import type { RealtimeService } from '../realtime/realtime.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { MESSAGES, MESSAGE_COOLDOWN_MS, OfficerRequestsService } from './officer-requests.service';

const SERVER = '111111111111111111';
const OTHER_SERVER = '222222222222222222';
const CHANNEL = '333333333333333333';
const OFFICER_ROLE = 'officer-role';
const member = { id: 'member-1', name: 'Merric' };

describe('OfficerRequestsService', () => {
  let guild: any;
  let conversation: any;
  let recentMessage: any;
  let takenIds: Set<number>;
  let idProbes: number;
  let posts: { channelId: string; embed: any; options: any }[];
  let dms: { userId: string; embed: any; components?: any[] }[];
  let postFails: boolean;
  let dmFails: boolean;
  let officerRolesElsewhere: string[];
  let createdConversation: any;
  let createdMessages: any[];
  let touched: string[];
  let guildUpdate: any;
  let published: string[][];
  let deleted: string[];
  let channelDeletes: string[][];
  let failDeleteOf: string | null;
  let mention: string | null;
  let service: OfficerRequestsService;

  beforeEach(() => {
    guild = {
      id: 'g1',
      name: 'Relic Hunters',
      realm: 'Realm',
      officerRoleId: OFFICER_ROLE,
      officerRequestChannelId: CHANNEL,
      servers: [{ discordId: SERVER }],
    };
    conversation = null;
    recentMessage = null;
    takenIds = new Set();
    idProbes = 0;
    posts = [];
    dms = [];
    postFails = false;
    dmFails = false;
    officerRolesElsewhere = [OFFICER_ROLE];
    createdConversation = null;
    createdMessages = [];
    touched = [];
    guildUpdate = null;
    published = [];
    deleted = [];
    channelDeletes = [];
    failDeleteOf = null;
    mention = '</contact-officer:999>';
    const prisma = {
      guild: {
        findUnique: async (args: any) => (args.where.id === guild.id ? guild : null),
        findFirst: async (args: any) => {
          const wanted = args.where.servers.some.discordId;
          return wanted === SERVER || wanted === OTHER_SERVER ? guild : null;
        },
        update: async (args: any) => void (guildUpdate = args.data),
      },
      discordServer: {
        findFirst: async (args: any) => (args.where.discordId === SERVER ? { id: 'row' } : null),
      },
      officerMessage: {
        findFirst: async () => recentMessage,
        create: async (args: any) => void createdMessages.push(args.data),
      },
      officerConversation: {
        findFirst: async (args: any) =>
          conversation &&
          conversation.publicId === args.where.publicId &&
          conversation.userDiscordId === args.where.userDiscordId
            ? conversation
            : null,
        findUnique: async (args: any) => {
          const key = args.where.guildId_publicId;
          if (args.include)
            return conversation && conversation.publicId === key.publicId ? conversation : null;
          idProbes++;
          return takenIds.has(key.publicId) ? { id: 'taken' } : null;
        },
        create: async (args: any) => void (createdConversation = args.data),
        update: async (args: any) => void touched.push(args.where.id),
        updateMany: async (args: any) => {
          const found = conversation && conversation.publicId === args.where.publicId;
          if (found) conversation.lockedAt = args.data.lockedAt;
          return { count: found ? 1 : 0 };
        },
        delete: async (args: any) => void deleted.push(args.where.id),
      },
    } as unknown as PrismaService;
    const bot = {
      postEmbed: async (channelId: string, embed: any, options: any) => {
        if (postFails) throw new Error('Missing Access');
        posts.push({ channelId, embed, options });
        return `discord-msg-${posts.length}`;
      },
      sendDirectMessage: async (userId: string, embed: any, components?: unknown[]) => {
        if (dmFails) throw new Error('Cannot send messages to this user');
        dms.push({ userId, embed, components });
      },
      getCommandMention: async () => mention,
      deleteMessage: async (channelId: string, messageId: string) => {
        if (messageId === failDeleteOf) throw new Error('Unknown Message');
        channelDeletes.push([channelId, messageId]);
      },
      fetchMemberRoles: async () => officerRolesElsewhere,
      listTextChannels: async () => [{ id: CHANNEL, name: 'officer-requests' }],
      postMessage: async (channelId: string, text: string) =>
        void posts.push({ channelId, embed: text, options: null }),
    } as unknown as DiscordBotService;
    const realtime = {
      publish: (guildId: string, type: string) => void published.push([guildId, type]),
    } as unknown as RealtimeService;
    service = new OfficerRequestsService(prisma, bot, realtime);
  });

  describe('/contact-officer', () => {
    it('tells the backoffice to refresh when a request comes in', async () => {
      await service.contact({
        serverId: SERVER,
        invoker: member,
        message: 'Hello',
        anonymous: true,
      });
      assert.deepEqual(published, [['g1', 'officer-requests']]);
    });

    const send = (extra: Record<string, unknown> = {}) =>
      service.contact({ serverId: SERVER, invoker: member, message: 'Please help', ...extra });

    it('tells the member when the server is not linked to a guild', async () => {
      assert.equal(await send({ serverId: '999999999999999999' }), MESSAGES.notLinked);
    });

    it('bounces with the setup message when the Officer Request Channel is not set', async () => {
      guild.officerRequestChannelId = null;
      assert.equal(
        await send(),
        'The Officer Request Channel is not setup for your guild, please contact an officer to set it up.',
      );
      assert.deepEqual([posts, createdConversation], [[], null]);
    });

    it('starts a conversation anonymously by default, posts it, and gives the member its id', async () => {
      const answer = await send();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].channelId, CHANNEL);
      assert.equal(posts[0].embed.description, 'Please help');
      assert.equal(posts[0].embed.fields[0].value, 'Anonymous member');
      assert.ok(
        !JSON.stringify(posts[0].embed).includes(member.id),
        'the post must not mention the member',
      );
      assert.equal(createdConversation.isAnonymous, true);
      assert.equal(createdConversation.userName, null);
      assert.equal(createdConversation.userDiscordId, member.id);
      assert.match(String(createdConversation.publicId), /^\d{8}$/);
      assert.ok(answer.includes(`**${createdConversation.publicId}**`));
      assert.match(answer, /anonymously/);
    });

    it('shows a link to the member, and stores their name, when they choose not to be anonymous', async () => {
      await send({ anonymous: false });
      assert.equal(posts[0].embed.fields[0].value, `<@${member.id}>`);
      assert.equal(createdConversation.isAnonymous, false);
      assert.equal(createdConversation.userName, 'Merric');
    });

    it('uses an 8-digit id that is free in the guild, retrying on collisions', async () => {
      const seen = new Set<number>();
      // Every candidate is "taken" until the third probe.
      const original = takenIds;
      takenIds = new Proxy(original, {
        get(target, prop) {
          if (prop === 'has') return (id: number) => (seen.add(id), idProbes < 3);
          const value = Reflect.get(target, prop) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      await send();
      assert.equal(idProbes, 3);
      assert.match(String(createdConversation.publicId), /^\d{8}$/);
    });

    describe('continuing a conversation', () => {
      beforeEach(() => {
        conversation = {
          id: 'c1',
          publicId: 12345678,
          isAnonymous: true,
          userDiscordId: member.id,
          messages: [{ discordMessageId: 'first-post' }],
        };
      });

      it('adds a follow-up, replying to the first post, and ignores the anonymous option', async () => {
        const answer = await send({ conversationId: 12345678, anonymous: false });
        assert.equal(posts[0].embed.title, 'Follow-up · #12345678');
        assert.equal(posts[0].embed.fields[0].value, 'Anonymous member');
        assert.deepEqual(posts[0].options, { replyTo: 'first-post' });
        assert.equal(createdConversation, null);
        assert.equal(createdMessages[0].conversationId, 'c1');
        assert.deepEqual(touched, ['c1']);
        assert.match(answer, /follow-up was sent/);
      });

      it('says it cannot find the conversation when somebody else tries to continue it', async () => {
        const answer = await service.contact({
          serverId: SERVER,
          invoker: { id: 'someone-else', name: 'Else' },
          message: 'Hi',
          conversationId: 12345678,
        });
        assert.equal(answer, MESSAGES.conversationNotFound);
        assert.deepEqual([posts, createdMessages], [[], []]);
      });

      it('tells the member the conversation is locked, and posts nothing', async () => {
        conversation.lockedAt = new Date();
        assert.equal(await send({ conversationId: 12345678 }), MESSAGES.locked);
        assert.match(MESSAGES.locked, /new conversation/);
        assert.deepEqual([posts, createdMessages, touched], [[], [], []]);
      });

      it('says it cannot find a conversation id that does not exist', async () => {
        assert.equal(await send({ conversationId: 87654321 }), MESSAGES.conversationNotFound);
      });
    });

    it('makes the member wait between messages', async () => {
      recentMessage = { id: 'm' };
      assert.equal(await send(), MESSAGES.cooldown);
      assert.equal(posts.length, 0);
      assert.equal(MESSAGE_COOLDOWN_MS, 30_000);
    });

    it('saves nothing and gives a friendly error when the channel post fails', async () => {
      postFails = true;
      assert.equal(await send(), MESSAGES.deliveryFailed);
      assert.deepEqual([createdConversation, createdMessages], [null, []]);
    });
  });

  describe('/contact-officer-reply', () => {
    beforeEach(() => {
      conversation = {
        id: 'c1',
        publicId: 12345678,
        isAnonymous: true,
        userDiscordId: member.id,
        messages: [
          { author: 'USER', content: 'Please help with X', discordMessageId: 'first-post' },
        ],
      };
    });

    const reply = (roleIds: string[] | undefined = [OFFICER_ROLE], serverId = SERVER) =>
      service.reply({
        serverId,
        invoker: { id: 'officer-1', name: 'Olga', roleIds },
        conversationId: 12345678,
        message: 'Sure, here is the answer',
      });

    it('bounces people without the Officer role', async () => {
      assert.equal(await reply(['member-role']), MESSAGES.notOfficer);
      assert.deepEqual([posts, dms, createdMessages], [[], [], []]);
    });

    it('bounces everyone when the guild has no Officer role', async () => {
      guild.officerRoleId = null;
      assert.equal(await reply(), MESSAGES.noOfficerRole);
    });

    it('looks the role up in the main server when the command was used in another server', async () => {
      officerRolesElsewhere = [];
      assert.equal(await reply(undefined, OTHER_SERVER), MESSAGES.notOfficer);
      officerRolesElsewhere = [OFFICER_ROLE];
      assert.match(await reply(undefined, OTHER_SERVER), /was sent to the member by DM/);
    });

    it('posts the reply in the channel with the officer’s name, replying to the request', async () => {
      await reply();
      assert.equal(posts[0].channelId, CHANNEL);
      assert.equal(posts[0].embed.description, 'Sure, here is the answer');
      assert.equal(posts[0].embed.fields[0].value, 'Olga');
      assert.deepEqual(posts[0].options, { replyTo: 'first-post' });
    });

    it('DMs the member the reply, the officer, the original request, the guild and how to answer', async () => {
      await reply();
      assert.equal(dms.length, 1);
      assert.equal(dms[0].userId, member.id);
      const embed = dms[0].embed;
      assert.match(embed.title, /Relic Hunters/);
      assert.equal(embed.description, 'Sure, here is the answer');
      const fields = Object.fromEntries(embed.fields.map((f: any) => [f.name, f.value]));
      assert.equal(fields['Guild'], 'Relic Hunters · Realm');
      assert.equal(fields['Replied by'], 'Olga');
      assert.equal(fields['Your request'], 'Please help with X');
      assert.match(fields['To reply'], /click <\/contact-officer:999>.*`12345678`/);
      assert.match(fields['To reply'], /\/contact-officer conversation-id:12345678 message:/);
    });

    it('puts a Reply button, carrying the guild and conversation, under the DM', async () => {
      await reply();
      const button = dms[0].components?.[0].components[0];
      assert.deepEqual(
        [button.type, button.label, button.custom_id],
        [2, 'Reply', 'contact-reply:g1:12345678'],
      );
      assert.match(
        dms[0].embed.fields.find((f: any) => f.name === 'To reply').value,
        /^Press \*\*Reply\*\* below/,
      );
    });

    it('falls back to plain instructions when the command id is unknown', async () => {
      mention = null;
      await reply();
      const text = dms[0].embed.fields.find((f: any) => f.name === 'To reply').value;
      assert.doesNotMatch(text, /<\//);
      assert.match(text, /use \/contact-officer with \*\*conversation-id\*\* `12345678`/);
    });

    it('saves the reply with the officer and whether the DM was delivered', async () => {
      await reply();
      assert.deepEqual(
        [createdMessages[0].author, createdMessages[0].officerName, createdMessages[0].dmDelivered],
        ['OFFICER', 'Olga', true],
      );
      assert.deepEqual(touched, ['c1']);
    });

    it('still saves and posts the reply, and tells the officer, when the DM cannot be delivered', async () => {
      dmFails = true;
      const answer = await reply();
      assert.equal(createdMessages[0].dmDelivered, false);
      assert.equal(posts.length, 1);
      assert.match(answer, /could not be reached by DM/);
    });

    it('says when the conversation does not exist', async () => {
      conversation = null;
      assert.equal(await reply(), MESSAGES.officerConversationNotFound);
    });

    it('bounces officers replying to a locked conversation', async () => {
      conversation.lockedAt = new Date();
      assert.equal(await reply(), MESSAGES.locked);
      assert.deepEqual([posts, dms, createdMessages], [[], [], []]);
    });

    describe('locking and deleting from the backoffice', () => {
      it('locks and unlocks, and tells the backoffice', async () => {
        await service.setLocked('g1', 12345678, true);
        assert.ok(conversation.lockedAt instanceof Date);
        await service.setLocked('g1', 12345678, false);
        assert.equal(conversation.lockedAt, null);
        assert.deepEqual(published, [
          ['g1', 'officer-requests'],
          ['g1', 'officer-requests'],
        ]);
      });

      it('404s when locking an unknown conversation', async () => {
        await assert.rejects(service.setLocked('g1', 87654321, true), NotFoundException);
      });

      it('refuses backoffice replies to a locked conversation', async () => {
        conversation.lockedAt = new Date();
        await assert.rejects(
          service.replyAsOfficer('g1', 12345678, { id: 'o', name: 'Olga' }, 'Hi'),
          ConflictException,
        );
        assert.deepEqual([posts, dms, createdMessages], [[], [], []]);
      });

      describe('deleting', () => {
        beforeEach(() => {
          conversation.guild = { officerRequestChannelId: CHANNEL };
          conversation.messages = [
            { author: 'USER', discordMessageId: 'm1' },
            { author: 'OFFICER', discordMessageId: 'm2' },
            { author: 'OFFICER', discordMessageId: null },
          ];
        });

        it('deletes the tracked messages from the channel, then the conversation', async () => {
          assert.deepEqual(await service.deleteConversation('g1', 12345678), { notDeleted: 0 });
          assert.deepEqual(channelDeletes, [
            [CHANNEL, 'm1'],
            [CHANNEL, 'm2'],
          ]);
          assert.deepEqual(deleted, ['c1']);
          assert.deepEqual(dms, []); // DMs are never touched
          assert.deepEqual(published, [['g1', 'officer-requests']]);
        });

        it('still removes the conversation when a channel message is already gone', async () => {
          failDeleteOf = 'm1';
          assert.deepEqual(await service.deleteConversation('g1', 12345678), { notDeleted: 1 });
          assert.deepEqual(channelDeletes, [[CHANNEL, 'm2']]);
          assert.deepEqual(deleted, ['c1']);
        });

        it('404s for an unknown conversation and deletes nothing', async () => {
          await assert.rejects(service.deleteConversation('g1', 87654321), NotFoundException);
          assert.deepEqual([channelDeletes, deleted], [[], []]);
        });
      });
    });

    describe('from the Reply button', () => {
      it('checks that the member owns the conversation and that it is not locked', async () => {
        assert.equal(await service.checkCanContinue('g1', 12345678, member.id), null);
        assert.equal(
          await service.checkCanContinue('g1', 12345678, 'someone-else'),
          MESSAGES.conversationNotFound,
        );
        conversation.lockedAt = new Date();
        assert.equal(await service.checkCanContinue('g1', 12345678, member.id), MESSAGES.locked);
      });
    });

    describe('from the backoffice', () => {
      const replyAsOfficer = () =>
        service.replyAsOfficer('g1', 12345678, { id: 'officer-1', name: 'Olga' }, 'From the web');

      it('delivers like the command: channel post, DM and saved message', async () => {
        assert.deepEqual(await replyAsOfficer(), { dmDelivered: true });
        assert.equal(posts[0].embed.description, 'From the web');
        assert.deepEqual(posts[0].options, { replyTo: 'first-post' });
        assert.equal(dms[0].userId, member.id);
        assert.equal(dms[0].embed.fields.find((f: any) => f.name === 'Replied by').value, 'Olga');
        assert.deepEqual(
          [createdMessages[0].officerDiscordId, createdMessages[0].officerName],
          ['officer-1', 'Olga'],
        );
        assert.deepEqual(touched, ['c1']);
      });

      it('tells the backoffice to refresh', async () => {
        await replyAsOfficer();
        assert.deepEqual(published, [['g1', 'officer-requests']]);
      });

      it('reports a DM that could not be delivered', async () => {
        dmFails = true;
        assert.deepEqual(await replyAsOfficer(), { dmDelivered: false });
        assert.equal(createdMessages[0].dmDelivered, false);
      });

      it('404s for an unknown conversation', async () => {
        conversation = null;
        await assert.rejects(replyAsOfficer(), NotFoundException);
        assert.deepEqual([posts, dms, createdMessages], [[], [], []]);
      });
    });
  });

  describe('setting the channel', () => {
    it('checks the channel and posts a note to prove the bot can write there', async () => {
      await service.setChannel('g1', { serverId: SERVER, channelId: CHANNEL });
      assert.equal(posts.length, 1);
      assert.deepEqual(guildUpdate, {
        officerRequestServerId: SERVER,
        officerRequestChannelId: CHANNEL,
      });
    });

    it('rejects servers outside the guild and channels outside the server', async () => {
      await assert.rejects(
        service.setChannel('g1', { serverId: OTHER_SERVER, channelId: CHANNEL }),
        /not part of this guild/,
      );
      await assert.rejects(
        service.setChannel('g1', { serverId: SERVER, channelId: '999999999999999999' }),
        BadRequestException,
      );
      assert.equal(guildUpdate, null);
    });

    it('clears the channel', async () => {
      await service.setChannel('g1', null);
      assert.deepEqual(guildUpdate, {
        officerRequestServerId: null,
        officerRequestChannelId: null,
      });
    });
  });
});
