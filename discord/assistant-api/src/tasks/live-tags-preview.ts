import { BadRequestException } from '@nestjs/common';
import {
  parseDynamicTokens,
  parseRosterTokens,
  renderContent,
  trackingKey,
  type DynamicToken,
  type Reactor,
  type RosterToken,
} from './dynamic-content';
import { MAX_POST_LENGTH } from './post-task';
import { SAMPLE_REACTORS, type ShowReactor, type ShowRosterEntry } from './show-sandbox';

/** How many characters of the real roster the backoffice is shown, so the shape is visible. */
export const ROSTER_SAMPLE_SIZE = 5;

/** As long as the textarea allows, which is a little over a message's limit. */
const MAX_PREVIEW_LENGTH = MAX_POST_LENGTH + 500;

/** What `{{roster …}}` and `{{reactions …}}` expressions have to work with, for the editor. */
export interface LiveTagsDataDto {
  /** The first few characters of the guild's own roster, exactly as an expression sees them. */
  roster: ShowRosterEntry[];
  /** How many characters the roster has in all: `roster.length` in a tag. */
  rosterCount: number;
  /** Every guild attribute in use on the roster, A–Z: what `attributes.includes('…')` can match. */
  attributes: string[];
  /** Every Discord role held by the roster's players, A–Z: for `discordUser.roles.includes('…')`. */
  discordRoles: string[];
  /** The made-up people a reactions preview runs on (see `SAMPLE_REACTORS`). */
  sampleReactions: ShowReactor[];
}

/** What a preview came out as. Exactly one of `text` and `error` is set. */
export interface LiveTagsPreviewDto {
  /** The text as the post would render it now; null when a tag is written wrongly. */
  text: string | null;
  /** What is wrong with the tags, in the words the editor would see on saving; else null. */
  error: string | null;
  /** True when the text has a reactions tag, so part of the result is made up. */
  usedSampleReactions: boolean;
  /** True when it has a roster tag, so part of the result is the guild's own roster. */
  usedRoster: boolean;
}

const sorted = (names: Iterable<string>): string[] =>
  [...new Set(names)].sort((a, b) => a.localeCompare(b));

/** The vocabulary of the guild's roster: the names its expressions can actually match. */
export function liveTagsData(entries: readonly ShowRosterEntry[]): LiveTagsDataDto {
  return {
    roster: entries.slice(0, ROSTER_SAMPLE_SIZE),
    rosterCount: entries.length,
    attributes: sorted(entries.flatMap((entry) => entry.attributes)),
    discordRoles: sorted(entries.flatMap((entry) => entry.discordUser.roles)),
    sampleReactions: SAMPLE_REACTORS,
  };
}

/**
 * The text with its tags filled in, as a message of a post would be written right now: roster tags
 * against the guild's real roster, reactions tags against made-up people, because the post whose
 * reactions they read usually has not been sent yet (and a preview must not depend on Discord).
 * A tag written wrongly comes back as `error`, the way saving would refuse it; an expression that
 * fails stays inside the text as the post itself would show it.
 */
export async function previewLiveTags(
  content: string,
  entries: readonly ShowRosterEntry[],
): Promise<LiveTagsPreviewDto> {
  if (typeof content !== 'string') throw new BadRequestException('Send the text to preview.');
  if (content.length > MAX_PREVIEW_LENGTH) {
    throw new BadRequestException(
      `A message can have at most ${MAX_POST_LENGTH} characters; this text has ${content.length}.`,
    );
  }

  let tokens: DynamicToken[];
  let rosterTokens: RosterToken[];
  try {
    tokens = parseDynamicTokens(content);
    rosterTokens = parseRosterTokens(content);
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return {
      text: null,
      error: error.message,
      usedSampleReactions: false,
      usedRoster: false,
    };
  }

  // Every reactions tag sees the same made-up people, whichever post or emoji it names.
  const people = new Map<string, readonly Reactor[]>(
    tokens.map((token) => [trackingKey(token), SAMPLE_REACTORS]),
  );
  const roster = rosterTokens.length > 0 ? { tokens: rosterTokens, entries } : undefined;
  return {
    text: await renderContent(content, tokens, people, roster),
    error: null,
    usedSampleReactions: tokens.length > 0,
    usedRoster: rosterTokens.length > 0,
  };
}
