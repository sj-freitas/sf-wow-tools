import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthService } from '../auth/auth.service';
import { CacheService } from '../cache/cache.service';
import { MemoryCacheStore } from '../cache/cache-store';
import { McpOAuthProvider } from './mcp-oauth.provider';
import { Sealer } from './sealed';

function setup() {
  const config = {
    get: (key: string) => (key === 'SITE_URL' ? 'https://guild.test' : undefined),
    getOrThrow: () => 'secret',
  } as unknown as ConfigService;
  const auth = {
    createLinkedSession: async () => ({
      token: 'mcp-session',
      expiresAt: new Date(Date.now() + 3600_000),
    }),
  } as unknown as AuthService;
  const provider = new McpOAuthProvider(config, auth, new CacheService(new MemoryCacheStore()));
  const client = provider.clientsStore.registerClient!({
    client_id: 'random',
    redirect_uris: ['https://app.test/callback'],
    client_name: 'Test app',
  } as OAuthClientInformationFull) as OAuthClientInformationFull;
  return { provider, client };
}

const request = (clientId: string) => ({
  clientId,
  clientName: 'Test app',
  redirectUri: 'https://app.test/callback',
  codeChallenge: 'challenge',
  state: 'xyz',
});

describe('McpOAuthProvider', () => {
  it('serves the MCP endpoint on the site', () => {
    assert.equal(setup().provider.resourceUrl.href, 'https://guild.test/api/mcp');
  });

  it('keeps a registered client in its id', async () => {
    const { provider, client } = setup();
    assert.notEqual(client.client_id, 'random');
    const found = await provider.clientsStore.getClient(client.client_id);
    assert.deepEqual(found?.redirect_uris, ['https://app.test/callback']);
    assert.equal(await provider.clientsStore.getClient('made-up'), undefined);
  });

  it('swaps a code for the session token, once', async () => {
    const { provider, client } = setup();
    const code = await provider.issueCode(request(client.client_id), 'browser-session');
    assert.equal(await provider.challengeForAuthorizationCode(client, code), 'challenge');
    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, undefined);
    assert.equal(tokens.access_token, 'mcp-session');
    assert.ok(tokens.expires_in! > 3500 && tokens.expires_in! <= 3600);
    await assert.rejects(provider.exchangeAuthorizationCode(client, code), /already used/);
  });

  it("rejects another client's code and a different redirect", async () => {
    const { provider, client } = setup();
    const other = { ...client, client_id: 'someone-else' };
    const code = await provider.issueCode(request(client.client_id), 'browser-session');
    await assert.rejects(provider.exchangeAuthorizationCode(other, code), /Invalid or expired/);
    await assert.rejects(
      provider.exchangeAuthorizationCode(client, code, undefined, 'https://evil.test/cb'),
      /redirect_uri/,
    );
  });
});

describe('Sealer', () => {
  it('opens only its own, unexpired values', () => {
    const codes = new Sealer('secret', 'code');
    const sealed = codes.seal({ a: 1 }, 1000);
    assert.deepEqual(codes.open(sealed), { a: 1 });
    assert.equal(new Sealer('secret', 'client').open(sealed), undefined);
    assert.equal(codes.open(sealed.slice(0, -2) + 'AA'), undefined);
    assert.equal(codes.open(codes.seal({ a: 1 }, -1)), undefined);
  });
});
