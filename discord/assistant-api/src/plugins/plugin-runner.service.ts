import { Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';
import { Prisma, type GuildPlugin } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { describeDiscordError } from '../discord/discord-errors';
import { ProblemsService, type ProblemTask } from '../problems/problems.service';
import { nextOccurrence } from '../tasks/schedule';
import { PluginsService } from './plugins.service';

const TICK_MS = 60 * 1000;
const LEASE_MINUTES = 5;
/** A run stops this long after it starts, well within its lease, and carries on in a minute. */
export const RUN_BUDGET_MS = 3 * 60 * 1000;
const CARRY_ON_MS = 60 * 1000;
/** A failed run is tried again after RETRY_DELAY_MS, up to MAX_ATTEMPTS within RETRY_WINDOW_MS. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const RETRY_WINDOW_MS = 30 * 60 * 1000;

/**
 * Runs the plugins that are due, once a minute, in the background worker. Like scheduled tasks,
 * a due plugin is claimed in the database (`FOR UPDATE SKIP LOCKED` plus a lease) so several
 * workers never run it twice. One that was due while no worker ran runs once when one starts.
 */
@Injectable()
export class PluginRunnerService implements OnApplicationShutdown {
  private readonly logger = new Logger(PluginRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginsService,
    // Guild problems: a failure an officer can fix is reported to them, once.
    @Optional() private readonly problems?: ProblemsService,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass: claim due plugins and run them. Never throws. */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let ran = 0;
    try {
      for (const id of await this.claimDue()) {
        const plugin = await this.prisma.guildPlugin.findUnique({ where: { id } });
        if (!plugin) continue;
        await this.run(plugin);
        ran++;
      }
    } catch (error) {
      this.logger.error(`Plugin tick failed: ${String(error)}`);
    } finally {
      this.ticking = false;
    }
    return ran;
  }

  /** Runs one plugin, records the run and decides when it runs next. Never throws. */
  async run(plugin: GuildPlugin, now: Date = new Date()): Promise<void> {
    const def = this.plugins.kind(plugin.kind);
    let result: string | null = null;
    let error: string | null = null;
    let state = plugin.state as Record<string, unknown>;
    let more = false;
    let quiet = false;
    const config = plugin.config as { channelId?: string } | null;
    const problem: ProblemTask = {
      guildId: plugin.guildId,
      source: 'PLUGIN',
      id: plugin.id,
      label: plugin.name,
      channelId: config?.channelId ?? null,
      // Channel Cleanup deletes messages, Recurring Event empties its channel and posts; others post.
      use:
        plugin.kind === 'CHANNEL_CLEANUP'
          ? 'cleanup'
          : plugin.kind === 'RECURRING_EVENT'
            ? 'recurring'
            : 'post',
    };
    try {
      if (!def) throw new Error(`Unknown kind of plugin: ${plugin.kind}`);
      const context = await this.plugins.context(plugin.guildId);
      // The config was checked by the kind when saved.
      const configured = { ...plugin, config: plugin.config as Record<string, unknown> };
      const outcome = await def.run(configured, context, now.getTime() + RUN_BUDGET_MS);
      ({ result, state, more = false, quiet = false } = outcome);
      await this.problems?.clear(problem);
    } catch (caught) {
      error = describeDiscordError(caught);
      this.logger.warn(`Plugin ${plugin.id} (${plugin.name}) failed: ${String(caught)}`);
      await this.problems?.report(problem, caught);
    }

    const finished = new Date();
    const status = error ? 'FAILED' : 'SUCCESS';
    // A run that did nothing stays out of the history (the plugin's last run still says it ran).
    if (error || !quiet) {
      await this.prisma.pluginRun.create({
        data: { pluginId: plugin.id, startedAt: now, finishedAt: finished, status, result, error },
      });
    }

    const timezone = await this.plugins.zoneOf(plugin);
    const retry = error !== null && (await this.shouldRetry(plugin.id, now));
    const nextRunAt = more
      ? new Date(finished.getTime() + CARRY_ON_MS)
      : retry
        ? new Date(finished.getTime() + RETRY_DELAY_MS)
        : nextOccurrence(this.plugins.scheduleOf(plugin), timezone, finished);
    await this.prisma.guildPlugin.update({
      where: { id: plugin.id },
      data: {
        lastRunAt: now,
        lastStatus: status,
        lastError: error,
        lastResult: result,
        nextRunAt,
        leaseUntil: null,
        state: state as Prisma.InputJsonValue,
      },
    });
  }

  private async shouldRetry(pluginId: string, now: Date): Promise<boolean> {
    const failures = await this.prisma.pluginRun.count({
      where: {
        pluginId,
        status: 'FAILED',
        finishedAt: { gte: new Date(now.getTime() - RETRY_WINDOW_MS) },
      },
    });
    return failures < MAX_ATTEMPTS;
  }

  private async claimDue(): Promise<string[]> {
    // Our own constant, inlined so Postgres sees a plain literal.
    const lease = Prisma.raw(`interval '${LEASE_MINUTES} minutes'`);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE guild_plugins
      SET lease_until = now() + ${lease}
      WHERE id IN (
        SELECT id FROM guild_plugins
        WHERE enabled
          AND next_run_at IS NOT NULL
          AND next_run_at <= now()
          AND (lease_until IS NULL OR lease_until < now())
        ORDER BY next_run_at
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    return rows.map((row) => row.id);
  }
}
