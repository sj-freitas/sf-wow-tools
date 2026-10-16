import type { Role, SignupAssignmentScope, SignupStatus } from '@prisma/client';
import type { APIEmbed } from 'discord-api-types/v10';
import type { RichMessage } from '../discord/discord-bot.service';
import { renderLine, type AssignmentLine } from './assignment-lines';
import { PREFIX, compactId, customId } from './signup-ids';
import { groupLabel, type EventKindConfig } from './event-kinds';
import { ROLE_CATEGORIES, ROLE_EMOJI, STATUS_CATEGORIES } from './signup-rules';
import { discordTimestamp } from './signup-time';

/**
 * What the bot posts for events, built from plain data (no I/O): the sign-up post with its
 * buttons, the raid setup, the assignments and the reminder sent by DM.
 */

/** The site's purple. */
const COLOR = 0x6d43c2;
/** Discord refuses embed fields longer than this. */
const MAX_FIELD = 1024;
const MAX_CONTENT = 2000;
/** Discord refuses embed titles longer than this. */
const MAX_TITLE = 256;

export interface EventView {
  id: string;
  title: string;
  description: string;
  /** Where (a dungeon, raid or any place); empty when not given. */
  location: string;
  startsAt: Date;
  closed: boolean;
  createdByName: string;
  /** Who leads it (its creator unless changed) and who is master looter, by Discord account. */
  leaderDiscordUserId: string;
  masterLooterDiscordUserId: string | null;
  /** Characters or members (`event-kinds.ts`). */
  kind: EventKindConfig;
  /** On the website: the event's page and the guild's "add a character" page. */
  eventUrl: string;
  addCharacterUrl: string;
}

export interface EntryView {
  id: string;
  discordUserId: string;
  discordName: string;
  /** Null for someone absent who picked no character. */
  characterName: string | null;
  characterClass: string | null;
  role: Role | null;
  status: SignupStatus;
  groupNumber: number | null;
  groupSlot: number | null;
  /** Has raid assist. */
  assist: boolean;
}

/** "Darkshivan", or the person's Discord name when they gave no character. */
export const entryName = (entry: EntryView): string => entry.characterName ?? entry.discordName;

/** A class's colour dot as message text (`<:c_druid_ff7c0a:123>`), or '' when there is none. */
export type ClassDot = (className: string | null) => string;

/**
 * The pictures a post uses, as message text: each class's icon or dot, each role's icon, and the
 * leader's. Anything left out falls back to plain emoji (🛡️ 💚 🏹 ⚔️ 👑) or nothing (classes).
 */
export interface Look {
  dot?: ClassDot;
  /** `<:r_tank_…:id>`, or '' to use the role's emoji. */
  role?: (role: Role) => string;
  /** `<:r_leader_…:id>`, or '' for 👑. */
  leader?: string;
  /** `<:r_assist_…:id>`, or '' for 🥈. */
  assist?: string;
  /** `<:r_masterlooter_…:id>`, or '' for 💰. */
  masterLooter?: string;
}

const dotOf = (look: Look): ClassDot => look.dot ?? (() => '');
const roleIconOf = (look: Look, role: Role): string => look.role?.(role) || ROLE_EMOJI[role];

/**
 * A blank line under a column's names, so the next row of columns (Ranged, Melee under Tank,
 * Healer) and the lists below don't sit right against it.
 */
const GAP = '\n\u200b';

/**
 * Items joined by `separator`, cut short with "+N more" so the field stays within Discord's limit.
 * "—" when there are none.
 */
export function nameList(names: readonly string[], limit = MAX_FIELD, separator = '\n'): string {
  if (names.length === 0) return '—';
  const items: string[] = [];
  let length = 0;
  for (const [index, name] of names.entries()) {
    const more = `+${names.length - index} more`;
    if (length + name.length + separator.length + more.length > limit) {
      items.push(more);
      break;
    }
    items.push(name);
    length += name.length + separator.length;
  }
  return items.join(separator);
}

