import { useCallback, useEffect, useState } from 'react';
import { Help } from './Help';
import { Link, useNavigate } from 'react-router-dom';
import { deleteHoneypot, fetchHoneypots, updateHoneypot } from './api';
import { HoneypotForm } from './HoneypotForm';
import { formatWhen } from './time';
import type { Guild, Honeypot } from './types';
import { useChannels } from './useChannels';
import { useConfirm } from './useConfirm';
import { guildPath } from './guildPath';
import { Spinner } from './Loading';
import { DiscordName } from './DiscordName';
import { showToast } from './toast';

interface Props {
  guild: Guild;
  timezone: string;
}

const REFRESH_MS = 15_000;

export function HoneypotsPage({ guild, timezone }: Props) {
  const [honeypots, setHoneypots] = useState<Honeypot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { channelName, channels } = useChannels(guild.id);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    fetchHoneypots(guild.id)
      .then((loaded) => {
        setHoneypots(loaded);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // A failed action is a note over the page: a banner would push the cards down.
  const run = (action: Promise<unknown>) => {
    action
      .then(load)
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : String(err), 8000));
  };

  return (
    <div className="tasks">
      {dialog}
      <div className="tasks-head">
        <div>
          <h3 className="field-label">
            Honeypot channels
            <Help>Channels where anyone who posts is banned.</Help>
          </h3>
        </div>
        <Link className="btn btn-primary" to={guildPath(guild, 'honeypots/create')}>
          + Honeypot channel
        </Link>
      </div>

      {honeypots === null ? (
        error ? (
          <p className="status-error">{error}</p>
        ) : (
          <Spinner />
        )
      ) : honeypots.length === 0 ? (
        <p className="empty">No honeypot channels yet.</p>
      ) : (
        honeypots.map((honeypot) => (
          <div key={honeypot.id} className="task-card">
            <div className="card-info">
              <div className="card-head">
                <strong className="card-name">{honeypot.name}</strong>
                <span className={honeypot.testMode ? 'badge' : 'badge badge-live'}>
                  {honeypot.testMode ? 'Test mode' : 'Live'}
                </span>
                {!honeypot.enabled && <span className="badge">Paused</span>}
              </div>
              <div className="muted card-meta">
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
                    <DiscordName
                      label={event.username ?? event.discordUserId}
                      id={event.discordUserId}
                    />
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

/** `/honeypots/create`: the honeypot form on its own page. */
export function HoneypotCreatePage({ guild }: { guild: Guild }) {
  const navigate = useNavigate();
  const { channels } = useChannels(guild.id);
  return (
    <div className="tasks">
      <Link className="back-link" to={guildPath(guild, 'honeypots')}>
        ← Honeypots
      </Link>
      <HoneypotForm
        guild={guild}
        channels={channels}
        onSaved={() => navigate(guildPath(guild, 'honeypots'))}
        onCancel={() => navigate(guildPath(guild, 'honeypots'))}
      />
    </div>
  );
}
