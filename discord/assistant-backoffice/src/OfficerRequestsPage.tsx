import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { fetchOfficerRequest, fetchOfficerRequests } from './api';
import { formatWhen, timeAgo } from './time';
import type { Conversation, ConversationsPage, Guild } from './types';
import { useCurrentUrl, useReturnTo } from './useReturnTo';

interface Props {
  guild: Guild;
  timezone: string;
}

const REFRESH_MS = 20_000;
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
    return () => clearInterval(timer);
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
            Messages members sent with /contact-officer. Officers reply in Discord with
            /contact-officer-reply. Read-only here.
          </span>
        </div>
      </div>

      {!guild.officerRequestChannel && (
        <div className="banner banner-error" role="status">
          <span>
            The Officer Request Channel is not set, so members' messages can't be delivered. Set it
            in Settings.
          </span>
          <Link className="btn btn-sm" to="/settings">
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
            to={`/officer-requests/${item.publicId}`}
            state={{ from: here }}
          >
            <div>
              <strong>#{item.publicId}</strong>{' '}
              <span className="badge">{item.isAnonymous ? 'Anonymous' : item.requesterName}</span>{' '}
              {item.awaitingReply && <span className="badge badge-live">Awaiting reply</span>}
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
 * `/officer-requests/:conversationId`: the whole conversation, read-only. Each message says who
 * wrote it: an anonymous member (or the member, if they chose to be named) or a named officer.
 */
export function ConversationPage({ guild, timezone }: Props) {
  const { conversationId } = useParams();
  const back = useReturnTo('/officer-requests');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="tasks">
      <Link className="back-link" to={back}>
        ← Officer requests
      </Link>
      {error ? (
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
            <span className={conversation.isAnonymous ? 'badge' : 'badge badge-main'}>
              {conversation.isAnonymous ? 'Anonymous' : 'Named'}
            </span>
          </div>
          <p className="muted">
            Read-only. Officers reply in Discord with{' '}
            <code>/contact-officer-reply conversation-id:{conversation.publicId}</code>; the member
            gets it by DM.
          </p>
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
        </>
      )}
    </div>
  );
}
