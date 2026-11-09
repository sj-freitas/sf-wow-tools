import { useCallback, useEffect, useState } from 'react';
import { Help } from '../Help';
import { Drawer } from '../Drawer';
import { Link } from 'react-router-dom';
import { guildPath } from '../guildPath';
import { Spinner } from '../Loading';
import { OneLine } from '../OneLine';
import { formatWhen } from '../time';
import { showToast } from '../toast';
import type { Guild } from '../types';
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

interface Props {
  guild: Guild;
  timezone: string;
}

const REFRESH_MS = 15_000;

/** `/plugins`: the plugins there are to add, and the ones the guild has. */
export function PluginsPage({ guild, timezone }: Props) {
  const [kinds, setKinds] = useState<PluginKindInfo[]>([]);
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);
  // The plugin whose run log is open (a drawer), by id.
  const [logOf, setLogOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { channelName } = useChannels(guild.id);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    fetchPlugins(guild.id)
      .then((loaded) => {
        setPlugins(loaded);
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

  return (
    <div className="tasks">
      {dialog}
      {(() => {
        const plugin = plugins?.find((p) => p.id === logOf);
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
        {kinds.map((kind) => (
          <div key={kind.kind} className="plugin-kind">
            <div>
              <strong>{kind.label}</strong>
              <p className="muted">{kind.description}</p>
            </div>
            <Link
              className="btn btn-sm btn-primary"
              to={guildPath(guild, `plugins/create/${kind.kind.toLowerCase()}`)}
            >
              + Add
            </Link>
          </div>
        ))}
      </section>

      <h4 className="plugin-list-title">This guild’s plugins</h4>
      {plugins === null ? (
        error ? (
          <p className="status-error">{error}</p>
        ) : (
          <Spinner />
        )
      ) : plugins.length === 0 ? (
        <p className="empty">No plugins yet: add one above.</p>
      ) : (
        plugins.map((plugin) => (
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
              <button type="button" className="btn btn-sm" onClick={() => setLogOf(plugin.id)}>
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
        ))
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
