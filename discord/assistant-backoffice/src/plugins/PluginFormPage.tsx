import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { channelKey, splitChannelKey } from '../channelKey';
import { ChannelSelect } from '../ChannelSelect';
import { guildPath } from '../guildPath';
import { Spinner } from '../Loading';
import type { Guild } from '../types';
import { useChannels } from '../useChannels';
import { useConfirm } from '../useConfirm';
import {
  createPlugin,
  fetchPlugins,
  updatePlugin,
  type Plugin,
  type PluginScheduleKind,
} from './pluginsApi';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

interface Props {
  guild: Guild;
  timezone: string;
}

/**
 * `/plugins/create/channel_cleanup` and `/plugins/edit/:id`: a Channel Clean Up's channel and
 * schedule. Creating one asks for confirmation, as it deletes messages on its own.
 */
export function PluginFormPage({ guild, timezone }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { channels } = useChannels(guild.id);
  const { confirm, dialog } = useConfirm();
  const back = guildPath(guild, 'plugins');

  // Editing: the plugin, once loaded (null while loading, undefined when creating).
  const [editing, setEditing] = useState<Plugin | null | undefined>(id ? null : undefined);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('');
  const [keepBotMessages, setKeepBotMessages] = useState(true);
  const [frequency, setFrequency] = useState<PluginScheduleKind>('DAILY');
  const [timeOfDay, setTimeOfDay] = useState('04:00');
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchPlugins(guild.id)
      .then((plugins) => {
        const plugin = plugins.find((p) => p.id === id);
        if (!plugin) throw new Error('That plugin no longer exists.');
        setEditing(plugin);
        setName(plugin.name);
        setChannel(channelKey(plugin.config.serverId, plugin.config.channelId));
        setKeepBotMessages(plugin.config.keepBotMessages);
        setFrequency(plugin.schedule.kind);
        setTimeOfDay(plugin.schedule.timeOfDay);
        setWeekday(plugin.schedule.weekday ?? 1);
        setDayOfMonth(plugin.schedule.dayOfMonth ?? 1);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id, id]);

  const usable = channels.filter((group) => group.channels.length > 0 || !group.error);
  const channelLabel = () => {
    const { serverId, channelId } = splitChannelKey(channel);
    const found = channels
      .find((group) => group.serverId === serverId)
      ?.channels.find((c) => c.id === channelId);
    return `#${found?.name ?? channelId}`;
  };
  const when = () =>
    frequency === 'DAILY'
      ? `every day at ${timeOfDay}`
      : frequency === 'WEEKLY'
        ? `every ${WEEKDAYS[weekday - 1]} at ${timeOfDay}`
        : `every month on day ${dayOfMonth} at ${timeOfDay}`;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const { serverId, channelId } = splitChannelKey(channel);
    const input = {
      name: name.trim(),
      scheduleKind: frequency,
      timeOfDay,
      weekday: frequency === 'WEEKLY' ? weekday : null,
      dayOfMonth: frequency === 'MONTHLY' ? dayOfMonth : null,
      config: { serverId, channelId, keepBotMessages },
    };
    const save = (action: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      action()
        .then(() => navigate(back))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusy(false));
    };
    if (editing) {
      save(() => updatePlugin(editing.id, input));
      return;
    }
    void confirm({
      title: 'Add Channel Clean Up?',
      message: `The bot will delete the messages in ${channelLabel()} ${when()} (${timezone}), keeping pinned${keepBotMessages ? ' and bot' : ''} messages. Deleted messages can’t be brought back.`,
      confirmLabel: 'Add',
      danger: true,
    }).then(
      (ok) =>
        ok &&
        save(() => createPlugin(guild.id, { ...input, kind: 'CHANNEL_CLEANUP', confirm: true })),
    );
  };

  if (editing === null && !error) return <Spinner />;

  return (
    <div className="tasks">
      {dialog}
      <Link className="back-link" to={back}>
        ← Plugins
      </Link>
      <form className="card-body task-form" onSubmit={handleSubmit}>
        <h3>{editing ? `Edit ${editing.name}` : 'New Channel Clean Up'}</h3>
        <p className="muted">
          Deletes the messages of a channel on a schedule. Pinned messages are always kept, so pin
          anything that should stay. A big channel can take a few minutes.
        </p>
        <div className="form-grid form-grid-3">
          <label className="field">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Channel Clean Up"
            />
          </label>
          <div className="field field-span-2">
            Channel
            <ChannelSelect groups={usable} value={channel} onChange={setChannel} required />
          </div>
          <label className="field">
            How often
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as PluginScheduleKind)}
            >
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </label>
          {frequency === 'WEEKLY' && (
            <label className="field">
              Day
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          )}
          {frequency === 'MONTHLY' && (
            <label className="field">
              Day of the month
              <select value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))}>
                {DAYS_OF_MONTH.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
              {dayOfMonth > 28 && (
                <small className="muted">Shorter months run on their last day.</small>
              )}
            </label>
          )}
          <label className="field">
            Time ({timezone})
            <input
              type="time"
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              required
            />
          </label>
        </div>
        <label className="field-toggle">
          <input
            type="checkbox"
            checked={keepBotMessages}
            onChange={(e) => setKeepBotMessages(e.target.checked)}
          />
          Keep messages from bots (sign-ups, Raid-Helper, …)
        </label>
        {error && <p className="status-error">{error}</p>}
        <div className="form-actions">
          <Link className="btn" to={back}>
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {editing ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}
