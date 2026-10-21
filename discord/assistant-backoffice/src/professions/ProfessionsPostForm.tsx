import { useState, type FormEvent } from 'react';
import { channelKey, splitChannelKey } from '../channelKey';
import { ChannelSelect } from '../ChannelSelect';
import { ScheduleFields } from '../plugins/PluginSchedule';
import { PluginFormFrame, type PluginFormProps } from '../plugins/PluginFormFrame';
import {
  describeSchedule,
  isInterval,
  scheduleInput,
  scheduleOf,
  type ScheduleValue,
} from '../plugins/scheduleValue';
import { usePluginSave } from '../plugins/usePluginSave';
import { TimezoneField } from '../TimezoneField';
import { useChannels } from '../useChannels';

/**
 * A Professions List's channel and how often it checks for changes (it also checks a couple of
 * minutes after anyone imports professions). A new one posts the list at once.
 */
export function ProfessionsPostForm({
  guild,
  timezone,
  editing,
}: PluginFormProps<'PROFESSIONS_POST'>) {
  const { channels } = useChannels(guild.id);
  const { save, busy, error, dialog, back } = usePluginSave(guild, 'PROFESSIONS_POST', editing);
  const [name, setName] = useState(editing?.name ?? '');
  const [channel, setChannel] = useState(
    editing ? channelKey(editing.config.serverId, editing.config.channelId) : '',
  );
  const [schedule, setSchedule] = useState<ScheduleValue>(
    editing
      ? scheduleOf(editing)
      : { frequency: 'EVERY_5_MINUTES', timeOfDay: '06:00', weekday: 1, dayOfMonth: 1 },
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
        config: { serverId, channelId },
        ...(editing ? {} : { firstRun: 'now' }),
      },
      {
        title: 'Add Professions List?',
        message: `The bot will post what the guild can craft in ${channelLabel()} now, check for changes ${describeSchedule(schedule)}${isInterval(schedule.frequency) ? '' : ` (${zoneLabel})`} and after each import, and replace its messages when the list changed.`,
      },
    );
  };

  return (
    <>
      {dialog}
      <PluginFormFrame
        title={editing ? `Edit ${editing.name}` : 'New Professions List'}
        intro="Posts what the guild can craft and who, from the Guild Assistant Professions addon, over as many messages as it takes. When the list changes it deletes its messages and posts it again; nothing else in the channel is touched."
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
              placeholder="Professions List"
            />
          </label>
          <div className="field field-span-2">
            Channel
            <ChannelSelect groups={usable} value={channel} onChange={setChannel} required />
          </div>
          {/* Checking only posts when the list changed, so checking often costs nothing. */}
          <ScheduleFields
            value={schedule}
            onChange={setSchedule}
            frequencies={['EVERY_5_MINUTES', 'HOURLY', 'DAILY']}
          />
          {!isInterval(schedule.frequency) && (
            <TimezoneField value={zone} onChange={setZone} serverTimezone={timezone} />
          )}
        </div>
      </PluginFormFrame>
    </>
  );
}
