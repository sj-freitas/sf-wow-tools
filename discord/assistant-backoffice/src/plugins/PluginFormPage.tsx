import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { channelKey, splitChannelKey } from '../channelKey';
import { ChannelSelect } from '../ChannelSelect';
import { Spinner } from '../Loading';
import { ProfessionsPostForm } from '../professions/ProfessionsPostForm';
import { RecurringEventForm } from '../signup/RecurringEventForm';
import type { Guild } from '../types';
import { useChannels } from '../useChannels';
import { ScheduleFields } from './PluginSchedule';
import { TimezoneField } from '../TimezoneField';
import { describeSchedule, scheduleInput, scheduleOf, type ScheduleValue } from './scheduleValue';
import { PluginFormFrame, type PluginFormProps } from './PluginFormFrame';
import { usePluginSave } from './usePluginSave';
import { fetchPlugins, type Plugin } from './pluginsApi';

interface Props {
  guild: Guild;
  timezone: string;
}

/**
 * `/plugins/create/:kind` and `/plugins/edit/:id`: the form of the plugin's kind (Channel Clean
 * Up here; Recurring Event, which belongs to event sign-ups, in ../signup; Professions List in
 * ../professions).
 */
export function PluginFormPage({ guild, timezone }: Props) {
  const { id, kind } = useParams();
  // Editing: the plugin, once loaded (null while loading, undefined when creating).
  const [editing, setEditing] = useState<Plugin | null | undefined>(id ? null : undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchPlugins(guild.id)
      .then((plugins) => {
        const plugin = plugins.find((p) => p.id === id);
        if (!plugin) throw new Error('That plugin no longer exists.');
        setEditing(plugin);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [guild.id, id]);

  if (error) return <p className="status-error">{error}</p>;
  if (editing === null) return <Spinner />;
  const which = editing?.kind ?? kind?.toUpperCase();
  if (which === 'RECURRING_EVENT') {
    return (
      <RecurringEventForm
        guild={guild}
        timezone={timezone}
        editing={editing?.kind === 'RECURRING_EVENT' ? editing : undefined}
      />
    );
  }
  if (which === 'PROFESSIONS_POST') {
    return (
      <ProfessionsPostForm
        guild={guild}
        timezone={timezone}
        editing={editing?.kind === 'PROFESSIONS_POST' ? editing : undefined}
      />
    );
  }
  if (which === 'CHANNEL_CLEANUP') {
    return (
      <ChannelCleanupForm
        guild={guild}
        timezone={timezone}
        editing={editing?.kind === 'CHANNEL_CLEANUP' ? editing : undefined}
      />
    );
  }
  return <p className="empty">There is no such kind of plugin.</p>;
}

/** A Channel Clean Up's channel and schedule. Creating one asks for confirmation. */
function ChannelCleanupForm({ guild, timezone, editing }: PluginFormProps<'CHANNEL_CLEANUP'>) {
  const { channels } = useChannels(guild.id);
  const { save, busy, error, dialog, back } = usePluginSave(guild, 'CHANNEL_CLEANUP', editing);
  const [name, setName] = useState(editing?.name ?? '');
  const [channel, setChannel] = useState(
    editing ? channelKey(editing.config.serverId, editing.config.channelId) : '',
  );
  const [keepBotMessages, setKeepBotMessages] = useState(editing?.config.keepBotMessages ?? true);
  const [schedule, setSchedule] = useState<ScheduleValue>(
    editing
      ? scheduleOf(editing)
      : { frequency: 'DAILY', timeOfDay: '04:00', weekday: 1, dayOfMonth: 1 },
  );

  const [zone, setZone] = useState(editing?.timezone ?? 'ST');
  const zoneLabel = zone === 'ST' ? timezone : zone;

  const usable = channels.filter((group) => group.channels.length > 0 || !group.error);
  const channelLabel = () => {
    const { serverId, channelId } = splitChannelKey(channel);
    const found = channels
      .find((group) => group.serverId === serverId)
      ?.channels.find((c) => c.id === channelId);
    return `#${found?.name ?? channelId}`;
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const { serverId, channelId } = splitChannelKey(channel);
    save(
      {
        name: name.trim(),
        ...scheduleInput(schedule),
        timezone: zone,
        config: { serverId, channelId, keepBotMessages },
      },
      {
        title: 'Add Channel Clean Up?',
        message: `The bot will delete the messages in ${channelLabel()} ${describeSchedule(schedule)} (${zoneLabel}), keeping pinned${keepBotMessages ? ' and bot' : ''} messages. Deleted messages can’t be brought back.`,
        danger: true,
      },
    );
  };

  return (
    <>
      {dialog}
      <PluginFormFrame
        title={editing ? `Edit ${editing.name}` : 'New Channel Clean Up'}
        intro="Deletes the messages of a channel on a schedule. Pinned messages are always kept, so pin anything that should stay. A big channel can take a few minutes."
        back={back}
        busy={busy}
        error={error}
        editing={!!editing}
        onSubmit={handleSubmit}
      >
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
            <ChannelSelect
              groups={usable}
              value={channel}
              onChange={setChannel}
              required
              check={{ guildId: guild.id, use: 'cleanup' }}
            />
          </div>
          <ScheduleFields value={schedule} onChange={setSchedule} />
          <TimezoneField value={zone} onChange={setZone} serverTimezone={timezone} />
        </div>
        <label className="field-toggle">
          <input
            type="checkbox"
            checked={keepBotMessages}
            onChange={(e) => setKeepBotMessages(e.target.checked)}
          />
          Keep messages from bots (sign-ups, Raid-Helper, …)
        </label>
      </PluginFormFrame>
    </>
  );
}
