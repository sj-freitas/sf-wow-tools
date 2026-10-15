import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inflateSync } from 'node:zlib';
import type { DiscordBotService } from '../discord/discord-bot.service';
import { ClassEmojiService, emojiName, emojiText, iconEmojiName } from './class-emojis.service';
import { classIcon, markerIcon } from '../game/games';
import { colorDotPng } from './color-dot';

describe('colorDotPng', () => {
  it('draws a PNG of the colour, transparent in the corners and solid in the middle', () => {
    const png = colorDotPng('#FF7C0A', 16);
    assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]); // "PNG"
    const idatAt = png.indexOf('IDAT');
    const length = png.readUInt32BE(idatAt - 4);
    const pixels = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + length));
    const row = 16 * 4 + 1;
    const pixel = (x: number, y: number) => [
      ...pixels.subarray(y * row + 1 + x * 4, y * row + 5 + x * 4),
    ];
    assert.equal(pixel(0, 0)[3], 0);
    assert.deepEqual(pixel(8, 8), [0xff, 0x7c, 0x0a, 255]);
  });
});

describe('emojiName', () => {
  it('fits Discord’s emoji names and carries the colour', () => {
    assert.equal(emojiName('Druid', '#FF7C0A'), 'c_druid_ff7c0a');
    assert.equal(emojiName('Death Knight', '#C41E3A'), 'c_deathknight_c41e3a');
    assert.ok(emojiName('A very long class name indeed', '#000000').length <= 32);
    assert.equal(iconEmojiName('Death Knight', '3fa2b19c'), 'i_deathknight_3fa2b19c');
    assert.ok(iconEmojiName('A very long class name indeed', '3fa2b19c').length <= 32);
  });
});

describe('ClassEmojiService', () => {
  it('uploads each class’s icon (or colour dot) once and turns classes into emojis', async () => {
    // Forever has an icon for every class (src/game/forever/class-icons/).
    const druid = iconEmojiName('Druid', classIcon('Forever', 'Druid')!.hash);
    const priest = iconEmojiName('Priest', classIcon('Forever', 'Priest')!.hash);
    const created: { name: string; contentType: string }[] = [];
    const discord = {
      listApplicationEmojis: () => Promise.resolve([{ id: '1', name: druid }]),
      createApplicationEmoji: (name: string, _data: Buffer, contentType: string) => {
        created.push({ name, contentType });
        return Promise.resolve({ id: String(created.length + 1), name });
      },
    } as unknown as DiscordBotService;
    const service = new ClassEmojiService(discord);
    const emojiOf = await service.forGame('Forever');
    assert.deepEqual(emojiOf('Druid'), { id: '1', name: druid });
    assert.equal(emojiText(emojiOf('Druid')), `<:${druid}:1>`);
    assert.equal(emojiOf('Nobody'), null);
    assert.deepEqual(
      created.find((emoji) => emoji.name === priest),
      { name: priest, contentType: 'image/png' },
    );
    assert.ok(!created.some((emoji) => emoji.name === druid));

    const before = created.length;
    await service.forGame('Forever');
    assert.equal(created.length, before);
  });

  it('uploads the raid marker icons as emojis, by marker name', async () => {
    const created: string[] = [];
    const discord = {
      listApplicationEmojis: () => Promise.resolve([]),
      createApplicationEmoji: (name: string) => {
        created.push(name);
        return Promise.resolve({ id: String(created.length), name });
      },
    } as unknown as DiscordBotService;
    const markerOf = await new ClassEmojiService(discord).markersFor('Forever');
    const skull = `m_skull_${markerIcon('Forever', 'Skull')!.hash}`;
    assert.equal(markerOf('Skull')?.name, skull);
    assert.ok(created.includes(skull));
    assert.equal(markerOf('Nothing'), null);
  });

  it('works without emojis when Discord refuses', async () => {
    const discord = {
      listApplicationEmojis: () => Promise.reject(new Error('no application id')),
    } as unknown as DiscordBotService;
    const emojiOf = await new ClassEmojiService(discord).forGame('Forever');
    assert.equal(emojiOf('Druid'), null);
    assert.equal(emojiText(null), '');
  });
});
