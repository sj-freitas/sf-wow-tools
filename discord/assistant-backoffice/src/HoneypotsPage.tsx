import { useCallback, useEffect, useState } from 'react';
import { deleteHoneypot, fetchHoneypots, updateHoneypot } from './api';
import { HoneypotForm } from './HoneypotForm';
import { formatWhen } from './time';
import type { Guild, Honeypot } from './types';
import { useChannels } from './useChannels';
import { useConfirm } from './useConfirm';

interface Props {
  guild: Guild;
  timezone: string;
}

const REFRESH_MS = 15_000;

export function HoneypotsPage({ guild, timezone }: Props) {
  const [honeypots, setHoneypots] = useState<Honeypot[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { channels, channelName } = useChannels(guild.id);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    fetchHoneypots(guild.id)
      .then(setHoneypots)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const run = (action: Promise<unknown>) => {
    setError(null);
    action
      .then(load)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <div className="tasks">
      {dialog}
      <div className="tasks-head">
        <div>
          <h3>Honeypot channels</h3>
          <span className="muted">
            Channels where anyone who posts is banned. Times are in {timezone}.
          </span>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          + Honeypot channel
        </button>
      </div>

      {error && (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-sm" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {creating && (
        <HoneypotForm
          guild={guild}
          channels={channels}
          onSaved={() => {
            setCreating(false);
            load();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {honeypots === null ? (
        <p className="empty">Loading…</p>
      ) : honeypots.length === 0 ? (
        <p className="empty">No honeypot channels yet.</p>
      ) : (
        honeypots.map((honeypot) => (
          <div key={honeypot.id} className="task-card">
            <div>
              <strong>{honeypot.name}</strong>{' '}
              <span className={honeypot.testMode ? 'badge' : 'badge badge-live'}>
                {honeypot.testMode ? 'Test mode' : 'Live'}
              </span>{' '}
              {!honeypot.enabled && <span className="badge">Paused</span>}
              <div className="muted">
                #{channelName(honeypot.serverId, honeypot.channelId) ?? honeypot.channelId}
                {honeypot.createdChannel ? ' (created by the bot)' : ''} · logs to #
                {channelName(honeypot.serverId, honeypot.logChannelId) ??
                  channels
                    .flatMap((group) => group.channels)
                    .find((channel) => channel.id === honeypot.logChannelId)?.name ??
                  honeypot.logChannelId}
              </div>
            </div>
            {honeypot.recentEvents.length > 0 && (
              <ul className="honeypot-events">
                {honeypot.recentEvents.map((event) => (
                  <li key={event.id}>
                    <span className="muted">{formatWhen(event.at, timezone)}</span>{' '}
                    {event.action === 'WOULD_BAN' && 'Would ban'}
                    {event.action === 'BANNED' && 'Banned'}
                    {event.action === 'FAILED' && 'Could not ban'}{' '}
                    <strong>{event.username ?? event.discordUserId}</strong>
                    {event.error && <span className="status-error"> · {event.error}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="settings-actions task-actions">
              {honeypot.testMode ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    void confirm({
                      title: 'Switch to live mode?',
                      message: `People who post in the honeypot "${honeypot.name}" will be permanently banned, and their messages from the last hour deleted.`,
                      confirmLabel: 'Go live',
                      danger: true,
                    }).then(
                      (ok) =>
                        ok &&
                        run(updateHoneypot(honeypot.id, { testMode: false, confirmLive: true })),
                    )
                  }
                >
                  Go live
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => run(updateHoneypot(honeypot.id, { testMode: true }))}
                >
                  Back to test mode
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => run(updateHoneypot(honeypot.id, { enabled: !honeypot.enabled }))}
              >
                {honeypot.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() =>
                  void confirm({
                    title: 'Remove honeypot',
                    message: `Remove the honeypot "${honeypot.name}"? The channel itself stays in Discord.`,
                    confirmLabel: 'Remove',
                    danger: true,
                  }).then((ok) => ok && run(deleteHoneypot(honeypot.id)))
                }
              >
                Remove
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