/** One person in a list: their sign-up number, class icon and name. "`12` 🟠 Darkshivan" */
const personLine = (entry: EntryView, number: number, dot: ClassDot): string =>
  [`\`${number}\``, dot(entry.characterClass), entryName(entry)]
    .filter((part) => part !== '')
    .join(' ');

/** An empty cell, to keep the role columns two to a row. */
const SPACER = { name: '\u200b', value: '\u200b', inline: true };

/** The role names the role columns are titled with. */
const ROLE_TITLES: Record<Role, string> = Object.fromEntries(
  ROLE_CATEGORIES.map(({ role, label }) => [role, label.split(' ').slice(1).join(' ')]),
) as Record<Role, string>;

/**
 * A long list as up to three columns side by side (inline fields), the first one titled. Short
 * lists stay one column.
 */
function columns(title: string, lines: readonly string[]): NonNullable<APIEmbed['fields']> {
  const count = lines.length <= 8 ? 1 : Math.min(3, Math.ceil(lines.length / 8));
  const perColumn = Math.max(1, Math.ceil(lines.length / count));
  return Array.from({ length: count }, (_, column) => ({
    name: column === 0 ? title : '\u200b',
    value:
      nameList(lines.slice(column * perColumn, (column + 1) * perColumn), MAX_FIELD - GAP.length) +
      GAP,
    inline: true,
  }));
}

/**
 * The sign-up post: the event; who leads it, when, and how many are coming; then one column per
 * role (🛡️ Tank, 💚 Healer, 🏹 Ranged, ⚔️ Melee) listing who signed up, each with their sign-up
 * number and class colour; then Late, Tentative and Absent as short lists; and the buttons.
 * `entries` come in sign-up order (that is where the numbers come from).
 *
 * The title carries the count, "Name - 👥 N (+M)": N signed up, M late or tentative.
 */
export function renderEventMessage(
  event: EventView,
  entries: readonly EntryView[],
  look: Look = {},
): RichMessage {
  const dot = dotOf(look);
  const numbered = entries.map((entry, index) => ({ entry, number: index + 1 }));
  const inStatus = (status: SignupStatus) =>
    numbered.filter(({ entry }) => entry.status === status);
  const available = inStatus('AVAILABLE');
  // Signed up, and maybe (late or tentative).
  const coming = available.length;
  const maybe = inStatus('LATE').length + inStatus('TENTATIVE').length;

  const fields: NonNullable<APIEmbed['fields']> = [];
  if (event.kind.usesCharacters) {
    for (const [index, { role }] of ROLE_CATEGORIES.entries()) {
      const inRole = available.filter(({ entry }) => entry.role === role);
      fields.push({
        name: `${roleIconOf(look, role)} ${ROLE_TITLES[role]} (${inRole.length})`,
        value:
          nameList(
            inRole.map(({ entry, number }) => personLine(entry, number, dot)),
            MAX_FIELD - GAP.length,
          ) + GAP,
        inline: true,
      });
      if (index % 2 === 1) fields.push(SPACER);
    }
  } else {
    // A members event: everyone coming in one list, by server nickname.
    fields.push(
      ...columns(
        `✅ Signed up (${available.length})`,
        available.map(({ entry, number }) => personLine(entry, number, dot)),
      ),
    );
  }
  for (const { status, label } of STATUS_CATEGORIES) {
    const people = inStatus(status);
    if (people.length === 0) continue;
    fields.push({
      name: `${label} (${people.length})`,
      value:
        nameList(
          people.map(({ entry, number }) => personLine(entry, number, dot)),
          MAX_FIELD - GAP.length,
          ', ',
        ) + GAP,
      inline: false,
    });
  }

  // Right under the title, before the description: where, then when and how long until.
  const header = [
    ...(event.location.trim() ? [`📍 ${event.location.trim()}`] : []),
    `🗓️ ${discordTimestamp(event.startsAt, 'F')} - ⏳ ${discordTimestamp(event.startsAt, 'R')}`,
  ].join('\n');
  // How many are coming goes in the title (the link): "First Guild Meeting - 👥 8 (+2)".
  const count = ` - 👥 ${coming}${maybe > 0 ? ` (+${maybe})` : ''}`;
  const embed: APIEmbed = {
    title: event.title.slice(0, MAX_TITLE - count.length) + count,
    url: event.eventUrl,
    description: [header, event.description.trim()].filter((part) => part !== '').join('\n\n'),
    color: COLOR,
    fields,
    ...(event.closed ? { footer: { text: '🔒 Sign-ups are closed' } } : {}),
  };

  const id = compactId(event.id);
  const button = (label: string, prefix: string, style: number) => ({
    type: 2,
    style,
    label,
    custom_id: customId(prefix, id),
    disabled: event.closed,
  });
  const link = (label: string, url: string) => ({ type: 2, style: 5, label, url });
  return {
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          button('Sign up', PREFIX.join, 3),
          button('Late', PREFIX.late, 2),
          button('Tentative', PREFIX.tentative, 2),
          button('Absent', PREFIX.absent, 4),
        ],
      },
      {
        type: 1,
        components: [
          ...(event.kind.usesCharacters ? [link('Add character', event.addCharacterUrl)] : []),
          link('Open on the website', event.eventUrl),
        ],
      },
    ],
  };
}

