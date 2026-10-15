import { HttpException, Injectable } from '@nestjs/common';
import type { Role, SignupStatus } from '@prisma/client';
import { Command } from '../bot/decorators/command.decorator';
import { Button, Modal, Select } from '../bot/decorators/interaction-handler.decorator';
import {
  getInvokerId,
  getModalValue,
  getStringOption,
  type ComponentReply,
  type DiscordInteraction,
  type ReplyMessage,
} from '../bot/discord-interaction.types';
import { timezoneOfRegion } from '../config/regions';
import { guildPath } from '../guilds/guild-path';
import { ClassEmojiService } from './class-emojis.service';
import { EVENT_KINDS, isEventKind } from './event-kinds';
import { SignupAccessService } from './signup-access.service';
import { SignupEntriesService, type CharacterOption, type Person } from './signup-entries.service';
import { SignupEventsService, type EventRow, type SignupGuild } from './signup-events.service';
import {
  PREFIX,
  compactId,
  customId,
  expandId,
  parseCustomId,
  roleCode,
  roleOfCode,
  statusCode,
  type ParsedId,
} from './signup-ids';
import { addCharacterUrl } from './signup-links';
import { messageUrl } from './signup-messages';
import {
  MAX_NOTE_LENGTH,
  ROLE_CATEGORIES,
  ROLE_EMOJI,
  canCreateEvents,
  canPostIn,
  isClosed,
} from './signup-rules';
import { parseEventStart, resolveTimezone } from './signup-time';

const ALL_ROLES: Role[] = ROLE_CATEGORIES.map((category) => category.role);
const ROLE_NAMES: Record<Role, string> = Object.fromEntries(
  ROLE_CATEGORIES.map(({ role, label }) => [role, label.split(' ').slice(1).join(' ')]),
) as Record<Role, string>;

const NO_EVENT = 'This event no longer exists.';
const CLOSED = 'Sign-ups for this event are closed.';
/** Discord allows this many options in a select menu. */
const MAX_OPTIONS = 25;

/** Who pressed the button: a `Person` for sign-ups, with their roles for permission checks. */
interface Invoker extends Person {
  id: string;
  roleIds?: string[];
}

/**
 * `/create-event`, and the sign-up post's buttons with the private steps that follow them:
 *
 *   Sign up   -> one menu of your characters in each role they play ("Darkshivan · 🛡️ Tank")
 *                -> signed up
 *   Late / Tentative -> (no character signed up yet: the same menu) -> a form for a note -> saved
 *   Absent    -> saved (no character needed)
 *
 * A members event (`type: Members`) has no characters: Sign up signs you up as yourself, and Late
 * and Tentative go straight to the note.
 *
 * Discord waits only 3 seconds for an answer, so anything that reads or writes more than a little
 * answers "thinking…" first (`defer`) and fills the answer in when done. Forms (modals) must be
 * opened straight away, so the steps that open one only look at what the button carries, or make
 * one small query.
 */
@Injectable()
export class SignupCommand {
  constructor(
    private readonly events: SignupEventsService,
    private readonly entries: SignupEntriesService,
    private readonly access: SignupAccessService,
    private readonly classEmojis: ClassEmojiService,
  ) {}

