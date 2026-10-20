import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Role, SignupLockMode, SignupStatus } from '@prisma/client';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GuildAccessService } from '../auth/guild-access.service';
import { DiscordBotService } from '../discord/discord-bot.service';
import { MAX_IMAGE_BYTES } from '../officer-requests/attachments';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { parseSnowflake } from '../tasks/post-task';
import { EVENT_KINDS } from './event-kinds';
import { SignupAccessService } from './signup-access.service';
import { SignupAssignmentsService } from './signup-assignments.service';
import { SignupEntriesService, type Person } from './signup-entries.service';
import {
  SignupEventsService,
  type EventInput,
  type EventRow,
  type SignupGuild,
} from './signup-events.service';
import { SignupRemindersService, type MissingDto } from './signup-reminders.service';
import {
  canCreateEvents,
  canManageEvent,
  canOrganizeEvent,
  isClosed,
  isScheduled,
  type SignupViewer,
} from './signup-rules';
import { discordPostIdOf, SignupUserEventsService } from './signup-user-events.service';

const ROLES: readonly Role[] = ['TANK', 'HEALER', 'RANGED_DPS', 'MELEE_DPS'];
const STATUSES: readonly SignupStatus[] = ['AVAILABLE', 'LATE', 'TENTATIVE', 'ABSENT'];
const LOCK_MODES: readonly SignupLockMode[] = ['AUTO', 'LOCKED', 'UNLOCKED'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kept here for its spec; it lives with the event queries now. */
export { discordPostIdOf };

type Body = Record<string, unknown>;

/** Nothing goes to Discord for an event whose own post isn't there yet. */
function assertPosted(event: EventRow): void {
  if (isScheduled(event)) {
    throw new BadRequestException(
      'The event isn’t posted yet. Post it first (or wait for its time).',
    );
  }
}

/** Members events have no assignments (event-kinds.ts). */
function assertHasAssignments(event: EventRow): void {
  if (!EVENT_KINDS[event.kind].hasAssignments) {
    throw new BadRequestException('This kind of event has no assignments.');
  }
}

/**
 * The backoffice side of event sign-ups, all under `/api/guilds/:guildId/signup`. Who may do what
 * is in signup-rules.ts.
 */
@Controller('guilds/:guildId/signup')
@UseGuards(AuthGuard)
export class SignupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordBotService,
    private readonly guildAccess: GuildAccessService,
    private readonly realtime: RealtimeService,
    private readonly access: SignupAccessService,
    private readonly events: SignupEventsService,
    private readonly entries: SignupEntriesService,
    private readonly assignments: SignupAssignmentsService,
    private readonly reminders: SignupRemindersService,
    private readonly userEvents: SignupUserEventsService,
  ) {}

  // ---- settings ----

  @Get('settings')
  async settings(@Req() req: AuthenticatedRequest, @Param('guildId') guildId: string) {
    const { viewer } = await this.context(req, guildId);
    const settings = await this.events.getSettings(guildId);
    const access = await this.guildAccess.find(req.user.id, guildId);
    return {
      channel:
        settings.channelId && settings.channelServerId
          ? { serverId: settings.channelServerId, channelId: settings.channelId }
          : null,
      eventCreatorRole: settings.eventCreatorRoleId
        ? { id: settings.eventCreatorRoleId, name: settings.eventCreatorRoleName ?? '' }
        : null,
      canConfigure: access !== null && (access.isAdmin || access.isOfficer),
      canCreate: canCreateEvents(viewer),
      isOfficer: viewer.isOfficer,
    };
  }

  /** Guild-Assistants and Officers. `channel` / `eventCreatorRoleId`: left out = unchanged, null = cleared. */
  @Put('settings')
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveSettings(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Body,
  ): Promise<void> {
    await this.guildAccess.assertCanConfigure(req.user.id, guildId);
    const guild = await this.events.findGuild(guildId);
    const data: Record<string, string | null> = {};

    if (body.channel === null) {
      data.channelServerId = null;
      data.channelId = null;
    } else if (body.channel !== undefined) {
      const channel = body.channel as Body;
      const serverId = parseSnowflake(channel.serverId, 'The server');
      const channelId = parseSnowflake(channel.channelId, 'The channel');
      if (!guild.servers.some((server) => server.discordId === serverId)) {
        throw new BadRequestException('That server is not one of the guild’s.');
      }
      const channels = await this.discord.listTextChannels(serverId).catch(() => {
        throw new BadRequestException('Could not read that server’s channels. Is the bot in it?');
      });
      if (!channels.some((c) => c.id === channelId)) {
        throw new BadRequestException('The bot cannot see that channel.');
      }
      data.channelServerId = serverId;
      data.channelId = channelId;
    }

    if (body.eventCreatorRoleId === null) {
      data.eventCreatorRoleId = null;
      data.eventCreatorRoleName = null;
    } else if (body.eventCreatorRoleId !== undefined) {
      const roleId = parseSnowflake(body.eventCreatorRoleId, 'The role');
      const main = guild.servers.find((server) => server.isMain)?.discordId;
      const roles = main ? await this.discord.listRoles(main).catch(() => []) : [];
      const role = roles.find((r) => r.id === roleId);
      if (!role) throw new BadRequestException('That role is not in the guild’s main server.');
      data.eventCreatorRoleId = role.id;
      data.eventCreatorRoleName = role.name;
    }

    await this.prisma.signupSettings.upsert({
      where: { guildId },
      create: { guildId, ...data },
      update: data,
    });
    this.realtime.publish(guildId, 'signup');
  }

  // ---- events ----

  /**
   * `?view=`: `upcoming` (default; soonest first), `past` (started, newest first) or `archived`
   * (newest first). Archived can be narrowed by `from` / `to` (YYYY-MM-DD, the event's day in
   * server time, both included) and `q` (words in the name, or its Discord post's id or link).
   * `?discordPostId=` (an id or a message link): the event with that Discord post, in any view.
   */
  @Get('events')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Query('view') view?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('discordPostId') discordPostId?: string,
  ) {
    return this.userEvents.list(req.user, guildId, { view, from, to, q, discordPostId });
  }

  @Post('events')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Body() body: Body,
  ): Promise<{ id: string }> {
    return this.userEvents.create(req.user, guildId, body);
  }

  /** The event whose sign-up post has this Discord id (kept after it is archived). */
  @Get('events/by-discord-post/:postId')
  async getByDiscordPost(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('postId') postId: string,
  ) {
    const id = discordPostIdOf(postId);
    if (!id) throw new BadRequestException('That is not a Discord post id.');
    const event = await this.prisma.signupEvent.findFirst({
      where: { guildId, discordPostId: id },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('No event has that Discord post.');
    return this.get(req, guildId, event.id);
  }

  @Get('events/:eventId')
  get(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.userEvents.get(req.user, guildId, eventId);
  }

  /** The owner and Officers: name, description and time. The channel stays. */
  @Put('events/:eventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Body() body: Body,
  ): Promise<void> {
    const { guild, event } = await this.eventContext(req, guildId, eventId, 'manage');
    await this.events.update(event, this.eventInput(guild, body));
    this.realtime.publish(guildId, 'signup');
  }

  @Put('events/:eventId/lock')
  @HttpCode(HttpStatus.NO_CONTENT)
  async lock(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Body() body: Body,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'manage');
    const mode = body.mode as SignupLockMode;
    if (!LOCK_MODES.includes(mode)) throw new BadRequestException('Unknown lock setting.');
    await this.events.setLockMode(event.id, mode);
    this.realtime.publish(guildId, 'signup');
  }

  /** Deletes the event for good (archived or not), with its messages in Discord. */
  @Delete('events/:eventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'manage', true);
    await this.events.delete(event);
    this.realtime.publish(guildId, 'signup');
  }

  /** Removes the event's messages from Discord and keeps it, read-only, under Archived. */
  @Post('events/:eventId/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'manage');
    await this.events.archive(event.id);
    this.realtime.publish(guildId, 'signup');
  }

  /** Posts a scheduled event now instead of at its time. */
  @Post('events/:eventId/publish')
  @HttpCode(HttpStatus.NO_CONTENT)
  async publish(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'manage');
    await this.events.publish(event.id);
    this.realtime.publish(guildId, 'signup');
  }

  /** Takes an archived event back out and posts it again. */
  @Post('events/:eventId/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  async restore(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'manage', true);
    if (!event.archivedAt) return;
    await this.events.restore(event.id);
    this.realtime.publish(guildId, 'signup');
  }

  // ---- sign-ups ----

  /** Your own sign-up. `status: ABSENT` needs no character. */
  @Put('events/:eventId/my-signup')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signUp(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Body() body: Body,
  ): Promise<void> {
    const { guild, viewer, event } = await this.eventContext(req, guildId, eventId);
    const person = {
      discordUserId: req.user.discordId,
      name: req.user.displayName,
      isOfficer: viewer.isOfficer,
    };
    await this.saveEntry(guild, event, person, body, false);
  }

  /** Taking back your own sign-up, while the event is open. */
  @Delete('events/:eventId/my-signup')
  @HttpCode(HttpStatus.NO_CONTENT)
  async withdraw(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId);
    if (isClosed(event)) throw new BadRequestException('Sign-ups for this event are closed.');
    const mine = event.entries.find((entry) => entry.discordUserId === req.user.discordId);
    if (mine) await this.entries.remove(event, mine.id);
  }

  /** The owner and Officers: someone's characters that could go, to sign them up. */
  @Get('events/:eventId/people/:discordUserId/characters')
  async characterOptions(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Param('discordUserId') discordUserId: string,
  ) {
    const { guild } = await this.eventContext(req, guildId, eventId, 'manage');
    return this.entries.characterOptions(guild, parseSnowflake(discordUserId, 'The person'));
  }

  /** The owner and Officers: adds or changes someone's sign-up, even once the event is closed. */
  @Put('events/:eventId/people/:discordUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signUpSomeone(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Param('discordUserId') discordUserId: string,
    @Body() body: Body,
  ): Promise<void> {
    const { guild, event } = await this.eventContext(req, guildId, eventId, 'manage');
    const id = parseSnowflake(discordUserId, 'The person');
    const existing = event.entries.find((entry) => entry.discordUserId === id);
    const name =
      typeof body.name === 'string' && body.name.trim() !== ''
        ? body.name.trim().slice(0, 100)
        : (existing?.discordName ?? id);
    const isOfficer = await this.access.isOfficer(guild, id);
    await this.saveEntry(guild, event, { discordUserId: id, name, isOfficer }, body, true);
  }

  @Delete('events/:eventId/entries/:entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeEntry(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Param('entryId') entryId: string,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'manage');
    if (!UUID.test(entryId)) throw new BadRequestException('Unknown sign-up.');
    await this.entries.remove(event, entryId);
  }

  // ---- raid setup ----

  /** `placements`: [{ entryId, group (1-8, or null for the bench), slot (0-4, or null) }]. */
  @Put('events/:eventId/setup')
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveSetup(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Body() body: Body,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    if (!Array.isArray(body.placements)) throw new BadRequestException('No setup was sent.');
    const placements = (body.placements as Body[]).map((p) => ({
      entryId: String(p.entryId),
      group: typeof p.group === 'number' ? p.group : null,
      slot: typeof p.slot === 'number' ? p.slot : null,
    }));
    // Raid roles, each optional: `leaderDiscordUserId` / `masterLooterDiscordUserId` (null clears
    // them: the creator leads, no master looter) and `assistEntryIds` (exactly who has assist).
    const discordId = (value: unknown, what: string) =>
      value === undefined ? undefined : value === null ? null : parseSnowflake(value, what);
    // Members events have no raid roles: only the placements are saved.
    const roles = EVENT_KINDS[event.kind].hasRaidRoles;
    await this.entries.savePlacements(
      event,
      placements,
      !roles
        ? {}
        : {
            leaderDiscordUserId: discordId(body.leaderDiscordUserId, 'The leader'),
            masterLooterDiscordUserId: discordId(
              body.masterLooterDiscordUserId,
              'The master looter',
            ),
            assistEntryIds: Array.isArray(body.assistEntryIds)
              ? (body.assistEntryIds as unknown[]).filter(
                  (id): id is string => typeof id === 'string',
                )
              : undefined,
          },
    );
  }

  /** Posts the setup (or, when posted, updates it). `mention`: ping the players in it. */
  @Post('events/:eventId/setup/post')
  @HttpCode(HttpStatus.NO_CONTENT)
  async postSetup(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Body() body: Body,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    assertPosted(event);
    await this.events.postSetup(event.id, body.mention === true);
    this.realtime.publish(guildId, 'signup');
  }

  @Delete('events/:eventId/setup/post')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSetup(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    await this.events.removeSetup(event.id);
    this.realtime.publish(guildId, 'signup');
  }

  // ---- who hasn't answered ----

  @Get('events/:eventId/missing')
  async missing(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ): Promise<MissingDto> {
    const { guild, event } = await this.eventContext(req, guildId, eventId, 'organize');
    return this.reminders.missing(guild, event);
  }

  @Post('events/:eventId/reminders')
  async remind(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Body() body: Body,
  ): Promise<{ delivered: boolean; sentAt: string }> {
    const { guild, event } = await this.eventContext(req, guildId, eventId, 'organize');
    assertPosted(event);
    return this.reminders.remind(
      guild,
      event,
      { discordId: req.user.discordId, name: req.user.displayName },
      parseSnowflake(body.discordUserId, 'The person'),
    );
  }

  // ---- assignments ----

  @Post('events/:eventId/assignments')
  @HttpCode(HttpStatus.NO_CONTENT)
  async createAssignment(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Body() body: Body,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    assertHasAssignments(event);
    await this.assignments.create(event, this.assignments.parseInput(event, body));
  }

  @Put('events/:eventId/assignments/:assignmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateAssignment(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: Body,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    assertHasAssignments(event);
    await this.assignments.update(event, assignmentId, this.assignments.parseInput(event, body));
  }

  /** Deletes the assignment, and its message if it is posted. */
  @Delete('events/:eventId/assignments/:assignmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAssignment(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Param('assignmentId') assignmentId: string,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    await this.assignments.delete(event, assignmentId);
  }

  /** `ids`: every assignment of the event, in the new order. */
  @Put('events/:eventId/assignment-order')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorderAssignments(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Body() body: Body,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    assertHasAssignments(event);
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    await this.assignments.reorder(event, ids);
  }

  /** The guild's other events with assignments, to copy some here. */
  @Get('events/:eventId/assignment-sources')
  async assignmentSources(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ) {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    return this.assignments.sources(event);
  }

  /** `fromEventId`, `assignmentIds`: copies those assignments of that event here. */
  @Post('events/:eventId/assignment-copies')
  async copyAssignments(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Body() body: Body,
  ): Promise<{ copied: number; dropped: number }> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    assertHasAssignments(event);
    const ids = Array.isArray(body.assignmentIds)
      ? (body.assignmentIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    return this.assignments.copyFrom(
      event,
      typeof body.fromEventId === 'string' ? body.fromEventId : '',
      ids,
    );
  }

  /** Posts every assignment that isn't in Discord. */
  @Post('events/:eventId/assignment-posts')
  @HttpCode(HttpStatus.NO_CONTENT)
  async postAssignments(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    assertPosted(event);
    assertHasAssignments(event);
    await this.assignments.postAll(event);
  }

  /** Deletes every assignment message from Discord; the assignments stay. */
  @Delete('events/:eventId/assignment-posts')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAssignmentPosts(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    await this.assignments.removeMessages(event);
  }

  @Post('events/:eventId/images')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async uploadImage(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @UploadedFile() file?: { buffer: Buffer },
  ): Promise<{ id: string; contentType: string }> {
    const { event } = await this.eventContext(req, guildId, eventId, 'organize');
    assertHasAssignments(event);
    if (!file) throw new BadRequestException('No image was sent.');
    return this.assignments.uploadImage(event, file.buffer);
  }

  @Get('events/:eventId/images/:imageId')
  async image(
    @Req() req: AuthenticatedRequest,
    @Param('guildId') guildId: string,
    @Param('eventId') eventId: string,
    @Param('imageId') imageId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.eventContext(req, guildId, eventId);
    const image = await this.assignments.getImage(eventId, imageId);
    if (!image) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'No image' });
      return;
    }
    res
      .set({
        'Content-Type': image.contentType,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(image.data);
  }

  // ---- helpers ----

  /** The guild and who the user is in it; throws unless they are in it. */
  private context(
    req: AuthenticatedRequest,
    guildId: string,
  ): Promise<{ guild: SignupGuild; viewer: SignupViewer }> {
    return this.userEvents.context(req.user, guildId);
  }

  /** `context`, plus the event; `need` throws unless the user may manage or organise it. */
  private async eventContext(
    req: AuthenticatedRequest,
    guildId: string,
    eventId: string,
    need?: 'manage' | 'organize',
    /** Archived events are read-only: anything but reading them is refused, unless this is set. */
    allowArchived = false,
  ): Promise<{ guild: SignupGuild; viewer: SignupViewer; event: EventRow }> {
    const { guild, viewer } = await this.context(req, guildId);
    if (!UUID.test(eventId)) throw new BadRequestException('Unknown event.');
    const event = await this.events.load(guildId, eventId);
    if (event.archivedAt && req.method !== 'GET' && !allowArchived) {
      throw new BadRequestException('This event is archived. Restore it first.');
    }
    if (need === 'manage' && !canManageEvent(viewer, event)) {
      throw new ForbiddenException('Only the event’s owner and Officers can do that.');
    }
    if (need === 'organize' && !canOrganizeEvent(viewer, event)) {
      throw new ForbiddenException('Only Officers and the event’s owner can do that.');
    }
    return { guild, viewer, event };
  }

  private eventInput(guild: SignupGuild, body: Body): EventInput {
    return this.userEvents.eventInput(guild, body);
  }

  private async saveEntry(
    guild: SignupGuild,
    event: EventRow,
    person: Person,
    body: Body,
    override: boolean,
  ): Promise<void> {
    const status = body.status as SignupStatus;
    if (!STATUSES.includes(status)) throw new BadRequestException('Unknown sign-up status.');
    const note = typeof body.note === 'string' ? body.note : undefined;
    if (typeof body.characterId !== 'string' || body.characterId === '') {
      // Members events never take a character; characters events need one to come.
      if (status !== 'ABSENT' && EVENT_KINDS[event.kind].usesCharacters) {
        throw new BadRequestException('Pick a character.');
      }
      await this.entries.setStatus(event, person, status, note, override);
      return;
    }
    const role = body.role as Role;
    if (!ROLES.includes(role)) throw new BadRequestException('Pick a role.');
    await this.entries.signUp(
      event,
      guild,
      person,
      { characterId: body.characterId, role, status, note },
      override,
    );
  }
}
