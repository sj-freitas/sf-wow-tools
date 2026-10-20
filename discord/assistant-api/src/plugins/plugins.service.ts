import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { GuildPlugin, PluginRun, Prisma, TaskRunStatus } from '@prisma/client';
import { DEFAULT_REGION, timezoneOfRegion } from '../config/regions';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import {
  describeSchedule,
  nextOccurrence,
  validateSchedule,
  type Schedule,
} from '../tasks/schedule';
import { PLUGIN_KINDS, pluginKind, type PluginContext } from './plugin-kinds';

/** Plugins repeat; posts are the only things that run once. */
export type PluginScheduleKind = 'DAILY' | 'WEEKLY' | 'MONTHLY';
const SCHEDULE_KINDS: readonly PluginScheduleKind[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

export interface PluginKindDto {
  kind: string;
  label: string;
  description: string;
}

export interface PluginRunDto {
  id: string;
  startedAt: string;
  status: TaskRunStatus;
  result: string | null;
  error: string | null;
}

export interface PluginDto {
  id: string;
  kind: string;
  kindLabel: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: PluginScheduleKind;
    timeOfDay: string;
    weekday: number | null;
    dayOfMonth: number | null;
  };
  /** e.g. "Every day at 02:00". */
  scheduleText: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: TaskRunStatus | null;
  lastError: string | null;
  lastResult: string | null;
  /** The kind's settings, e.g. a clean-up's server and channel. */
  config: Record<string, unknown>;
  recentRuns: PluginRunDto[];
}

export interface PluginInput {
  kind?: unknown;
  name?: unknown;
  enabled?: unknown;
  scheduleKind?: unknown;
  timeOfDay?: unknown;
  weekday?: unknown;
  dayOfMonth?: unknown;
  config?: unknown;
  /** Must be true to create a plugin: they delete things on their own, on a schedule. */
  confirm?: unknown;
}

const RECENT_RUNS = 5;
const MAX_NAME = 80;

