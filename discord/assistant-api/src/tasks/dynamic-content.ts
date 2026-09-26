import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { MAX_POST_LENGTH, normalizeEmoji } from './post-task';

/**
 * How the people who reacted are written into the post: `names` (Discord names), `mainNames` (the
 * names of their main characters, else their Discord name), `number` or `tags` (mentions).
 */
export type ReactorFormat = 'names' | 'mainNames' | 'number' | 'tags';

export const MAX_DYNAMIC_TOKENS = 5;
/** Never list more than this many people in one place; the rest becomes "…and N more". */
export const MAX_LISTED_REACTORS = 50;

export interface Reactor {
  id: string;
  /** Display name, else username. */
  name: string;
}

/** How a token points at the post whose reactions it shows. */
export interface PostRef {
  /** `id:<uuid>`, `name:<lower-cased name>`, or `self` (the post the text is in). */
  ref: string;
  /** As written, for messages. */
  label: string;
}

/** One dynamic tag in a post's text. */
export interface DynamicToken extends PostRef {
  /** The text exactly as written, which is what gets replaced. */
  raw: string;
  /** Unicode emoji, or `name:id` for a custom one. */
  emoji: string;
  format: ReactorFormat;
}

const FORMATS: readonly ReactorFormat[] = ['names', 'mainNames', 'number', 'tags'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `{{reactions post="Raid signup" emoji=👍 show=names}}` */
const NEW_TOKEN = /\{\{\s*reactions(?=[\s}])([\s\S]*?)\}\}/g;
const NEW_START = /\{\{\s*reactions(?=[\s}])/g;
const ARGUMENT = /([A-Za-z]+)\s*=\s*(?:"([^"]*)"|([^\s"}]+))/y;
const HELP =
  'Use {{reactions post="Post name" emoji=👍 show=names}} (show: names, mainNames, tags or number).';

function refOf(value: string): PostRef {
  const text = value.trim();
  return UUID.test(text)
    ? { ref: `id:${text.toLowerCase()}`, label: text }
    : { ref: `name:${text.toLowerCase()}`, label: text };
}

function parseNewToken(raw: string, body: string): DynamicToken {
  const args = new Map<string, string>();
  let position = 0;
  while (position < body.length) {
    if (/\s/.test(body[position])) {
      position++;
      continue;
    }
    ARGUMENT.lastIndex = position;
    const match = ARGUMENT.exec(body);
    if (!match) throw new BadRequestException(`${raw} is not written correctly. ${HELP}`);
    const key = match[1].toLowerCase();
    if (!['post', 'emoji', 'show'].includes(key) || args.has(key)) {
      throw new BadRequestException(
        `${raw}: "${match[1]}" is not an option here, or is given twice. ${HELP}`,
      );
    }
    args.set(key, match[2] ?? match[3]);
    position = ARGUMENT.lastIndex;
  }
  const emojiText = args.get('emoji');
  if (!emojiText) throw new BadRequestException(`${raw} needs an emoji. ${HELP}`);
  const emoji = normalizeEmoji(emojiText);
  if (!emoji) {
    throw new BadRequestException(
      `"${emojiText}" in ${raw} is not an emoji (custom ones as <:name:id>).`,
    );
  }
  const show = args.get('show') ?? 'names';
  const format = FORMATS.find((candidate) => candidate.toLowerCase() === show.toLowerCase());
  if (!format) {
    throw new BadRequestException(
      `"${show}" in ${raw} is not one of names, mainNames, tags, number.`,
    );
  }
  const post = args.get('post');
  const target: PostRef =
    post === undefined || post.trim() === '' ? { ref: 'self', label: 'this post' } : refOf(post);
  return { raw, ...target, emoji, format };
}

/**
 * The dynamic tags of a text, in order: `{{reactions post="Raid signup" emoji=👍 show=names}}`
 * (the post can be its name or its id, and is this post when left out). Throws for one that is written wrongly, so a typo is
 * reported on save instead of showing up in Discord.
 */
export function parseDynamicTokens(content: string): DynamicToken[] {
  const found: { index: number; token: DynamicToken }[] = [];
  for (const match of content.matchAll(NEW_TOKEN)) {
    found.push({ index: match.index, token: parseNewToken(match[0], match[1]) });
  }
  if ([...content.matchAll(NEW_START)].length !== found.length) {
    throw new BadRequestException(`A reactions tag is not written correctly. ${HELP}`);
  }
  if (found.length > MAX_DYNAMIC_TOKENS) {
    throw new BadRequestException(`A post can have at most ${MAX_DYNAMIC_TOKENS} reactions tags.`);
  }
  return found.sort((a, b) => a.index - b.index).map((entry) => entry.token);
}

/** The identity of what a token asks for: the same reactions read by different tokens share it. */
export const trackingKey = (token: Pick<DynamicToken, 'ref' | 'emoji' | 'format'>) =>
  `${token.ref}|${token.emoji}|${token.format}`;

/** Changes when someone reacts, un-reacts or renames themselves: what "nothing changed" means. */
export function hashReactors(reactors: readonly Reactor[]): string {
  const sorted = [...reactors].sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256')
    .update(JSON.stringify(sorted.map((r) => [r.id, r.name])))
    .digest('hex');
}

/** The text for one token, listing at most `limit` people. */
export function formatReactors(
  format: ReactorFormat,
  reactors: readonly Reactor[],
  limit = MAX_LISTED_REACTORS,
): string {
  if (format === 'number') return String(reactors.length);
  if (reactors.length === 0) return 'nobody yet';
  const shown = reactors.slice(0, limit);
  const items = shown.map((reactor) => (format === 'tags' ? `<@${reactor.id}>` : reactor.name));
  const more = reactors.length - shown.length;
  return `${items.join(', ')}${more > 0 ? ` …and ${more} more` : ''}`;
}

/**
 * The template with every token replaced by its people. A token whose people are unknown (its
 * post is gone or not in Discord yet) reads as nobody. If the result would not fit in a Discord
 * message, the lists are shortened until it does.
 */
export function renderContent(
  template: string,
  tokens: readonly DynamicToken[],
  people: ReadonlyMap<string, readonly Reactor[]>,
): string {
  if (tokens.length === 0) return template;
  for (let limit = MAX_LISTED_REACTORS; ; limit = Math.floor(limit / 2)) {
    let rendered = template;
    for (const token of tokens) {
      const text = formatReactors(token.format, people.get(trackingKey(token)) ?? [], limit);
      rendered = rendered.split(token.raw).join(text);
    }
    if (rendered.length <= MAX_POST_LENGTH || limit === 0) {
      return rendered.length <= MAX_POST_LENGTH ? rendered : rendered.slice(0, MAX_POST_LENGTH);
    }
  }
}
