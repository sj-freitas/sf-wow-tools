import { fetchCurrentUser, redirectToLogin } from './api';

export type GuildEventType = 'characters' | 'guild' | 'officer-requests';

const handlers: Record<GuildEventType, Set<() => void>> = {
  characters: new Set(),
  guild: new Set(),
  'officer-requests': new Set(),
};
let source: EventSource | null = null;

const subscriberCount = () => Object.values(handlers).reduce((total, set) => total + set.size, 0);

function open(): EventSource {
  const stream = new EventSource('/api/events');
  for (const type of Object.keys(handlers) as GuildEventType[]) {
    stream.addEventListener(type, () => handlers[type].forEach((handler) => handler()));
  }
  stream.onerror = () => {
    // The browser gives no status code: if the stream was closed, check whether we were logged out.
    if (stream.readyState === EventSource.CLOSED) {
      void fetchCurrentUser().then((user) => (user ? undefined : redirectToLogin()));
    }
  };
  return stream;
}

/**
 * Runs `handler` whenever the API reports a change to a guild the user can see. One shared
 * connection serves every page: it opens with the first subscriber and closes with the last.
 * Returns the function that unsubscribes.
 */
export function subscribeEvents(type: GuildEventType, handler: () => void): () => void {
  handlers[type].add(handler);
  source ??= open();
  return () => {
    handlers[type].delete(handler);
    if (subscriberCount() === 0) {
      source?.close();
      source = null;
    }
  };
}
