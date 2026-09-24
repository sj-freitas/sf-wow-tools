import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { CreateGuildPage } from './CreateGuildPage';
import { subscribeEvents } from './events';
import { canConfigure } from './guildAccess';
import { HomeEditPage, HomePage } from './HomePage';
import { HoneypotCreatePage, HoneypotsPage } from './HoneypotsPage';
import { PostEditorPage } from './PostEditorPage';
import { PostsPage } from './PostsPage';
import { RequireAccess } from './RequireAccess';
import { CharacterEditorPage, RosterPage } from './RosterPage';
import { SettingsPage } from './SettingsPage';
import { SetupInstructions } from './SetupInstructions';
import type { Guild, SetupInfo, User } from './types';

interface Props {
  guilds: Guild[];
  setup: SetupInfo;
  currentUser: User;
  onGuildsChanged: () => Promise<void>;
}

const SELECTED_KEY = 'guildAssistant.guild';

function readSelectedGuild(): string | undefined {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Everything behind the login: the guild picker and, for the chosen guild, its pages.
 *
 *   /                  Home (welcome post)        everyone in the guild
 *   /edit              write the welcome post     Officers
 *   /roster            roster                     everyone in the guild
 *   /roster/create     add a character            everyone (members: their own)
 *   /roster/edit/:id   edit a character           Officers, or its owner
 *   /posts             posts (?q=&page=)          Officers
 *   /posts/create      new post                   Officers
 *   /posts/edit/:id    edit a post                Officers
 *   /honeypots         honeypot channels          Officers
 *   /honeypots/create  new honeypot               Officers
 *   /settings          guild settings             Guild-Assistants and Officers
 *   /guilds/create     set up a new guild         anyone
 */
export function GuildShell({ guilds, setup, currentUser, onGuildsChanged }: Props) {
  const [selectedId, setSelectedId] = useState(readSelectedGuild);
  const guild = guilds.find((g) => g.id === selectedId) ?? guilds[0];
  const navigate = useNavigate();

  const guildsChanged = useRef(onGuildsChanged);
  useEffect(() => {
    guildsChanged.current = onGuildsChanged;
  }, [onGuildsChanged]);
  useEffect(
    () => subscribeEvents('guild', () => void guildsChanged.current().catch(() => undefined)),
    [],
  );

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      // Not remembering the guild between visits is fine.
    }
  };

  const timezone = setup.regions.find((region) => region.id === guild?.region)?.timezone ?? 'UTC';

  return (
    <Routes>
      <Route
        path="guilds/create"
        element={
          <CreateGuildPage
            setup={setup}
            onCreated={async (created) => {
              select(created.id);
              await onGuildsChanged();
            }}
          />
        }
      />
      {guild ? (
        <Route
          element={
            <GuildFrame
              guilds={guilds}
              guild={guild}
              setup={setup}
              onSelect={(id) => {
                select(id);
                navigate('/');
              }}
            />
          }
        >
          <Route index element={<HomePage guild={guild} timezone={timezone} />} />
          <Route
            path="edit"
            element={
              <RequireAccess allowed={guild.isOfficer}>
                <HomeEditPage guild={guild} />
              </RequireAccess>
            }
          />
          <Route path="roster" element={<RosterPage guild={guild} currentUser={currentUser} />} />
          <Route
            path="roster/create"
            element={<CharacterEditorPage guild={guild} currentUser={currentUser} />}
          />
          <Route
            path="roster/edit/:characterId"
            element={<CharacterEditorPage guild={guild} currentUser={currentUser} />}
          />
          <Route
            path="posts"
            element={
              <RequireAccess allowed={guild.isOfficer}>
                <PostsPage guild={guild} timezone={timezone} />
              </RequireAccess>
            }
          />
          <Route
            path="posts/create"
            element={
              <RequireAccess allowed={guild.isOfficer}>
                <PostEditorPage guild={guild} timezone={timezone} />
              </RequireAccess>
            }
          />
          <Route
            path="posts/edit/:id"
            element={
              <RequireAccess allowed={guild.isOfficer}>
                <PostEditorPage guild={guild} timezone={timezone} />
              </RequireAccess>
            }
          />
          <Route
            path="honeypots"
            element={
              <RequireAccess allowed={guild.isOfficer}>
                <HoneypotsPage guild={guild} timezone={timezone} />
              </RequireAccess>
            }
          />
          <Route
            path="honeypots/create"
            element={
              <RequireAccess allowed={guild.isOfficer}>
                <HoneypotCreatePage guild={guild} />
              </RequireAccess>
            }
          />
          <Route path="honeypot" element={<Navigate to="/honeypots" replace />} />
          <Route
            path="settings"
            element={
              <RequireAccess allowed={canConfigure(guild)}>
                <SettingsPage
                  guild={guild}
                  regions={setup.regions}
                  onGuildsChanged={onGuildsChanged}
                />
              </RequireAccess>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      ) : (
        <Route path="*" element={<NoGuild setup={setup} />} />
      )}
    </Routes>
  );
}

