import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { MAX_POST_LENGTH, normalizeEmoji } from './post-task';
import { checkShowExpression, runShowExpression, ShowExpressionError } from './show-sandbox';

export const MAX_DYNAMIC_TOKENS = 5;

export interface Reactor {
  id: string;
  /** Discord display name (global name), else username. */
  name: string;
  /** How they are shown in the message's server: their nickname there, else `name`. */
  displayName?: string;
  /** Their main characters in the guild (one entry each; empty when they have none). */
  mains?: string[];
}

/** How a token points at the post whose reactions it shows. */
export interface PostRef {
  /**
   * `name:<lower-cased name>` (a scheduled post), `msgid:<message id>` (a message the bot posted),
   * `msg:<channel id>/<message id>` (any message, by its link) or `self` (the post the text is in).
   */
  ref: string;
  /** As written, for messages. */
  label: string;
  /** Set when written as a Discord message link. */
  message?: { serverId: string; channelId: string; messageId: string };
}

/** One dynamic tag in a post's text. */
export interface DynamicToken extends PostRef {
  /** The text exactly as written, which is what gets replaced. */
  raw: string;
  /** Unicode emoji, or `name:id` for a custom one. */
  emoji: string;
  /**
   * The JavaScript expression that writes the people, from `show`: `reactions` is the list of
   * people who reacted (see `runShowExpression`).
   */
  expression: string;
}

/** What a tag shows when it has no `show`: the Discord names of the people, comma separated. */
export const DEFAULT_SHOW = 'reactions.map((r) => r.name)';

const MESSAGE_LINK =
  /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})\/?$/;
const MESSAGE_ID = /^\d{15,25}$/;
/** `{{reactions sourcePost="Raid signup" emoji=👍 show="reactions.length"}}` */
const NEW_START = /\{\{\s*reactions(?=[\s}])/g;
const HELP =
  'Use {{reactions sourcePost="Post name" emoji=👍 show="reactions.map((r) => r.name)"}}: show is a JavaScript expression in quotes.';

function refOf(value: string): PostRef {
  const text = value.trim();
  const link = MESSAGE_LINK.exec(text);
  if (link) {
    const [, serverId, channelId, messageId] = link;
    return {
      ref: `msg:${channelId}/${messageId}`,
      label: text,
      message: { serverId, channelId, messageId },
    };
  }
  if (MESSAGE_ID.test(text)) return { ref: `msgid:${text}`, label: text };
  return { ref: `name:${text.toLowerCase()}`, label: text };
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
    if (!['sourcepost', 'emoji', 'show'].includes(name) || args.has(name)) {
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
  const show = (args.get('show') ?? DEFAULT_SHOW).trim();
  if (show === '') throw new BadRequestException(`${raw} has an empty show. ${HELP}`);
  const post = args.get('sourcepost');
  const target: PostRef =
    post === undefined || post.trim() === '' ? { ref: 'self', label: 'this post' } : refOf(post);
  return { raw, ...target, emoji, expression: show };
}

/**
 * The dynamic tags of a text, in order: `{{reactions sourcePost="Raid signup" emoji=👍 show="reactions.length"}}`
 * (the source can be a message id, a message link or a post name, and is this post when left
 * out). `show` is a JavaScript expression, in quotes when it has spaces. Throws for a tag that is written wrongly, so a typo is reported
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
export const trackingKey = (token: Pick<DynamicToken, 'ref' | 'emoji'>) =>
  `${token.ref}|${token.emoji}`;

/**
 * Changes when someone reacts, un-reacts, renames themselves or gets a main: what "nothing changed"
 * means. Server nicknames are left out: they cost a lookup each, so they are only fetched once this
 * has changed.
 */
export function hashReactors(reactors: readonly Reactor[]): string {
  const sorted = [...reactors].sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256')
    .update(JSON.stringify(sorted.map((r) => [r.id, r.name, r.mains ?? []])))
    .digest('hex');
}

const mainNameOf = (reactor: Reactor): string =>
  reactor.mains && reactor.mains.length > 0 ? reactor.mains.join(' / ') : reactor.name;

/** What a tag's expression works with; a failing expression shows as a warning, not a broken post. */
async function tagText(token: DynamicToken, reactors: readonly Reactor[]): Promise<string> {
  try {
    return await runShowExpression(
      token.expression,
      reactors.map((reactor) => ({
        id: reactor.id,
        tag: `<@${reactor.id}>`,
        name: reactor.name,
        displayName: reactor.displayName ?? reactor.name,
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
 * The template with every tag replaced by what its expression makes of the people. A tag whose
 * people are unknown (its message is gone or not posted yet) sees nobody. A result that would not fit
 * in a Discord message is cut.
 */
export async function renderContent(
  template: string,
  tokens: readonly DynamicToken[],
  people: ReadonlyMap<string, readonly Reactor[]>,
): Promise<string> {
  let rendered = template;
  for (const token of tokens) {
    const text = await tagText(token, people.get(trackingKey(token)) ?? []);
    rendered = rendered.split(token.raw).join(text);
  }
  return rendered.length <= MAX_POST_LENGTH ? rendered : rendered.slice(0, MAX_POST_LENGTH);
}
