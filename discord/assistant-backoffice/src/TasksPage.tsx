import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteHoneypot,
  deleteTask,
  fetchChannels,
  fetchHoneypots,
  fetchTaskReactions,
  fetchTasks,
  runTaskNow,
  updateHoneypot,
  updateTask,
} from './api';
import { HoneypotForm } from './HoneypotForm';
import { PostTaskForm } from './PostTaskForm';
import { useConfirm } from './useConfirm';
import type { Guild, Honeypot, Reaction, ScheduledPost, ServerChannels } from './types';

interface Props {
  guild: Guild;
  /** The guild's region timezone, in which all schedules are read and shown. */
  timezone: string;
}

const REFRESH_MS = 15_000;
/** While a post is waiting for the worker, check back often so the result shows up quickly. */
const QUEUED_REFRESH_MS = 3_000;
const FLASH_MS = 8_000;

/** A post whose next run is now or in the past is waiting for the worker's next check. */
const isQueued = (post: ScheduledPost): boolean =>
  post.enabled && post.nextRunAt !== null && new Date(post.nextRunAt).getTime() <= Date.now();

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function formatWhen(iso: string | null, timezone: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(iso));
}

/** Live reaction counts of a post (poll results), refreshed while it is open. */
function ReactionsPanel({ taskId }: { taskId: string }) {
  const [reactions, setReactions] = useState<Reaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetchTaskReactions(taskId)
        .then((result) => {
          setReactions(result);
          setError(null);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [taskId]);

  if (error) return <p className="status-error">{error}</p>;
  if (!reactions) return <p className="muted">Loading reactions…</p>;
  if (reactions.length === 0) return <p className="muted">No reactions yet.</p>;
  return (
    <ul className="reaction-list">
      {reactions.map((reaction) => (
        <li key={reaction.emoji}>
          {reaction.imageUrl ? (
            <img className="md-emoji" src={reaction.imageUrl} alt={reaction.emoji} />
          ) : (
            <span className="reaction-emoji">{reaction.emoji}</span>
          )}
          <strong>{reaction.count}</strong>
        </li>
      ))}
    </ul>
  );
}

export function TasksPage({ guild, timezone }: Props) {
  const [posts, setPosts] = useState<ScheduledPost[] | null>(null);
  const [honeypots, setHoneypots] = useState<Honeypot[]>([]);
  const [channels, setChannels] = useState<ServerChannels[]>([]);
  const [creating, setCreating] = useState<'post' | 'honeypot' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reactionsFor, setReactionsFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  // Posts the user just asked to run, until the server shows them as queued.
  const [starting, setStarting] = useState<Set<string>>(new Set());
  // Result of a run that just finished, shown for a few seconds.
  const [flash, setFlash] = useState<Record<string, { ok: boolean; text: string }>>({});
  const lastRuns = useRef<Map<string, string | null>>(new Map());

  const load = useCallback(() => {
    Promise.all([fetchTasks(guild.id), fetchHoneypots(guild.id)])
      .then(([loadedPosts, loadedHoneypots]) => {
        for (const post of loadedPosts) {
          const before = lastRuns.current.get(post.id);
          if (before !== undefined && post.lastRunAt && post.lastRunAt !== before) {
            const ok = post.lastStatus !== 'FAILED';
            setFlash((current) => ({
              ...current,
              [post.id]: {
                ok,
                text: ok ? 'Posted just now' : (post.lastError ?? 'The run failed'),
              },
            }));
            setTimeout(
              () =>
                setFlash((current) => {
                  const rest = { ...current };
                  delete rest[post.id];
                  return rest;
                }),
              FLASH_MS,
            );
          }
          lastRuns.current.set(post.id, post.lastRunAt);
        }
        setPosts(loadedPosts);
        setHoneypots(loadedHoneypots);
        setStarting(new Set());
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id]);

  // The list refreshes by itself, so results of runs that happen in the background show up.
  const anyQueued = starting.size > 0 || (posts?.some(isQueued) ?? false);
  useEffect(() => {
    load();
    const timer = setInterval(load, anyQueued ? QUEUED_REFRESH_MS : REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, anyQueued]);

  useEffect(() => {
    fetchChannels(guild.id)
      .then(setChannels)
      .catch(() => setChannels([]));
  }, [guild.id]);

  const channelName = (serverId: string, channelId: string) =>
    channels
      .find((group) => group.serverId === serverId)
      ?.channels.find((channel) => channel.id === channelId)?.name;

  const run = (action: Promise<unknown>) => {
    setError(null);
    action
      .then(load)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const postNow = (postId: string) => {
    setError(null);
    setStarting((current) => new Set(current).add(postId));
    runTaskNow(postId)
      .then(load)
      .catch((err: unknown) => {
        setStarting((current) => {
          const next = new Set(current);
          next.delete(postId);
          return next;
        });
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const saved = () => {
    setCreating(null);
    setEditingId(null);
    load();
  };

  return (
    <div className="tasks">
      {dialog}
      <div className="tasks-head">
        <div>
          <h3>Posts and Tasks</h3>
          <span className="muted">Times are in {timezone}.</span>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingId(null);
              setCreating('post');
            }}
          >
            + Scheduled post
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setEditingId(null);
              setCreating('honeypot');
            }}
          >
            + Honeypot channel
          </button>
        </div>
      </div>

      {error && (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-sm" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {creating === 'post' && (
        <PostTaskForm
          guild={guild}
          channels={channels}
          timezone={timezone}
          onSaved={saved}
          onCancel={() => setCreating(null)}
        />
      )}
      {creating === 'honeypot' && (
        <HoneypotForm
          guild={guild}
          channels={channels}
          onSaved={saved}
          onCancel={() => setCreating(null)}
        />
      )}

      <h4 className="tasks-section">Posts</h4>
      {!posts ? (
        <p className="empty">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="empty">No scheduled posts yet.</p>
      ) : (
        posts.map((post) =>
          editingId === post.id ? (
            <PostTaskForm
              key={post.id}
              guild={guild}
              channels={channels}
              editing={post}
              timezone={timezone}
              onSaved={saved}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={post.id} className="task-card">
              <div className="task-card-main">
                <div>
                  <strong>{post.name}</strong>{' '}
                  {!post.enabled && <span className="badge">Paused</span>}
                  <div className="muted">
                    #{channelName(post.post.serverId, post.post.channelId) ?? post.post.channelId} ·{' '}
                    {post.schedule.description}
                  </div>
                  <div className="muted">
                    Next:{' '}
                    {isQueued(post)
                      ? 'waiting for the next check'
                      : formatWhen(post.nextRunAt, timezone)}
                  </div>
                  <div className="muted">
                    Last ran:{' '}
                    {post.lastRunAt ? (
                      <>
                        {formatWhen(post.lastRunAt, timezone)} ({timeAgo(post.lastRunAt)}) ·{' '}
                        {post.lastStatus === 'FAILED' ? (
                          <span className="status-error">failed</span>
                        ) : (
                          'posted'
                        )}
                      </>
                    ) : (
                      'never'
                    )}
                  </div>
                  {(starting.has(post.id) || isQueued(post)) && (
                    <div className="run-status" role="status">
                      <span className="spinner" aria-hidden="true" /> Queued: it will be posted
                      within a minute.
                    </div>
                  )}
                  {flash[post.id] && (
                    <div
                      className={
                        flash[post.id].ok ? 'run-status run-ok' : 'run-status status-error'
                      }
                      role="status"
                    >
                      {flash[post.id].ok ? '✓ ' : ''}
                      {flash[post.id].text}
                    </div>
                  )}
                  {post.lastStatus === 'FAILED' && post.lastError && (
                    <div className="status-error">{post.lastError}</div>
                  )}
                  {post.post.posted?.messageDeleted && (
                    <div className="status-error">
                      The post was deleted in Discord; the next run posts a new one.
                    </div>
                  )}
                </div>
                <div className="settings-actions">
                  {post.post.posted && !post.post.posted.messageDeleted && (
                    <>
                      <a
                        className="btn btn-sm"
                        href={post.post.posted.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View in Discord
                      </a>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setReactionsFor(reactionsFor === post.id ? null : post.id)}
                      >
                        {reactionsFor === post.id ? 'Hide reactions' : 'Reactions'}
                      </button>
                    </>
                  )}
                  {post.enabled && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Post it now instead of waiting for the schedule"
                      disabled={starting.has(post.id) || isQueued(post)}
                      onClick={() => postNow(post.id)}
                    >
                      {starting.has(post.id) || isQueued(post) ? 'Queued…' : 'Post now'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => run(updateTask(post.id, { enabled: !post.enabled }))}
                  >
                    {post.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setCreating(null);
                      setEditingId(post.id);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() =>
                      void confirm({
                        title: 'Delete scheduled post',
                        message: `Delete "${post.name}"? Posts already in Discord stay.`,
                        confirmLabel: 'Delete',
                        danger: true,
                      }).then((ok) => ok && run(deleteTask(post.id)))
                    }
                  >
                    Delete
                  </button>
                </div>
              </div>
              {reactionsFor === post.id && <ReactionsPanel taskId={post.id} />}
            </div>
          ),
        )
      )}

      <h4 className="tasks-section">Honeypot channels</h4>
      {honeypots.length === 0 ? (
        <p className="empty">No honeypot channels yet.</p>
      ) : (
        honeypots.map((honeypot) => (
          <div key={honeypot.id} className="task-card">
            <div className="task-card-main">
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
              <div className="settings-actions">
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
          </div>
        ))
      )}
    </div>
  );
}
