import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { DiscordInteraction, ReplyMessage } from '../bot/discord-interaction.types';
import type { ClassEmojiService } from '../discord/class-emojis.service';
import type { SignupAccessService } from './signup-access.service';
import type { CharacterOption, SignupChoice, SignupEntriesService } from './signup-entries.service';
import type { EventRow, SignupEventsService, SignupGuild } from './signup-events.service';
import { PREFIX, compactId, customId, roleCode, statusCode } from './signup-ids';
import type { SignupViewer } from './signup-rules';
import { SignupCommand } from './signup.command';
import { nextHalfHourIn, todayIn } from './signup-time';

const EVENT_ID = '0b6f3c2e-5d4a-4f1b-9c8d-7e6f5a4b3c2d';
const HEALER_ID = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
const HYBRID_ID = 'a0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
const ID = compactId(EVENT_ID);

const GUILD: SignupGuild = {
  id: 'guild-1',
  name: 'Relic Hunters',
  gameVersion: 'Forever',
  region: 'EU',
  realm: 'RP',
  faction: 'ALLIANCE',
  officerRoleId: 'officer-role',
  servers: [{ discordId: 'server-1', isMain: true }],
};

const CHARACTERS: CharacterOption[] = [
  {
    id: HEALER_ID,
    name: 'Tearyn',
    class: 'Priest',
    roles: ['HEALER'],
    isMain: false,
    inGuild: true,
  },
  {
    id: HYBRID_ID,
    name: 'Darkshivan',
    class: 'Druid',
    roles: ['TANK', 'HEALER'],
    isMain: true,
    inGuild: false,
  },
];

function makeEvent(over: Partial<EventRow> = {}): EventRow {
  return {
    id: EVENT_ID,
    guildId: GUILD.id,
    kind: 'CHARACTERS',
    title: 'Naxxramas',
    description: '',
    location: '',
    startsAt: new Date(Date.now() + 86_400_000),
    timezone: 'Europe/Paris',
    serverId: 'server-1',
    channelId: 'channel-1',
    messageId: 'message-1',
    createdByDiscordId: 'owner',
    createdByName: 'Owner',
    lockMode: 'AUTO',
    closedShown: false,
    setupMessageId: null,
    setupMentions: false,
    pluginKey: null,
    pluginAutoRun: true,
    archivedAt: null,
    publishAt: null,
    publishError: null,
    leaderDiscordUserId: null,
    masterLooterDiscordUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    entries: [],
    ...over,
  };
}

const interaction = (
  customIdValue: string,
  over: Partial<NonNullable<DiscordInteraction['data']>> = {},
): DiscordInteraction => ({
  type: 3,
  guild_id: 'server-1',
  member: { roles: [], user: { id: 'user-1', username: 'user', global_name: 'User One' } },
  data: { name: '', custom_id: customIdValue, ...over },
});

interface Menu {
  custom_id: string;
  options: {
    label: string;
    value: string;
    default?: boolean;
    description: string;
    emoji?: { id: string; name: string };
  }[];
}
/** The select menu in the first row of a private reply. */
const menuOf = (message: { components?: unknown[] }): Menu =>
  (message.components as { components: Menu[] }[])[0].components[0];

const commandInteraction = (options: Record<string, string>): DiscordInteraction => ({
  type: 2,
  guild_id: 'server-1',
  member: { roles: [], user: { id: 'user-1', username: 'user' } },
  data: {
    name: 'create-event',
    options: Object.entries(options).map(([name, value]) => ({ name, value })),
  },
});

