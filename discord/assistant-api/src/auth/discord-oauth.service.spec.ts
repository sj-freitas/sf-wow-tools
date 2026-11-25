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
});
