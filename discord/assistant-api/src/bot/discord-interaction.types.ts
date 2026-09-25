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

export interface DiscordInteractionUser {
  id: string;
  username?: string;
  global_name?: string | null;
}

export interface DiscordInteraction {
  type: InteractionType;
  /** Absent when the command was invoked in a DM. */
  guild_id?: string;
  /** The channel the command was used in. */
  channel_id?: string;
  application_id?: string;
  /** Lets us edit the reply for 15 minutes after the command. */
  token?: string;
  /** Present for invocations inside a server. */
  member?: { nick?: string | null; roles?: string[]; user: DiscordInteractionUser };
  /** Present for invocations in a DM. */
  user?: DiscordInteractionUser;
  data?: {
    name: string;
    options?: DiscordInteractionOption[];
    /** Buttons and modals: the id we gave the component. */
    custom_id?: string;
    /** Modal submissions: the fields, one per row. */
    components?: { components: { custom_id: string; value?: string }[] }[];
  };
}

/** What a button or modal handler answers: a private message, or a pop-up form to open. */
export type ComponentReply = string | { modal: ModalData };

export interface ModalData {
  custom_id: string;
  /** At most 45 characters. */
  title: string;
  components: unknown[];
}

/** The text a user typed into a modal field. */
export function getModalValue(
  interaction: DiscordInteraction,
  customId: string,
): string | undefined {
  for (const row of interaction.data?.components ?? []) {
    const field = row.components.find((component) => component.custom_id === customId);
    if (field) return field.value;
  }
  return undefined;
}

export const getInvokerId = (interaction: DiscordInteraction): string | undefined =>
  interaction.member?.user.id ?? interaction.user?.id;

export function getStringOption(interaction: DiscordInteraction, name: string): string | undefined {
  const value = interaction.data?.options?.find((option) => option.name === name)?.value;
  return typeof value === 'string' ? value : undefined;
}

export function getNumberOption(interaction: DiscordInteraction, name: string): number | undefined {
  const value = interaction.data?.options?.find((option) => option.name === name)?.value;
  return typeof value === 'number' ? value : undefined;
}

/** A yes/no option that may have been left out (Discord has no default for these). */
export function getOptionalBooleanOption(
  interaction: DiscordInteraction,
  name: string,
): boolean | undefined {
  const value = interaction.data?.options?.find((option) => option.name === name)?.value;
  return typeof value === 'boolean' ? value : undefined;
}

export function getBooleanOption(interaction: DiscordInteraction, name: string): boolean {
  const value = interaction.data?.options?.find((option) => option.name === name)?.value;
  return value === true;
}