describe('SignupCommand', () => {
  let event: EventRow;
  let viewer: SignupViewer;
  let settings: { channelServerId: string | null; channelId: string | null };
  let created: { channel: unknown; startsAt: Date } | null;
  let signUps: SignupChoice[];
  let statuses: { status: string; note?: string }[];
  let lastPerson: { isOfficer?: boolean } | null = null;
  let command: SignupCommand;

  beforeEach(() => {
    event = makeEvent();
    viewer = { discordId: 'user-1', isOfficer: false, isEventCreator: false };
    settings = { channelServerId: 'server-1', channelId: 'events' };
    created = null;
    signUps = [];
    statuses = [];
    const events = {
      origin: 'https://site.test',
      findGuildOfServer: () => Promise.resolve(GUILD),
      findGuild: () => Promise.resolve(GUILD),
      getSettings: () => Promise.resolve(settings),
      loadById: () => Promise.resolve(event),
      peek: () =>
        Promise.resolve({
          kind: event.kind,
          lockMode: event.lockMode,
          startsAt: event.startsAt,
          archivedAt: event.archivedAt,
          hasCharacter: event.entries.some((entry) => entry.characterId),
        }),
      create: (_g: unknown, _c: unknown, input: { startsAt: Date }, channel: unknown) => {
        created = { channel, startsAt: input.startsAt };
        return Promise.resolve(makeEvent());
      },
    } as unknown as SignupEventsService;
    const entries = {
      characterOptions: () => Promise.resolve(CHARACTERS),
      signUp: (_e: unknown, _g: unknown, person: { isOfficer?: boolean }, choice: SignupChoice) => {
        signUps.push(choice);
        lastPerson = person;
        const name = CHARACTERS.find((c) => c.id === choice.characterId)?.name ?? '?';
        return Promise.resolve({ characterName: name });
      },
      setStatus: (_e: unknown, _p: unknown, status: string, note?: string) => {
        statuses.push({ status, note });
        return Promise.resolve('updated');
      },
    } as unknown as SignupEntriesService;
    const access = {
      forDiscordMember: () => Promise.resolve(viewer),
    } as unknown as SignupAccessService;
    const classEmojis = {
      forGame: () =>
        Promise.resolve((className: string | null) =>
          className === 'Druid' ? { id: '42', name: 'c_druid_ff7c0a' } : null,
        ),
    } as unknown as ClassEmojiService;
    command = new SignupCommand(events, entries, access, classEmojis);
  });

  describe('/create-event', () => {
    const OPTIONS = { name: 'Naxx', date: '2030-10-20', time: '20:00' };

    it('refuses members who are neither Officers nor EventCreators', async () => {
      assert.match(await command.createEvent(commandInteraction(OPTIONS)), /Only Officers/);
      assert.equal(created, null);
    });

    it('posts in the event channel, reading the time as server time', async () => {
      viewer = { ...viewer, isEventCreator: true };
      assert.match(await command.createEvent(commandInteraction(OPTIONS)), /Event created/);
      assert.deepEqual(created?.channel, { serverId: 'server-1', channelId: 'events' });
      // 20:00 in Paris in October 2030 (summer time) is 18:00 UTC.
      assert.equal(created?.startsAt.toISOString(), '2030-10-20T18:00:00.000Z');
    });

    it('lets only Officers pick another channel', async () => {
      viewer = { ...viewer, isEventCreator: true };
      const elsewhere = commandInteraction({ ...OPTIONS, channel: 'general' });
      assert.match(await command.createEvent(elsewhere), /outside <#events>/);
      viewer = { ...viewer, isOfficer: true };
      assert.match(await command.createEvent(elsewhere), /Event created/);
      assert.deepEqual(created?.channel, { serverId: 'server-1', channelId: 'general' });
    });

    it("is today, in the event's timezone, when no date is given", async () => {
      viewer = { ...viewer, isEventCreator: true };
      const withoutDate = { name: OPTIONS.name, time: OPTIONS.time };
      assert.match(await command.createEvent(commandInteraction(withoutDate)), /Event created/);
      const local = DateTime.fromJSDate(created!.startsAt, { zone: 'Europe/Paris' });
      assert.equal(local.toFormat('yyyy-MM-dd HH:mm'), `${todayIn('Europe/Paris')} 20:00`);
    });

    it('starts at the next full or half hour when no time is given', async () => {
      viewer = { ...viewer, isEventCreator: true };
      assert.match(
        await command.createEvent(commandInteraction({ name: OPTIONS.name })),
        /Event created/,
      );
      const local = DateTime.fromJSDate(created!.startsAt, { zone: 'Europe/Paris' });
      const soon = nextHalfHourIn('Europe/Paris');
      assert.equal(local.toFormat('yyyy-MM-dd HH:mm'), `${soon.date} ${soon.time}`);
    });

    it('explains a bad date or timezone', async () => {
      viewer = { ...viewer, isEventCreator: true };
      assert.match(
        await command.createEvent(commandInteraction({ ...OPTIONS, date: '20/10/2030' })),
        /YYYY-MM-DD/,
      );
      assert.match(
        await command.createEvent(commandInteraction({ ...OPTIONS, timezone: 'Mars' })),
        /Unknown timezone/,
      );
    });
  });

  describe('signing up', () => {
    const pickValue = (characterId: string, role: string) =>
      `${compactId(characterId)}.${roleCode(role as never)}`;

    it('answers "thinking" at once, then one menu of each character in each role it plays', async () => {
      event = makeEvent({
        entries: [
          {
            discordUserId: 'user-1',
            characterId: HYBRID_ID,
            role: 'HEALER',
          } as EventRow['entries'][0],
        ],
      });
      const reply = command.join(interaction(customId(PREFIX.join, ID)));
      assert.ok(typeof reply === 'object' && 'defer' in reply);
      assert.equal(reply.defer, 'reply');
      const menu = menuOf((await reply.work()) as ReplyMessage);
      assert.equal(menu.custom_id, customId(PREFIX.pick, ID, statusCode('AVAILABLE')));
      assert.deepEqual(
        menu.options.map((option) => [option.label, option.value]),
        [
          ['Tearyn · 💚 Healer', pickValue(HEALER_ID, 'HEALER')],
          ['Darkshivan · 🛡️ Tank', pickValue(HYBRID_ID, 'TANK')],
          ['Darkshivan · 💚 Healer', pickValue(HYBRID_ID, 'HEALER')],
        ],
      );
      // Nothing preselected (Discord ignores re-picking it); the current choice says so.
      assert.ok(menu.options.every((option) => !option.default));
      assert.match(menu.options[2].description, /^Signed up now · Druid · Main/);
      // The class colour dot, where the class has one.
      assert.deepEqual(menu.options[1].emoji, { id: '42', name: 'c_druid_ff7c0a' });
      assert.equal(menu.options[0].emoji, undefined);
    });

    it('signs up with the character and role picked, in one step', async () => {
      const reply = command.pick(
        interaction(customId(PREFIX.pick, ID, statusCode('AVAILABLE')), {
          values: [pickValue(HYBRID_ID, 'TANK')],
        }),
      );
      assert.ok(typeof reply === 'object' && 'defer' in reply);
      assert.equal(reply.defer, 'update');
      const result = (await reply.work()) as ReplyMessage;
      assert.deepEqual(signUps, [{ characterId: HYBRID_ID, role: 'TANK', status: 'AVAILABLE' }]);
      assert.match(result.content ?? '', /✅ .*Darkshivan.*Tank/);
      assert.deepEqual(result.components, []);
    });

    it('Late: the note form at once when they already have a character signed up', async () => {
      event = makeEvent({
        entries: [{ discordUserId: 'user-1', characterId: HEALER_ID } as EventRow['entries'][0]],
      });
      const reply = await command.late(interaction(customId(PREFIX.late, ID)));
      assert.ok(typeof reply === 'object' && 'modal' in reply);
      assert.equal(reply.modal.custom_id, customId(PREFIX.note, ID, statusCode('LATE')));
      const saved = command.saveNote(
        interaction(reply.modal.custom_id, {
          components: [{ components: [{ custom_id: 'note', value: '30 min late' }] }],
        }),
      );
      assert.ok(typeof saved === 'object' && 'defer' in saved);
      assert.equal(saved.defer, 'reply');
      await saved.work();
      assert.deepEqual(statuses, [{ status: 'LATE', note: '30 min late' }]);
    });

    it('Tentative without a character: the menu, then the form (opened at once), then saved', async () => {
      const menu = await command.tentative(interaction(customId(PREFIX.tentative, ID)));
      assert.ok(typeof menu === 'object' && 'defer' in menu);
      assert.equal(
        menuOf((await menu.work()) as ReplyMessage).custom_id,
        customId(PREFIX.pick, ID, statusCode('TENTATIVE')),
      );
      const form = command.pick(
        interaction(customId(PREFIX.pick, ID, statusCode('TENTATIVE')), {
          values: [pickValue(HEALER_ID, 'HEALER')],
        }),
      );
      assert.ok(typeof form === 'object' && 'modal' in form);
      assert.equal(
        form.modal.custom_id,
        customId(
          PREFIX.note,
          ID,
          statusCode('TENTATIVE'),
          compactId(HEALER_ID),
          roleCode('HEALER'),
        ),
      );
      const done = command.saveNote(
        interaction(form.modal.custom_id, {
          components: [{ components: [{ custom_id: 'note', value: 'maybe' }] }],
        }),
      );
      assert.ok(typeof done === 'object' && 'defer' in done);
      assert.equal(done.defer, 'update');
      await done.work();
      assert.deepEqual(signUps, [
        { characterId: HEALER_ID, role: 'HEALER', status: 'TENTATIVE', note: 'maybe' },
      ]);
    });

    it('Absent needs no character', async () => {
      const reply = command.absent(interaction(customId(PREFIX.absent, ID)));
      assert.ok(typeof reply === 'object' && 'defer' in reply);
      assert.match((await reply.work()) as string, /absent/);
      assert.deepEqual(statuses, [{ status: 'ABSENT', note: undefined }]);
    });

    it('refuses once the event is closed, and shows service refusals', async () => {
      event = makeEvent({ lockMode: 'LOCKED' });
      assert.equal(
        await command.late(interaction(customId(PREFIX.late, ID))),
        'Sign-ups for this event are closed.',
      );
      const join = command.join(interaction(customId(PREFIX.join, ID)));
      assert.ok(typeof join === 'object' && 'defer' in join);
      assert.match((await join.work()) as string, /closed/);

      event = makeEvent();
      const failing = command as unknown as { entries: { signUp: () => Promise<never> } };
      failing.entries.signUp = () => Promise.reject(new BadRequestException('Not yours.'));
      const reply = command.pick(
        interaction(customId(PREFIX.pick, ID, statusCode('AVAILABLE')), {
          values: [pickValue(HEALER_ID, 'HEALER')],
        }),
      );
      assert.ok(typeof reply === 'object' && 'defer' in reply);
      assert.equal(await reply.work(), 'Not yours.');
    });
  });

  describe('a members event', () => {
    beforeEach(() => {
      event = makeEvent({ kind: 'MEMBERS' });
    });

    it('signs up as yourself, with no menu', async () => {
      const reply = command.join(interaction(customId(PREFIX.join, ID)));
      assert.ok(typeof reply === 'object' && 'defer' in reply);
      assert.match((await reply.work()) as string, /✅ You are signed up/);
      assert.deepEqual(statuses, [{ status: 'AVAILABLE', note: undefined }]);
      assert.equal(signUps.length, 0);
    });

    it('Late opens the note form straight away, even when not signed up yet', async () => {
      const reply = await command.late(interaction(customId(PREFIX.late, ID)));
      assert.ok(typeof reply === 'object' && 'modal' in reply);
      assert.equal(reply.modal.custom_id, customId(PREFIX.note, ID, statusCode('LATE')));
    });
  });

  it('/create-event takes the type, characters by default', async () => {
    viewer = { ...viewer, isEventCreator: true };
    let kind: unknown;
    const events = (command as unknown as { events: Record<string, unknown> }).events;
    events.create = (_g: unknown, _c: unknown, input: { kind?: string }) => {
      kind = input.kind;
      return Promise.resolve(makeEvent());
    };
    await command.createEvent(
      commandInteraction({ name: 'Social', date: '2030-10-20', time: '20:00', type: 'MEMBERS' }),
    );
    assert.equal(kind, 'MEMBERS');
    await command.createEvent(
      commandInteraction({ name: 'Raid', date: '2030-10-20', time: '20:00' }),
    );
    assert.equal(kind, 'CHARACTERS');
  });

  it('tells the sign-up whether you are an Officer (Officers get raid assist)', async () => {
    viewer = { ...viewer, isOfficer: true };
    const reply = command.pick(
      interaction(customId(PREFIX.pick, ID, statusCode('AVAILABLE')), {
        values: [`${compactId(HEALER_ID)}.${roleCode('HEALER')}`],
      }),
    );
    assert.ok(typeof reply === 'object' && 'defer' in reply);
    await reply.work();
    assert.equal(lastPerson?.isOfficer, true);
  });
});
