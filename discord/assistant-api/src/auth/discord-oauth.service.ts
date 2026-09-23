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

export interface DiscordRole {
  id: string;
  name: string;
}

@Injectable()
export class DiscordOAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly botToken: string;
  readonly redirectUri: string;

  constructor(configService: ConfigService) {
    this.clientId = configService.getOrThrow<string>('DISCORD_APPLICATION_ID');
    this.clientSecret = configService.getOrThrow<string>('DISCORD_CLIENT_SECRET');
    this.botToken = configService.getOrThrow<string>('DISCORD_TOKEN');
    this.redirectUri = configService.getOrThrow<string>('DISCORD_OAUTH_REDIRECT_URI');
  }

  /** `prompt: 'none'` skips Discord's consent screen for already-authorized users. */
  buildAuthorizeUrl(state: string, prompt: 'none' | 'consent'): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'identify guilds guilds.members.read',
      state,
      prompt,
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
    return this.get<DiscordUser>('/users/@me', `Bearer ${accessToken}`);
  }

  fetchGuilds(accessToken: string): Promise<DiscordPartialGuild[]> {
    return this.get<DiscordPartialGuild[]>('/users/@me/guilds', `Bearer ${accessToken}`);
  }

  /** The user's own member record (role ids) in a server. Needs `guilds.members.read`. */
  fetchGuildMember(accessToken: string, guildId: string): Promise<{ roles: string[] }> {
    return this.get<{ roles: string[] }>(
      `/users/@me/guilds/${guildId}/member`,
      `Bearer ${accessToken}`,
    );
  }

  /** All roles of a server, read with the bot token (the bot must be in the server). */
  fetchGuildRoles(guildId: string): Promise<DiscordRole[]> {
    return this.get<DiscordRole[]>(`/guilds/${guildId}/roles`, `Bot ${this.botToken}`);
  }

  private async get<T>(path: string, authorization: string): Promise<T> {
    const response = await fetch(`${DISCORD_API}${path}`, {
      headers: { Authorization: authorization },
    });
    if (!response.ok) {
      throw new UnauthorizedException(`Discord request ${path} failed (${response.status})`);
    }
    return (await response.json()) as T;
  }
}
