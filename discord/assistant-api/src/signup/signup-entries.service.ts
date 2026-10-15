import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Role, SignupStatus } from '@prisma/client';
import { formatCharacterName } from '../characters/character-name';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SignupEventsService, type EventRow, type SignupGuild } from './signup-events.service';
import { MAX_NOTE_LENGTH, isClosed, validatePlacements, type Placement } from './signup-rules';

/** One of a person's characters that could go to an event of the guild. */
export interface CharacterOption {
  id: string;
  name: string;
  class: string;
  roles: Role[];
  isMain: boolean;
  /** Already on the guild's roster; picking one that isn't adds it. */
  inGuild: boolean;
}

export interface SignupChoice {
  characterId: string;
  role: Role;
  status: SignupStatus;
  note?: string;
}

export interface Person {
  discordUserId: string;
  name: string;
}

export const CLOSED_MESSAGE = 'Sign-ups for this event are closed.';

/**
 * People's answers to events, from Discord and from the backoffice. `override` is for the event's
 * owner and Officers managing someone else's sign-up: it also works once the event is closed.
 */
@Injectable()
export class SignupEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: SignupEventsService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * The person's characters that fit the guild: same game version, region, server and faction.
   * Mains first. Characters on that server but in no guild (or another one) are offered too.
   */
  async characterOptions(guild: SignupGuild, discordUserId: string): Promise<CharacterOption[]> {
    const characters = await this.prisma.character.findMany({
      where: {
        player: { discordUserId },
        gameVersion: guild.gameVersion,
        region: guild.region,
        realm: guild.realm,
        faction: guild.faction,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        class: true,
        roles: true,
        isMain: true,
        guilds: { where: { guildId: guild.id }, select: { id: true } },
      },
    });
    return characters
      .map((character) => ({
        id: character.id,
        name: formatCharacterName(character),
        class: character.class,
        roles: character.roles,
        isMain: character.isMain,
        inGuild: character.guilds.length > 0,
      }))
      .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));
  }

  /** Signs the person up with a character and role, in a status; replaces their earlier answer. */
  async signUp(
    event: EventRow,
    guild: SignupGuild,
    person: Person,
    choice: SignupChoice,
    override = false,
  ): Promise<{ characterName: string }> {
    if (!override && isClosed(event)) throw new BadRequestException(CLOSED_MESSAGE);
    const options = await this.characterOptions(guild, person.discordUserId);
    const character = options.find((option) => option.id === choice.characterId);
    if (!character) {
      throw new BadRequestException(
        `That character is not one of ${override ? 'theirs' : 'yours'} on ${guild.realm}.`,
      );
    }
    if (character.roles.length > 0 && !character.roles.includes(choice.role)) {
      throw new BadRequestException(`${character.name} does not play that role.`);
    }
    const note = this.note(choice.status, choice.note);

    const data = {
      discordName: person.name,
      characterId: character.id,
      role: choice.role,
      status: choice.status,
      note,
      ...(choice.status === 'ABSENT' ? { groupNumber: null, groupSlot: null } : {}),
    };
    await this.prisma.signupEntry.upsert({
      where: { eventId_discordUserId: { eventId: event.id, discordUserId: person.discordUserId } },
      create: { eventId: event.id, discordUserId: person.discordUserId, ...data },
      update: data,
    });
    if (!character.inGuild) {
      // Signing up to the guild's event with a character puts it on the guild's roster.
      await this.prisma.characterGuildMembership.createMany({
        data: [{ characterId: character.id, guildId: guild.id }],
        skipDuplicates: true,
      });
      this.realtime.publish(guild.id, 'characters');
    }
    this.changed(event);
    return { characterName: character.name };
  }

  /**
   * Changes only the status (and note) of the person's sign-up, keeping its character. Absent
   * works without one; Late and Tentative need a sign-up with a character first
   * ('needs-character' returned).
   */
  async setStatus(
    event: EventRow,
    person: Person,
    status: SignupStatus,
    note?: string,
    override = false,
  ): Promise<'updated' | 'needs-character'> {
    if (!override && isClosed(event)) throw new BadRequestException(CLOSED_MESSAGE);
    const existing = event.entries.find((entry) => entry.discordUserId === person.discordUserId);
    if (status !== 'ABSENT' && !existing?.characterId) return 'needs-character';
    const data = {
      discordName: person.name,
      status,
      note: this.note(status, note),
      ...(status === 'ABSENT' ? { groupNumber: null, groupSlot: null } : {}),
    };
    await this.prisma.signupEntry.upsert({
      where: { eventId_discordUserId: { eventId: event.id, discordUserId: person.discordUserId } },
      create: { eventId: event.id, discordUserId: person.discordUserId, ...data },
      update: data,
    });
    this.changed(event);
    return 'updated';
  }

  async remove(event: EventRow, entryId: string): Promise<void> {
    const { count } = await this.prisma.signupEntry.deleteMany({
      where: { id: entryId, eventId: event.id },
    });
    if (count === 0) throw new NotFoundException('That sign-up no longer exists.');
    this.changed(event);
  }

  /** Saves the raid setup: who is in which group and place; everyone else is on the bench. */
  async savePlacements(event: EventRow, placements: readonly Placement[]): Promise<void> {
    const problem = validatePlacements(placements, event.entries);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.$transaction([
      this.prisma.signupEntry.updateMany({
        where: { eventId: event.id },
        data: { groupNumber: null, groupSlot: null },
      }),
      ...placements
        .filter((placement) => placement.group !== null)
        .map((placement) =>
          this.prisma.signupEntry.update({
            where: { id: placement.entryId },
            data: { groupNumber: placement.group, groupSlot: placement.slot },
          }),
        ),
    ]);
    this.changed(event);
  }

  private note(status: SignupStatus, note: string | undefined): string {
    if (status !== 'LATE' && status !== 'TENTATIVE') return '';
    const text = (note ?? '').trim();
    if (text.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException(`The note can be at most ${MAX_NOTE_LENGTH} characters.`);
    }
    return text;
  }

  private changed(event: { id: string; guildId: string }): void {
    this.events.refresh(event.id);
    this.realtime.publish(event.guildId, 'signup');
  }
}
