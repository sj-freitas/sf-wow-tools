import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { deletePostMessage, deleteTask, fetchTasks, runTaskNow, updateTask } from './api';
import { ReactionsPanel } from './ReactionsPanel';
import { formatWhen, timeAgo } from './time';
import type { Guild, PostsPage as PostsPageData, ScheduledPost } from './types';
import { useChannels } from './useChannels';
import { useConfirm } from './useConfirm';
import { useCurrentUrl } from './useReturnTo';
import { guildPath } from './guildPath';

interface Props {
  guild: Guild;
  /** The guild's region timezone, in which all times are read and shown. */
  timezone: string;
}

const REFRESH_MS = 15_000;
/** While a post is waiting for the worker, check back often so the result shows up quickly. */
const QUEUED_REFRESH_MS = 3_000;
const FLASH_MS = 8_000;
const SEARCH_DELAY_MS = 300;

/** A post whose time has come but that the worker has not sent yet. */
const isQueued = (post: ScheduledPost): boolean =>
  post.enabled && post.nextRunAt !== null && new Date(post.nextRunAt).getTime() <= Date.now();

/** Some message of the post is in Discord right now. */
const isLive = (post: ScheduledPost): boolean => post.post.live;

const wasDeleted = (post: ScheduledPost): boolean => post.post.wasDeleted;

/** How many messages of the post are in Discord. */
const liveCount = (post: ScheduledPost): number =>
  post.post.parts.filter((part) => part.posted !== null).length;

function statusLabel(post: ScheduledPost): string {
  if (post.post.complete) return 'Posted';
  if (isLive(post)) return `Partly posted (${liveCount(post)} of ${post.post.parts.length})`;
  if (wasDeleted(post)) return 'Deleted from Discord';
  if (!post.enabled) return 'Paused';
  if (isQueued(post)) return 'Queued';
  if (post.nextRunAt) return 'Scheduled';
  return post.lastStatus === 'FAILED' ? 'Failed' : 'Not scheduled';
}

const snippet = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
};