function NoGuild({ setup }: { setup: SetupInfo }) {
  return (
    <div className="card empty">
      <p>
        None of your Discord servers belong to a guild that uses Guild Assistant yet. Create one to
        get started.
      </p>
      <SetupInstructions setup={setup} />
      <Link className="btn btn-primary" to="/guilds/create">
        + Create guild
      </Link>
    </div>
  );
}

interface FrameProps {
  guilds: Guild[];
  guild: Guild;
  setup: SetupInfo;
  onSelect: (guildId: string) => void;
}

/** The guild picker, the guild's header and its section links, around the page being shown. */
function GuildFrame({ guilds, guild, setup, onSelect }: FrameProps) {
  const accessLabels = [
    ...(guild.isAdmin ? [setup.adminRoleName] : []),
    ...(guild.isOfficer ? ['Officer'] : []),
  ];
  const accessHint = [
    guild.isAdmin &&
      `${setup.adminRoleName} (in every server of this guild): create guilds and configure them.`,
    guild.isOfficer &&
      `Officer (${guild.officerRole?.name ?? ''}): manage every player's characters, the posts and honeypots, and configure the guild.`,
    "Everyone in one of the guild's servers: see the home page and the roster, and add and edit their own characters.",
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <>
      <div className="topbar">
        <div className="tabs" role="tablist">
          {guilds.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={g.id === guild.id}
              onClick={() => onSelect(g.id)}
            >
              {g.name}
            </button>
          ))}
        </div>
        <Link className="btn" to="/guilds/create">
          + Create guild
        </Link>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <div className="card-title">
              <h2>{guild.name}</h2>
              <span className={`badge badge-${guild.faction.toLowerCase()}`}>{guild.faction}</span>
              <span
                className={`badge ${accessLabels.length > 0 ? 'badge-admin' : ''}`}
                title={accessHint}
              >
                Your access: {accessLabels.length > 0 ? accessLabels.join(' + ') : 'Member'}
              </span>
            </div>
            <div className="card-meta">
              {guild.realm} · {guild.gameVersion}
            </div>
          </div>
        </div>

        <div className="server-list">
          {guild.servers.map((server) => (
            <span key={server.discordId} className="server-chip">
              {server.name || server.discordId}
              {server.isMain && guild.servers.length > 1 && <span className="badge">Main</span>}
            </span>
          ))}
        </div>

        <nav className="view-tabs" aria-label="Guild sections">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/roster">Roster</NavLink>
          {guild.isOfficer && <NavLink to="/posts">Posts</NavLink>}
          {guild.isOfficer && <NavLink to="/honeypots">Honeypots</NavLink>}
          {canConfigure(guild) && <NavLink to="/settings">Settings</NavLink>}
        </nav>

        <Outlet />
      </section>
    </>
  );
}
