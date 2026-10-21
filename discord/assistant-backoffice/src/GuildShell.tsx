import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { bannerUrl, resolveGuildPath } from './api';
import { ArmoryContext, GamesContext } from './game';
import { subscribeEvents } from './events';
import { canConfigure } from './guildAccess';
import { guildPath } from './guildPath';
import { GuildIcon } from './GuildIcon';
import { LandingPage } from './LandingPage';
import { forgetLastGuild, readLastGuildId, rememberLastGuild } from './lastGuild';
import { PrivacyPage } from './PublicPages';
import { RequireAccess } from './RequireAccess';
import type { Guild, SetupInfo, User } from './types';
import { Spinner } from './Loading';

// Each page is loaded when first opened, so the first visit (and the public landing page, which
// loads none of this) downloads less.
const CharacterPage = lazy(() =>
  import('./CharacterPage').then((m) => ({ default: m.CharacterPage })),
);
const CharactersPage = lazy(() =>
  import('./CharactersPage').then((m) => ({ default: m.CharactersPage })),
);
const CreateGuildPage = lazy(() =>
  import('./CreateGuildPage').then((m) => ({ default: m.CreateGuildPage })),
);
const HomeEditPage = lazy(() => import('./HomePage').then((m) => ({ default: m.HomeEditPage })));
const HomePage = lazy(() => import('./HomePage').then((m) => ({ default: m.HomePage })));
const HoneypotCreatePage = lazy(() =>
  import('./HoneypotsPage').then((m) => ({ default: m.HoneypotCreatePage })),
);
const HoneypotsPage = lazy(() =>
  import('./HoneypotsPage').then((m) => ({ default: m.HoneypotsPage })),
);
const PluginFormPage = lazy(() =>
  import('./plugins/PluginFormPage').then((m) => ({ default: m.PluginFormPage })),
);
const PluginsPage = lazy(() =>
  import('./plugins/PluginsPage').then((m) => ({ default: m.PluginsPage })),
);
const ConversationPage = lazy(() =>
  import('./OfficerRequestsPage').then((m) => ({ default: m.ConversationPage })),
);
const OfficerRequestsPage = lazy(() =>
  import('./OfficerRequestsPage').then((m) => ({ default: m.OfficerRequestsPage })),
);
const OfficerNotePage = lazy(() =>
  import('./OfficerNotePage').then((m) => ({ default: m.OfficerNotePage })),
);
const PostEditorPage = lazy(() =>
  import('./PostEditorPage').then((m) => ({ default: m.PostEditorPage })),
);
const PostsPage = lazy(() => import('./PostsPage').then((m) => ({ default: m.PostsPage })));
const CharacterEditorPage = lazy(() =>
  import('./RosterPage').then((m) => ({ default: m.CharacterEditorPage })),
);
const RosterPage = lazy(() => import('./RosterPage').then((m) => ({ default: m.RosterPage })));
const ProfessionsPage = lazy(() =>
  import('./professions/ProfessionsPage').then((m) => ({ default: m.ProfessionsPage })),
);
const SettingsPage = lazy(() =>
  import('./SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const SignupRoutes = lazy(() =>
  import('./signup/SignupRoutes').then((m) => ({ default: m.SignupRoutes })),
);

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
 *   /                                               goes to the guild you last used (a cookie), else /overview
 *   /overview                                       your guilds: pick one or add one
 *   /privacy                                        the privacy policy (also before logging in)
 *   /guilds/create                                  set up a new guild
 *   /<version>/<region>/<server>/characters         your characters on that server
 *   /<version>/<region>/<server>/characters/<name>  a character's own page (guild-agnostic: the
 *                                                    same one regardless of which guild it is in,
 *                                                    or none); basic info to everyone, its bio too
 *                                                    once its player shares it (RP servers only)
 *   /<version>/<region>/<server>/characters/<name>/bio   writing that bio; its own player only
 *   /<version>/<region>/<server>/guilds/<guild>      a guild, e.g. /forever/eu/firemaw/guilds/relic-hunters
 *                                                    (the literal "guilds" keeps this from
 *                                                    colliding with a character's address above),
 *                                                    and under it:
 *       /                     Welcome (the welcome post)   everyone in the guild
 *       /edit                 write the welcome post       Officers
 *       /roster               roster                       everyone in the guild
 *       /roster/create        add a character              everyone (members: their own)
 *       /roster/edit/:id      edit a character             Officers, or its owner
 *       /roster/notes/:id     Officers' private note about a character   Officers
 *       /professions          what the guild can craft (?q=&prof=)        everyone in the guild
 *       /professions/:craftId[/crafters]  the same, at one recipe (its Wowhead spell id), its
 *                             characters open with /crafters (the Professions List's links)
 *       /posts                posts (?q=&page=)            Officers
 *       /posts/create         new post                     Officers
 *       /posts/edit/:id       edit a post                  Officers
 *       /honeypots            honeypot channels            Officers
 *       /honeypots/create     new honeypot                 Officers
 *       /plugins              plugins: add one, see the guild's    Officers
 *       /plugins/create/:kind new plugin (channel_cleanup, recurring_event) Officers
 *       /plugins/edit/:id     edit a plugin                         Officers
 *       /officer-requests     members' messages to officers           Officers
 *       /officer-requests/:conversationId   one conversation          Officers
 *       /signup/...           events people sign up to     everyone in the guild (see
 *                                                          signup/SignupRoutes.tsx)
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
    <GamesContext.Provider value={setup.games}>
      <ArmoryContext.Provider value={setup.armoryTest}>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route index element={<LastGuildRedirect guilds={guilds} />} />
            <Route path="overview" element={<LandingPage guilds={guilds} setup={setup} />} />
            <Route path="privacy" element={<PrivacyPage framed={false} />} />
            <Route
              path="guilds/create"
              element={<CreateGuildPage setup={setup} onCreated={onGuildsChanged} />}
            />
            <Route path=":version/:region/:realm/characters" element={<CharactersPage />} />
            <Route
              path=":version/:region/:realm/characters/:namePath"
              element={<CharacterPage editMode={false} />}
            />
            <Route
              path=":version/:region/:realm/characters/:namePath/bio"
              element={<CharacterPage editMode={true} />}
            />
            <Route
              path=":version/:region/:realm/guilds/:guildSlug/*"
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
        </Suspense>
      </ArmoryContext.Provider>
    </GamesContext.Provider>
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
/**
 * An address that is none of your guilds: maybe a guild's old one, from before a rename (links in
 * Discord keep it). The API says where it lives now; a guild of yours goes there, same page.
 */
function UnknownGuildAddress({ path, guilds }: { path: string; guilds: Guild[] }) {
  const rest = useParams()['*'] ?? '';
  const [moved, setMoved] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    resolveGuildPath(path)
      .then((result) => current && setMoved(result.path))
      .catch(() => current && setMoved(null));
    return () => {
      current = false;
    };
  }, [path]);

  if (moved === undefined) return <Spinner />;
  if (moved && guilds.some((g) => g.path === moved)) {
    return <Navigate to={`/${moved}${rest ? `/${rest}` : ''}`} replace />;
  }
  return (
    <div className="card empty">
      <p>You are not in a guild at this address.</p>
      <Link className="btn btn-primary" to="/overview">
        Overview
      </Link>
    </div>
  );
}

