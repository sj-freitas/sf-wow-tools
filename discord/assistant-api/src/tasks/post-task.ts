import { BadRequestException } from '@nestjs/common';

export const MAX_POST_LENGTH = 2000;
export const MAX_SEED_REACTIONS = 10;

export const MAX_PARTS = 10;
export const MAX_IMAGES_PER_PART = 4;
/** A part may wait this long after the one before it; the worker sleeps through it. */
export const MAX_PART_DELAY_SECONDS = 60;
/** Keeps a whole sequence inside the worker's 5 minute lease on the task. */
export const MAX_TOTAL_DELAY_SECONDS = 240;

/** One message of a post. A post is one or more of these, sent in order. */
export interface PostPart {
  /** Stays the same when the post is edited, so the part keeps its Discord message. */
  id: string;
  content: string;
  /** Emojis the bot adds to the message so people can just click them (polls). */
  seedReactions: string[];
  /** Whether Discord shows link previews (embeds) under the message. */
  embedLinks: boolean;
  /** Seconds to wait after the previous part before sending this one (unused for the first). */
  delaySeconds: number;
  /** Uploaded images (post_images) shown under the text, in order. */
  imageIds: string[];
}

/** What a POST task is configured to do. `serverId` is the Discord server the channel is in. */
export interface PostConfig {
  serverId: string;
  channelId: string;
  parts: PostPart[];
}

/** A part as it is in Discord. */
export interface PostedPart {
  partId: string;
  messageId: string;
  channelId: string;
  serverId: string;
  postedAt: string;
  /** The text as it is in Discord, once the dynamic parts (reactions) are filled in. */
  renderedContent: string;
  /** Which images and link-preview setting the message was sent with, to see what changed. */
  imageIds: string[];
  embedLinks: boolean;
  /** The message was deleted in Discord. */
  deleted?: boolean;
}

/**
 * What the runs left behind, so the post can be edited and its reactions read. `messages` is in
 * the order of the parts; a message sent, then deleted, stays with `deleted` set.
 */
export interface PostState {
  messages?: PostedPart[];
  /** Hash of the guild's roster the messages with `{{roster …}}` tags were last written from. */
  rosterHash?: string;
}

export const liveMessages = (state: PostState): PostedPart[] =>
  (state.messages ?? []).filter((message) => !message.deleted);

/** Whether any message of the post is in Discord. */
export const isLive = (state: PostState): boolean => liveMessages(state).length > 0;

export const liveMessageOf = (state: PostState, partId: string): PostedPart | undefined =>
  liveMessages(state).find((message) => message.partId === partId);

/** Every part is in Discord. */
export const isComplete = (config: PostConfig, state: PostState): boolean =>
  config.parts.length > 0 && config.parts.every((part) => liveMessageOf(state, part.id));

/** It was in Discord and every message was deleted (from here or in Discord). */
export const wasDeleted = (state: PostState): boolean =>
  !isLive(state) && (state.messages?.length ?? 0) > 0;

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

export function parseSnowflake(value: unknown, what: string): string {
  if (typeof value !== 'string' || !SNOWFLAKE.test(value)) {
    throw new BadRequestException(`${what} is invalid.`);
  }
  return value;
}

export const messageUrl = (serverId: string, channelId: string, messageId: string): string =>
  `https://discord.com/channels/${serverId}/${channelId}/${messageId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The seconds a part waits, a whole number from 0 to a minute. */
export function parseDelaySeconds(value: unknown): number {
  if (value === undefined) return 0;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_PART_DELAY_SECONDS
  ) {
    throw new BadRequestException(
      `The wait before a message must be a whole number of seconds, 0 to ${MAX_PART_DELAY_SECONDS}.`,
    );
  }
  return value;
}

/**
 * The parts of a post as sent by the backoffice: 1 to MAX_PARTS messages, each with text, and
 * optionally reactions, link previews, a wait and image ids. A part without an id gets one; ids are
 * kept when given so a part keeps its Discord message across edits.
 */
export function parseParts(value: unknown, newId: () => string): PostPart[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException('The post needs at least one message.');
  }
  if (value.length > MAX_PARTS) {
    throw new BadRequestException(`A post can have at most ${MAX_PARTS} messages.`);
  }
  const ids = new Set<string>();
  const parts = value.map((raw: unknown, index): PostPart => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const id = typeof item.id === 'string' && UUID.test(item.id) ? item.id.toLowerCase() : newId();
    if (ids.has(id)) throw new BadRequestException('Two messages of the post have the same id.');
    ids.add(id);
    const imageIds = item.imageIds === undefined ? [] : item.imageIds;
    if (
      !Array.isArray(imageIds) ||
      imageIds.length > MAX_IMAGES_PER_PART ||
      imageIds.some((image) => typeof image !== 'string' || !UUID.test(image))
    ) {
      throw new BadRequestException(`A message can have at most ${MAX_IMAGES_PER_PART} images.`);
    }
    return {
      id,
      content: parsePostContent(item.content),
      seedReactions: parseSeedReactions(item.seedReactions),
      embedLinks: parseEmbedLinks(item.embedLinks),
      delaySeconds: index === 0 ? 0 : parseDelaySeconds(item.delaySeconds),
      imageIds: [...new Set((imageIds as string[]).map((image) => image.toLowerCase()))],
    };
  });
  const total = parts.reduce((sum, part) => sum + part.delaySeconds, 0);
  if (total > MAX_TOTAL_DELAY_SECONDS) {
    throw new BadRequestException(
      `The waits between messages add up to ${total} seconds; the most is ${MAX_TOTAL_DELAY_SECONDS}.`,
    );
  }
  return parts;
}
