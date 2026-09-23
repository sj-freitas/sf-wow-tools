import type { InteractionType } from 'discord-interactions';

/**
 * Minimal shape of a Discord Interactions webhook payload — just the
 * fields command handlers actually use today. See the full schema at
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 * if a handler needs more (e.g. `data.options`, `member`).
 */
export interface DiscordInteraction {
  type: InteractionType;
  /** Absent when the command was invoked in a DM. */
  guild_id?: string;
  data?: {
    name: string;
  };
}
