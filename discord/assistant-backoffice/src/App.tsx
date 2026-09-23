import { useEffect, useState } from 'react';
import { fetchCurrentUser, logout } from './api';
import { PlayersPage } from './PlayersPage';
import type { User } from './types';

type AuthState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; user: User | null };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    fetchCurrentUser()
      .then((user) => setAuth({ status: 'ready', user }))
      .catch((err: unknown) =>
        setAuth({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  if (auth.status === 'loading') {
    return <p className="status">Loading…</p>;
  }

  if (auth.status === 'error') {
    return <p className="status status-error">Failed to check login: {auth.message}</p>;
  }

  if (!auth.user) {
    return (
      <main>
        <h1>Guild Assistant</h1>
        {/* Full-page navigation: the API redirects to Discord and back. */}
        <a href="/api/auth/login">Log in with Discord</a>
      </main>
    );
  }

  const handleLogout = () => {
    void logout().then(() => setAuth({ status: 'ready', user: null }));
  };

  return (
    <main>
      <header>
        <span>{auth.user.username}</span>
        <button type="button" onClick={handleLogout}>
          Log out
        </button>
      </header>
      <h1>Players</h1>
      <PlayersPage />
    </main>
  );
}
