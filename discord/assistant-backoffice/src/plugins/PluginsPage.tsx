import { useCallback, useEffect, useState } from 'react';
import { deleteHoneypot, fetchHoneypots, updateHoneypot } from '../api';
import { Help } from '../Help';
import { Drawer } from '../Drawer';
import { Link, useSearchParams } from 'react-router-dom';
import { fuzzyWordsScore } from '../fuzzy';
import { guildPath } from '../guildPath';
import { Spinner } from '../Loading';
import { OneLine } from '../OneLine';
import { formatWhen } from '../time';
import { showToast } from '../toast';
import type { Guild, Honeypot } from '../types';
import { useChannels } from '../useChannels';
import { useConfirm } from '../useConfirm';
import {
  deletePlugin,
  fetchPluginKinds,
  fetchPlugins,
  runPluginNow,
  updatePlugin,
  type Plugin,
  type PluginKindInfo,
} from './pluginsApi';
import { WEEKDAYS } from './scheduleValue';
import { HoneypotLog, HoneypotStatus } from './HoneypotPlugin';
import { HONEYPOT_KIND, honeypotSummary } from './honeypotKind';

interface Props {
  guild: Guild;
  timezone: string;
}

const REFRESH_MS = 15_000;

/**
 * `/plugins`: the plugins there are to add, and the ones the guild has. Honeypots are among them,
 * though they have their own data and API (./HoneypotPlugin.tsx).
 */
