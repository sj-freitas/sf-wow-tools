import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { guildPath } from '../guildPath';
import { Spinner } from '../Loading';
import { formatWhen } from '../time';
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
  const [error, setError] = useState<string | null>(null);
  const { channelName } = useChannels(guild.id);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    fetchPlugins(guild.id)
      .then(setPlugins)
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

  const run = (action: Promise<unknown>) => {
    setError(null);
    action
      .then(load)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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
            runNow: `Check the guild’s professions now and, if they changed, replace the list in ${channelOf(plugin)}? Its schedule carries on as before.`,
            runNowDanger: false,
            remove: 'the list it posted stays',
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
      <div className="tasks-head">
        <div>
          <h3>Plugins</h3>
          <span className="muted">
            Features that run on their own, on a schedule. Times are in {timezone}.
          </span>
        </div>
      </div>

      {error && (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-sm" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

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
        <Spinner />
      ) : plugins.length === 0 ? (
        <p className="empty">No plugins yet: add one above.</p>
      ) : (
        plugins.map((plugin) => (
          <div key={plugin.id} className="task-card">
            <div>
              <strong>{plugin.name}</strong> <span className="badge">{plugin.kindLabel}</span>{' '}
              {!plugin.enabled && <span className="badge">Paused</span>}
              <div className="muted">
                {channelOf(plugin)} · {plugin.scheduleText} · {describe(plugin).summary}
              </div>
              <div className="muted">
                {plugin.enabled
                  ? `Next run: ${formatWhen(plugin.nextRunAt, timezone)}`
                  : 'Paused: it won’t run until resumed.'}
              </div>
            </div>
            {plugin.recentRuns.length > 0 && (
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
            <div className="settings-actions task-actions">
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
