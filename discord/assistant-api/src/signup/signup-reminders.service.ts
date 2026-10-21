import { BadRequestException, Injectable } from '@nestjs/common';
import { formatCharacterName } from '../characters/character-name';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService, type GuildMemberInfo } from '../discord/discord-bot.service';
import { isDiscordError } from '../discord/discord-errors';
import type { EventRow, SignupGuild } from './signup-events.service';
import { messageUrl, renderReminder } from './signup-messages';

/** Discord's "Cannot send messages to this user" (they don't accept DMs from server members). */
const CANNOT_DM = 50007;

export interface MissingPersonDto {
  discordUserId: string;
  name: string;
  /** Their characters in the guild, if any. */
  characters: string[];
  /** Holds the guild's Raider role in its main server. */
  isRaider: boolean;
  reminders: number;
  lastReminderAt: string | null;
  /** Whether the last reminder reached them (null: never reminded). */
  lastDelivered: boolean | null;
}

export interface MissingDto {
  /** `known`: Discord would not list the servers' members, so only people with characters. */
  source: 'servers' | 'known';
  /** Whether the guild has a Raider role set (else the "Raiders only" filter does nothing). */
  hasRaiderRole: boolean;
  people: MissingPersonDto[];
}

/** Who hasn't answered an event yet, and reminding them by DM. */
@Injectable()
export class SignupRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordBotService,
  ) {}

  /**
   * Everyone in the guild's Discord servers (people, not bots) without a sign-up to the event,
   * characters or not. Without the bot's member list, falls back to people with characters.
   */
  async missing(guild: SignupGuild, event: EventRow): Promise<MissingDto> {
    const main = guild.servers.find((server) => server.isMain)?.discordId;
    const [raider, players, contacts] = await Promise.all([
      this.prisma.guildRoleMapping.findUnique({
        where: { guildId_guildRole: { guildId: guild.id, guildRole: 'RAIDER' } },
        select: { discordRoleId: true },
      }),
      this.prisma.player.findMany({
        where: { characters: { some: { guilds: { some: { guildId: guild.id } } } } },
        select: {
          discordUserId: true,
          discordDisplayName: true,
          discordUsername: true,
          characters: {
            where: { guilds: { some: { guildId: guild.id } } },
            select: { firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.signupContact.findMany({
        where: { eventId: event.id },
        orderBy: { sentAt: 'desc' },
        select: { discordUserId: true, sentAt: true, delivered: true },
      }),
    ]);

    const people = new Map<string, { name: string; roles: string[] | null }>();
    let listed = false;
    for (const server of guild.servers) {
      let members: GuildMemberInfo[];
      try {
        members = await this.discord.listGuildMembers(server.discordId);
      } catch {
        continue;
      }
      listed = true;
      for (const member of members) {
        if (member.bot) continue;
        const known = people.get(member.id);
        people.set(member.id, {
          name: known?.name ?? member.nick ?? member.name,
          // Ranks are roles of the main server.
          roles: server.discordId === main ? member.roles : (known?.roles ?? null),
        });
      }
    }
    if (!listed) {
      for (const player of players) {
        people.set(player.discordUserId, {
          name: player.discordDisplayName ?? player.discordUsername ?? player.discordUserId,
          roles: null,
        });
      }
    }

    const answered = new Set(event.entries.map((entry) => entry.discordUserId));
    const characters = new Map(
      players.map((player) => [player.discordUserId, player.characters.map(formatCharacterName)]),
    );
    const result: MissingPersonDto[] = [];
    for (const [discordUserId, person] of people) {
      if (answered.has(discordUserId)) continue;
      const theirs = contacts.filter((contact) => contact.discordUserId === discordUserId);
      result.push({
        discordUserId,
        name: person.name,
        characters: characters.get(discordUserId) ?? [],
        isRaider: raider !== null && (person.roles ?? []).includes(raider.discordRoleId),
        reminders: theirs.length,
        lastReminderAt: theirs[0]?.sentAt.toISOString() ?? null,
        lastDelivered: theirs[0]?.delivered ?? null,
      });
    }
    result.sort(
      (a, b) =>
        Number(b.characters.length > 0) - Number(a.characters.length > 0) ||
        a.name.localeCompare(b.name),
    );
    return { source: listed ? 'servers' : 'known', hasRaiderRole: raider !== null, people: result };
  }

  /**
   * DMs one person a link to the event's sign-up post, and records it (as many times as
   * organisers like). Not delivered when they don't accept DMs; still recorded.
   */
  async remind(
    guild: SignupGuild,
    event: EventRow,
    sender: { discordId: string; name: string },
    discordUserId: string,
  ): Promise<{ delivered: boolean; sentAt: string }> {
    if (!event.messageId) {
      throw new BadRequestException('The event is not in Discord. Post it again first.');
    }
    const { embed, components } = renderReminder(
      event,
      guild.name,
      sender.name,
      messageUrl(event.serverId, event.channelId, event.messageId),
    );
    let delivered = true;
    try {
      await this.discord.sendDirectMessage(discordUserId, embed, components);
    } catch (error) {
      if (!isDiscordError(error, CANNOT_DM)) {
        throw new BadRequestException('Discord could not send the message. Try again later.');
      }
      delivered = false;
    }
    const contact = await this.prisma.signupContact.create({
      data: {
        eventId: event.id,
        discordUserId,
        sentByDiscordId: sender.discordId,
        sentByName: sender.name,
        delivered,
      },
    });
    return { delivered, sentAt: contact.sentAt.toISOString() };
  }
}
