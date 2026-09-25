import { BadRequestException } from '@nestjs/common';

export const MAX_POST_LENGTH = 2000;
export const MAX_SEED_REACTIONS = 10;

/** What a POST task is configured to do. `serverId` is the Discord server the channel is in. */
export interface PostConfig {
  serverId: string;
  channelId: string;
  content: string;
  /** Emojis the bot adds to the post so people can just click them (polls). */
  seedReactions: string[];
  /**
   * Whether Discord shows link previews (embeds) under the post. Absent on posts made before the
   * option existed, which counts as true.
   */
  embedLinks?: boolean;
}

/** What the last run left behind, so the post can be edited and its reactions read. */
export interface PostState {
  messageId?: string;
  channelId?: string;
  serverId?: string;
  postedAt?: string;
  /** The message was deleted in Discord; the next run posts a new one. */
  messageDeleted?: boolean;
}

const SNOWFLAKE = /^\d{15,25}$/;
const CUSTOM_EMOJI = /^<a?:(\w{2,32}):(\d{15,25})>$/;

/** Unicode emoji stay as they are; `<:name:id>` becomes the `name:id` Discord's API wants. */
export function normalizeEmoji(input: string): string | null {
  const emoji = input.trim();
  if (emoji === '') return null;
  const custom = CUSTOM_EMOJI.exec(emoji);
  if (custom) return `${custom[1]}:${custom[2]}`;
  if (/^\w{2,32}:\d{15,25}$/.test(emoji)) return emoji;
  // A unicode emoji: no letters, digits, whitespace or Discord syntax.
  return /^[^\p{L}\p{N}\s<>:@#]{1,16}$/u.test(emoji) ? emoji : null;
}

export function parsePostContent(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException('The post needs some text.');
  }
  if (value.length > MAX_POST_LENGTH) {
    throw new BadRequestException(
      `A Discord message can have at most ${MAX_POST_LENGTH} characters.`,
    );
  }
  return value;
}

export function parseSeedReactions(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SEED_REACTIONS) {
    throw new BadRequestException(`At most ${MAX_SEED_REACTIONS} reactions can be added.`);
  }
  const emojis = value.map((item) => (typeof item === 'string' ? normalizeEmoji(item) : null));
  if (emojis.some((emoji) => emoji === null)) {
    throw new BadRequestException('Reactions must be emojis (custom ones as <:name:id>).');
  }
  return [...new Set(emojis as string[])];
}

/** Absent means the default (or the current value): links are shown. */
export function parseEmbedLinks(value: unknown, current = true): boolean {
  if (value === undefined) return current;
  if (typeof value !== 'boolean') {
    throw new BadRequestException('embedLinks must be true or false.');
  }
  return value;
}

export const embedsShown = (config: Pick<PostConfig, 'embedLinks'>): boolean =>
  config.embedLinks !== false;

export function parseSnowflake(value: unknown, what: string): string {
  if (typeof value !== 'string' || !SNOWFLAKE.test(value)) {
    throw new BadRequestException(`${what} is invalid.`);
  }
  return value;
}

export const messageUrl = (serverId: string, channelId: string, messageId: string): string =>
  `https://discord.com/channels/${serverId}/${channelId}/${messageId}`;