  // Deferred: it posts in Discord and writes the event, which can take more than 3 seconds.
  @Command('create-event', { ephemeral: true, defer: true })
  async createEvent(interaction: DiscordInteraction): Promise<string> {
    const invoker = invokerOf(interaction);
    const serverId = interaction.guild_id;
    if (!serverId || !invoker) return 'Use this command in your guild’s Discord server.';
    const guild = await this.events.findGuildOfServer(serverId);
    if (!guild) return 'This server is not linked to a guild yet.';

    const viewer = await this.access.forDiscordMember(guild, invoker, serverId);
    if (!canCreateEvents(viewer)) {
      return 'Only Officers and members with the EventCreator role can create events.';
    }
    const settings = await this.events.getSettings(guild.id);
    const pickedChannel = getStringOption(interaction, 'channel');
    const channel = pickedChannel
      ? { serverId, channelId: pickedChannel }
      : settings.channelId && settings.channelServerId
        ? { serverId: settings.channelServerId, channelId: settings.channelId }
        : null;
    if (!channel) {
      return 'There is no event channel yet. Pick a channel, or set one in the backoffice (Events → Settings).';
    }
    if (!canPostIn(viewer, settings.channelId, channel.channelId)) {
      return settings.channelId
        ? `Only Officers can post events outside <#${settings.channelId}>.`
        : 'Only Officers can post events until an event channel is set.';
    }

    const zone = resolveTimezone(
      getStringOption(interaction, 'timezone'),
      timezoneOfRegion(guild.region),
    );
    if (!zone) {
      return 'Unknown timezone. Use ST (server time), UTC, an offset like +02:00, or a name like Europe/Lisbon.';
    }
    const startsAt = parseEventStart(
      getStringOption(interaction, 'date') ?? '',
      getStringOption(interaction, 'time') ?? '',
      zone,
    );
    if (typeof startsAt === 'string') return startsAt;

    try {
      const event = await this.events.create(
        guild,
        { discordId: invoker.id, name: invoker.name },
        {
          kind: kindOption(getStringOption(interaction, 'type')),
          title: getStringOption(interaction, 'name') ?? '',
          description: getStringOption(interaction, 'description') ?? '',
          startsAt,
          timezone: zone,
        },
        channel,
      );
      const where = event.messageId
        ? messageUrl(event.serverId, event.channelId, event.messageId)
        : `<#${event.channelId}>`;
      return `Event created: ${where}`;
    } catch (error) {
      return explain(error);
    }
  }

  @Button(PREFIX.join)
  join(interaction: DiscordInteraction): ComponentReply {
    return {
      defer: 'reply',
      work: () =>
        this.withEvent(interaction, async (event, guild, invoker) => {
          if (EVENT_KINDS[event.kind].usesCharacters) {
            return this.characterMenu(event, guild, invoker, 'AVAILABLE');
          }
          // A members event: you sign up as yourself, nothing to pick.
          await this.entries.setStatus(event, invoker, 'AVAILABLE');
          return `✅ You are signed up for **${event.title}**.`;
        }),
    };
  }

  @Button(PREFIX.late)
  async late(interaction: DiscordInteraction): Promise<ComponentReply> {
    return this.statusButton(interaction, 'LATE');
  }

  @Button(PREFIX.tentative)
  async tentative(interaction: DiscordInteraction): Promise<ComponentReply> {
    return this.statusButton(interaction, 'TENTATIVE');
  }

  @Button(PREFIX.absent)
  absent(interaction: DiscordInteraction): ComponentReply {
    return {
      defer: 'reply',
      work: () =>
        this.withEvent(interaction, async (event, _guild, invoker) => {
          await this.entries.setStatus(event, invoker, 'ABSENT');
          return `You are marked as absent for **${event.title}**. Changed your mind? Press Sign up.`;
        }),
    };
  }

  /**
   * The menu's pick (`<character>.<role>`): signs up, or (Late / Tentative) opens the note form
   * at once — the form must come straight away, so nothing is looked up here; the sign-up is
   * checked when the form is sent.
   */
  @Select(PREFIX.pick)
  pick(interaction: DiscordInteraction): ComponentReply {
    const parsed = parseCustomId(interaction.data?.custom_id);
    const choice = parseChoice(interaction.data?.values?.[0]);
    if (!parsed || !choice) return { update: { content: NO_EVENT, components: [] } };
    const status = parsed.status ?? 'AVAILABLE';
    if (status === 'LATE' || status === 'TENTATIVE') {
      return noteForm(
        customId(
          PREFIX.note,
          compactId(parsed.eventId),
          statusCode(status),
          compactId(choice.characterId),
          roleCode(choice.role),
        ),
        status,
      );
    }
    return {
      defer: 'update',
      work: () =>
        this.withEvent(interaction, async (event, guild, invoker) => {
          const { characterName } = await this.entries.signUp(event, guild, invoker, {
            ...choice,
            status,
          });
          return { content: done(event, status, characterName, choice.role), components: [] };
        }),
    };
  }

