import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import { DiscordApiError, DiscordOAuthService } from './discord-oauth.service';

const config = {
  getOrThrow: (key: string) => `test-${key}`,
} as unknown as ConfigService;

/** Answers `response` to the next calls, keeping what each was asked with. */
function withFetch(response: () => Promise<Response>): {
  calls: RequestInit[];
  restore: () => void;
} {
  const calls: RequestInit[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    calls.push(init ?? {});
    return response();
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

/** A 429 that asks for `retryAfter` seconds, as Discord sends it. */
const rateLimited = (retryAfter: string): Response =>
  new Response('{"message":"You are being rate limited."}', {
    status: 429,
    headers: { 'retry-after': retryAfter },
  });

describe('DiscordOAuthService', () => {
  it('gives every call to Discord a time limit', async () => {
    const service = new DiscordOAuthService(config);
    const { calls, restore } = withFetch(async () => new Response('{"user":{"id":"1"}}'));
    try {
      await service.fetchServerMember('s1', 'u1');
    } finally {
      restore();
    }
    // Without one, a call Discord leaves hanging holds up whatever asked for it (an upload waiting
    // on a membership check) for as long as Discord keeps the connection open.
    assert.ok(calls[0].signal instanceof AbortSignal);
    assert.equal(calls[0].signal?.aborted, false);
  });

  it('says what Discord answered, so a member it has no record of can be told apart', async () => {
    const service = new DiscordOAuthService(config);
    const { restore } = withFetch(
      async () => new Response('{"message":"Unknown Member"}', { status: 404 }),
    );
    try {
      await assert.rejects(service.fetchServerMember('s1', 'u1'), (error: unknown) => {
        assert.ok(error instanceof DiscordApiError);
        assert.equal(error.discordStatus, 404);
        return true;
      });
    } finally {
      restore();
    }
  });

  it('waits out a rate limit and asks again, as Discord asked it to', async () => {
    const service = new DiscordOAuthService(config);
    let answered = 0;
    const { calls, restore } = withFetch(async () => {
      answered += 1;
      return answered === 1 ? rateLimited('0.01') : new Response('[{"id":"g1","name":"G"}]');
    });
    try {
      // Some of these routes allow one request a second, which a single sync can reach twice.
      // Giving up on the first 429 cost the caller everything it was doing.
      assert.deepEqual(await service.fetchGuilds('token'), [{ id: 'g1', name: 'G' }]);
    } finally {
      restore();
    }
    assert.equal(calls.length, 2);
  });

  it('gives up on a rate limit that outlasts the second try, saying how long Discord asked for', async () => {
    const service = new DiscordOAuthService(config);
    const { calls, restore } = withFetch(async () => rateLimited('0.01'));
    try {
      await assert.rejects(service.fetchGuilds('token'), (error: unknown) => {
        assert.ok(error instanceof DiscordApiError);
        assert.equal(error.discordStatus, 429);
        assert.equal(error.retryAfterMs, 10);
        assert.match(error.message, /\/users\/@me\/guilds failed \(429\), retry after 10ms/);
        return true;
      });
    } finally {
      restore();
    }
    assert.equal(calls.length, 2, 'it waits a rate limit out once, not forever');
  });
});
