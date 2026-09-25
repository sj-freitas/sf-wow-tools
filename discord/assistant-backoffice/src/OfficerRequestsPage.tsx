import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { subscribeEvents } from './events';
import {
  deleteOfficerRequest,
  fetchOfficerRequest,
  fetchOfficerRequests,
  replyToOfficerRequest,
  setOfficerRequestLocked,
} from './api';
import { useConfirm } from './useConfirm';
import { formatWhen, timeAgo } from './time';
import type { Conversation, ConversationsPage, Guild } from './types';
import { useCurrentUrl, useReturnTo } from './useReturnTo';
import { guildPath } from './guildPath';

interface Props {
  guild: Guild;
  timezone: string;
}

const REFRESH_MS = 60_000;
const SEARCH_DELAY_MS = 300;

/** `/officer-requests`: what members wrote to the officers, most recently active first. */
export function OfficerRequestsPage({ guild, timezone }: Props) {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const pageParam = Number.parseInt(params.get('page') ?? '1', 10);
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
  const [queryInput, setQueryInput] = useState(query);
  const [data, setData] = useState<ConversationsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const here = useCurrentUrl();

  const load = useCallback(() => {
    const request = ++latest.current;
    fetchOfficerRequests(guild.id, { query, page })
      .then((loaded) => {
        if (request !== latest.current) return;
        setData(loaded);
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

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    // New messages and replies arrive over the live stream; the timer is only a safety net.
    const unsubscribe = subscribeEvents('officer-requests', load);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (queryInput.trim() !== query) goTo({ q: queryInput.trim(), page: 1 }, true);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [queryInput, query, goTo]);
  useEffect(() => setQueryInput(query), [query]);

  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, (data.page - 1) * data.pageSize + data.items.length) : 0;

  return (
    <div className="tasks">
      <div className="tasks-head">
        <div>
          <h3>Officer requests</h3>
          <span className="muted">
            Messages members sent with /contact-officer. Reply here, or in Discord with
            /contact-officer-reply.
          </span>
        </div>
      </div>

      {!guild.officerRequestChannel && (
        <div className="banner banner-error" role="status">
          <span>
            The Officer Request Channel is not set, so members' messages can't be delivered. Set it
            in Settings.
          </span>
          <Link className="btn btn-sm" to={guildPath(guild, 'settings')}>
            Open settings
          </Link>
        </div>
      )}

      <input
        type="search"
        className="post-search"
        placeholder="Search by conversation ID or text…"
        value={queryInput}
        onChange={(e) => setQueryInput(e.target.value)}
        aria-label="Search officer requests"
      />

      {error && <p className="status-error">{error}</p>}

      {!data ? (
        <p className="empty">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="empty">
          {query ? `No conversations match "${query}".` : 'No one has written to the officers yet.'}
        </p>
      ) : (
        data.items.map((item) => (
          <Link
            key={item.publicId}
            className="task-card conversation-card"
            to={guildPath(guild, `officer-requests/${item.publicId}`)}
            state={{ from: here }}
          >
            <div>
              <strong>#{item.publicId}</strong>{' '}
              <span className="badge">{item.isAnonymous ? 'Anonymous' : item.requesterName}</span>{' '}
              {item.locked && <span className="badge">Locked</span>}{' '}
              {item.awaitingReply && !item.locked && (
                <span className="badge badge-live">Awaiting reply</span>
              )}
              <div className="post-snippet">{item.preview}</div>
              <div className="muted">
                {item.messageCount} message{item.messageCount === 1 ? '' : 's'} · last activity{' '}
                {formatWhen(item.lastActivityAt, timezone)} ({timeAgo(item.lastActivityAt)})
              </div>
            </div>
          </Link>
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
 * `/officer-requests/:conversationId`: the whole conversation and a reply box. Each message says who
 * wrote it: an anonymous member (or the member, if they chose to be named) or a named officer.
 */
export function ConversationPage({ guild, timezone }: Props) {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const back = useReturnTo(guildPath(guild, 'officer-requests'));
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ notDeleted: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    if (!conversationId) return;
    fetchOfficerRequest(guild.id, conversationId)
      .then((loaded) => {
        setConversation(loaded);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id, conversationId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    // New messages and replies arrive over the live stream; the timer is only a safety net.
    const unsubscribe = subscribeEvents('officer-requests', load);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [load]);

  const toggleLock = () => {
    if (!conversation || busy) return;
    setBusy(true);
    setError(null);
    setOfficerRequestLocked(guild.id, conversation.publicId, !conversation.locked)
      .then(load)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const remove = async () => {
    if (!conversation || busy) return;
    const ok = await confirm({
      title: `Delete conversation #${conversation.publicId}`,
      message:
        "This removes the conversation from the database and deletes its messages from the Officer Request Channel. Direct messages already sent to the member can't be deleted. This can't be undone.",
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    deleteOfficerRequest(guild.id, conversation.publicId)
      .then((result) => {
        if (result.notDeleted === 0) navigate(back, { replace: true });
        else setRemoved(result);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  if (removed) {
    return (
      <div className="tasks">
        <Link className="back-link" to={back}>
          ← Officer requests
        </Link>
        <p className="muted">
          The conversation was deleted. {removed.notDeleted} message
          {removed.notDeleted === 1 ? '' : 's'} could not be removed from the Officer Request
          Channel (probably already deleted, or the channel was changed since).
        </p>
      </div>
    );
  }

  return (
    <div className="tasks">
      {dialog}
      <Link className="back-link" to={back}>
        ← Officer requests
      </Link>
      {error && conversation && <p className="status-error">{error}</p>}
      {error && !conversation ? (
        <p className="status-error">{error}</p>
      ) : !conversation ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <div className="tasks-head">
            <div>
              <h3>Conversation #{conversation.publicId}</h3>
              <span className="muted">
                Started {formatWhen(conversation.createdAt, timezone)} ·{' '}
                {conversation.isAnonymous
                  ? 'The member is anonymous.'
                  : `The member is ${conversation.requester?.name ?? 'named'}.`}
              </span>
            </div>
            <div className="settings-actions">
              <span className={conversation.isAnonymous ? 'badge' : 'badge badge-main'}>
                {conversation.isAnonymous ? 'Anonymous' : 'Named'}
              </span>
              {conversation.locked && <span className="badge">Locked</span>}
              <button type="button" className="btn btn-sm" disabled={busy} onClick={toggleLock}>
                {conversation.locked ? 'Unlock' : 'Lock'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                Delete
              </button>
            </div>
          </div>
          {conversation.locked && (
            <p className="muted">
              Locked: nobody can write to this conversation. Members who try are told to start a new
              one.
            </p>
          )}
          <ol className="conversation">
            {conversation.messages.map((message) => {
              const fromOfficer = message.author === 'OFFICER';
              return (
                <li
                  key={message.id}
                  className={fromOfficer ? 'bubble bubble-officer' : 'bubble bubble-member'}
                >
                  <div className="bubble-head">
                    <strong>
                      {fromOfficer
                        ? `Officer ${message.authorName ?? ''}`.trim()
                        : (message.authorName ?? 'Anonymous member')}
                    </strong>
                    <span className="badge">{fromOfficer ? 'Officer' : 'Member'}</span>
                    <span className="muted">{formatWhen(message.createdAt, timezone)}</span>
                  </div>
                  <div className="bubble-text">{message.content}</div>
                  {fromOfficer && message.dmDelivered === false && (
                    <div className="status-error">
                      The member could not be reached by DM (they may have DMs closed).
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {!conversation.locked && (
            <ReplyForm guildId={guild.id} publicId={conversation.publicId} onSent={load} />
          )}
        </>
      )}
    </div>
  );
}

const MAX_REPLY_LENGTH = 3500;

/** The member gets the reply by DM, and it is also posted in the Officer Request Channel. */
function ReplyForm({
  guildId,
  publicId,
  onSent,
}: {
  guildId: string;
  publicId: number;
  onSent: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setFeedback(null);
    replyToOfficerRequest(guildId, publicId, message)
      .then(({ dmDelivered }) => {
        setText('');
        setFeedback(
          dmDelivered
            ? { ok: true, text: 'Reply sent: the member got it by DM.' }
            : {
                ok: false,
                text: 'Reply saved and posted, but the member could not be reached by DM (they may have DMs closed).',
              },
        );
        onSent();
      })
      .catch((err: unknown) =>
        setFeedback({ ok: false, text: err instanceof Error ? err.message : String(err) }),
      )
      .finally(() => setSending(false));
  };

  return (
    <form className="reply-form" onSubmit={send}>
      <label className="field">
        <span>Reply as an officer</span>
        <textarea
          rows={4}
          maxLength={MAX_REPLY_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Your name is shown to the member. The reply goes to them by DM."
        />
      </label>
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()}>
          {sending ? 'Sending…' : 'Send reply'}
        </button>
        <span className="muted">
          {text.length}/{MAX_REPLY_LENGTH}
        </span>
      </div>
      {feedback && (
        <p className={feedback.ok ? 'muted' : 'status-error'} role="status">
          {feedback.text}
        </p>
      )}
    </form>
  );
}
