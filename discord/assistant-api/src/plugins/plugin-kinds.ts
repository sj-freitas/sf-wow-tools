import type { GuildPlugin, PluginKind } from '@prisma/client';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { CHANNEL_CLEANUP } from './kinds/channel-cleanup';

/** What a plugin kind's code gets to work with. */
export interface PluginContext {
  bot: DiscordBotService;
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
  /** Checks what the backoffice sent; throws a BadRequestException that says what is wrong. */
  parseConfig(input: unknown, context: PluginContext): Promise<Config>;
  run(
    plugin: Omit<GuildPlugin, 'config'> & { config: Config },
    context: PluginContext,
    deadline: number,
  ): Promise<PluginRunOutcome>;
}

/** Every plugin kind, in the order the Plugins tab lists them. Add new kinds here. */
export const PLUGIN_KINDS: readonly PluginKindDef[] = [CHANNEL_CLEANUP as unknown as PluginKindDef];

export function pluginKind(kind: string): PluginKindDef | undefined {
  return PLUGIN_KINDS.find((def) => def.kind === kind);
}
