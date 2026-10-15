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

export interface EventView {
  id: string;
  title: string;
  description: string;
  startsAt: Date;
  closed: boolean;
  createdByName: string;
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
}

/** "Darkshivan", or the person's Discord name when they gave no character. */
export const entryName = (entry: EntryView): string => entry.characterName ?? entry.discordName;

/** A class's colour dot as message text (`<:c_druid_ff7c0a:123>`), or '' when there is none. */
export type ClassDot = (className: string | null) => string;
const noDots: ClassDot = () => '';

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

/** One person in a list: their sign-up number, class colour and name. "`12` 🟠 **Darkshivan**" */
const personLine = (entry: EntryView, number: number, dot: ClassDot): string =>
  [`\`${number}\``, dot(entry.characterClass), `**${entryName(entry)}**`]
    .filter((part) => part !== '')
    .join(' ');

/** An empty cell, to keep the role columns two to a row. */
const SPACER = { name: '\u200b', value: '\u200b', inline: true };

/**
 * A long list as up to three columns side by side (inline fields), the first one titled. Short
 * lists stay one column.
 */
function columns(title: string, lines: readonly string[]): NonNullable<APIEmbed['fields']> {
  const count = lines.length <= 8 ? 1 : Math.min(3, Math.ceil(lines.length / 8));
  const perColumn = Math.max(1, Math.ceil(lines.length / count));
  return Array.from({ length: count }, (_, column) => ({
    name: column === 0 ? title : '\u200b',
    value: nameList(lines.slice(column * perColumn, (column + 1) * perColumn)),
    inline: true,
  }));
}

/**
 * The sign-up post: the event; who leads it, when, and how many are coming; then one column per
 * role (🛡️ Tank, 💚 Healer, 🏹 Ranged, ⚔️ Melee) listing who signed up, each with their sign-up
 * number and class colour; then Late, Tentative and Absent as short lists; and the buttons.
 * `entries` come in sign-up order (that is where the numbers come from).
 *
 * The count is "**N** (+M)": N are coming (signed up or late), M are tentative.
 */
export function renderEventMessage(
  event: EventView,
  entries: readonly EntryView[],
  dot: ClassDot = noDots,
): RichMessage {
  const numbered = entries.map((entry, index) => ({ entry, number: index + 1 }));
  const inStatus = (status: SignupStatus) =>
    numbered.filter(({ entry }) => entry.status === status);
  const available = inStatus('AVAILABLE');
  const coming = available.length + inStatus('LATE').length;
  const tentative = inStatus('TENTATIVE').length;

  const fields: NonNullable<APIEmbed['fields']> = [];
  if (event.kind.usesCharacters) {
    for (const [index, { role, label }] of ROLE_CATEGORIES.entries()) {
      const inRole = available.filter(({ entry }) => entry.role === role);
      fields.push({
        name: `${label} (${inRole.length})`,
        value: nameList(inRole.map(({ entry, number }) => personLine(entry, number, dot))),
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
      value: nameList(
        people.map(({ entry, number }) => personLine(entry, number, dot)),
        MAX_FIELD,
        ', ',
      ),
      inline: false,
    });
  }

  const header = [
    `🗓️ ${discordTimestamp(event.startsAt, 'F')} · ⏳ ${discordTimestamp(event.startsAt, 'R')}`,
    `👑 ${event.createdByName} · 👥 **${coming}**${tentative > 0 ? ` (+${tentative})` : ''}`,
  ].join('\n');
  const embed: APIEmbed = {
    title: event.title,
    url: event.eventUrl,
    description: [event.description.trim(), header].filter((part) => part !== '').join('\n\n'),
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

/** The raid setup: groups 1-8 with whoever is in them. Mentions ping the players in groups. */
export function renderSetupMessage(
  event: Pick<EventView, 'title' | 'startsAt' | 'eventUrl' | 'kind'>,
  entries: readonly EntryView[],
  mention: boolean,
  dot: ClassDot = noDots,
): RichMessage {
  const fields: NonNullable<APIEmbed['fields']> = [];
  const placed: EntryView[] = [];
  for (let group = 1; group <= event.kind.groupCount; group++) {
    const members = entries
      .filter((entry) => entry.groupNumber === group)
      .sort((a, b) => (a.groupSlot ?? 0) - (b.groupSlot ?? 0));
    if (members.length === 0) continue;
    placed.push(...members);
    const lines = members.map((entry) =>
      // "🛡️ – <icon> Name": the dash keeps the role emoji and the class icon apart.
      [entry.role ? `${ROLE_EMOJI[entry.role]} –` : '', dot(entry.characterClass), entryName(entry)]
        .filter((part) => part !== '')
        .join(' '),
    );
    const name = groupLabel(event.kind, group);
    // One unlimited group (a members event's invited) can be long: spread it over columns.
    fields.push(
      ...(event.kind.groupSize === null
        ? columns(`${name} (${members.length})`, lines)
        : [{ name, value: nameList(lines), inline: true }]),
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
): RichMessage {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const nameOf = (entryId: string) => {
    const entry = byId.get(entryId);
    return entry ? entryName(entry) : null;
  };
  const lines = assignment.lines
    .map((line) => renderLine(line, nameOf, markerEmoji))
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
