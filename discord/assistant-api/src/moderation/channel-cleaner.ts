import { Logger } from '@nestjs/common';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { describeDiscordError } from '../discord/discord-errors';

/** Discord only bulk-deletes messages younger than 14 days; a day of margin. */
const BULK_MAX_AGE_MS = 13 * 24 * 60 * 60 * 1000;
const DISCORD_EPOCH = 1_420_070_400_000n;

const ageMs = (messageId: string, now: number): number =>
  now - Number((BigInt(messageId) >> 22n) + DISCORD_EPOCH);

export interface CleanOptions {
  /** Keep messages sent by bots and webhooks. */
  keepBotMessages?: boolean;
  /** Keep pinned messages (default: yes; Recurring Event empties its channel completely). */
  keepPinned?: boolean;
  /** Start below this message (where an earlier, unfinished pass stopped). */
  before?: string;
  /** Stop at this time (ms since the epoch), to carry on later from `cursor`. */
  deadline?: number;
}

export interface CleanResult {
  deleted: number;
  /** The whole channel was gone through. */
  done: boolean;
  /** When not done: where to carry on (pass it as `before`). */
  cursor?: string;
}

const logger = new Logger('ChannelCleaner');

/**
 * Walks a channel from the newest message back (or from `before`), deleting every message but the
 * pinned ones (unless `keepPinned` is false) and, with `keepBotMessages`, those of bots. Young messages go in bulk, older ones
 * one by one, as Discord requires. Used by `/clear-channel` and the Channel Clean Up plugin.
 */
export async function cleanChannel(
  bot: Pick<DiscordBotService, 'listMessages' | 'bulkDeleteMessages' | 'deleteMessage'>,
  channelId: string,
  options: CleanOptions = {},
  clock: () => number = Date.now,
): Promise<CleanResult> {
  let deleted = 0;
  let before = options.before;
  for (;;) {
    if (options.deadline !== undefined && clock() >= options.deadline) {
      return { deleted, done: false, cursor: before };
    }
    const page = await bot.listMessages(channelId, before);
    if (page.length === 0) return { deleted, done: true };
    before = page[page.length - 1].id;

    const now = clock();
    const doomed = page.filter(
      (message) =>
        !(message.pinned && options.keepPinned !== false) &&
        !(options.keepBotMessages && message.bot),
    );
    const recent = doomed.filter((m) => ageMs(m.id, now) < BULK_MAX_AGE_MS).map((m) => m.id);
    const old = doomed.filter((m) => ageMs(m.id, now) >= BULK_MAX_AGE_MS).map((m) => m.id);

    if (recent.length >= 2) {
      await bot.bulkDeleteMessages(channelId, recent);
      deleted += recent.length;
    } else {
      old.push(...recent);
    }
    for (const id of old) {
      try {
        await bot.deleteMessage(channelId, id);
        deleted++;
      } catch (error) {
        // Already gone, or a system message Discord does not let anyone delete.
        logger.debug(`Skipped message ${id}: ${describeDiscordError(error)}`);
      }
    }
  }
}
