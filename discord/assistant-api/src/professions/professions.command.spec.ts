import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DiscordInteraction } from '../bot/discord-interaction.types';
import { ProfessionsCommand } from './professions.command';
import type { CrafterMatch, ProfessionsService } from './professions.service';

const interaction = (item: string, guildId: string | null = 'server-1') =>
  ({
    guild_id: guildId,
    data: { name: 'crafter', options: [{ name: 'item', type: 3, value: item }] },
  }) as unknown as DiscordInteraction;

const command = (found: { matches: CrafterMatch[]; more: number } | null) =>
  new ProfessionsCommand({
    findCrafters: async () => found,
  } as unknown as ProfessionsService);

const rod: CrafterMatch = {
  name: 'Copper Rod',
  url: 'https://www.wowhead.com/forever/spell=1245287/copper-rod',
  profession: 'Blacksmithing',
  crafters: [
    { name: 'Shivan Nightpath', discordUserId: '123' },
    { name: 'Bob', discordUserId: null },
  ],
};

describe('/crafter', () => {
  it('lists each recipe found with its crafters and their Discord profiles', async () => {
    const reply = await command({ matches: [rod], more: 0 }).crafter(interaction('copper rod'));
    assert.equal(
      reply,
      '**[Copper Rod](<https://www.wowhead.com/forever/spell=1245287/copper-rod>)** · Blacksmithing\n' +
        '- Shivan Nightpath · <@123>\n' +
        '- Bob',
    );
  });

  it('says when nobody can craft it', async () => {
    const reply = await command({ matches: [], more: 0 }).crafter(interaction('thorium'));
    assert.equal(reply, "Couldn't find a crafter for “thorium”.");
  });

  it('says how many more matched', async () => {
    const reply = await command({ matches: [rod], more: 3 }).crafter(interaction('copper'));
    assert.match(reply, /…and 3 more recipes: be more specific\.$/);
  });

  it('keeps within Discord’s message length', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...rod,
      name: `Recipe ${i}`,
      crafters: Array.from({ length: 30 }, (_, j) => ({
        name: `Crafter ${j}`,
        discordUserId: `${j}`,
      })),
    }));
    const reply = await command({ matches: many, more: 0 }).crafter(interaction('recipe'));
    assert.ok(reply.length <= 2000, `${reply.length} characters`);
    assert.match(reply, /more recipes: be more specific\.$/);
  });

  it('needs a server linked to a guild', async () => {
    assert.match(await command(null).crafter(interaction('rod')), /isn't linked to a guild/);
    assert.match(await command(null).crafter(interaction('rod', null)), /inside a server/);
  });
});
