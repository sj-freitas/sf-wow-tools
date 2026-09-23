import { useEffect, useState } from 'react';
import { fetchCurrentUser, fetchGuilds, logout } from './api';
import { GuildsPage } from './GuildsPage';
import { LoginScreen } from './LoginScreen';
import type { Guild, User } from './types';

type AuthState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; user: User | null; guilds: Guild[] };

function Avatar({ user }: { user: User }) {
  if (user.avatar) {
    return (
      <img
        className="avatar"
        src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=64`}
        alt=""
      />
    );
  }
  return <span className="avatar">{user.username.charAt(0).toUpperCase()}</span>;
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    fetchCurrentUser()
      .then(async (user) =>
        setAuth({ status: 'ready', user, guilds: user ? await fetchGuilds() : [] }),
      )
      .catch((err: unknown) =>
        setAuth({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  const reloadGuilds = async () => {
    const guilds = await fetchGuilds();
    setAuth((current) => (current.status === 'ready' ? { ...current, guilds } : current));
  };

  if (auth.status === 'loading') {
    return <p className="status">Loading…</p>;
  }

  if (auth.status === 'error') {
    return <p className="status status-error">Failed to check login: {auth.message}</p>;
  }

  if (!auth.user) {
    return <LoginScreen />;
  }

  const handleLogout = () => {
    void logout().then(() => setAuth({ status: 'ready', user: null, guilds: [] }));
  };

  return (
    <>
      <header className="header">
        <div className="brand">
          <span className="brand-mark">
            <img src="/logo.png" alt="" />
          </span>
          Guild Assistant
        </div>
        <div className="header-user">
          <Avatar user={auth.user} />
          <span className="username">{auth.user.username}</span>
          <button type="button" className="btn btn-sm" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="page">
        <GuildsPage guilds={auth.guilds} onGuildsChanged={reloadGuilds} />
      </main>
    </>
  );
}
