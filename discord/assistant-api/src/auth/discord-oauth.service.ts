import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DISCORD_API = 'https://discord.com/api/v10';

export interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

export interface DiscordPartialGuild {
  id: string;
}

@Injectable()
export class DiscordOAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  readonly redirectUri: string;

  constructor(configService: ConfigService) {
    this.clientId = configService.getOrThrow<string>('DISCORD_APPLICATION_ID');
    this.clientSecret = configService.getOrThrow<string>('DISCORD_CLIENT_SECRET');
    this.redirectUri = configService.getOrThrow<string>('DISCORD_OAUTH_REDIRECT_URI');
  }

  buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state,
      prompt: 'none',
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<string> {
    const response = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      }),
    });
    if (!response.ok) {
      throw new UnauthorizedException('Discord rejected the login code');
    }
    const body = (await response.json()) as { access_token: string };
    return body.access_token;
  }

  fetchUser(accessToken: string): Promise<DiscordUser> {
    return this.get<DiscordUser>('/users/@me', accessToken);
  }

  fetchGuilds(accessToken: string): Promise<DiscordPartialGuild[]> {
    return this.get<DiscordPartialGuild[]>('/users/@me/guilds', accessToken);
  }

  private async get<T>(path: string, accessToken: string): Promise<T> {
    const response = await fetch(`${DISCORD_API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new UnauthorizedException(`Discord request ${path} failed (${response.status})`);
    }
    return (await response.json()) as T;
  }
}
