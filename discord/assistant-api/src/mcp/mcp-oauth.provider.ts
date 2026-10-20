import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { AuthService } from '../auth/auth.service';
import { CacheService } from '../cache/cache.service';
import { siteOrigin } from '../config/site-origin';
import { Sealer } from './sealed';

/** How long the user has to approve a connection, and the client to swap its code for a token. */
const CONSENT_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;

/** What the consent page shows and acts on (sealed into its address). */
export interface ConsentRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}

/** An authorization code: the access token itself, sealed, until the client proves PKCE. */
interface AuthorizationCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  accessToken: string;
  expiresAt: number;
}

/**
 * The OAuth side of the MCP server (the SDK's `mcpAuthRouter` serves the endpoints). Signing in
 * is the backoffice's Discord login: `authorize` sends the user to a consent page, which logs
 * them in first if needed. The access token is a session of their own (`createLinkedSession`),
 * so the MCP server sees exactly what the user can see in the backoffice. Nothing is stored
 * besides that session: client registrations, consent requests and codes are sealed values.
 */
@Injectable()
export class McpOAuthProvider implements OAuthServerProvider {
  readonly origin: string;
  /** The MCP endpoint, as clients address it (the OAuth "resource"). */
  readonly resourceUrl: URL;
  private readonly clients: Sealer;
  private readonly consents: Sealer;
  private readonly codes: Sealer;

  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
    private readonly cache: CacheService,
  ) {
    this.origin = siteOrigin(config);
    this.resourceUrl = new URL('/api/mcp', this.origin);
    const secret = config.getOrThrow<string>('SESSION_ENCRYPTION_KEY');
    this.clients = new Sealer(secret, 'client');
    this.consents = new Sealer(secret, 'consent');
    this.codes = new Sealer(secret, 'code');
  }

  /** Clients register themselves (dynamic registration); their client id is their sealed details. */
  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.clients.open<OAuthClientInformationFull>(clientId),
      // The SDK has already given it a random id: replaced by the sealed details.
      registerClient: (client) => {
        const details: Partial<OAuthClientInformationFull> = { ...client };
        delete details.client_id;
        return { ...client, client_id: this.clients.seal(details) };
      },
    };
  }

  /** The address of the consent page for one request (the user may need to log in on the way). */
  consentUrl(request: ConsentRequest): string {
    return `/api/mcp-oauth/consent?request=${this.consents.seal(request, CONSENT_TTL_MS)}`;
  }

  openConsent(sealed: string): ConsentRequest | undefined {
    return this.consents.open<ConsentRequest>(sealed);
  }

  authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    res.redirect(
      this.consentUrl({
        clientId: client.client_id,
        clientName: client.client_name || client.client_uri || 'An AI app',
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
      }),
    );
    return Promise.resolve();
  }

  /** After the user approved: their new session, sealed into a short-lived code. */
  async issueCode(request: ConsentRequest, browserSessionToken: string): Promise<string> {
    const { token, expiresAt } = await this.auth.createLinkedSession(browserSessionToken);
    const code: AuthorizationCode = {
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      accessToken: token,
      expiresAt: expiresAt.getTime(),
    };
    return this.codes.seal(code, CODE_TTL_MS);
  }

  challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    return Promise.resolve(this.readCode(client, authorizationCode).codeChallenge);
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const code = this.readCode(client, authorizationCode);
    if (redirectUri !== undefined && redirectUri !== code.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the one used to authorize');
    }
    // A code works once (the cache remembers it for as long as it would be valid).
    const usedKey = `mcp-code-used:${createHash('sha256').update(authorizationCode).digest('hex')}`;
    if (await this.cache.get<boolean>(usedKey)) {
      throw new InvalidGrantError('This authorization code was already used');
    }
    await this.cache.set(usedKey, true, CODE_TTL_MS);
    return {
      access_token: code.accessToken,
      token_type: 'Bearer',
      expires_in: Math.max(0, Math.floor((code.expiresAt - Date.now()) / 1000)),
    };
  }

  /** No refresh tokens: the Discord token behind a session can't be renewed, so clients reconnect. */
  exchangeRefreshToken(): Promise<OAuthTokens> {
    return Promise.reject(new InvalidGrantError('Refresh tokens are not issued: connect again'));
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const user = await this.auth.findUserBySessionToken(token);
    if (!user) throw new InvalidTokenError('Invalid or expired token');
    return { token, clientId: 'guild-assistant', scopes: [], extra: { user } };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    await this.auth.logout(request.token);
  }

  private readCode(client: OAuthClientInformationFull, sealed: string): AuthorizationCode {
    const code = this.codes.open<AuthorizationCode>(sealed);
    if (!code || code.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    return code;
  }
}
