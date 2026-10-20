import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryCacheStore } from './cache-store';
import { CacheService } from './cache.service';

describe('CacheService (memory store)', () => {
  const setup = () => {
    let now = 1000;
    const cache = new CacheService(new MemoryCacheStore(() => now));
    return { cache, advance: (ms: number) => (now += ms) };
  };

  it('keeps a value until it expires', async () => {
    const { cache, advance } = setup();
    await cache.set('k', { a: 1 }, 100);
    assert.deepEqual(await cache.get('k'), { a: 1 });
    advance(100);
    assert.equal(await cache.get('k'), undefined);
  });

  it('hands out copies, as a shared store would', async () => {
    const { cache } = setup();
    const value = { list: [1] };
    await cache.set('k', value, 100);
    value.list.push(2);
    const read = await cache.get<{ list: number[] }>('k');
    assert.deepEqual(read, { list: [1] });
  });

  it('loads once for overlapping calls, then serves the cache', async () => {
    const { cache } = setup();
    let loads = 0;
    const load = async () => {
      loads++;
      return 'value';
    };
    const [a, b] = await Promise.all([
      cache.getOrLoad('k', 100, load),
      cache.getOrLoad('k', 100, load),
    ]);
    assert.equal(a, 'value');
    assert.equal(b, 'value');
    assert.equal(await cache.getOrLoad('k', 100, load), 'value');
    assert.equal(loads, 1);
  });

  it('does not keep a failed load', async () => {
    const { cache } = setup();
    await assert.rejects(
      cache.getOrLoad('k', 100, async () => {
        throw new Error('Discord is down');
      }),
    );
    assert.equal(await cache.getOrLoad('k', 100, async () => 'ok'), 'ok');
  });
});
