import { useEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { bannerUrl } from './api';
import { CreateGuildPage } from './CreateGuildPage';
import { subscribeEvents } from './events';
import { canConfigure } from './guildAccess';
import { guildPath } from './guildPath';
import { HomeEditPage, HomePage } from './HomePage';
import { HoneypotCreatePage, HoneypotsPage } from './HoneypotsPage';
import { LandingPage } from './LandingPage';
import { forgetLastGuild, readLastGuildId, rememberLastGuild } from './lastGuild';
import { ConversationPage, OfficerRequestsPage } from './OfficerRequestsPage';
import { PostEditorPage } from './PostEditorPage';
import { PostsPage } from './PostsPage';
import { RequireAccess } from './RequireAccess';
import { CharacterEditorPage, RosterPage } from './RosterPage';
import { SettingsPage } from './SettingsPage';
import type { Guild, SetupInfo, User } from './types';

interface Props {
  guilds: Guild[];
  setup: SetupInfo;
  currentUser: User;
  /** Reloads the user's guilds and returns the fresh list. */
  onGuildsChanged: () => Promise<Guild[]>;
}

/**
 * Everything behind the login.
 *
 *   /                                     goes to the guild you last used (a cookie), else to /overview
 *   /overview                             your guilds: pick one or add one
 *   /guilds/create                        set up a new guild
 *   /<version>/<region>/<server>/<guild>  a guild, e.g. /forever/eu/firemaw/relic-hunters, and under it:
 *       /                     Welcome (the welcome post)   everyone in the guild
 *       /edit                 write the welcome post       Officers
 *       /roster               roster                       everyone in the guild
 *       /roster/create        add a character              everyone (members: their own)
 *       /roster/edit/:id      edit a character             Officers, or its owner
 *       /posts                posts (?q=&page=)            Officers
 *       /posts/create         new post                     Officers
 *       /posts/edit/:id       edit a post                  Officers
 *       /honeypots            honeypot channels            Officers
 *       /honeypots/create     new honeypot                 Officers
 *       /officer-requests     members' messages to officers           Officers
 *       /officer-requests/:conversationId   one conversation          Officers
 *       /settings             guild settings               Guild-Assistants and Officers
 */
export function GuildShell({ guilds, setup, currentUser, onGuildsChanged }: Props) {
  const guildsChanged = useRef(onGuildsChanged);
  useEffect(() => {
    guildsChanged.current = onGuildsChanged;
  }, [onGuildsChanged]);
  useEffect(
    () => subscribeEvents('guild', () => void guildsChanged.current().catch(() => undefined)),
    [],
  );

  return (
    <Routes>
      <Route index element={<LastGuildRedirect guilds={guilds} />} />
      <Route path="overview" element={<LandingPage guilds={guilds} setup={setup} />} />
      <Route
        path="guilds/create"
        element={<CreateGuildPage setup={setup} onCreated={onGuildsChanged} />}
      />
      <Route
        path=":version/:region/:realm/:guildSlug/*"
        element={
          <GuildRoutes
            guilds={guilds}
            setup={setup}
            currentUser={currentUser}
            onGuildsChanged={onGuildsChanged}
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * `/`: straight to the guild the user last opened (remembered in a cookie), so that with a
 * guild chosen they never see the list again. With none, or one they have since left, the
 * Overview.
 */
function LastGuildRedirect({ guilds }: { guilds: Guild[] }) {
  const remembered = readLastGuildId();
  const guild = guilds.find((g) => g.id === remembered);
  useEffect(() => {
    if (remembered && !guild) forgetLastGuild();
  }, [remembered, guild]);
  return <Navigate to={guild ? guildPath(guild) : '/overview'} replace />;
}

/** Finds the guild the address points to and shows its pages, or says it wasn't found. */
function GuildRoutes({ guilds, setup, currentUser, onGuildsChanged }: Props) {
  const { version, region, realm, guildSlug } = useParams();
  const path = [version, region, realm, guildSlug].join('/');
  const guild = guilds.find((g) => g.path === path);

  // Opening a guild makes it the one `/` goes to next time.
  const guildId = guild?.id;
  useEffect(() => {
    if (guildId) rememberLastGuild(guildId);
  }, [guildId]);

  if (!guild) {
    return (
      <div className="card empty">
        <p>You are not in a guild at this address.</p>
        <Link className="btn btn-primary" to="/overview">
          Overview
        </Link>
      </div>
    );
  }

  const timezone = setup.regions.find((r) => r.id === guild.region)?.timezone ?? 'UTC';
  const home = guildPath(guild);
  const officersOnly = (page: ReactNode) => (
    <RequireAccess allowed={guild.isOfficer} fallback={home}>
      {page}
    </RequireAccess>
  );

  return (
    <GuildFrame guild={guild} setup={setup}>
      <Routes>
        <Route index element={<HomePage guild={guild} timezone={timezone} />} />
        <Route path="edit" element={officersOnly(<HomeEditPage guild={guild} />)} />
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
          element={officersOnly(<PostsPage guild={guild} timezone={timezone} />)}
        />
        <Route
          path="posts/create"
          element={officersOnly(<PostEditorPage guild={guild} timezone={timezone} />)}
        />
        <Route
          path="posts/edit/:id"
          element={officersOnly(<PostEditorPage guild={guild} timezone={timezone} />)}
        />
        <Route
          path="honeypots"
          element={officersOnly(<HoneypotsPage guild={guild} timezone={timezone} />)}
        />
        <Route
          path="honeypots/create"
          element={officersOnly(<HoneypotCreatePage guild={guild} />)}
        />
        <Route path="honeypot" element={<Navigate to={guildPath(guild, 'honeypots')} replace />} />
        <Route
          path="officer-requests"
          element={officersOnly(<OfficerRequestsPage guild={guild} timezone={timezone} />)}
        />
        <Route
          path="officer-requests/:conversationId"
          element={officersOnly(<ConversationPage guild={guild} timezone={timezone} />)}
        />
        <Route
          path="settings"
          element={
            <RequireAccess allowed={canConfigure(guild)} fallback={home}>
              <SettingsPage
                guild={guild}
                regions={setup.regions}
                onGuildsChanged={onGuildsChanged}
              />
            </RequireAccess>
          }
        />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </GuildFrame>
  );
}

/** The guild's name and details, its section links, and the page being shown. */
function GuildFrame({
  guild,
  setup,
  children,
}: {
  guild: Guild;
  setup: SetupInfo;
  children: ReactNode;
}) {
  const regionLabel = setup.regions.find((r) => r.id === guild.region)?.label ?? guild.region;

  return (
    <section className="card">
      {guild.bannerVersion !== null && (
        <img className="guild-banner" src={bannerUrl(guild)} alt={`${guild.name} banner`} />
      )}
      <div className="card-header">
        <div className="guild-identity">
          <ServerIcon guild={guild} />
          <div>
            <h2>{guild.name}</h2>
            <div className="card-meta">
              {guild.realm} · {guild.faction === 'ALLIANCE' ? 'Alliance' : 'Horde'} ·{' '}
              {guild.gameVersion} · {regionLabel}
            </div>
          </div>
        </div>
      </div>

      <nav className="view-tabs" aria-label="Guild sections">
        <NavLink to={guildPath(guild)} end>
          Welcome
        </NavLink>
        <NavLink to={guildPath(guild, 'roster')}>Roster</NavLink>
        {guild.isOfficer && <NavLink to={guildPath(guild, 'posts')}>Posts</NavLink>}
        {guild.isOfficer && <NavLink to={guildPath(guild, 'honeypots')}>Honeypots</NavLink>}
        {guild.isOfficer && (
          <NavLink to={guildPath(guild, 'officer-requests')}>Officer requests</NavLink>
        )}
        {canConfigure(guild) && <NavLink to={guildPath(guild, 'settings')}>Settings</NavLink>}
      </nav>

      {children}
    </section>
  );
}

/** The picture of the guild's main Discord server, or its first letter when the server has none. */
function ServerIcon({ guild }: { guild: Guild }) {
  const main = guild.servers.find((server) => server.isMain);
  if (main?.icon) {
    return (
      <img
        className="guild-icon"
        src={`https://cdn.discordapp.com/icons/${main.discordId}/${main.icon}.png?size=128`}
        alt=""
      />
    );
  }
  return (
    <span className="guild-icon guild-icon-fallback">{guild.name.charAt(0).toUpperCase()}</span>
  );
}
