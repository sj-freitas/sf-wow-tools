import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { DiscordInteraction } from '../bot/discord-interaction.types';
import { OfficerRequestsCommand } from './officer-requests.command';
import { MESSAGES, type OfficerRequestsService } from './officer-requests.service';

const interaction = (
  options: { name: string; value: string | number | boolean }[],
  over: Partial<DiscordInteraction> = {},
): DiscordInteraction => ({
  type: 2,
  guild_id: '111111111111111111',
  member: {
    nick: 'Nicky',
    roles: ['r1'],
    user: { id: 'u1', username: 'user', global_name: 'Global' },
  },
  data: { name: 'x', options },
  ...over,
});

describe('OfficerRequestsCommand', () => {
  let calls: { kind: string; input: any }[];
  let command: OfficerRequestsCommand;
  let refusal: string | null;
  let loaded: unknown[];
  let imageResult: unknown;

  beforeEach(() => {
    calls = [];
    refusal = null;
    loaded = [];
    imageResult = undefined;
    const service = {
      contact: async (input: unknown) => (calls.push({ kind: 'contact', input }), 'contacted'),
      reply: async (input: unknown) => (calls.push({ kind: 'reply', input }), 'replied'),
      checkCanContinue: async () => refusal,
      loadImage: async (attachment: unknown) => {
        loaded.push(attachment);
        return imageResult;
      },
    } as unknown as OfficerRequestsService;
    command = new OfficerRequestsCommand(service);
  });

  it('passes the message, the optional anonymous flag and the conversation id on', async () => {
    const answer = await command.contact(
      interaction([
        { name: 'message', value: '  hello officers  ' },
        { name: 'anonymous', value: false },
        { name: 'conversation-id', value: 12345678 },
      ]),
    );
    assert.equal(answer, 'contacted');
    assert.deepEqual(calls[0].input, {
      serverId: '111111111111111111',
      invoker: { id: 'u1', name: 'Nicky', roleIds: ['r1'] },
      message: 'hello officers',
      image: undefined,
      anonymous: false,
      conversationId: 12345678,
    });
  });

  it('leaves the anonymous flag undefined when it was not given', async () => {
    await command.contact(interaction([{ name: 'message', value: 'hi' }]));
    assert.equal(calls[0].input.anonymous, undefined);
    assert.equal(calls[0].input.conversationId, undefined);
  });

  describe('images', () => {
    const attachment = {
      id: '9',
      filename: 'me.png',
      size: 100,
      url: 'https://cdn.discordapp.com/x',
    };
    const withImage = (options: { name: string; value: string | number | boolean }[]) =>
      interaction([...options, { name: 'image', value: '9' }], {
        data: {
          name: 'x',
          options: [...options, { name: 'image', value: '9' }],
          resolved: { attachments: { '9': attachment } },
        },
      });

    it('hands the attached file to the service and passes the image on', async () => {
      imageResult = { data: Buffer.from('img'), contentType: 'image/png' };
      await command.contact(withImage([{ name: 'message', value: 'look' }]));
      assert.deepEqual(loaded, [attachment]);
      assert.equal(calls[0].input.image, imageResult);
    });

    it('does the same for officer replies', async () => {
      imageResult = { data: Buffer.from('img'), contentType: 'image/png' };
      await command.reply(
        withImage([
          { name: 'conversation-id', value: 12345678 },
          { name: 'message', value: 'see' },
        ]),
      );
      assert.equal(calls[0].input.image, imageResult);
    });

    it('answers with the reason and sends nothing when the image is refused', async () => {
      imageResult = 'The image is too big';
      assert.equal(
        await command.contact(withImage([{ name: 'message', value: 'look' }])),
        'The image is too big',
      );
      assert.deepEqual(calls, []);
    });
  });

  it('only works inside a server', async () => {
    const dm = interaction([{ name: 'message', value: 'hi' }], {
      guild_id: undefined,
      member: undefined,
      user: { id: 'u1' },
    });
    assert.equal(await command.contact(dm), MESSAGES.serverOnly);
    assert.equal(await command.reply(dm), MESSAGES.serverOnly);
    assert.deepEqual(calls, []);
  });

  it('rejects empty and too-long messages before doing anything', async () => {
    assert.match(
      await command.contact(interaction([{ name: 'message', value: '   ' }])),
      /Write a message/,
    );
    assert.match(
      await command.contact(interaction([{ name: 'message', value: 'x'.repeat(3501) }])),
      /too long/,
    );
    assert.deepEqual(calls, []);
  });

  it('replies with the conversation id and the message', async () => {
    await command.reply(
      interaction([
        { name: 'conversation-id', value: 12345678 },
        { name: 'message', value: 'answer' },
      ]),
    );
    assert.deepEqual(calls[0].input.conversationId, 12345678);
    assert.equal(calls[0].input.message, 'answer');
  });

  it('asks for the conversation id when replying without one', async () => {
    assert.match(
      await command.reply(interaction([{ name: 'message', value: 'answer' }])),
      /conversation ID/,
    );
  });

  describe('the Reply button in a DM', () => {
    const CUSTOM_ID = 'contact-reply:guild-1:12345678';
    const dmInteraction = (over: Partial<DiscordInteraction['data']> = {}): DiscordInteraction => ({
      type: 3,
      user: { id: 'u1', username: 'user', global_name: 'Global' },
      data: { name: '', custom_id: CUSTOM_ID, ...over },
    });

    it('opens a form for the message when the member may write', async () => {
      const reply = await command.openReplyForm(dmInteraction());
      assert.ok(typeof reply === 'object');
      assert.equal(reply.modal.custom_id, CUSTOM_ID);
      assert.match(reply.modal.title, /#12345678/);
      assert.ok(reply.modal.title.length <= 45);
    });

    it('shows why instead when the conversation is locked or not theirs', async () => {
      refusal = MESSAGES.locked;
      assert.equal(await command.openReplyForm(dmInteraction()), MESSAGES.locked);
    });

    it('ignores buttons with a malformed id', async () => {
      assert.equal(
        await command.openReplyForm(dmInteraction({ custom_id: 'contact-reply:x' })),
        MESSAGES.conversationNotFound,
      );
    });

    it('sends the submitted message as a follow-up to that conversation', async () => {
      const answer = await command.sendReplyForm({
        ...dmInteraction(),
        type: 5,
        data: {
          name: '',
          custom_id: CUSTOM_ID,
          components: [{ components: [{ custom_id: 'message', value: '  thanks!  ' }] }],
        },
      });
      assert.equal(answer, 'contacted');
      assert.deepEqual(calls[0].input, {
        guildId: 'guild-1',
        invoker: { id: 'u1', name: 'Global', roleIds: undefined },
        message: 'thanks!',
        conversationId: 12345678,
      });
    });

    it('refuses an empty submission', async () => {
      const answer = await command.sendReplyForm({
        ...dmInteraction(),
        type: 5,
        data: { name: '', custom_id: CUSTOM_ID, components: [] },
      });
      assert.match(answer, /Write a message/);
      assert.deepEqual(calls, []);
    });
  });
});
