import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { APIReaction } from 'discord-api-types/v10';
import { humanReactions } from './discord-bot.service';

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