export function PostsPage({ guild, timezone }: Props) {
  const [data, setData] = useState<PostsPageData | null>(null);
  // The search and the page live in the address (`/posts?q=raid&page=2`), so they survive a
  // reload, the back button, and being shared.
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const pageParam = Number.parseInt(params.get('page') ?? '1', 10);
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
  const [queryInput, setQueryInput] = useState(query);
  const here = useCurrentUrl();
  const [error, setError] = useState<string | null>(null);
  // Posts the user just asked to send, until the server shows them as queued.
  const [starting, setStarting] = useState<Set<string>>(new Set());
  // Result of a run that just finished, shown for a few seconds.
  const [flash, setFlash] = useState<Record<string, { ok: boolean; text: string }>>({});
  const lastRuns = useRef<Map<string, string | null>>(new Map());
  const latestRequest = useRef(0);
  const { channelName } = useChannels(guild.id);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    const request = ++latestRequest.current;
    fetchTasks(guild.id, { query, page })
      .then((loaded) => {
        if (request !== latestRequest.current) return; // a newer search or page replaced this one
        for (const post of loaded.items) {
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
        setData(loaded);
        setStarting(new Set());
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id, query, page]);

  const goTo = useCallback(
    (next: { q?: string; page?: number }, replace = false) => {
      const nextParams = new URLSearchParams();
      const q = next.q ?? query;
      if (q) nextParams.set('q', q);
      if (next.page && next.page > 1) nextParams.set('page', String(next.page));
      setParams(nextParams, { replace });
    },
    [query, setParams],
  );

  // Typing in the search box searches after a short pause, from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (queryInput.trim() !== query) goTo({ q: queryInput.trim(), page: 1 }, true);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [queryInput, query, goTo]);

  // The address changed (back button, a shared link): show its search in the box.
  useEffect(() => setQueryInput(query), [query]);

  const anyQueued = starting.size > 0 || (data?.items.some(isQueued) ?? false);
  useEffect(() => {
    load();
    const timer = setInterval(load, anyQueued ? QUEUED_REFRESH_MS : REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, anyQueued]);

  // The last post of the last page was removed: step back to the page that still exists.
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  useEffect(() => {
    if (data && data.items.length === 0 && data.total > 0 && page > lastPage)
      goTo({ page: lastPage }, true);
  }, [data, page, lastPage, goTo]);

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

  const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, (data.page - 1) * data.pageSize + data.items.length) : 0;

  return (
    <div className="tasks">
      {dialog}
      <div className="tasks-head">
        <div>
          <h3>Posts</h3>
          <span className="muted">
            Each post is sent once, as one message. Times are in {timezone}.
          </span>
        </div>
        <Link
          className="btn btn-primary"
          to={guildPath(guild, 'posts/create')}
          state={{ from: here }}
        >
          + New post
        </Link>
      </div>

      <input
        type="search"
        className="post-search"
        placeholder="Search posts by name or text…"
        value={queryInput}
        onChange={(e) => setQueryInput(e.target.value)}
        aria-label="Search posts"
      />

      {error && (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-sm" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {!data ? (
        <p className="empty">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="empty">
          {query ? `No posts match "${query}".` : 'No posts yet. Create one with "+ New post".'}
        </p>
      ) : (
        data.items.map((post) => (
          <div key={post.id} className="task-card">
            <div>
              <strong>{post.name}</strong>{' '}
              <span
                className={
                  isLive(post)
                    ? 'badge badge-main'
                    : post.lastStatus === 'FAILED' && !post.nextRunAt
                      ? 'badge badge-live'
                      : 'badge'
                }
              >
                {statusLabel(post)}
              </span>
              <div className="muted">
                #{channelName(post.post.serverId, post.post.channelId) ?? post.post.channelId} ·{' '}
                {isLive(post) ? (
                  <>
                    Posted {formatWhen(post.lastRunAt, timezone)}
                    {post.lastRunAt && ` (${timeAgo(post.lastRunAt)})`}
                  </>
                ) : wasDeleted(post) ? (
                  'Deleted from Discord. Edit it to pick a new date, or use Post now.'
                ) : post.nextRunAt ? (
                  isQueued(post) ? (
                    'Waiting for the next check'
                  ) : (
                    `Scheduled for ${formatWhen(post.nextRunAt, timezone)}`
                  )
                ) : post.enabled ? (
                  'Not scheduled. Edit it to pick a new date, or use Post now.'
                ) : (
                  `Paused. It was set for ${formatWhen(post.schedule.runAt, timezone)}.`
                )}
              </div>
              <div className="post-snippet">{snippet(post.post.parts[0]?.content ?? '')}</div>
              {post.post.parts.length > 1 && (
                <div className="muted">
                  {post.post.parts.length} messages, sent in order
                  {post.post.parts.some((part) => part.imageIds.length > 0) && ' · with images'}
                </div>
              )}
              {post.lastRunAt && !isLive(post) && (
                <div className="muted">
                  Last ran: {formatWhen(post.lastRunAt, timezone)} ({timeAgo(post.lastRunAt)}) ·{' '}
                  {post.lastStatus === 'FAILED' ? (
                    <span className="status-error">failed</span>
                  ) : (
                    'posted'
                  )}
                </div>
              )}
              {post.lastStatus === 'FAILED' && post.lastError && !isLive(post) && (
                <div className="status-error">{post.lastError}</div>
              )}
              {(starting.has(post.id) || isQueued(post)) && (
                <div className="run-status" role="status">
                  <span className="spinner" aria-hidden="true" /> Queued: it will be posted within a
                  minute.
                </div>
              )}
              {flash[post.id] && (
                <div
                  className={flash[post.id].ok ? 'run-status run-ok' : 'run-status status-error'}
                  role="status"
                >
                  {flash[post.id].ok ? '✓ ' : ''}
                  {flash[post.id].text}
                </div>
              )}
            </div>
            {post.post.parts.map(
              (part, i) =>
                part.posted && (
                  <div key={part.id} className="part-reactions">
                    {post.post.parts.length > 1 && <span className="muted">Message {i + 1}</span>}
                    <ReactionsPanel taskId={post.id} part={i + 1} />
                  </div>
                ),
            )}
            <div className="settings-actions task-actions">
              {post.post.parts.map((part, i) => {
                const label = post.post.parts.length > 1 ? ` ${i + 1}` : '';
                return (
                  part.posted && (
                    <span key={part.id} className="part-links">
                      <CopyIdButton id={part.posted.messageId} label={label} />
                      <a
                        className="btn btn-sm"
                        href={part.posted.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {label ? `View${label} in Discord` : 'View in Discord'}
                      </a>
                    </span>
                  )
                );
              })}
              {!post.post.complete && post.enabled && (
                <button
                  type="button"
                  className="btn btn-sm"
                  title="Send it now instead of waiting for its time"
                  disabled={starting.has(post.id) || isQueued(post)}
                  onClick={() => postNow(post.id)}
                >
                  {starting.has(post.id) || isQueued(post) ? 'Queued…' : 'Post now'}
                </button>
              )}
              {!isLive(post) && !wasDeleted(post) && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => run(updateTask(post.id, { enabled: !post.enabled }))}
                >
                  {post.enabled ? 'Pause' : 'Resume'}
                </button>
              )}
              <Link
                className="btn btn-sm"
                to={guildPath(guild, `posts/edit/${post.id}`)}
                state={{ from: here }}
              >
                Edit
              </Link>
              {isLive(post) && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  title="Removes the message(s) from Discord. The post stays here, so it can be sent again later."
                  onClick={() =>
                    void confirm({
                      title: 'Delete the post from Discord?',
                      message: `${liveCount(post) === 1 ? 'The message' : `The ${liveCount(post)} messages`} in #${channelName(post.post.serverId, post.post.channelId) ?? 'the channel'} ${liveCount(post) === 1 ? 'is' : 'are'} removed, with the reactions. "${post.name}" stays here, so you can send it again later with Post now or a new date.`,
                      confirmLabel: 'Delete post',
                      danger: true,
                    }).then((ok) => ok && run(deletePostMessage(post.id)))
                  }
                >
                  Delete post
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm btn-danger"
                title="Stops tracking this post here and removes it from the database. Whatever is in Discord stays."
                onClick={() =>
                  void confirm({
                    title: 'Untrack this post?',
                    message: isLive(post)
                      ? `"${post.name}" is removed from Posts and from the database. The message stays in Discord and can no longer be deleted from the backoffice. To remove it from Discord too, cancel and use Delete post first.`
                      : `"${post.name}" is removed from Posts and from the database. Nothing is left in Discord to delete.`,
                    confirmLabel: isLive(post) ? 'Untrack anyway' : 'Untrack',
                    danger: true,
                  }).then((ok) => ok && run(deleteTask(post.id)))
                }
              >
                Untrack
              </button>
            </div>
          </div>
        ))
      )}

      {data && data.total > 0 && (
        <div className="pager">
          <span className="muted">
            {from}–{to} of {data.total}
            {query ? ' matching' : ''}
          </span>
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={data.page <= 1}
              onClick={() => goTo({ page: data.page - 1 })}
            >
              Previous
            </button>
            <span className="muted">
              Page {data.page} of {lastPage}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={data.page >= lastPage}
              onClick={() => goTo({ page: data.page + 1 })}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Copies the Discord message id of the post, for `sourcePost=…` in a `{{reactions …}}` tag (in this
 * post's text or another's), which shows who reacted with an emoji.
 */
function CopyIdButton({ id, label = '' }: { id: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      title={`Copy this post's Discord message id (${id}), to show who reacted to it inside a post's text`}
      onClick={() => {
        void navigator.clipboard
          .writeText(id)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => window.prompt('Copy the message id:', id));
      }}
    >
      {copied ? '✓ Copied' : `Copy ID${label}`}
    </button>
  );
}