function GuildRoutes({ guilds, setup, currentUser, onGuildsChanged }: Props) {
  const { version, region, realm, guildSlug } = useParams();
  const path = [version, region, realm, 'guilds', guildSlug].join('/');
  const guild = guilds.find((g) => g.path === path);

  // Opening a guild makes it the one `/` goes to next time.
  const guildId = guild?.id;
  useEffect(() => {
    if (guildId) rememberLastGuild(guildId);
  }, [guildId]);

  if (!guild) return <UnknownGuildAddress path={path} guilds={guilds} />;

  const timezone = setup.regions.find((r) => r.id === guild.region)?.timezone ?? 'UTC';
  const home = guildPath(guild);
  const officersOnly = (page: ReactNode) => (
    <RequireAccess allowed={guild.isOfficer} fallback={home}>
      {page}
    </RequireAccess>
  );

  return (
    <GuildFrame guild={guild} setup={setup}>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route index element={<HomePage guild={guild} timezone={timezone} />} />
          <Route path="edit" element={officersOnly(<HomeEditPage guild={guild} />)} />
          <Route path="roster" element={<RosterPage guild={guild} currentUser={currentUser} />} />
          <Route path="professions" element={<ProfessionsPage guild={guild} />} />
          <Route path="professions/:craftId" element={<ProfessionsPage guild={guild} />} />
          <Route path="professions/:craftId/crafters" element={<ProfessionsPage guild={guild} />} />
          <Route
            path="roster/create"
            element={<CharacterEditorPage guild={guild} currentUser={currentUser} />}
          />
          <Route
            path="roster/edit/:characterId"
            element={<CharacterEditorPage guild={guild} currentUser={currentUser} />}
          />
          <Route
            path="roster/notes/:characterId"
            element={officersOnly(<OfficerNotePage guild={guild} />)}
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
          <Route
            path="honeypot"
            element={<Navigate to={guildPath(guild, 'honeypots')} replace />}
          />
          <Route
            path="plugins"
            element={officersOnly(<PluginsPage guild={guild} timezone={timezone} />)}
          />
          <Route
            path="plugins/create/:kind"
            element={officersOnly(<PluginFormPage guild={guild} timezone={timezone} />)}
          />
          <Route
            path="plugins/edit/:id"
            element={officersOnly(<PluginFormPage guild={guild} timezone={timezone} />)}
          />
          <Route
            path="officer-requests"
            element={officersOnly(<OfficerRequestsPage guild={guild} timezone={timezone} />)}
          />
          <Route
            path="officer-requests/:conversationId"
            element={officersOnly(<ConversationPage guild={guild} timezone={timezone} />)}
          />
          <Route path="signup/*" element={<SignupRoutes guild={guild} timezone={timezone} />} />
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
      </Suspense>
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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The guild's sections this person sees: tabs, or (on a phone) a dropdown.
  const sections: { label: string; to: string; end?: boolean }[] = [
    { label: 'Welcome', to: guildPath(guild), end: true },
    { label: 'Roster', to: guildPath(guild, 'roster') },
    { label: 'Professions', to: guildPath(guild, 'professions') },
    { label: 'Events', to: guildPath(guild, 'signup') },
    ...(guild.isOfficer
      ? [
          { label: 'Posts', to: guildPath(guild, 'posts') },
          { label: 'Honeypots', to: guildPath(guild, 'honeypots') },
          { label: 'Plugins', to: guildPath(guild, 'plugins') },
          { label: 'Officer requests', to: guildPath(guild, 'officer-requests') },
        ]
      : []),
    ...(canConfigure(guild) ? [{ label: 'Settings', to: guildPath(guild, 'settings') }] : []),
  ];
  // The section open now: the longest one the address is in (Welcome only when exactly on it).
  const current =
    [...sections]
      .sort((a, b) => b.to.length - a.to.length)
      .find((s) =>
        s.end ? pathname === s.to : pathname === s.to || pathname.startsWith(`${s.to}/`),
      )?.to ?? '';

  return (
    <section className="card">
      {guild.bannerVersion !== null && (
        <img className="guild-banner" src={bannerUrl(guild)} alt={`${guild.name} banner`} />
      )}
      <div className="card-header">
        <div className="guild-identity">
          {/* The logo and the name lead back to the guild's Welcome page. */}
          <Link className="guild-identity-link" to={guildPath(guild)}>
            <GuildIcon guild={guild} />
          </Link>
          <div>
            <h2>
              <Link className="guild-identity-link" to={guildPath(guild)}>
                {guild.name}
              </Link>
            </h2>
            <div className="card-meta">
              {guild.realm} · {guild.faction === 'ALLIANCE' ? 'Alliance' : 'Horde'} ·{' '}
              {guild.gameVersion} · {regionLabel}
            </div>
          </div>
        </div>
      </div>

      <nav className="view-tabs guild-tabs" aria-label="Guild sections">
        {sections.map((section) => (
          <NavLink key={section.to} to={section.to} end={section.end}>
            {section.label}
          </NavLink>
        ))}
      </nav>
      {/* Phones: the same sections in a dropdown (CSS shows one or the other). */}
      <div className="view-tabs-select">
        <select
          aria-label="Guild section"
          value={current}
          onChange={(e) => navigate(e.target.value)}
        >
          {current === '' && <option value="">Choose a section…</option>}
          {sections.map((section) => (
            <option key={section.to} value={section.to}>
              {section.label}
            </option>
          ))}
        </select>
      </div>

      {children}
    </section>
  );
}
