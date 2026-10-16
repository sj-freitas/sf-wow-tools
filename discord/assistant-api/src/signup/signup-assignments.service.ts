import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SignupAssignment, SignupAssignmentScope } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DiscordBotService, type BotFile } from '../discord/discord-bot.service';
import { describeDiscordError, isDiscordError, UNKNOWN_MESSAGE } from '../discord/discord-errors';
import { sniffImageType } from '../guilds/banner';
import { MAX_IMAGE_BYTES } from '../officer-requests/attachments';
import { RealtimeService } from '../realtime/realtime.service';
import { parseLines, readLines, remapLines, type AssignmentLine } from './assignment-lines';
import { ClassEmojiService, emojiText } from './class-emojis.service';
import { SignupEventsService, toEntryView, type EventRow } from './signup-events.service';
import { renderAssignmentMessage } from './signup-messages';

export const MAX_ASSIGNMENT_IMAGES = 4;
const MAX_ASSIGNMENT_TITLE = 100;
const MAX_SCOPE_LABEL = 60;
const SCOPES: readonly SignupAssignmentScope[] = ['GLOBAL', 'RAID', 'BOSS'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AssignmentInput {
  scope: SignupAssignmentScope;
  scopeLabel: string;
  title: string;
  lines: AssignmentLine[];
  mentions: boolean;
  imageIds: string[];
}

type AssignmentRow = SignupAssignment & { images: { id: string }[] };

/** The order assignments are posted in: everyone's first, then per raid, then per boss. */
export const byPostingOrder = (
  a: Pick<SignupAssignment, 'scope' | 'position'>,
  b: Pick<SignupAssignment, 'scope' | 'position'>,
): number => SCOPES.indexOf(a.scope) - SCOPES.indexOf(b.scope) || a.position - b.position;

/**
 * Assignments: tasks for some of the signed-up players, one Discord message each in the event's
 * channel. While an event's assignments are posted, saving one edits (or posts) its message and
 * deleting one deletes its message. "Remove from Discord" deletes every message but keeps the
 * assignments, which can be posted again.
 */
@Injectable()
export class SignupAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordBotService,
    private readonly events: SignupEventsService,
    private readonly realtime: RealtimeService,
    private readonly emojis: ClassEmojiService,
  ) {}

  list(eventId: string): Promise<AssignmentRow[]> {
    return this.prisma.signupAssignment
      .findMany({
        where: { eventId },
        include: { images: { select: { id: true }, orderBy: { createdAt: 'asc' } } },
      })
      .then((rows) => rows.sort(byPostingOrder));
  }

  /** Checks what the backoffice sent against the event; throws with what is wrong. */
  parseInput(event: EventRow, body: Record<string, unknown>): AssignmentInput {
    const scope = body.scope as SignupAssignmentScope;
    if (!SCOPES.includes(scope)) throw new BadRequestException('Pick who the assignment is for.');
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title === '') throw new BadRequestException('Give the assignment a title.');
    if (title.length > MAX_ASSIGNMENT_TITLE) {
      throw new BadRequestException(`The title can be at most ${MAX_ASSIGNMENT_TITLE} characters.`);
    }
    const scopeLabel =
      scope === 'GLOBAL' ? '' : typeof body.scopeLabel === 'string' ? body.scopeLabel.trim() : '';
    if (scopeLabel.length > MAX_SCOPE_LABEL) {
      throw new BadRequestException(
        `The raid or boss name can be at most ${MAX_SCOPE_LABEL} characters.`,
      );
    }
    const lines = parseLines(body.lines, new Set(event.entries.map((entry) => entry.id)));
    if (typeof lines === 'string') throw new BadRequestException(lines);
    const imageIds = Array.isArray(body.imageIds)
      ? [
          ...new Set(
            (body.imageIds as unknown[]).filter((id): id is string => typeof id === 'string'),
          ),
        ]
      : [];
    if (imageIds.length > MAX_ASSIGNMENT_IMAGES) {
      throw new BadRequestException(
        `An assignment can have at most ${MAX_ASSIGNMENT_IMAGES} images.`,
      );
    }
    return { scope, scopeLabel, title, lines, mentions: body.mentions === true, imageIds };
  }

  async create(event: EventRow, input: AssignmentInput): Promise<void> {
    await this.assertImagesUsable(event.id, null, input.imageIds);
    const last = await this.prisma.signupAssignment.aggregate({
      where: { eventId: event.id },
      _max: { position: true },
    });
    const created = await this.prisma.signupAssignment.create({
      data: { eventId: event.id, ...this.fields(input), position: (last._max.position ?? -1) + 1 },
    });
    await this.attachImages(event.id, created.id, input.imageIds);
    // While the event's assignments are in Discord, a new one goes there too.
    if (await this.anyPosted(event.id)) await this.post(event, created.id);
    this.realtime.publish(event.guildId, 'signup');
  }

  async update(event: EventRow, assignmentId: string, input: AssignmentInput): Promise<void> {
    const existing = await this.find(event.id, assignmentId);
    await this.assertImagesUsable(event.id, assignmentId, input.imageIds);
    await this.prisma.signupAssignment.update({
      where: { id: assignmentId },
      // An edit by hand stops a plugin from overwriting it (see plugins.ts).
      data: { ...this.fields(input), editedManually: existing.pluginKey !== null },
    });
    await this.attachImages(event.id, assignmentId, input.imageIds);
    if (existing.messageId) await this.post(event, assignmentId);
    this.realtime.publish(event.guildId, 'signup');
  }

  async delete(event: EventRow, assignmentId: string): Promise<void> {
    const existing = await this.find(event.id, assignmentId);
    if (existing.messageId) await this.events.deleteQuietly(event.channelId, existing.messageId);
    await this.prisma.signupAssignment.delete({ where: { id: assignmentId } });
    this.realtime.publish(event.guildId, 'signup');
  }

  /** New positions, in the given order (ids of the event's assignments). */
  async reorder(event: EventRow, ids: readonly string[]): Promise<void> {
    const existing = await this.prisma.signupAssignment.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });
    const known = new Set(existing.map((row) => row.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new BadRequestException('The assignments changed meanwhile. Reload the page.');
    }
    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.prisma.signupAssignment.update({ where: { id }, data: { position } }),
      ),
    );
    this.realtime.publish(event.guildId, 'signup');
  }

  /** The guild's other events that have assignments, newest first: what can be copied here. */
  async sources(event: EventRow) {
    const events = await this.prisma.signupEvent.findMany({
      where: {
        guildId: event.guildId,
        id: { not: event.id },
        kind: 'CHARACTERS',
        assignments: { some: {} },
      },
      orderBy: { startsAt: 'desc' },
      take: 20,
      select: {
        id: true,
        title: true,
        startsAt: true,
        timezone: true,
        assignments: {
          select: { id: true, title: true, scope: true, scopeLabel: true, position: true },
        },
      },
    });
    return events.map((source) => ({
      id: source.id,
      title: source.title,
      startsAt: source.startsAt.toISOString(),
      timezone: source.timezone,
      assignments: [...source.assignments].sort(byPostingOrder).map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        scope: assignment.scope,
        scopeLabel: assignment.scopeLabel,
      })),
    }));
  }

  /**
   * Copies some of another event's assignments here, at the end, images included. People are
   * matched to this event's sign-ups by the same character, else the same Discord account (the
   * absent don't count); anyone not signed up here is left out, and `dropped` says how many such
   * mentions there were. While this event's assignments are posted, the copies are posted too.
   */
  async copyFrom(
    event: EventRow,
    sourceEventId: string,
    assignmentIds: readonly string[],
  ): Promise<{ copied: number; dropped: number }> {
    const source = UUID.test(sourceEventId)
      ? await this.prisma.signupEvent.findFirst({
          where: { id: sourceEventId, guildId: event.guildId },
          include: {
            entries: { select: { id: true, characterId: true, discordUserId: true } },
            assignments: { include: { images: { orderBy: { createdAt: 'asc' } } } },
          },
        })
      : null;
    if (!source || source.id === event.id)
      throw new NotFoundException('That event no longer exists.');
    const chosen = source.assignments
      .filter((assignment) => assignmentIds.includes(assignment.id))
      .sort(byPostingOrder);
    if (chosen.length === 0) throw new BadRequestException('Pick at least one assignment to copy.');

    const here = event.entries.filter((entry) => entry.status !== 'ABSENT');
    const byCharacter = new Map(
      here.filter((entry) => entry.characterId).map((entry) => [entry.characterId, entry.id]),
    );
    const byPerson = new Map(here.map((entry) => [entry.discordUserId, entry.id]));
    const before = new Map(source.entries.map((entry) => [entry.id, entry]));
    const mapEntry = (entryId: string): string | null => {
      const old = before.get(entryId);
      if (!old) return null;
      return (
        (old.characterId ? byCharacter.get(old.characterId) : undefined) ??
        byPerson.get(old.discordUserId) ??
        null
      );
    };

    const posted = await this.anyPosted(event.id);
    const last = await this.prisma.signupAssignment.aggregate({
      where: { eventId: event.id },
      _max: { position: true },
    });
    let position = (last._max.position ?? -1) + 1;
    let dropped = 0;
    const created: string[] = [];
    for (const assignment of chosen) {
      const remapped = remapLines(readLines(assignment.lines), mapEntry);
      dropped += remapped.dropped;
      const copy = await this.prisma.signupAssignment.create({
        data: {
          eventId: event.id,
          ...this.fields({
            scope: assignment.scope,
            scopeLabel: assignment.scopeLabel,
            title: assignment.title,
            lines: remapped.lines,
            mentions: assignment.mentions,
            imageIds: [],
          }),
          position: position++,
        },
      });
      for (const image of assignment.images) {
        await this.prisma.signupImage.create({
          data: {
            eventId: event.id,
            assignmentId: copy.id,
            contentType: image.contentType,
            size: image.size,
            data: image.data,
          },
        });
      }
      created.push(copy.id);
    }
    if (posted) {
      for (const id of created) await this.post(event, id);
    }
    this.realtime.publish(event.guildId, 'signup');
    return { copied: created.length, dropped };
  }

  /** Posts every assignment that isn't in Discord yet, in posting order. */
  async postAll(event: EventRow): Promise<void> {
    const assignments = await this.list(event.id);
    for (const assignment of assignments) {
      if (!assignment.messageId) await this.post(event, assignment.id);
    }
    this.realtime.publish(event.guildId, 'signup');
  }

  /** Deletes every assignment message from Discord; the assignments themselves stay. */
  async removeMessages(event: EventRow): Promise<void> {
    const posted = await this.prisma.signupAssignment.findMany({
      where: { eventId: event.id, messageId: { not: null } },
      select: { id: true, messageId: true },
    });
    for (const assignment of posted) {
      await this.events.deleteQuietly(event.channelId, assignment.messageId as string);
    }
    await this.prisma.signupAssignment.updateMany({
      where: { eventId: event.id },
      data: { messageId: null },
    });
    this.realtime.publish(event.guildId, 'signup');
  }

  /** Stores an uploaded image for one of the event's assignments, checking it really is one. */
  async uploadImage(event: EventRow, data: Buffer): Promise<{ id: string; contentType: string }> {
    if (data.length === 0) throw new BadRequestException('No image was sent.');
    if (data.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        `The image can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
    }
    const contentType = sniffImageType(data);
    if (!contentType)
      throw new BadRequestException('The image must be a PNG, JPEG, GIF or WebP file.');
    return this.prisma.signupImage.create({
      data: { eventId: event.id, contentType, size: data.length, data: new Uint8Array(data) },
      select: { id: true, contentType: true },
    });
  }

  async getImage(eventId: string, imageId: string) {
    if (!UUID.test(imageId)) return null;
    const image = await this.prisma.signupImage.findFirst({ where: { id: imageId, eventId } });
    return image ? { contentType: image.contentType, data: Buffer.from(image.data) } : null;
  }

  private fields(input: AssignmentInput) {
    return {
      scope: input.scope,
      scopeLabel: input.scopeLabel,
      title: input.title,
      lines: input.lines as unknown as object,
      mentions: input.mentions,
    };
  }

  private async find(eventId: string, assignmentId: string): Promise<SignupAssignment> {
    const assignment = UUID.test(assignmentId)
      ? await this.prisma.signupAssignment.findFirst({ where: { id: assignmentId, eventId } })
      : null;
    if (!assignment) throw new NotFoundException('That assignment no longer exists.');
    return assignment;
  }

  private async anyPosted(eventId: string): Promise<boolean> {
    const count = await this.prisma.signupAssignment.count({
      where: { eventId, messageId: { not: null } },
    });
    return count > 0;
  }

  private async assertImagesUsable(
    eventId: string,
    assignmentId: string | null,
    imageIds: readonly string[],
  ): Promise<void> {
    if (imageIds.length === 0) return;
    if (imageIds.some((id) => !UUID.test(id))) throw new BadRequestException('Unknown image.');
    const found = await this.prisma.signupImage.findMany({
      where: { id: { in: [...imageIds] }, eventId },
      select: { assignmentId: true },
    });
    const usable = found.filter(
      (image) => image.assignmentId === null || image.assignmentId === assignmentId,
    );
    if (usable.length !== imageIds.length) {
      throw new BadRequestException(
        'One of the images is not available any more. Upload it again.',
      );
    }
  }

  /** The assignment owns exactly these images; ones it dropped are left for the worker to remove. */
  private async attachImages(
    eventId: string,
    assignmentId: string,
    imageIds: readonly string[],
  ): Promise<void> {
    await this.prisma.signupImage.updateMany({
      where: { eventId, assignmentId, id: { notIn: [...imageIds] } },
      data: { assignmentId: null },
    });
    if (imageIds.length > 0) {
      await this.prisma.signupImage.updateMany({
        where: { eventId, id: { in: [...imageIds] } },
        data: { assignmentId },
      });
    }
  }

  /** Posts the assignment's message, or replaces it (text and images) when it is posted. */
  private async post(event: EventRow, assignmentId: string): Promise<void> {
    const [assignment, entries] = await Promise.all([
      this.prisma.signupAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: { images: { orderBy: { createdAt: 'asc' } } },
      }),
      this.events.loadById(event.id).then((row) => (row?.entries ?? []).map(toEntryView)),
    ]);
    const guild = await this.events.findGuild(event.guildId);
    const [markerOf, look] = await Promise.all([
      this.emojis.markersFor(guild.gameVersion),
      this.events.look(guild),
    ]);
    const message = renderAssignmentMessage(
      { ...assignment, lines: readLines(assignment.lines) },
      entries,
      (marker) => emojiText(markerOf(marker)),
      look,
    );
    const files: BotFile[] = assignment.images.map((image, index) => ({
      name: `assignment-${index + 1}.${image.contentType.split('/')[1] ?? 'png'}`,
      data: Buffer.from(image.data),
      contentType: image.contentType,
    }));
    try {
      if (assignment.messageId) {
        try {
          await this.discord.editRichMessage(event.channelId, assignment.messageId, message, files);
          return;
        } catch (error) {
          // Deleted in Discord meanwhile: post it again below.
          if (!isDiscordError(error, UNKNOWN_MESSAGE)) throw error;
        }
      }
      const messageId = await this.discord.sendRichMessage(event.channelId, message, files);
      await this.prisma.signupAssignment.update({
        where: { id: assignmentId },
        data: { messageId },
      });
    } catch (error) {
      throw new BadRequestException(
        `Could not post “${assignment.title}”: ${describeDiscordError(error)}`,
      );
    }
  }
}
