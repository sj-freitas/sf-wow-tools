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

export interface DiscordAttachment {
  id: string;
  filename: string;
  content_type?: string;
  size: number;
  url: string;
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
    /** Files attached to options, by attachment id. */
    resolved?: { attachments?: Record<string, DiscordAttachment> };
    /** Buttons and modals: the id we gave the component. */
    custom_id?: string;
    /** Select menus: the values of the options picked. */
    values?: string[];
    /** Modal submissions: the fields, one per row. */
    components?: { components: { custom_id: string; value?: string }[] }[];
  };
}

/**
 * What a button, select menu or modal handler answers: a private message (plain text, or
 * `message` with embeds and components), a pop-up form to open, or `update`: new contents for the
 * message the component is on. Only use `update` on the user's own private messages (a step of a
 * flow the bot showed them), never for a component on a message everyone sees, nor for a modal
 * opened from one.
 */
export type ComponentReply =
  | string
  | { modal: ModalData }
  | { message: ReplyMessage }
  | { update: ReplyMessage }
  | DeferredReply;

/**
 * For work that may take longer than the 3 seconds Discord waits for an answer: Discord is told
 * "thinking…" at once, then `work` runs and its result replaces that. `reply`: a new private
 * message (shows "… is thinking"); `update`: the message the component is on (same rule as
 * `update` above: only the user's own private messages, or a form opened from one).
 */
export interface DeferredReply {
  defer: 'reply' | 'update';
  work: () => Promise<string | ReplyMessage>;
}

export interface ReplyMessage {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

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

/** The file the user attached to an attachment option, if any. */
export function getAttachmentOption(
  interaction: DiscordInteraction,
  name: string,
): DiscordAttachment | undefined {
  const id = getStringOption(interaction, name);
  return id ? interaction.data?.resolved?.attachments?.[id] : undefined;
}