/** Plugins of a guild, for the backoffice's Plugins tab (Officers only). */
@Injectable()
export class PluginsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: DiscordBotService,
  ) {}

  kinds(): PluginKindDto[] {
    return PLUGIN_KINDS.map(({ kind, label, description }) => ({ kind, label, description }));
  }

  async list(guildId: string): Promise<PluginDto[]> {
    const timezone = await this.timezoneOf(guildId);
    const plugins = await this.prisma.guildPlugin.findMany({
      where: { guildId },
      orderBy: { createdAt: 'asc' },
      include: { runs: { orderBy: { startedAt: 'desc' }, take: RECENT_RUNS } },
    });
    return plugins.map((plugin) => this.toDto(plugin, plugin.runs, timezone));
  }

  async create(guildId: string, userId: string, input: PluginInput): Promise<PluginDto> {
    const def = pluginKind(String(input.kind));
    if (!def) throw new BadRequestException('Pick a kind of plugin.');
    if (input.confirm !== true) {
      throw new BadRequestException('Confirm that this plugin may delete messages on its own.');
    }
    const timezone = await this.timezoneOf(guildId);
    const schedule = this.parseSchedule(input);
    const config = await def.parseConfig(input.config, await this.context(guildId));
    const plugin = await this.prisma.guildPlugin.create({
      data: {
        guildId,
        kind: def.kind,
        name: this.parseName(input.name, def.label),
        enabled: input.enabled !== false,
        scheduleKind: schedule.kind,
        timeOfDay: schedule.timeOfDay!,
        weekday: schedule.weekday ?? null,
        dayOfMonth: schedule.dayOfMonth ?? null,
        nextRunAt: nextOccurrence(schedule, timezone, new Date()),
        config: config as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
    return this.toDto(plugin, [], timezone);
  }

  /** Changes what is given: the name, the schedule, the settings, or pauses/resumes it. */
  async update(pluginId: string, input: PluginInput): Promise<PluginDto> {
    const plugin = await this.find(pluginId);
    const def = pluginKind(plugin.kind)!;
    const timezone = await this.timezoneOf(plugin.guildId);
    const data: Prisma.GuildPluginUpdateInput = {};
    if (input.name !== undefined) data.name = this.parseName(input.name, def.label);
    if (input.config !== undefined) {
      const config = await def.parseConfig(input.config, await this.context(plugin.guildId));
      data.config = config as Prisma.InputJsonValue;
      // Somewhere else now: an unfinished clean-up's place means nothing there.
      data.state = {};
    }
    const scheduleChanged = input.scheduleKind !== undefined || input.timeOfDay !== undefined;
    const schedule = scheduleChanged
      ? this.parseSchedule({
          scheduleKind: input.scheduleKind ?? plugin.scheduleKind,
          timeOfDay: input.timeOfDay ?? plugin.timeOfDay,
          weekday: input.weekday ?? plugin.weekday,
          dayOfMonth: input.dayOfMonth ?? plugin.dayOfMonth,
        })
      : this.scheduleOf(plugin);
    if (scheduleChanged) {
      data.scheduleKind = schedule.kind;
      data.timeOfDay = schedule.timeOfDay!;
      data.weekday = schedule.weekday ?? null;
      data.dayOfMonth = schedule.dayOfMonth ?? null;
    }
    if (input.enabled !== undefined) data.enabled = input.enabled === true;
    // Resumed or rescheduled: the next run is the next occurrence from now.
    if (scheduleChanged || (input.enabled === true && !plugin.enabled)) {
      data.nextRunAt = nextOccurrence(schedule, timezone, new Date());
    }
    const updated = await this.prisma.guildPlugin.update({
      where: { id: pluginId },
      data,
      include: { runs: { orderBy: { startedAt: 'desc' }, take: RECENT_RUNS } },
    });
    return this.toDto(updated, updated.runs, timezone);
  }

  /** Runs it within the minute; its schedule carries on as before. */
  async runNow(pluginId: string): Promise<void> {
    const plugin = await this.find(pluginId);
    if (!plugin.enabled) throw new BadRequestException('Resume the plugin first.');
    await this.prisma.guildPlugin.update({
      where: { id: pluginId },
      data: { nextRunAt: new Date() },
    });
  }

  async remove(pluginId: string): Promise<void> {
    await this.find(pluginId);
    await this.prisma.guildPlugin.delete({ where: { id: pluginId } });
  }

  async guildIdOf(pluginId: string): Promise<string> {
    return (await this.find(pluginId)).guildId;
  }

  async context(guildId: string): Promise<PluginContext> {
    const servers = await this.prisma.discordServer.findMany({
      where: { guildId },
      select: { discordId: true },
    });
    return { bot: this.bot, serverIds: servers.map((s) => s.discordId), clock: Date.now };
  }

  scheduleOf(plugin: GuildPlugin): Schedule {
    return {
      kind: plugin.scheduleKind,
      timeOfDay: plugin.timeOfDay,
      weekday: plugin.weekday,
      dayOfMonth: plugin.dayOfMonth,
    };
  }

  async timezoneOf(guildId: string): Promise<string> {
    const guild = await this.prisma.guild.findUnique({
      where: { id: guildId },
      select: { region: true },
    });
    if (!guild) throw new NotFoundException('Guild not found');
    return timezoneOfRegion(guild.region ?? DEFAULT_REGION);
  }

  private parseSchedule(input: PluginInput): Schedule {
    const kind = input.scheduleKind as PluginScheduleKind;
    if (!SCHEDULE_KINDS.includes(kind)) {
      throw new BadRequestException('Pick how often: daily, weekly or monthly.');
    }
    const schedule: Schedule = {
      kind,
      timeOfDay: typeof input.timeOfDay === 'string' ? input.timeOfDay : null,
      weekday: kind === 'WEEKLY' ? Number(input.weekday) : null,
      dayOfMonth: kind === 'MONTHLY' ? Number(input.dayOfMonth) : null,
    };
    const problems = validateSchedule(schedule);
    if (problems.length > 0) throw new BadRequestException(problems.join(' '));
    return schedule;
  }

  private parseName(value: unknown, fallback: string): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name.length > MAX_NAME) {
      throw new BadRequestException(`The name can have at most ${MAX_NAME} characters.`);
    }
    return name || fallback;
  }

  private async find(pluginId: string): Promise<GuildPlugin> {
    const plugin = await this.prisma.guildPlugin.findUnique({ where: { id: pluginId } });
    if (!plugin) throw new NotFoundException('Plugin not found');
    return plugin;
  }

  private toDto(plugin: GuildPlugin, runs: PluginRun[], timezone: string): PluginDto {
    const schedule = this.scheduleOf(plugin);
    return {
      id: plugin.id,
      kind: plugin.kind,
      kindLabel: pluginKind(plugin.kind)?.label ?? plugin.kind,
      name: plugin.name,
      enabled: plugin.enabled,
      schedule: {
        kind: plugin.scheduleKind as PluginScheduleKind,
        timeOfDay: plugin.timeOfDay,
        weekday: plugin.weekday,
        dayOfMonth: plugin.dayOfMonth,
      },
      scheduleText: describeSchedule(schedule, timezone),
      nextRunAt: plugin.enabled ? (plugin.nextRunAt?.toISOString() ?? null) : null,
      lastRunAt: plugin.lastRunAt?.toISOString() ?? null,
      lastStatus: plugin.lastStatus,
      lastError: plugin.lastError,
      lastResult: plugin.lastResult,
      config: plugin.config as Record<string, unknown>,
      recentRuns: runs.map((run) => ({
        id: run.id,
        startedAt: run.startedAt.toISOString(),
        status: run.status,
        result: run.result,
        error: run.error,
      })),
    };
  }
}