  /** The Late / Tentative note. With a character and role it completes a new sign-up. */
  @Modal(PREFIX.note)
  saveNote(interaction: DiscordInteraction): ComponentReply {
    const parsed = parseCustomId(interaction.data?.custom_id);
    const note = getModalValue(interaction, 'note') ?? '';
    const status = parsed?.status ?? 'LATE';
    if (parsed?.characterId && parsed.role) {
      const choice = { characterId: parsed.characterId, role: parsed.role };
      return {
        // Opened from the user's own private menu, which can be replaced.
        defer: 'update',
        work: () =>
          this.withEvent(interaction, async (event, guild, invoker) => {
            const { characterName } = await this.entries.signUp(event, guild, invoker, {
              ...choice,
              status,
              note,
            });
            return { content: done(event, status, characterName, choice.role), components: [] };
          }),
      };
    }
    return {
      defer: 'reply',
      work: () =>
        this.withEvent(interaction, async (event, _guild, invoker) => {
          const result = await this.entries.setStatus(event, invoker, status, note);
          return result === 'updated'
            ? `You are marked as ${status === 'LATE' ? 'late' : 'tentative'} for **${event.title}**.`
            : 'Sign up with a character first.';
        }),
    };
  }

  /**
   * Late / Tentative: someone already signed up with a character gets the note form straight
   * away (one small query decides); anyone else the character menu first.
   */
  private async statusButton(
    interaction: DiscordInteraction,
    status: SignupStatus,
  ): Promise<ComponentReply> {
    const parsed = parseCustomId(interaction.data?.custom_id);
    const invoker = invokerOf(interaction);
    if (!parsed || !invoker) return NO_EVENT;
    const peek = await this.events.peek(parsed.eventId, invoker.id);
    if (!peek) return NO_EVENT;
    if (isClosed(peek)) return CLOSED;
    // Straight to the note when there's no character to pick: already signed up with one, or a
    // members event (people sign up as themselves).
    if (peek.hasCharacter || !EVENT_KINDS[peek.kind].usesCharacters) {
      return noteForm(customId(PREFIX.note, compactId(parsed.eventId), statusCode(status)), status);
    }
    return {
      defer: 'reply',
      work: () =>
        this.withEvent(interaction, (event, guild, who) =>
          this.characterMenu(event, guild, who, status),
        ),
    };
  }

  /**
   * Loads the event the component belongs to (for deferred work) and turns refusals into a
   * private answer.
   */
  private async withEvent(
    interaction: DiscordInteraction,
    handle: (
      event: EventRow,
      guild: SignupGuild,
      invoker: Invoker,
      parsed: ParsedId,
    ) => Promise<string | ReplyMessage>,
  ): Promise<string | ReplyMessage> {
    const parsed = parseCustomId(interaction.data?.custom_id);
    const invoker = invokerOf(interaction);
    if (!parsed || !invoker) return NO_EVENT;
    const event = await this.events.loadById(parsed.eventId);
    if (!event) return NO_EVENT;
    if (isClosed(event)) return CLOSED;
    const guild = await this.events.findGuild(event.guildId);
    try {
      return await handle(event, guild, invoker, parsed);
    } catch (error) {
      return explain(error);
    }
  }

