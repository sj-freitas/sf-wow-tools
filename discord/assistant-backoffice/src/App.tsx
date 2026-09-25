import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchCurrentUser, fetchGuilds, fetchSetupInfo, logout, takeReturnPath } from './api';
import { GuildShell } from './GuildShell';
import { UserMenu } from './UserMenu';
import { LoginScreen } from './LoginScreen';
import type { Guild, SetupInfo, User } from './types';

type AuthState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; user: User | null; guilds: Guild[]; setup: SetupInfo | null };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const navigate = useNavigate();

  useEffect(() => {
    fetchCurrentUser()
      .then(async (user) => {
        const [guilds, setup] = user
          ? await Promise.all([fetchGuilds(), fetchSetupInfo()])
          : [[], null];
        setAuth({ status: 'ready', user, guilds, setup });
        // Back to the page the user was on before logging in.
        const returnTo = user ? takeReturnPath() : null;
        if (returnTo && returnTo !== '/') navigate(returnTo, { replace: true });
      })
      .catch((err: unknown) =>
        setAuth({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, [navigate]);

  const reloadGuilds = async (): Promise<Guild[]> => {
    const guilds = await fetchGuilds();
    setAuth((current) => (current.status === 'ready' ? { ...current, guilds } : current));
    return guilds;
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
    void logout().then(() => setAuth({ status: 'ready', user: null, guilds: [], setup: null }));
  };

  return (
    <>
      <header className="header">
        <Link className="brand" to="/overview" title="Overview: all your guilds">
          <span className="brand-mark">
            <img src="/logo.png" alt="" />
          </span>
          Guild Assistant
        </Link>
        <UserMenu
          user={auth.user}
          guilds={auth.guilds}
          setup={auth.setup}
          onLogout={handleLogout}
        />
      </header>
      <main className="page">
        {auth.setup && (
          <GuildShell
            guilds={auth.guilds}
            setup={auth.setup}
            currentUser={auth.user}
            onGuildsChanged={reloadGuilds}
          />
        )}
      </main>
    </>
  );
}