/**
 * After a name in the setup: the leader's crown, or the silver one for an assist, and the bag for
 * the master looter.
 */
function raidMarks(
  event: Pick<EventView, 'leaderDiscordUserId' | 'masterLooterDiscordUserId'>,
  entry: EntryView,
  look: Look,
): string {
  const marks: string[] = [];
  if (entry.discordUserId === event.leaderDiscordUserId) marks.push(look.leader || '👑');
  else if (entry.assist) marks.push(look.assist || '🥈');
  if (entry.discordUserId === event.masterLooterDiscordUserId) {
    marks.push(look.masterLooter || '💰');
  }
  return marks.join(' ');
}

/** The raid setup: groups 1-8 with whoever is in them. Mentions ping the players in groups. */
export function renderSetupMessage(
  event: Pick<
    EventView,
    'title' | 'startsAt' | 'eventUrl' | 'kind' | 'leaderDiscordUserId' | 'masterLooterDiscordUserId'
  >,
  entries: readonly EntryView[],
  mention: boolean,
  look: Look = {},
): RichMessage {
  const dot = dotOf(look);
  const fields: NonNullable<APIEmbed['fields']> = [];
  const placed: EntryView[] = [];
  for (let group = 1; group <= event.kind.groupCount; group++) {
    const members = entries
      .filter((entry) => entry.groupNumber === group)
      .sort((a, b) => (a.groupSlot ?? 0) - (b.groupSlot ?? 0));
    if (members.length === 0) continue;
    placed.push(...members);
    const lines = members.map((entry) =>
      // "<role icon> <class icon> Name <leader / assist> <master looter>".
      [
        entry.role ? roleIconOf(look, entry.role) : '',
        dot(entry.characterClass),
        entryName(entry),
        raidMarks(event, entry, look),
      ]
        .filter((part) => part !== '')
        .join(' '),
    );
    const label = groupLabel(event.kind, group);
    // "Group 1:", or for one unlimited group (a members event's invited) "Invited (7):", spread
    // over columns since it can be long. A blank line under each keeps the rows apart.
    fields.push(
      ...(event.kind.groupSize === null
        ? columns(`${label} (${members.length}):`, lines)
        : [
            {
              name: `${label}:`,
              value: nameList(lines, MAX_FIELD - GAP.length) + GAP,
              inline: true,
            },
          ]),
    );
  }
  const embed: APIEmbed = {
    title: `${event.kind.setupTitle} · ${event.title}`,
    url: event.eventUrl,
    description:
      fields.length === 0
        ? event.kind.groupCount === 1
          ? 'Nobody has been invited yet.'
          : 'Nobody has been placed in a group yet.'
        : `🗓️ ${discordTimestamp(event.startsAt, 'F')}`,
    color: COLOR,
    fields,
  };
  return {
    content: mention ? mentionsOf(placed.map((entry) => entry.discordUserId)) : '',
    embeds: [embed],
    mention,
  };
}