  /**
   * One menu: each of the person's characters in each role it plays (mains first), shown with
   * its class colour. Picking one is the whole sign-up. (Or how to add a character.)
   */
  private async characterMenu(
    event: EventRow,
    guild: SignupGuild,
    invoker: Invoker,
    status: SignupStatus,
  ): Promise<string | ReplyMessage> {
    const [options, emojiOf] = await Promise.all([
      this.entries.characterOptions(guild, invoker.id),
      this.classEmojis.forGame(guild.gameVersion),
    ]);
    const links = { type: 1, components: this.characterLinks(guild) };
    if (options.length === 0) {
      return {
        content: `You have no characters on ${guild.realm} (${faction(guild)}) yet. Add one on the website, then press the button again.`,
        components: [links],
      };
    }
    const mine = event.entries.find((entry) => entry.discordUserId === invoker.id);
    const choices = options.flatMap((option) =>
      (option.roles.length > 0 ? ALL_ROLES.filter((r) => option.roles.includes(r)) : ALL_ROLES).map(
        (role) => ({ option, role }),
      ),
    );
    const shown = choices.slice(0, MAX_OPTIONS);
    // Nothing is preselected: Discord only reports a pick that changes the selection, so a
    // preselected option could never be chosen. The current one says so instead.
    return {
      content:
        `**${event.title}** · sign up${statusSuffix(status)} as:` +
        (choices.length > shown.length
          ? `\n-# Showing ${shown.length} of ${choices.length}: mains first.`
          : ''),
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: customId(PREFIX.pick, compactId(event.id), statusCode(status)),
              placeholder: 'Pick a character and role',
              options: shown.map(({ option, role }) => {
                const emoji = emojiOf(option.class);
                const current = mine?.characterId === option.id && mine.role === role;
                return {
                  label: `${option.name} · ${ROLE_EMOJI[role]} ${ROLE_NAMES[role]}`,
                  value: `${compactId(option.id)}.${roleCode(role)}`,
                  description: describeCharacter(option, current),
                  ...(emoji ? { emoji: { id: emoji.id, name: emoji.name } } : {}),
                };
              }),
            },
          ],
        },
        links,
      ],
    };
  }

  /** Add a character, or fix one's roles, on the website. */
  private characterLinks(guild: SignupGuild) {
    return [
      {
        type: 2,
        style: 5,
        label: 'Add character',
        url: addCharacterUrl(this.events.origin, guild),
      },
      {
        type: 2,
        style: 5,
        label: 'Edit characters',
        url: `${this.events.origin}/${guildPath(guild)}/roster`,
      },
    ];
  }
}

/** A menu value `<character>.<role>` (compact id, role letter). */
function parseChoice(value: string | undefined): { characterId: string; role: Role } | null {
  const [character, code] = (value ?? '').split('.');
  const characterId = expandId(character);
  const role = roleOfCode(code);
  return characterId && role ? { characterId, role } : null;
}

function noteForm(id: string, status: SignupStatus): ComponentReply {
  return {
    modal: {
      custom_id: id,
      title: status === 'LATE' ? 'Late: a note for the organisers' : 'Tentative: a note',
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'note',
              label: 'A note for the organisers (optional)',
              style: 2,
              max_length: MAX_NOTE_LENGTH,
              required: false,
              placeholder:
                status === 'LATE' ? 'e.g. I’ll be there 30 minutes late' : 'e.g. Depends on work',
            },
          ],
        },
      ],
    },
  };
}

function done(event: EventRow, status: SignupStatus, characterName: string, role: Role): string {
  const as = `**${characterName}** (${ROLE_EMOJI[role]} ${ROLE_NAMES[role]})`;
  switch (status) {
    case 'LATE':
      return `⏰ You are signed up for **${event.title}** as ${as}, arriving late.`;
    case 'TENTATIVE':
      return `❔ You are tentatively signed up for **${event.title}** as ${as}.`;
    default:
      return `✅ You are signed up for **${event.title}** as ${as}.`;
  }
}

const describeCharacter = (option: CharacterOption, current: boolean): string =>
  [
    current ? 'Signed up now' : '',
    option.class,
    option.isMain ? 'Main' : '',
    option.inGuild ? '' : 'not in the guild yet',
  ]
    .filter((part) => part !== '')
    .join(' · ')
    .slice(0, 100);

const statusSuffix = (status: SignupStatus): string =>
  status === 'LATE' ? ' (late)' : status === 'TENTATIVE' ? ' (tentative)' : '';

/** The `type:` option: characters unless it says members. */
const kindOption = (value: string | undefined) => (isEventKind(value) ? value : 'CHARACTERS');

const faction = (guild: SignupGuild) => (guild.faction === 'ALLIANCE' ? 'Alliance' : 'Horde');

function invokerOf(interaction: DiscordInteraction): Invoker | null {
  const id = getInvokerId(interaction);
  if (!id) return null;
  const user = interaction.member?.user ?? interaction.user;
  return {
    id,
    discordUserId: id,
    name: interaction.member?.nick ?? user?.global_name ?? user?.username ?? 'Unknown',
    roleIds: interaction.member?.roles,
  };
}

function explain(error: unknown): string {
  if (error instanceof HttpException) return error.message;
  throw error;
}
