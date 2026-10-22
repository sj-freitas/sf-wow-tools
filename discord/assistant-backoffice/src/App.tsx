import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { fetchCurrentUser, fetchGuilds, fetchSetupInfo, logout, takeReturnPath } from './api';
import { accessSummary } from './guildAccess';
import { UserMenu } from './UserMenu';
import { useCurrentGuild } from './useCurrentGuild';
import { PrivacyPage, PublicHome } from './PublicPages';
import { Spinner } from './Loading';
import { Toasts } from './Toasts';
import { usePageMeta } from './usePageMeta';
import type { Guild, SetupInfo, User } from './types';

// Everything behind the login, loaded once someone is logged in: the public pages don't need it.
const GuildShell = lazy(() => import('./GuildShell').then((m) => ({ default: m.GuildShell })));

const ROLE_REFRESH_MS = 60_000;

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

  const reloadGuilds = useCallback(async (): Promise<Guild[]> => {
    const guilds = await fetchGuilds();
    // Keep the old objects when nothing changed, so pages don't reload for no reason.
    setAuth((current) =>
      current.status === 'ready' && JSON.stringify(current.guilds) !== JSON.stringify(guilds)
        ? { ...current, guilds }
        : current,
    );
    return guilds;
  }, []);

  // Roles come from Discord: the API re-reads them at most once a minute, so ask again about that
  // often (and when the tab is shown again) to pick up role changes without a reload.
  const signedIn = auth.status === 'ready' && auth.user !== null;
  useEffect(() => {
    if (!signedIn) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') reloadGuilds().catch(() => undefined);
    };
    const timer = setInterval(refresh, ROLE_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [signedIn, reloadGuilds]);

  if (auth.status === 'loading') {
    return <Spinner />;
  }

  // Not knowing whether someone is logged in (the API is down, or a crawler can't reach it) shows
  // the public pages, as to someone logged out, rather than only an error.
  if (auth.status === 'error' || !auth.user) {
    // Logged out: the public landing page for any address (so deep links still explain the site
    // and offer to log in), plus the privacy policy.
    return (
      <Routes>
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="*" element={<PublicHome />} />
      </Routes>
    );
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
        <UserMenu user={auth.user} guilds={auth.guilds} onLogout={handleLogout} />
      </header>
      <NoIndex />
      <Toasts />
      <main className="page">
        {auth.setup && (
          <Suspense fallback={<Spinner />}>
            <GuildShell
              guilds={auth.guilds}
              setup={auth.setup}
              currentUser={auth.user}
              onGuildsChanged={reloadGuilds}
            />
          </Suspense>
        )}
      </main>
      <footer className="app-footer">
        <AccountLine user={auth.user} guilds={auth.guilds} setup={auth.setup} />
        <Link to="/privacy">Privacy policy</Link>
      </footer>
    </>
  );
}

/** Who you are logged in as, and your roles in the guild you are viewing (the menu has neither). */
function AccountLine({
  user,
  guilds,
  setup,
}: {
  user: User;
  guilds: Guild[];
  setup: SetupInfo | null;
}) {
  const current = useCurrentGuild(guilds);
  return (
    <p className="app-footer-account">
      Logged in as {user.displayName}
      {current && setup && (
        <>
          {' · '}
          {accessSummary(current, setup.adminRoleName)} in {current.name}
        </>
      )}
    </p>
  );
}

/** Pages behind the login are nobody's search result (`/privacy` sets its own, indexable, meta). */
function NoIndex() {
  usePageMeta({ index: false });
  return null;
}
