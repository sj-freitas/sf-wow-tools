import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError, GuildAssistantApi, summarize, type UploadResult } from './api';

function fakeFetch(answer: Response | Error) {
  const asked: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
  return { fetcher, asked };
}

const guild = (name: string, imported: number): UploadResult['guilds'][number] => ({
  id: name,
  name,
  result: {
    imported: Array.from({ length: imported }, (_, i) => ({ name: `C${i}`, relayed: false })),
    skipped: [],
  },
});

describe('GuildAssistantApi', () => {
  it('sends the file with the key, as JSON, to the upload endpoint', async () => {
    const { fetcher, asked } = fakeFetch(Response.json({ guilds: [] }));
    const api = new GuildAssistantApi('https://ga.test', 'GuildAssistantUploader/1.0.0', fetcher);
    assert.deepEqual(await api.uploadProfessions('gak_key', 'DB = {}'), { guilds: [] });
    assert.equal(asked[0].url, 'https://ga.test/api/upload/professions');
    assert.equal(asked[0].init?.method, 'POST');
    assert.deepEqual(asked[0].init?.headers, {
      Authorization: 'Bearer gak_key',
      'User-Agent': 'GuildAssistantUploader/1.0.0',
      'Content-Type': 'application/json',
    });
    assert.equal(asked[0].init?.body, JSON.stringify({ data: 'DB = {}' }));
  });

  it('checks a key with who it is', async () => {
    const account = { user: { name: 'Shivan' }, guilds: [{ id: 'g', name: 'Alpha' }] };
    const { fetcher, asked } = fakeFetch(Response.json(account));
    const api = new GuildAssistantApi('https://ga.test', 'ua', fetcher);
    assert.deepEqual(await api.me('gak_key'), account);
    assert.equal(asked[0].url, 'https://ga.test/api/upload/me');
    assert.equal(asked[0].init?.method, 'GET');
  });

  it('passes on Guild Assistant’s message, its status, or that it couldn’t be reached', async () => {
    const refused = fakeFetch(
      Response.json({ message: 'That upload key doesn’t work.' }, { status: 401 }),
    );
    await assert.rejects(
      new GuildAssistantApi('https://ga.test', 'ua', refused.fetcher).me('gak_x'),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 401 &&
        error.message === 'That upload key doesn’t work.',
    );
    const broken = fakeFetch(new Response('oops', { status: 502 }));
    await assert.rejects(
      new GuildAssistantApi('https://ga.test', 'ua', broken.fetcher).me('gak_x'),
      /answered 502/,
    );
    const offline = fakeFetch(new TypeError('fetch failed'));
    await assert.rejects(
      new GuildAssistantApi('https://ga.test', 'ua', offline.fetcher).me('gak_x'),
      (error: unknown) =>
        error instanceof ApiError && error.status === null && /online/.test(error.message),
    );
  });
});

describe('summarize', () => {
  it('says how many characters each guild updated', () => {
    assert.equal(
      summarize({ guilds: [guild('Alpha', 3), guild('Zeta', 1)] }),
      'Updated 3 characters in Alpha, 1 in Zeta.',
    );
    assert.equal(
      summarize({ guilds: [guild('Alpha', 1), guild('Zeta', 0)] }),
      'Updated 1 character in Alpha.',
    );
    assert.match(summarize({ guilds: [guild('Alpha', 0)] }), /rosters/);
    assert.match(summarize({ guilds: [] }), /aren’t in a guild/);
  });
});
