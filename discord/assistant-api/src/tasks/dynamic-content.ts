import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { MAX_POST_LENGTH, normalizeEmoji } from './post-task';
import { checkShowExpression, runShowExpression, ShowExpressionError } from './show-sandbox';

/**
 * How the people who reacted are written into the post. The presets: `names` (Discord names),
 * `mainNames` (the names of their main characters, else their Discord name), `number` and `tags`
 * (mentions). `custom` is a JavaScript expression of the tag's own (see `runShowExpression`).
 */
export type ReactorFormat = 'names' | 'mainNames' | 'number' | 'tags' | 'custom';

export const MAX_DYNAMIC_TOKENS = 5;
/** Never list more than this many people in one place; the rest becomes "…and N more". */
export const MAX_LISTED_REACTORS = 50;

export interface Reactor {
  id: string;
  /** Display name, else username. */
  name: string;
  /** Their main characters in the guild, when they were looked up (`mainNames` and expressions). */
  mains?: string[];
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
  /** The JavaScript of a `custom` tag. */
  expression?: string;
}

const PRESETS: readonly ReactorFormat[] = ['names', 'mainNames', 'number', 'tags'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `{{reactions post="Raid signup" emoji=👍 show=names}}` */
const NEW_START = /\{\{\s*reactions(?=[\s}])/g;
const HELP =
  'Use {{reactions post="Post name" emoji=👍 show=names}} (show: names, mainNames, tags, number, or a JavaScript expression in quotes).';

/** Whether a tag's people must be looked up as main characters (for `mainNames` and expressions). */
export const needsMains = (format: ReactorFormat): boolean =>
  format === 'mainNames' || format === 'custom';

function refOf(value: string): PostRef {
  const text = value.trim();
  return UUID.test(text)
    ? { ref: `id:${text.toLowerCase()}`, label: text }
    : { ref: `name:${text.toLowerCase()}`, label: text };
}

/**
 * Reads the `key=value` options of one tag starting at `from` (just after `{{reactions`), up to
 * the closing `}}`. A value is bare, or in "double" or 'single' quotes, inside which `}}` is just
 * text and `\"` stands for the quote itself.
 */
function scanTag(content: string, from: number): { end: number; args: Map<string, string> } {
  const args = new Map<string, string>();
  let position = from;
  const fail = (what: string): never => {
    throw new BadRequestException(
      `${content.slice(Math.max(0, from - 12), from + 40)}… ${what}. ${HELP}`,
    );
  };
  for (;;) {
    while (position < content.length && /\s/.test(content[position])) position++;
    if (content.startsWith('}}', position)) return { end: position + 2, args };
    if (position >= content.length) fail('is missing its closing }}');
    const key = /^[A-Za-z]+/.exec(content.slice(position))?.[0];
    if (!key)
      fail(`has something that is not key=value at "${content.slice(position, position + 10)}"`);
    position += key!.length;
    while (/\s/.test(content[position] ?? '')) position++;
    if (content[position] !== '=') fail(`is missing "=" after ${key}`);
    position++;
    while (/\s/.test(content[position] ?? '')) position++;

    let value: string;
    const quote = content[position];
    if (quote === '"' || quote === "'") {
      position++;
      let text = '';
      for (;;) {
        if (position >= content.length) fail(`has a ${key} value that is never closed`);
        const char = content[position];
        if (char === '\\' && content[position + 1] === quote) {
          text += quote;
          position += 2;
        } else if (char === quote) {
          position++;
          break;
        } else {
          text += char;
          position++;
        }
      }
      value = text;
    } else {
      const bare = /^[^\s"'}]+/.exec(content.slice(position))?.[0];
      if (!bare) fail(`has no value for ${key}`);
      value = bare!;
      position += value.length;
    }
    const name = key!.toLowerCase();
    if (!['post', 'emoji', 'show'].includes(name) || args.has(name)) {
      fail(`has "${key}", which is not an option here or is given twice`);
    }
    args.set(name, value);
  }
}

function tokenOf(raw: string, args: Map<string, string>): DynamicToken {
  const emojiText = args.get('emoji');
  if (!emojiText) throw new BadRequestException(`${raw} needs an emoji. ${HELP}`);
  const emoji = normalizeEmoji(emojiText);
  if (!emoji) {
    throw new BadRequestException(
      `"${emojiText}" in ${raw} is not an emoji (custom ones as <:name:id>).`,
    );
  }
  const show = (args.get('show') ?? 'names').trim();
  const preset = PRESETS.find((candidate) => candidate.toLowerCase() === show.toLowerCase());
  if (show === '') throw new BadRequestException(`${raw} has an empty show. ${HELP}`);
  const post = args.get('post');
  const target: PostRef =
    post === undefined || post.trim() === '' ? { ref: 'self', label: 'this post' } : refOf(post);
  return preset
    ? { raw, ...target, emoji, format: preset }
    : { raw, ...target, emoji, format: 'custom', expression: show };
}

/**
 * The dynamic tags of a text, in order: `{{reactions post="Raid signup" emoji=👍 show=names}}`
 * (the post can be its name or its id, and is this post when left out). `show` is a preset or a
 * JavaScript expression in quotes. Throws for a tag that is written wrongly, so a typo is reported
 * on save instead of showing up in Discord. (Expressions are checked by `checkExpressions`.)
 */
export function parseDynamicTokens(content: string): DynamicToken[] {
  const tokens: DynamicToken[] = [];
  let searchFrom = 0;
  for (;;) {
    NEW_START.lastIndex = searchFrom;
    const start = NEW_START.exec(content);
    if (!start) break;
    const { end, args } = scanTag(content, start.index + start[0].length);
    tokens.push(tokenOf(content.slice(start.index, end), args));
    searchFrom = end;
  }
  if (tokens.length > MAX_DYNAMIC_TOKENS) {
    throw new BadRequestException(`A post can have at most ${MAX_DYNAMIC_TOKENS} reactions tags.`);
  }
  return tokens;
}

/** Runs every expression once on sample people, so a wrong one is refused on save. */
export async function checkExpressions(tokens: readonly DynamicToken[]): Promise<void> {
  for (const token of tokens) {
    if (token.format !== 'custom' || token.expression === undefined) continue;
    try {
      await checkShowExpression(token.expression);
    } catch (error) {
      if (error instanceof ShowExpressionError) {
        throw new BadRequestException(`The show expression of ${token.raw} ${error.message}`);
      }
      throw error;
    }
  }
}

/** The identity of what a token asks for: the same reactions read by different tokens share it. */
export const trackingKey = (token: Pick<DynamicToken, 'ref' | 'emoji' | 'format'>) =>
  `${token.ref}|${token.emoji}|${token.format}`;

/** Changes when someone reacts, un-reacts, renames themselves or gets a main: what "nothing changed" means. */
export function hashReactors(reactors: readonly Reactor[]): string {
  const sorted = [...reactors].sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256')
    .update(JSON.stringify(sorted.map((r) => [r.id, r.name, r.mains ?? []])))
    .digest('hex');
}

const mainNameOf = (reactor: Reactor): string =>
  reactor.mains && reactor.mains.length > 0 ? reactor.mains.join(' / ') : reactor.name;

/** The text for one preset tag, listing at most `limit` people. */
export function formatReactors(
  format: ReactorFormat,
  reactors: readonly Reactor[],
  limit = MAX_LISTED_REACTORS,
): string {
  if (format === 'number') return String(reactors.length);
  if (reactors.length === 0) return 'nobody yet';
  const shown = reactors.slice(0, limit);
  const items = shown.map((reactor) => {
    if (format === 'tags') return `<@${reactor.id}>`;
    return format === 'mainNames' ? mainNameOf(reactor) : reactor.name;
  });
  const more = reactors.length - shown.length;
  return `${items.join(', ')}${more > 0 ? ` …and ${more} more` : ''}`;
}

/** What a `custom` tag's expression works with, and what to show if it fails. */
async function customText(token: DynamicToken, reactors: readonly Reactor[]): Promise<string> {
  try {
    return await runShowExpression(
      token.expression ?? '""',
      reactors.map((reactor) => ({
        id: reactor.id,
        tag: `<@${reactor.id}>`,
        name: reactor.name,
        mainName: mainNameOf(reactor),
        mains: reactor.mains ?? [],
      })),
    );
  } catch (error) {
    if (error instanceof ShowExpressionError) return `⚠️ (${error.message})`;
    throw error;
  }
}

/**
 * The template with every token replaced by its people. A token whose people are unknown (its
 * post is gone or not in Discord yet) reads as nobody. If the result would not fit in a Discord
 * message, the preset lists are shortened until it does.
 */
export async function renderContent(
  template: string,
  tokens: readonly DynamicToken[],
  people: ReadonlyMap<string, readonly Reactor[]>,
): Promise<string> {
  if (tokens.length === 0) return template;
  const custom = new Map<string, string>();
  for (const token of tokens) {
    if (token.format === 'custom') {
      custom.set(token.raw, await customText(token, people.get(trackingKey(token)) ?? []));
    }
  }
  for (let limit = MAX_LISTED_REACTORS; ; limit = Math.floor(limit / 2)) {
    let rendered = template;
    for (const token of tokens) {
      const text =
        custom.get(token.raw) ??
        formatReactors(token.format, people.get(trackingKey(token)) ?? [], limit);
      rendered = rendered.split(token.raw).join(text);
    }
    if (rendered.length <= MAX_POST_LENGTH || limit === 0) {
      return rendered.length <= MAX_POST_LENGTH ? rendered : rendered.slice(0, MAX_POST_LENGTH);
    }
  }
}
