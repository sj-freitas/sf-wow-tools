import { Controller, MessageEvent, Req, Sse, UseGuards } from '@nestjs/common';
import { filter, interval, map, merge, mergeMap, Observable } from 'rxjs';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from './realtime.service';

const HEARTBEAT_MS = 25_000;

@Controller('events')
@UseGuards(AuthGuard)
export class EventsController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Server-Sent Events stream of changes to the guilds the user can see. The
   * heartbeat keeps proxies from closing an idle connection.
   */
  @Sse()
  stream(@Req() req: AuthenticatedRequest): Observable<MessageEvent> {
    const userId = req.user.id;

    const changes = this.realtime.events.pipe(
      mergeMap(async (event) => {
        const access = await this.prisma.guildAccess.findUnique({
          where: { userId_guildId: { userId, guildId: event.guildId } },
          select: { userId: true },
        });
        return access ? event : null;
      }),
      filter((event) => event !== null),
      map((event): MessageEvent => ({ type: event.type, data: { guildId: event.guildId } })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: '' })),
    );

    return merge(changes, heartbeat);
  }
}
