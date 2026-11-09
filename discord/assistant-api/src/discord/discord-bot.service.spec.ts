import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DiscordAPIError } from '@discordjs/rest';
import type { ConfigService } from '@nestjs/config';
import type { APIReaction } from 'discord-api-types/v10';
import type { CacheService } from '../cache/cache.service';
import { DiscordBotService, humanReactions } from './discord-bot.service';

const reaction = (
  overrides: Partial<APIReaction> & { name?: string; id?: string | null },
): APIReaction => ({
  count: 1,
  me: false,
  me_burst: false,
  count_details: { burst: 0, normal: 1 },
  burst_colors: [],
  emoji: { id: overrides.id ?? null, name: overrides.name ?? '👍' },
  ...overrides,
});

describe('humanReactions', () => {
  it('leaves out the bot’s own vote', () => {
    assert.deepEqual(humanReactions([reaction({ count: 4, me: true })]), [
      { emoji: '👍', emojiId: null, count: 3 },
    ]);
  });

  it('keeps counts as they are when the bot did not react', () => {
    assert.equal(humanReactions([reaction({ count: 4, me: false })])[0].count, 4);
  });

  it('keeps an option the bot seeded even when nobody else voted yet', () => {
    assert.deepEqual(humanReactions([reaction({ count: 1, me: true, name: '👎' })]), [
      { emoji: '👎', emojiId: null, count: 0 },
    ]);
  });

  it('handles custom emoji', () => {
    const [result] = humanReactions([
      reaction({ count: 2, me: true, name: 'pepe', id: '123456789012345678' }),
    ]);
    assert.deepEqual(result, {
      emoji: 'pepe:123456789012345678',
      emojiId: '123456789012345678',
      count: 1,
    });
  });

  it('is empty without reactions', () => {
    assert.deepEqual(humanReactions([]), []);
  });
});

describe('sendDirectText', () => {
  /** A bot whose Discord answers are `post`'s: every POST is recorded as "path". */
  function bot(post: (path: string) => unknown) {
    const calls: string[] = [];
    const service = new DiscordBotService(
      { get: () => undefined, getOrThrow: () => 'token' } as unknown as ConfigService,
      {} as CacheService,
    );
    (service as unknown as { rest: unknown }).rest = {
      post: async (path: string) => {
        calls.push(path);
        return post(path);
      },
    };
    return { service, calls };
  }

  it('opens a person’s DM channel once and reuses it', async () => {
    const { service, calls } = bot((path) =>
      path === '/users/@me/channels' ? { id: 'dm-1' } : {},
    );
    await service.sendDirectText('u1', 'one');
    await service.sendDirectText('u1', 'two');
    assert.deepEqual(calls, [
      '/users/@me/channels',
      '/channels/dm-1/messages',
      '/channels/dm-1/messages',
    ]);
  });

  it('opens it again when Discord forgot it', async () => {
    let gone = false;
    const { service, calls } = bot((path) => {
      if (path === '/users/@me/channels') return { id: gone ? 'dm-2' : 'dm-1' };
      if (path === '/channels/dm-1/messages' && gone) {
        throw new DiscordAPIError(
          { message: 'Unknown Channel', code: 10003 },
          10003,
          404,
          'POST',
          'u',
          {},
        );
      }
      return {};
    });
    await service.sendDirectText('u1', 'one');
    gone = true;
    await service.sendDirectText('u1', 'two');
    assert.deepEqual(calls.slice(2), [
      '/channels/dm-1/messages',
      '/users/@me/channels',
      '/channels/dm-2/messages',
    ]);
  });
});
