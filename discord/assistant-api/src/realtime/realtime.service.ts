import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface GuildEvent {
  guildId: string;
  /** `characters`: players/characters changed. `guild`: the guild itself (servers) changed. */
  type: 'characters' | 'guild';
}

/**
 * In-process event bus behind the backoffice's live updates (see
 * events.controller.ts). Single-instance only: with several API instances this
 * would need a shared bus (Redis, Postgres LISTEN/NOTIFY).
 */
@Injectable()
export class RealtimeService {
  readonly events = new Subject<GuildEvent>();

  publish(guildId: string, type: GuildEvent['type']): void {
    this.events.next({ guildId, type });
  }
}
