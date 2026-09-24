import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DISCORD_API = 'https://discord.com/api/v10';
const MAX_MEMBER_PAGES = 10;

/** A failed Discord API call. Status 401 means the access token was rejected. */
export class DiscordApiError extends UnauthorizedException {
  constructor(
    readonly discordStatus: number,
    message: string,
  ) {
    super(message);
  }
}

export interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

export interface DiscordPartialGuild {
  id: string;
  name: string;
}

export interface DiscordProfile {
  id: string;
  username: string;
  global_name: string | null;
  bot?: boolean;
}

export interface DiscordServerMember {
  nick: string | null;
  /** Ids of the roles the member holds in the server. */
  roles: string[];
  user: DiscordProfile;
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

  async exchangeCode(code: string): Promise<{ accessToken: string; expiresIn: number }> {
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
    const body = (await response.json()) as { access_token: string; expires_in: number };
    return { accessToken: body.access_token, expiresIn: body.expires_in };
  }

  fetchUser(accessToken: string): Promise<DiscordUser> {
    return this.get<DiscordUser>('/users/@me', `Bearer ${accessToken}`);
  }

  fetchGuilds(accessToken: string): Promise<DiscordPartialGuild[]> {
    return this.get<DiscordPartialGuild[]>('/users/@me/guilds', `Bearer ${accessToken}`);
  }

  /** Ids of every server the bot is in (paginated, 200 per page). */
  async fetchBotGuildIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    let after: string | undefined;
    for (;;) {
      const query = new URLSearchParams({ limit: '200', ...(after && { after }) });
      const page = await this.get<DiscordPartialGuild[]>(
        `/users/@me/guilds?${query.toString()}`,
        `Bot ${this.botToken}`,
      );
      page.forEach((guild) => ids.add(guild.id));
      if (page.length < 200) {
        return ids;
      }
      after = page[page.length - 1].id;
    }
  }

  /** Any user's public profile by id, read with the bot token (no intent needed). */
  fetchUserById(userId: string): Promise<DiscordProfile> {
    return this.get<DiscordProfile>(`/users/${userId}`, `Bot ${this.botToken}`);
  }

  /**
   * A user's member record in a server, read with the bot token. Fails (404)
   * when the user isn't in the server; needs the bot to be in the server.
   */
  fetchServerMember(serverId: string, userId: string): Promise<DiscordServerMember> {
    return this.get<DiscordServerMember>(
      `/guilds/${serverId}/members/${userId}`,
      `Bot ${this.botToken}`,
    );
  }

  /**
   * Every human member of a server, read with the bot token in pages of 1000
   * (capped at MAX_MEMBER_PAGES pages). Discord only allows this when the
   * Server Members privileged intent is enabled for the application.
   */
  async fetchServerMembers(serverId: string): Promise<DiscordServerMember[]> {
    const members: DiscordServerMember[] = [];
    let after = '0';
    for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
      const batch = await this.get<DiscordServerMember[]>(
        `/guilds/${serverId}/members?limit=1000&after=${after}`,
        `Bot ${this.botToken}`,
      );
      members.push(...batch.filter((member) => !member.user.bot));
      if (batch.length < 1000) {
        break;
      }
      after = batch[batch.length - 1].user.id;
    }
    return members;
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
      throw new DiscordApiError(
        response.status,
        `Discord request ${path} failed (${response.status})`,
      );
    }
    return (await response.json()) as T;
  }
}
