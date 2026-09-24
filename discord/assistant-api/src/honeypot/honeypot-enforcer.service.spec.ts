import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { HoneypotEnforcerService, type PostedMessage } from './honeypot-enforcer.service';

const OFFICER = 'officer-role';
const message = (overrides: Partial<PostedMessage> = {}): PostedMessage => ({
  serverId: 'main',
  channelId: 'trap',
  messageId: 'm1',
  authorId: 'spammer',
  authorUsername: 'spammy',
  authorIsBot: false,
  isServerOwner: false,
  isAdministrator: false,
  roleIds: [],
  ...overrides,
});

describe('HoneypotEnforcerService', () => {
  let testMode: boolean;
  let banFails: boolean;
  let bans: any[];
  let logs: { channelId: string; text: string }[];
  let events: any[];
  let roleLookups: string[];
  let enforcer: HoneypotEnforcerService;

  beforeEach(async () => {
    testMode = true;
    banFails = false;
    bans = [];
    logs = [];
    events = [];
    roleLookups = [];
    const prisma = {
      honeypot: {
        findMany: async () => [
          {
            id: 'h1',
            name: 'trap',
            testMode,
            discordServerId: 'main',
            channelId: 'trap',
            logChannelId: 'log',
            guild: { officerRoleId: OFFICER, servers: [{ discordId: 'main' }] },
          },
        ],
      },
      honeypotEvent: { create: async (args: any) => void events.push(args.data) },
    } as unknown as PrismaService;
    const bot = {
      getBotUserId: async () => 'bot',
      fetchMemberRoles: async (server: string, user: string) => {
        roleLookups.push(`${server}:${user}`);
        return [OFFICER];
      },
      banMember: async (server: string, user: string, options: any) => {
        if (banFails) throw new Error('Missing Permissions');
        bans.push({ server, user, ...options });
      },
      postQuietMessage: async (channelId: string, text: string) =>
        void logs.push({ channelId, text }),
    } as unknown as DiscordBotService;
    enforcer = new HoneypotEnforcerService(prisma, bot);
    await enforcer.refresh();
  });

  it('knows which channels are honeypots', () => {
    assert.equal(enforcer.isHoneypot('trap'), true);
    assert.equal(enforcer.isHoneypot('general'), false);
  });

  it('ignores posts in other channels', async () => {
    await enforcer.handle(message({ channelId: 'general' }));
    assert.deepEqual([bans, logs, events], [[], [], []]);
  });

  describe('test mode', () => {
    it('only logs what it would do and bans nobody', async () => {
      await enforcer.handle(message());
      assert.equal(bans.length, 0);
      assert.equal(logs.length, 1);
      assert.equal(logs[0].channelId, 'log');
      assert.match(logs[0].text, /Test mode.*Would ban/);
      assert.equal(events[0].action, 'WOULD_BAN');
    });
  });

  describe('live mode', () => {
    beforeEach(async () => {
      testMode = false;
      await enforcer.refresh();
    });

    it('bans and deletes the last hour of messages, and logs it', async () => {
      await enforcer.handle(message());
      assert.deepEqual(bans, [
        {
          server: 'main',
          user: 'spammer',
          deleteMessageSeconds: 3600,
          reason: 'Guild Assistant honeypot: posted in #trap',
        },
      ]);
      assert.match(logs[0].text, /Banned/);
      assert.equal(events[0].action, 'BANNED');
    });

    it('records and logs a failed ban with the reason', async () => {
      banFails = true;
      await enforcer.handle(message());
      assert.equal(events[0].action, 'FAILED');
      assert.match(events[0].error, /Missing Permissions/);
      assert.match(logs[0].text, /Could not ban/);
    });
  });

  describe('who is left alone', () => {
    it('Officers (role known from the message)', async () => {
      await enforcer.handle(message({ roleIds: ['x', OFFICER] }));
      assert.deepEqual([bans, logs, events], [[], [], []]);
    });

    it('Officers when the post is in another server: roles are looked up in the main server', async () => {
      await enforcer.handle(message({ serverId: 'other', roleIds: [] }));
      assert.deepEqual(roleLookups, ['main:spammer']);
      assert.deepEqual([bans, logs, events], [[], [], []]);
    });

    it('bots, the server owner and Administrators', async () => {
      await enforcer.handle(message({ authorIsBot: true }));
      await enforcer.handle(message({ authorId: 'o', isServerOwner: true }));
      await enforcer.handle(message({ authorId: 'a', isAdministrator: true }));
      assert.deepEqual([bans, logs, events], [[], [], []]);
    });
  });

  it('does not flood the log channel when the same person keeps posting', async () => {
    await enforcer.handle(message());
    await enforcer.handle(message({ messageId: 'm2' }));
    await enforcer.handle(message({ messageId: 'm3' }));
    assert.equal(logs.length, 1);
    assert.equal(events.length, 1);
    await enforcer.handle(message({ authorId: 'someone-else', messageId: 'm4' }));
    assert.equal(logs.length, 2);
  });
});