const SCOPE_LABELS: Record<SignupAssignmentScope, string> = {
  GLOBAL: 'Everyone',
  RAID: 'Raid',
  BOSS: 'Boss',
};

export interface AssignmentView {
  scope: SignupAssignmentScope;
  scopeLabel: string;
  title: string;
  lines: AssignmentLine[];
  mentions: boolean;
}

/** "Boss · Patchwerk", "Raid · Naxxramas", "Everyone". */
export const scopeHeading = (scope: SignupAssignmentScope, label: string): string =>
  label.trim() === '' ? SCOPE_LABELS[scope] : `${SCOPE_LABELS[scope]} · ${label.trim()}`;

/**
 * An assignment as a plain message (so its images can sit under it): a heading, one line per task,
 * and the players' mentions at the end when it pings them.
 */
export function renderAssignmentMessage(
  assignment: AssignmentView,
  entries: readonly EntryView[],
  /** A raid marker's emoji by name (`Skull`), or '' to write the marker as text. */
  markerEmoji: (marker: string) => string = () => '',
  /** The role and class icons put in front of each player, as on the sign-up post. */
  look: Look = {},
): RichMessage {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const nameOf = (entryId: string) => {
    const entry = byId.get(entryId);
    return entry ? entryName(entry) : null;
  };
  const dot = dotOf(look);
  const iconsOf = (entryId: string) => {
    const entry = byId.get(entryId);
    if (!entry) return '';
    return [entry.role ? roleIconOf(look, entry.role) : '', dot(entry.characterClass)]
      .filter((part) => part !== '')
      .join(' ');
  };
  const lines = assignment.lines
    .map((line) => renderLine(line, nameOf, markerEmoji, iconsOf))
    .filter((line): line is string => line !== null);
  const heading = `### ${assignment.title}\n-# ${scopeHeading(assignment.scope, assignment.scopeLabel)}`;
  const mentioned = assignment.mentions
    ? assignment.lines
        .flatMap((line) => line.entryIds)
        .map((id) => byId.get(id)?.discordUserId)
        .filter((id): id is string => id !== undefined)
    : [];
  const tail = mentioned.length > 0 ? `\n\n${mentionsOf(mentioned)}` : '';
  let body = [heading, ...lines].join('\n');
  if (body.length + tail.length > MAX_CONTENT) {
    body = `${body.slice(0, MAX_CONTENT - tail.length - 2)}…`;
  }
  return { content: body + tail, mention: mentioned.length > 0 };
}

const mentionsOf = (discordUserIds: readonly string[]): string =>
  [...new Set(discordUserIds)].map((id) => `<@${id}>`).join(' ');

/** The DM reminding someone to answer an event, with a button to the sign-up post. */
export function renderReminder(
  event: Pick<EventView, 'title' | 'startsAt'>,
  guildName: string,
  senderName: string,
  postUrl: string,
): { embed: APIEmbed; components: unknown[] } {
  return {
    embed: {
      title: event.title,
      description: `${senderName} from **${guildName}** asks you to sign up for this event (or say you can't come).\n\n🗓️ ${discordTimestamp(event.startsAt, 'F')} · ${discordTimestamp(event.startsAt, 'R')}`,
      color: COLOR,
    },
    components: [
      { type: 1, components: [{ type: 2, style: 5, label: 'Open the sign-up', url: postUrl }] },
    ],
  };
}

export const messageUrl = (serverId: string, channelId: string, messageId: string): string =>
  `https://discord.com/channels/${serverId}/${channelId}/${messageId}`;
