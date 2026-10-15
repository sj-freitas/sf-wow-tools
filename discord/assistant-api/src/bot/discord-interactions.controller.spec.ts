import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { CommandRegistryService } from './command-registry.service';
import type { DiscordInteraction } from './discord-interaction.types';
import { DiscordInteractionsController } from './discord-interactions.controller';

const EPHEMERAL = 64;
const click = (customId: string, type = 3): DiscordInteraction => ({
  type,
  data: { name: '', custom_id: customId },
});

describe('DiscordInteractionsController buttons and modals', () => {
  let registry: CommandRegistryService;
  let controller: any;
  let edits: { token: string; message: unknown }[];

  beforeEach(() => {
    registry = new CommandRegistryService();
    registry.registerComponent(
      'button',
      'open',
      {
        run: async (i: DiscordInteraction) =>
          i.data?.custom_id === 'open:boom'
            ? Promise.reject(new Error('boom'))
            : { modal: { custom_id: i.data?.custom_id, title: 'T', components: [] } },
      },
      'run',
    );
    registry.registerComponent('modal', 'open', { run: () => 'thanks' }, 'run');
    edits = [];
    const bot = {
      editInteractionResponse: (_app: string, token: string, message: unknown) => {
        edits.push({ token, message });
        return Promise.resolve();
      },
    } as unknown as DiscordBotService;
    controller = new DiscordInteractionsController(
      { getOrThrow: () => 'public-key' } as unknown as ConfigService,
      registry,
      bot,
    );
  });

  it('answers a button click that opens a modal with the modal (response type 9)', async () => {
    const response = await controller.handleComponent(click('open:abc'));
    assert.equal(response.type, 9);
    assert.equal(response.data.custom_id, 'open:abc');
  });

  it('answers a submitted modal with a private message (response type 4)', async () => {
    const response = await controller.handleComponent(click('open:abc', 5));
    assert.equal(response.type, 4);
    assert.deepEqual(response.data, { content: 'thanks', flags: EPHEMERAL });
  });

  it('says so, privately, when nothing handles the button any more', async () => {
    const response = await controller.handleComponent(click('gone:1'));
    assert.equal(response.data.flags, EPHEMERAL);
    assert.match(response.data.content, /no longer available/);
  });

  it('answers privately when a handler throws', async () => {
    const response = await controller.handleComponent(click('open:boom'));
    assert.equal(response.data.flags, EPHEMERAL);
    assert.match(response.data.content, /Something went wrong/);
  });

  it('does not run a button handler for a modal, or the other way round', async () => {
    registry.registerComponent('button', 'only-button', { run: () => 'x' }, 'run');
    assert.equal(await registry.executeComponent('modal', click('only-button:1', 5)), null);
  });

  it('answers "thinking" at once for slow work, then shows its result (types 5 and 6)', async () => {
    let finish!: (value: string) => void;
    registry.registerComponent(
      'button',
      'slow',
      {
        run: (i: DiscordInteraction) => ({
          defer: i.data?.custom_id === 'slow:mine' ? 'update' : 'reply',
          work: () => new Promise<string>((resolve) => (finish = resolve)),
        }),
      },
      'run',
    );
    const withToken = (id: string) => ({ ...click(id), application_id: 'app', token: 'tok' });

    const reply = await controller.handleComponent(withToken('slow:public'));
    assert.deepEqual(reply, { type: 5, data: { flags: EPHEMERAL } });
    assert.equal(edits.length, 0);
    finish('done');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(edits, [{ token: 'tok', message: { content: 'done' } }]);

    const update = await controller.handleComponent(withToken('slow:mine'));
    assert.deepEqual(update, { type: 6 });
  });
});
