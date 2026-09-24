import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Honeypot, HoneypotAction, HoneypotEvent } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService, type ServerChannel } from '../discord/discord-bot.service';
import { describeDiscordError } from '../discord/discord-errors';
import { parseSnowflake } from '../tasks/post-task';

export interface HoneypotEventDto {
  id: string;
  discordUserId: string;
  username: string | null;
  action: HoneypotAction;
  error: string | null;
  at: string;
}

export interface HoneypotDto {
  id: string;
  name: string;
  enabled: boolean;
  /** Test mode only logs what would happen; nothing is banned. */
  testMode: boolean;
  serverId: string;
  channelId: string;
  logChannelId: string;
  createdChannel: boolean;
  recentEvents: HoneypotEventDto[];
}

export interface HoneypotInput {
  name?: unknown;
  enabled?: unknown;
  testMode?: unknown;
  /** Must be true to create a honeypot in, or switch one to, live mode (real bans). */
  confirmLive?: unknown;
  serverId?: unknown;
  /** Use this existing channel... */
  channelId?: unknown;
  /** ...or have the bot create one with this name and topic. */
  newChannelName?: unknown;
  topic?: unknown;
  /** Posted in the channel once, e.g. a warning. */
  initialPost?: unknown;
  logServerId?: unknown;
  logChannelId?: unknown;
}

const CHANNEL_NAME = /^[a-z0-9][a-z0-9_-]{1,99}$/;

@Injectable()
export class HoneypotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  async list(guildId: string): Promise<HoneypotDto[]> {
    const honeypots = await this.prisma.honeypot.findMany({
      where: { guildId },
      orderBy: { createdAt: 'asc' },
      include: { events: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    return honeypots.map((honeypot) => this.toDto(honeypot, honeypot.events));
  }

  async create(guildId: string, userId: string, input: HoneypotInput): Promise<HoneypotDto> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { officerRoleId: true, servers: { select: { discordId: true } } },
    });
    if (!guild) throw new NotFoundException('Guild not found');
    if (!guild.officerRoleId) {
      throw new BadRequestException(
        "Set the guild's Officer role first (Manage guild → Discord roles), so Officers are never banned.",
      );
    }

    const testMode = input.testMode === undefined ? true : input.testMode === true;
    if (!testMode && input.confirmLive !== true) {
      throw new BadRequestException('Confirm that you want to ban people for real.');
    }
    const name = this.parseName(input.name);
    const serverId = parseSnowflake(input.serverId, 'The server');
    const logServerId = parseSnowflake(input.logServerId, 'The log channel server');
    const logChannelId = parseSnowflake(input.logChannelId, 'The log channel');
    const guildServerIds = new Set(guild.servers.map((server) => server.discordId));
    if (!guildServerIds.has(serverId) || !guildServerIds.has(logServerId)) {
      throw new BadRequestException('That server is not part of this guild.');
    }
    const topic = typeof input.topic === 'string' ? input.topic.trim().slice(0, 1024) : '';
    const initialPost = typeof input.initialPost === 'string' ? input.initialPost.trim() : '';
    if (initialPost.length > 2000) {
      throw new BadRequestException('The first post can have at most 2000 characters.');
    }

    await this.assertChannel(logServerId, logChannelId, 'log channel');

    let channel: ServerChannel;
    let createdChannel = false;
    if (typeof input.channelId === 'string' && input.channelId !== '') {
      const channelId = parseSnowflake(input.channelId, 'The channel');
      await this.assertChannel(serverId, channelId, 'honeypot channel');
      channel = { id: channelId, name };
    } else {
      const newName = typeof input.newChannelName === 'string' ? input.newChannelName.trim() : '';
      if (!CHANNEL_NAME.test(newName)) {
        throw new BadRequestException(
          'The new channel name must be lower case letters, numbers, - or _ (2 to 100 characters).',
        );
      }
      try {
        channel = await this.bot.createTextChannel(serverId, {
          name: newName,
          topic: topic === '' ? undefined : topic,
        });
      } catch (error) {
        throw new BadRequestException(
          `Could not create the channel: ${describeDiscordError(error)}`,
        );
      }
      createdChannel = true;
    }

    if (initialPost !== '') {
      try {
        await this.bot.postMessage(channel.id, initialPost);
      } catch (error) {
        throw new BadRequestException(
          `Could not post in the channel: ${describeDiscordError(error)}`,
        );
      }
    }

    try {
      const honeypot = await this.prisma.honeypot.create({
        data: {
          guildId,
          name,
          testMode,
          discordServerId: serverId,
          channelId: channel.id,
          logChannelId,
          createdChannel,
          createdById: userId,
        },
      });
      return this.toDto(honeypot, []);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('That channel already is a honeypot.');
      }
      throw error;
    }
  }

  async update(honeypotId: string, input: HoneypotInput): Promise<HoneypotDto> {
    const honeypot = await this.find(honeypotId);
    const testMode = input.testMode === undefined ? honeypot.testMode : input.testMode === true;
    if (honeypot.testMode && !testMode && input.confirmLive !== true) {
      throw new BadRequestException('Confirm that you want to ban people for real.');
    }
    const updated = await this.prisma.honeypot.update({
      where: { id: honeypotId },
      data: {
        name: input.name === undefined ? honeypot.name : this.parseName(input.name),
        enabled: input.enabled === undefined ? honeypot.enabled : input.enabled === true,
        testMode,
      },
      include: { events: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    return this.toDto(updated, updated.events);
  }

  async remove(honeypotId: string): Promise<void> {
    await this.find(honeypotId);
    await this.prisma.honeypot.delete({ where: { id: honeypotId } });
  }

  async events(honeypotId: string): Promise<HoneypotEventDto[]> {
    await this.find(honeypotId);
    const events = await this.prisma.honeypotEvent.findMany({
      where: { honeypotId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return events.map(toEventDto);
  }

  async guildIdOf(honeypotId: string): Promise<string> {
    return (await this.find(honeypotId)).guildId;
  }

  private async find(honeypotId: string): Promise<Honeypot> {
    const honeypot = await this.prisma.honeypot.findUnique({ where: { id: honeypotId } });
    if (!honeypot) throw new NotFoundException('Honeypot not found');
    return honeypot;
  }

  private parseName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name === '' || name.length > 80) {
      throw new BadRequestException('Give the honeypot a name (up to 80 characters).');
    }
    return name;
  }

  private async assertChannel(serverId: string, channelId: string, what: string): Promise<void> {
    let channels: ServerChannel[];
    try {
      channels = await this.bot.listTextChannels(serverId);
    } catch (error) {
      throw new BadRequestException(
        `Could not read the server's channels: ${describeDiscordError(error)}`,
      );
    }
    if (!channels.some((channel) => channel.id === channelId)) {
      throw new BadRequestException(`That ${what} is not in the chosen server.`);
    }
  }

  private toDto(honeypot: Honeypot, events: HoneypotEvent[]): HoneypotDto {
    return {
      id: honeypot.id,
      name: honeypot.name,
      enabled: honeypot.enabled,
      testMode: honeypot.testMode,
      serverId: honeypot.discordServerId,
      channelId: honeypot.channelId,
      logChannelId: honeypot.logChannelId,
      createdChannel: honeypot.createdChannel,
      recentEvents: events.map(toEventDto),
    };
  }
}

const toEventDto = (event: HoneypotEvent): HoneypotEventDto => ({
  id: event.id,
  discordUserId: event.discordUserId,
  username: event.username,
  action: event.action,
  error: event.error,
  at: event.createdAt.toISOString(),
});
