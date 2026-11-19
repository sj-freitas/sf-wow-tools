import { DiscordName } from '../DiscordName';
import { OneLine } from '../OneLine';
import { formatWhen } from '../time';
import type { Honeypot } from '../types';

/** Its card's one status line, always there: paused, the last ban that failed, else its mode. */
export function HoneypotStatus({ honeypot }: { honeypot: Honeypot }) {
  if (!honeypot.enabled) return <>Paused: it bans nobody until resumed.</>;
  const last = honeypot.recentEvents[0];
  if (last?.action === 'FAILED') {
    return (
      <OneLine
        text={`Last ban failed: ${last.error ?? 'unknown error'}`}
        className="status-error"
      />
    );
  }
  return (
    <OneLine
      text={
        honeypot.testMode
          ? 'Test mode: it reports what it would do, and bans nobody.'
          : 'Live: anyone who posts in it is banned.'
      }
    />
  );
}

/** What it did lately, in its Log drawer. */
export function HoneypotLog({ honeypot, timezone }: { honeypot: Honeypot; timezone: string }) {
  if (honeypot.recentEvents.length === 0) {
    return <p className="empty">Nothing yet: each time someone posts in it, it’s logged here.</p>;
  }
  return (
    <ul className="honeypot-events">
      {honeypot.recentEvents.map((event) => (
        <li key={event.id}>
          <span className="muted">{formatWhen(event.at, timezone)}</span>{' '}
          {event.action === 'WOULD_BAN' && 'Would ban'}
          {event.action === 'BANNED' && 'Banned'}
          {event.action === 'FAILED' && 'Could not ban'}{' '}
          <DiscordName label={event.username ?? event.discordUserId} id={event.discordUserId} />
          {event.error && <span className="status-error"> · {event.error}</span>}
        </li>
      ))}
    </ul>
  );
}
