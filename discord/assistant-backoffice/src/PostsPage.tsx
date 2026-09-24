import { useCallback, useEffect, useRef, useState } from 'react';
import { deletePostMessage, deleteTask, fetchTasks, runTaskNow, updateTask } from './api';
import { PostTaskForm } from './PostTaskForm';
import { ReactionsPanel } from './ReactionsPanel';
import { formatWhen, timeAgo } from './time';
import type { Guild, PostsPage as PostsPageData, ScheduledPost } from './types';
import { useChannels } from './useChannels';
import { useConfirm } from './useConfirm';

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

/** In Discord right now. */
const isLive = (post: ScheduledPost): boolean =>
  post.post.posted !== null && !post.post.posted.messageDeleted;

const wasDeleted = (post: ScheduledPost): boolean => post.post.posted?.messageDeleted === true;

function statusLabel(post: ScheduledPost): string {
  if (isLive(post)) return 'Posted';
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
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reactionsFor, setReactionsFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Posts the user just asked to send, until the server shows them as queued.
  const [starting, setStarting] = useState<Set<string>>(new Set());
  // Result of a run that just finished, shown for a few seconds.
  const [flash, setFlash] = useState<Record<string, { ok: boolean; text: string }>>({});
  const lastRuns = useRef<Map<string, string | null>>(new Map());
  const latestRequest = useRef(0);
  const { channels, channelName } = useChannels(guild.id);
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

  // Typing in the search box searches after a short pause, from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(queryInput.trim());
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const anyQueued = starting.size > 0 || (data?.items.some(isQueued) ?? false);
  useEffect(() => {
    load();
    const timer = setInterval(load, anyQueued ? QUEUED_REFRESH_MS : REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, anyQueued]);

  // The last post of the last page was removed: step back to the page that still exists.
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  useEffect(() => {
    if (data && data.items.length === 0 && data.total > 0 && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage]);

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
    setCreating(false);
    setEditingId(null);
    load();
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setEditingId(null);
            setCreating(true);
          }}
        >
          + New post
        </button>
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

      {creating && (
        <PostTaskForm
          guild={guild}
          channels={channels}
          timezone={timezone}
          onSaved={saved}
          onCancel={() => setCreating(false)}
        />
      )}

      {!data ? (
        <p className="empty">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="empty">
          {query ? `No posts match "${query}".` : 'No posts yet. Create one with "+ New post".'}
        </p>
      ) : (
        data.items.map((post) =>
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
                  <div className="post-snippet">{snippet(post.post.content)}</div>
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
                </div>
                <div className="settings-actions">
                  {post.post.posted && isLive(post) && (
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
                  {!isLive(post) && post.enabled && (
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
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setCreating(false);
                      setEditingId(post.id);
                    }}
                  >
                    Edit
                  </button>
                  {isLive(post) && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      title="Removes the message from Discord. The post stays here, so it can be sent again later."
                      onClick={() =>
                        void confirm({
                          title: 'Delete the post from Discord?',
                          message: `The message in #${channelName(post.post.serverId, post.post.channelId) ?? 'the channel'} is removed${post.post.seedReactions.length > 0 ? ', with its reactions' : ''}. "${post.name}" stays here, so you can send it again later with Post now or a new date.`,
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
              {reactionsFor === post.id && <ReactionsPanel taskId={post.id} />}
            </div>
          ),
        )
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
              onClick={() => setPage(data.page - 1)}
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
              onClick={() => setPage(data.page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
