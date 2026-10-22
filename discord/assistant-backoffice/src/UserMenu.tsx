import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GuildIcon } from './GuildIcon';
import { guildPath } from './guildPath';
import { useCurrentGuild } from './useCurrentGuild';
import { ChevronIcon } from './Icons';
import type { Guild, User } from './types';

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
  return <span className="avatar">{user.displayName.charAt(0).toUpperCase()}</span>;
}

/** A phone: the menu covers the whole screen (see `.user-menu-panel`), so the page under it stays. */
const PHONE = '(max-width: 720px)';

interface Props {
  user: User;
  guilds: Guild[];
  onLogout: () => void;
}

/**
 * The top-right menu: who you are logged in as, your guilds to switch between (the one you are
 * in first), adding a guild, and logging out. Your roles in the guild are in the footer. On a
 * phone it covers the whole screen.
 */
export function UserMenu({ user, guilds, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const current = useCurrentGuild(guilds);
  const ordered = current ? [current, ...guilds.filter((g) => g.id !== current.id)] : guilds;

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
    // Full screen on a phone: the page behind doesn't scroll meanwhile.
    const phone = window.matchMedia(PHONE).matches;
    if (phone) document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
      if (phone) document.body.style.overflow = '';
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
        <span className="username">{user.displayName}</span>
        <span className="select-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div className="user-menu-panel" role="menu" aria-label="Your account and guilds">
          <div className="user-menu-head">
            <span className="user-menu-who">
              Logged in as <strong>{user.displayName}</strong>
            </span>
            <button
              type="button"
              className="user-menu-close"
              aria-label="Close the menu"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="user-menu-section">
            {ordered.length === 0 && <div className="muted">You are not in a guild yet.</div>}
            {ordered.map((guild) => (
              <Link
                key={guild.id}
                role="menuitem"
                className={guild.id === current?.id ? 'user-menu-item current' : 'user-menu-item'}
                aria-current={guild.id === current?.id ? 'page' : undefined}
                to={guildPath(guild)}
              >
                <GuildIcon guild={guild} />
                <span className="user-menu-guild">{guild.name}</span>
              </Link>
            ))}
            <Link role="menuitem" className="user-menu-item" to="/guilds/create">
              <span className="guild-icon user-menu-add" aria-hidden="true">
                +
              </span>
              <span className="user-menu-guild">Add a guild</span>
            </Link>
          </div>
          <div className="user-menu-section">
            <button
              type="button"
              role="menuitem"
              className="user-menu-item user-menu-logout"
              onClick={onLogout}
            >
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
