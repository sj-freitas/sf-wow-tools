import { Injectable } from '@nestjs/common';
import { DiscordOAuthService } from '../auth/discord-oauth.service';
import { PrismaService } from '../database/prisma.service';
import { parseProfessionExport } from './profession-export';
import { ProfessionsService, type ImportResultDto } from './professions.service';

/** A guild an upload goes to. */
export interface UploadGuildDto {
  id: string;
  name: string;
}

/** Who an upload key is, and where its uploads go (the uploader shows it once a key is saved). */
export interface UploaderDto {
  user: { name: string };
  guilds: UploadGuildDto[];
}

/** One upload: the import into each of those guilds, as Import professions there would do. */
export interface UploadResultDto {
  guilds: (UploadGuildDto & { result: ImportResultDto })[];
}

/**
 * The Guild Assistant Uploader's uploads (discord/assistant-uploader), sent with an upload key
 * (src/upload-keys) whenever the game rewrites the addon's file. Each one is imported into every
 * guild of the player's, the same as dropping the file into each guild's Import professions.
 */
@Injectable()
export class ProfessionsUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordOAuthService,
    private readonly professions: ProfessionsService,
  ) {}

  /**
   * The player's guilds: the ones they could see at their last login on the site whose Discord
   * servers they are still in (a key outlives logins, and someone who left shouldn't keep
   * uploading there). By name.
   */
  async guilds(user: { id: string; discordId: string }): Promise<UploadGuildDto[]> {
    const access = await this.prisma.guildAccess.findMany({
      where: { userId: user.id },
      select: {
        guild: { select: { id: true, name: true, servers: { select: { discordId: true } } } },
      },
    });
    const stillIn = await Promise.all(
      access.map(async ({ guild }) => {
        const lookups = await Promise.allSettled(
          guild.servers.map((server) =>
            this.discord.fetchServerMember(server.discordId, user.discordId),
          ),
        );
        return lookups.some((lookup) => lookup.status === 'fulfilled')
          ? { id: guild.id, name: guild.name }
          : null;
      }),
    );
    return stillIn
      .filter((guild): guild is UploadGuildDto => guild !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async whoAmI(user: { id: string; discordId: string; displayName: string }): Promise<UploaderDto> {
    return { user: { name: user.displayName }, guilds: await this.guilds(user) };
  }

  /** `data`: the file as the game wrote it (or its export's JSON). */
  async upload(user: { id: string; discordId: string }, data: unknown): Promise<UploadResultDto> {
    // A file with no export in it fails before anything else, with what's wrong with it.
    parseProfessionExport(data);
    const results: UploadResultDto['guilds'] = [];
    for (const guild of await this.guilds(user)) {
      results.push({ ...guild, result: await this.professions.import(user, guild.id, data) });
    }
    return { guilds: results };
  }
}
