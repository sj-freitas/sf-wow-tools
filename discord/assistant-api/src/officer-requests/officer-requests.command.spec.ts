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

  beforeEach(() => {
    calls = [];
    const service = {
      contact: async (input: unknown) => (calls.push({ kind: 'contact', input }), 'contacted'),
      reply: async (input: unknown) => (calls.push({ kind: 'reply', input }), 'replied'),
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
      anonymous: false,
      conversationId: 12345678,
    });
  });

  it('leaves the anonymous flag undefined when it was not given', async () => {
    await command.contact(interaction([{ name: 'message', value: 'hi' }]));
    assert.equal(calls[0].input.anonymous, undefined);
    assert.equal(calls[0].input.conversationId, undefined);
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
});
