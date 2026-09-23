import type { InteractionType } from 'discord-interactions';

/**
 * Minimal shape of a Discord Interactions webhook payload — just the
 * fields command handlers actually use today. See the full schema at
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 * if a handler needs more (e.g. `data.options`, `member`).
 */
export interface DiscordInteractionOption {
  name: string;
  value?: string | number | boolean;
}

export interface DiscordInteraction {
  type: InteractionType;
  /** Absent when the command was invoked in a DM. */
  guild_id?: string;
  /** Present for invocations inside a server. */
  member?: { user: { id: string } };
  /** Present for invocations in a DM. */
  user?: { id: string };
  data?: {
    name: string;
    options?: DiscordInteractionOption[];
  };
}

export const getInvokerId = (interaction: DiscordInteraction): string | undefined =>
  interaction.member?.user.id ?? interaction.user?.id;

export function getStringOption(interaction: DiscordInteraction, name: string): string | undefined {
  const value = interaction.data?.options?.find((option) => option.name === name)?.value;
  return typeof value === 'string' ? value : undefined;
}

export function getBooleanOption(interaction: DiscordInteraction, name: string): boolean {
  const value = interaction.data?.options?.find((option) => option.name === name)?.value;
  return value === true;
}
