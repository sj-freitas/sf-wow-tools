import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import { PublicController } from './public.controller';

const config = (values: Record<string, string>) =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`${key} missing`);
      return values[key];
    },
  }) as unknown as ConfigService;

describe('PublicController', () => {
  it('uses BOT_INVITE_URL when it is set', () => {
    const controller = new PublicController(
      config({ BOT_INVITE_URL: ' https://example.test/invite ', DISCORD_APPLICATION_ID: 'app' }),
    );
    assert.equal(controller.getInfo().botInviteUrl, 'https://example.test/invite');
  });

  it('builds the invite link from the application id otherwise', () => {
    const controller = new PublicController(config({ DISCORD_APPLICATION_ID: 'app-id' }));
    const url = new URL(controller.getInfo().botInviteUrl);
    assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
    assert.equal(url.searchParams.get('client_id'), 'app-id');
    assert.equal(url.searchParams.get('scope'), 'bot applications.commands');
  });

  it('gives the contact email only when CONTACT_EMAIL is set', () => {
    const app = { DISCORD_APPLICATION_ID: 'app' };
    assert.equal(new PublicController(config(app)).getInfo().contactEmail, null);
    assert.equal(
      new PublicController(config({ ...app, CONTACT_EMAIL: 'me@example.test' })).getInfo()
        .contactEmail,
      'me@example.test',
    );
  });
});

describe('PublicController.discordProfile', () => {
  const response = () => {
    const sent: { status?: number; redirect?: [number, string] } = {};
    const res = {
      status: (code: number) => {
        sent.status = code;
        return { json: () => undefined };
      },
      redirect: (code: number, url: string) => {
        sent.redirect = [code, url];
      },
    };
    return { res: res as never, sent };
  };

  it('forwards to the Discord profile', () => {
    const { res, sent } = response();
    new PublicController(config({ DISCORD_APPLICATION_ID: 'app' })).discordProfile(
      '150741579831836672',
      res,
    );
    assert.deepEqual(sent.redirect, [302, 'https://discord.com/users/150741579831836672']);
  });

  it('refuses anything but a Discord id, so it can send nobody elsewhere', () => {
    for (const id of ['abc', '123', 'https:%2F%2Fevil.test', '1507415798318366720000']) {
      const { res, sent } = response();
      new PublicController(config({ DISCORD_APPLICATION_ID: 'app' })).discordProfile(id, res);
      assert.equal(sent.status, 404, id);
      assert.equal(sent.redirect, undefined, id);
    }
  });
});
