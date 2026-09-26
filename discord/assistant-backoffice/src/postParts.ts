import type { PostPart, PostPartInput } from './types';

export const MAX_PART_LENGTH = 2000;
export const MAX_PARTS = 10;
export const MAX_IMAGES_PER_PART = 4;
export const MAX_IMAGE_MB = 5;
export const MAX_DELAY_SECONDS = 60;

/** A message of the post as it is in the form. */
export interface PartDraft {
  /** Only for React: tells the messages apart while they are moved around. */
  key: string;
  /** The id the server knows the message by (kept when editing). */
  id?: string;
  content: string;
  /** The emojis to add, as typed: "👍 👎". */
  reactions: string;
  embedLinks: boolean;
  delaySeconds: number;
  imageIds: string[];
  /** The message is in Discord: it keeps its place and can only be edited or removed. */
  posted: boolean;
}

let counter = 0;
const nextKey = (): string => `part-${Date.now()}-${++counter}`;

export const newDraft = (): PartDraft => ({
  key: nextKey(),
  content: '',
  reactions: '',
  embedLinks: true,
  delaySeconds: 0,
  imageIds: [],
  posted: false,
});

export const draftOf = (part: PostPart): PartDraft => ({
  key: nextKey(),
  id: part.id,
  content: part.content,
  reactions: part.seedReactions.join(' '),
  embedLinks: part.embedLinks,
  delaySeconds: part.delaySeconds,
  imageIds: part.imageIds,
  posted: part.posted !== null,
});

export const inputOf = (draft: PartDraft): PostPartInput => ({
  ...(draft.id ? { id: draft.id } : {}),
  content: draft.content,
  seedReactions: draft.reactions.split(/[\s,]+/).filter(Boolean),
  embedLinks: draft.embedLinks,
  delaySeconds: draft.delaySeconds,
  imageIds: draft.imageIds,
});

/** The messages that are already in Discord keep their order: only two that are not can swap. */
export const canSwap = (drafts: readonly PartDraft[], a: number, b: number): boolean =>
  b >= 0 && b < drafts.length && !drafts[a].posted && !drafts[b].posted;
