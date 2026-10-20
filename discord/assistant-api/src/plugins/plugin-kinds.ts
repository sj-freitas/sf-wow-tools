import { Injectable } from '@nestjs/common';
import type { GuildPlugin, PluginKind } from '@prisma/client';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { CHANNEL_CLEANUP } from './kinds/channel-cleanup';

/** What a plugin kind's code gets to work with. */
export interface PluginContext {
  bot: DiscordBotService;
  /** The plugin's guild. */
  guildId: string;
  /** The Discord servers of the plugin's guild. */
  serverIds: readonly string[];
  /** Now, in ms (replaced in tests). */
  clock: () => number;
}

/** The outcome of one run. */
export interface PluginRunOutcome {
  /** What was done, in plain language ("Deleted 120 messages."). */
  result: string;
  /** Saved for the next run. */
  state: Record<string, unknown>;
  /** The work isn't finished: carry on in a minute instead of waiting for the next occurrence. */
  more?: boolean;
}

/**
 * A kind of plugin: what the Plugins tab offers to add. Each kind validates its own settings
 * (`config`) and does its own work; scheduling, leases and run history are shared.
 */
export interface PluginKindDef<Config = Record<string, unknown>> {
  kind: PluginKind;
  label: string;
  description: string;
  /** How often it may run; left out: daily, weekly or monthly. */
  scheduleKinds?: readonly ('DAILY' | 'WEEKLY' | 'MONTHLY')[];
  /** Checks what the backoffice sent; throws a BadRequestException that says what is wrong. */
  parseConfig(input: unknown, context: PluginContext): Promise<Config>;
  run(
    plugin: Omit<GuildPlugin, 'config'> & { config: Config },
    context: PluginContext,
    deadline: number,
  ): Promise<PluginRunOutcome>;
}

/**
 * The plugin kinds there are, in the order the Plugins tab lists them. Channel Clean Up is built
 * in; a feature that can be taken out on its own adds its kind from its own module (event
 * sign-ups add Recurring Event, `src/signup/recurring-event.plugin.ts`) with `add` when it starts.
 */
@Injectable()
export class PluginKindRegistry {
  private readonly kinds: PluginKindDef[] = [CHANNEL_CLEANUP as unknown as PluginKindDef];

  add<Config>(def: PluginKindDef<Config>): void {
    if (this.get(def.kind)) return;
    this.kinds.push(def as unknown as PluginKindDef);
  }

  all(): readonly PluginKindDef[] {
    return this.kinds;
  }

  get(kind: string): PluginKindDef | undefined {
    return this.kinds.find((def) => def.kind === kind);
  }
}
