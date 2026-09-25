import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { accessSummary } from './guildAccess';
import { guildPath } from './guildPath';
import type { Guild, SetupInfo, User } from './types';

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

interface Props {
  user: User;
  guilds: Guild[];
  setup: SetupInfo | null;
  onLogout: () => void;
}

/**
 * The top-right menu: who you are, the guilds you are in (to switch between them), adding a
 * guild, and logging out.
 */
export function UserMenu({ user, guilds, setup, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const current = guilds.find(
    (guild) => pathname === guildPath(guild) || pathname.startsWith(`${guildPath(guild)}/`),
  );

  // Close after navigating, when clicking elsewhere, and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={root}>
      <button
        type="button"
        className="user-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar user={user} />
        <span className="username">{user.username}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-section">
            <div className="muted">Signed in as</div>
            <strong>{user.username}</strong>
            {current && setup && (
              <div className="muted">
                In {current.name}: {accessSummary(current, setup.adminRoleName)}
              </div>
            )}
          </div>
          <div className="user-menu-section">
            <div className="muted">Your guilds</div>
            {guilds.length === 0 && <div className="muted">You are not in a guild yet.</div>}
            {guilds.map((guild) => (
              <Link
                key={guild.id}
                role="menuitem"
                className={guild.id === current?.id ? 'user-menu-item current' : 'user-menu-item'}
                to={guildPath(guild)}
              >
                <span>{guild.name}</span>
                <span className="muted">{guild.realm}</span>
              </Link>
            ))}
            <Link role="menuitem" className="user-menu-item" to="/guilds/create">
              + Add a guild
            </Link>
          </div>
          <div className="user-menu-section">
            <button type="button" role="menuitem" className="user-menu-item" onClick={onLogout}>
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
