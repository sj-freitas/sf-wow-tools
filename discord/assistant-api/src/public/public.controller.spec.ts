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