export function PluginsPage({ guild, timezone }: Props) {
  // The API's kinds; null until read, so the catalog appears at once, Honeypot in its place.
  const [kinds, setKinds] = useState<PluginKindInfo[] | null>(null);
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);
  const [honeypots, setHoneypots] = useState<Honeypot[] | null>(null);
  // The plugin or honeypot whose log is open (a drawer).
  const [logOf, setLogOf] = useState<{ honeypot: boolean; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const channels = useChannels(guild.id);
  const { channelName } = channels;
  const { confirm, dialog } = useConfirm();
  // The search and the type filter, kept in the address (`?q=raid&type=honeypot`) like the
  // roster's, so a filtered list can be linked to and survives a refresh.
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };
  const toggleType = (type: string) => {
    const current = params.getAll('type');
    const next = new URLSearchParams(params);
    next.delete('type');
    for (const value of current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type]) {
      next.append('type', value);
    }
    setParams(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    next.delete('q');
    next.delete('type');
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    Promise.all([fetchPlugins(guild.id), fetchHoneypots(guild.id)])
      .then(([loadedPlugins, loadedHoneypots]) => {
        setPlugins(loadedPlugins);
        setHoneypots(loadedHoneypots);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id]);

  useEffect(() => {
    fetchPluginKinds(guild.id)
      .then(setKinds)
      .catch(() => setKinds([]));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [guild.id, load]);

  // A failed action is a note over the page: a banner would push the plugins down.
  const run = (action: Promise<unknown>) => {
    action
      .then(load)
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : String(err), 8000));
  };

  const channelOf = (plugin: Plugin) =>
    `#${channelName(plugin.config.serverId, plugin.config.channelId) ?? plugin.config.channelId}`;
  // What a plugin does, per kind: its summary line, and what Run now and Remove will do.
  const describe = (plugin: Plugin) =>
    plugin.kind === 'CHANNEL_CLEANUP'
      ? {
          summary: `keeps pinned${plugin.config.keepBotMessages ? ' and bot messages' : ' messages'}`,
          runNow: `Delete the messages in ${channelOf(plugin)} now, keeping pinned${plugin.config.keepBotMessages ? ' and bot' : ''} messages? This can’t be undone. Its schedule carries on as before.`,
          runNowDanger: true,
          remove: 'messages it already deleted stay deleted',
        }
      : plugin.kind === 'PROFESSIONS_POST'
        ? {
            summary: 'posts what the guild can craft, again when it changes',
            runNow: `Delete the list in ${channelOf(plugin)} and post it again now, even if nothing changed? Its schedule carries on as before.`,
            runNowDanger: false,
            remove: 'the list it posted stays',
          }
        : plugin.kind === 'PROFESSION_LISTENER'
          ? {
              summary: `answers “who can craft …?”${
                plugin.config.sendDm && plugin.config.postInChannel
                  ? ' by DM and in the channel'
                  : plugin.config.postInChannel
                    ? ' in the channel'
                    : ' by DM'
              }`,
              runNow: '',
              runNowDanger: false,
              remove: 'the answers it sent stay',
            }
          : {
              summary: `posts “${plugin.config.title}” for ${WEEKDAYS[plugin.config.weekday - 1]} ${plugin.config.time}`,
              runNow: `Archive the events still open in ${channelOf(plugin)}, delete all its other messages (pinned ones too) and post the next “${plugin.config.title}” now? Deleted messages can’t be brought back. Its schedule carries on as before.`,
              runNowDanger: true,
              remove: 'the events it already posted stay',
            };

  // The types to filter by: the kinds to add (Honeypot last), then any kind a plugin has that the
  // API no longer offers. In the address by the same name as their create page (`honeypot`).
  const types = [
    ...(kinds ?? []).map((kind) => ({ path: kind.kind.toLowerCase(), label: kind.label })),
    { path: HONEYPOT_KIND.path, label: HONEYPOT_KIND.label },
    ...(plugins ?? []).map((plugin) => ({
      path: plugin.kind.toLowerCase(),
      label: plugin.kindLabel,
    })),
  ].filter((type, index, all) => all.findIndex((t) => t.path === type.path) === index);
  const pickedTypes = params.getAll('type').filter((path) => types.some((t) => t.path === path));
  const filtering = query.trim() !== '' || pickedTypes.length > 0;
  // Of the picked types (any, when none is), and every word of the search in something its card
  // shows: its name, type, channel, schedule, what it does, its mode.
  const matches = (type: string, texts: (string | false)[]) =>
    (pickedTypes.length === 0 || pickedTypes.includes(type)) &&
    (query.trim() === '' ||
      fuzzyWordsScore(
        query,
        texts.filter((text): text is string => !!text),
      ) !== null);
  const shownPlugins = (plugins ?? []).filter((plugin) =>
    matches(plugin.kind.toLowerCase(), [
      plugin.name,
      plugin.kindLabel,
      channelOf(plugin),
      !plugin.live && plugin.scheduleText,
      describe(plugin).summary,
      !plugin.enabled && 'Paused',
    ]),
  );
  const shownHoneypots = (honeypots ?? []).filter((honeypot) =>
    matches(HONEYPOT_KIND.path, [
      honeypot.name,
      HONEYPOT_KIND.label,
      honeypotSummary(honeypot, channels),
      honeypot.testMode ? 'Test mode' : 'Live',
      !honeypot.enabled && 'Paused',
    ]),
  );
  const total = (plugins?.length ?? 0) + (honeypots?.length ?? 0);
  const shownCount = shownPlugins.length + shownHoneypots.length;

  return (
    <div className="tasks">
      {dialog}
      {(() => {
        const honeypot = logOf?.honeypot ? honeypots?.find((h) => h.id === logOf.id) : undefined;
        if (honeypot) {
          return (
            <Drawer title={`${honeypot.name}: log`} onClose={() => setLogOf(null)}>
              <HoneypotLog honeypot={honeypot} timezone={timezone} />
            </Drawer>
          );
        }
        const plugin = logOf?.honeypot ? undefined : plugins?.find((p) => p.id === logOf?.id);
        return plugin ? (
          <Drawer title={`${plugin.name}: log`} onClose={() => setLogOf(null)}>
            {plugin.recentRuns.length === 0 ? (
              <p className="empty">
                {plugin.live
                  ? 'Nothing answered yet: each answer it sends is logged here.'
                  : 'No runs to show yet. Checks that found nothing to do aren’t logged.'}
              </p>
            ) : (
              <ul className="honeypot-events">
                {plugin.recentRuns.map((runInfo) => (
                  <li key={runInfo.id}>
                    <span className="muted">{formatWhen(runInfo.startedAt, timezone)}</span>{' '}
                    {runInfo.status === 'FAILED' ? (
                      <span className="status-error">Failed: {runInfo.error}</span>
                    ) : (
                      runInfo.result
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Drawer>
        ) : null;
      })()}
      <div className="tasks-head">
        <div>
          <h3 className="field-label">
            Plugins
            <Help>Features that run on their own: on a schedule, or as messages arrive.</Help>
          </h3>
        </div>
      </div>

      <section className="plugin-catalog" aria-label="Plugins to add">
        {kinds &&
          [...kinds.map((kind) => ({ ...kind, path: kind.kind.toLowerCase() })), HONEYPOT_KIND].map(
            (kind) => (
              <div key={kind.path} className="plugin-kind">
                <div>
                  <strong>{kind.label}</strong>
                  <p className="muted">{kind.description}</p>
                </div>
                <Link
                  className="btn btn-sm btn-primary"
                  to={guildPath(guild, `plugins/create/${kind.path}`)}
                >
                  + Add
                </Link>
              </div>
            ),
          )}
      </section>

      <h4 className="plugin-list-title">This guild’s plugins</h4>
      {/* The kinds too: the type filter comes from them, and mustn't appear after the list. */}
      {plugins === null || honeypots === null || kinds === null ? (
        error ? (
          <p className="status-error">{error}</p>
        ) : (
          <Spinner />
        )
      ) : total === 0 ? (
        <p className="empty">No plugins yet: add one above.</p>
      ) : (
        <>
          <div className="roster-filters">
            <div className="search-field">
              <input
                className="post-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, type, channel, schedule…"
                aria-label="Search the plugins"
              />
            </div>
            <div className="roster-attribute-filter" role="group" aria-label="Filter by type">
              {types.map((type) => (
                <button
                  key={type.path}
                  type="button"
                  aria-pressed={pickedTypes.includes(type.path)}
                  className={
                    pickedTypes.includes(type.path)
                      ? 'attribute-toggle attribute-toggle-on'
                      : 'attribute-toggle'
                  }
                  onClick={() => toggleType(type.path)}
                >
                  <span className="plugin-type-chip">{type.label}</span>
                </button>
              ))}
            </div>
            {/* Always there, one line: searching or filtering never moves the list. */}
            <div className="roster-filter-summary">
              <span className="muted">
                {filtering
                  ? `${shownCount} of ${total} plugins`
                  : `${total} plugin${total === 1 ? '' : 's'}`}
              </span>
              {filtering && (
                <button type="button" className="btn btn-sm" onClick={clearFilters}>
                  Clear
                </button>
              )}
            </div>
          </div>
          {shownCount === 0 && <p className="empty">No plugins match.</p>}
          {shownPlugins.map((plugin) => (
            <div key={plugin.id} className="task-card">
              <div className="card-info">
                <div className="card-head">
                  <strong className="card-name">{plugin.name}</strong>
                  <span className="badge">{plugin.kindLabel}</span>
                  {!plugin.enabled && <span className="badge">Paused</span>}
                </div>
                <div className="muted card-meta">
                  {channelOf(plugin)} · {plugin.scheduleText} · {describe(plugin).summary}
                </div>
                {/* One line whatever it says: a long notice is cut short, a tap shows it all. */}
                <div className="muted card-meta">
                  {!plugin.enabled ? (
                    plugin.live ? (
                      'Paused: it doesn’t answer until resumed.'
                    ) : (
                      'Paused: it won’t run until resumed.'
                    )
                  ) : plugin.live ? (
                    <OneLine
                      text={liveStatus(plugin)}
                      className={
                        plugin.notice || plugin.lastStatus === 'FAILED' ? 'status-error' : undefined
                      }
                    />
                  ) : (
                    `Next run: ${formatWhen(plugin.nextRunAt, timezone)}`
                  )}
                </div>
              </div>
              {/* Its run log is behind "Log"; only a failure shows here, to be seen. */}
              {/* A live plugin says so in its status line, which is always there. */}
              {plugin.lastStatus === 'FAILED' && !plugin.live && (
                <p className="status-error">Last run failed: {plugin.lastError}</p>
              )}
              <div className="settings-actions task-actions">
                {/* A live plugin answers as messages arrive: there is nothing to run. */}
                {!plugin.live && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!plugin.enabled}
                    title={plugin.enabled ? 'Runs within a minute' : 'Resume it first'}
                    onClick={() =>
                      void confirm({
                        title: 'Run now?',
                        message: describe(plugin).runNow,
                        confirmLabel: 'Run now',
                        danger: describe(plugin).runNowDanger,
                      }).then((ok) => ok && run(runPluginNow(plugin.id)))
                    }
                  >
                    Run now
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setLogOf({ honeypot: false, id: plugin.id })}
                >
                  Log
                </button>
                <Link className="btn btn-sm" to={guildPath(guild, `plugins/edit/${plugin.id}`)}>
                  Edit
                </Link>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => run(updatePlugin(plugin.id, { enabled: !plugin.enabled }))}
                >
                  {plugin.enabled ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() =>
                    void confirm({
                      title: 'Remove plugin',
                      message: `Remove "${plugin.name}"? It stops running; ${describe(plugin).remove}.`,
                      confirmLabel: 'Remove',
                      danger: true,
                    }).then((ok) => ok && run(deletePlugin(plugin.id)))
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {shownHoneypots.map((honeypot) => (
            <div key={honeypot.id} className="task-card">
              <div className="card-info">
                <div className="card-head">
                  <strong className="card-name">{honeypot.name}</strong>
                  <span className="badge">{HONEYPOT_KIND.label}</span>
                  <span className={honeypot.testMode ? 'badge' : 'badge badge-live'}>
                    {honeypot.testMode ? 'Test mode' : 'Live'}
                  </span>
                  {!honeypot.enabled && <span className="badge">Paused</span>}
                </div>
                <div className="muted card-meta">{honeypotSummary(honeypot, channels)}</div>
                {/* One line whatever it says, like a plugin's: what it did is behind "Log". */}
                <div className="muted card-meta">
                  <HoneypotStatus honeypot={honeypot} />
                </div>
              </div>
              <div className="settings-actions task-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setLogOf({ honeypot: true, id: honeypot.id })}
                >
                  Log
                </button>
                {honeypot.testMode ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      void confirm({
                        title: 'Switch to live mode?',
                        message: `People who post in the honeypot "${honeypot.name}" will be permanently banned, and their messages from the last hour deleted.`,
                        confirmLabel: 'Go live',
                        danger: true,
                      }).then(
                        (ok) =>
                          ok &&
                          run(updateHoneypot(honeypot.id, { testMode: false, confirmLive: true })),
                      )
                    }
                  >
                    Go live
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => run(updateHoneypot(honeypot.id, { testMode: true }))}
                  >
                    Back to test mode
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => run(updateHoneypot(honeypot.id, { enabled: !honeypot.enabled }))}
                >
                  {honeypot.enabled ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() =>
                    void confirm({
                      title: 'Remove honeypot',
                      message: `Remove the honeypot "${honeypot.name}"? The channel itself stays in Discord.`,
                      confirmLabel: 'Remove',
                      danger: true,
                    }).then((ok) => ok && run(deleteHoneypot(honeypot.id)))
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * A live plugin's one status line: what keeps it from working, else how its last answer failed
 * (a DM Discord refused), else that it is listening.
 */
const liveStatus = (plugin: Plugin): string =>
  plugin.notice ??
  (plugin.lastStatus === 'FAILED'
    ? `Last answer failed: ${plugin.lastError ?? 'unknown error'}`
    : 'Listening: it answers within seconds of a question.');
