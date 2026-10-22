import { useState, type FormEvent } from 'react';
import { channelKey, splitChannelKey } from '../channelKey';
import { ChannelSelect } from '../ChannelSelect';
import { PluginFormFrame, type PluginFormProps } from '../plugins/PluginFormFrame';
import { usePluginSave } from '../plugins/usePluginSave';
import { ScheduleFields } from '../plugins/PluginSchedule';
import {
  WEEKDAYS,
  describeSchedule,
  scheduleInput,
  scheduleOf,
  type ScheduleValue,
} from '../plugins/scheduleValue';
import { useChannels } from '../useChannels';
import { TimezoneField } from '../TimezoneField';
import { EventTextFields, type EventText } from './EventFields';
import './signup.css';
import { Select } from '../Select';

/**
 * A Recurring Event plugin (event sign-ups' plugin kind, shown in the Plugins tab): when it runs
 * (weekly), it archives the events still open in its channel, deletes all its other messages (pinned
 * ones too) and posts the next one from this
 * form. Changes apply to the events it posts from then on; Pause in the Plugins tab suspends it.
 */
export function RecurringEventForm({
  guild,
  timezone,
  editing,
}: PluginFormProps<'RECURRING_EVENT'>) {
  const { channels, channelName } = useChannels(guild.id);
  const { save, busy, error, dialog, back } = usePluginSave(guild, 'RECURRING_EVENT', editing);
  const config = editing?.config;
  const [name, setName] = useState(editing?.name ?? '');
  const [channel, setChannel] = useState(
    config ? channelKey(config.serverId, config.channelId) : '',
  );
  const [text, setText] = useState<EventText>({
    kind: config?.kind ?? 'CHARACTERS',
    title: config?.title ?? '',
    location: config?.location ?? '',
    description: config?.description ?? '',
  });
  const [eventWeekday, setEventWeekday] = useState(config?.weekday ?? 3);
  const [eventTime, setEventTime] = useState(config?.time ?? '20:00');
  const [eventTimezone, setEventTimezone] = useState(config?.timezone ?? 'ST');
  const [schedule, setSchedule] = useState<ScheduleValue>(
    editing
      ? scheduleOf(editing)
      : { frequency: 'WEEKLY', timeOfDay: '23:00', weekday: 3, dayOfMonth: 1 },
  );

  // The schedule's timezone (also the first post's date and time).
  const [zone, setZone] = useState(editing?.timezone ?? 'ST');
  const zoneLabel = zone === 'ST' ? timezone : zone;
  // Adding one: post the first event right away, or at a date and time picked here (guild time).
  const [firstLater, setFirstLater] = useState(false);
  const [firstDate, setFirstDate] = useState('');
  const [firstTime, setFirstTime] = useState('18:00');

  const usable = channels.filter((group) => group.channels.length > 0 || !group.error);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const { serverId, channelId } = splitChannelKey(channel);
    const where = `#${channelName(serverId, channelId) ?? channelId}`;
    const next = `“${text.title}” for the next ${WEEKDAYS[eventWeekday - 1]} at ${eventTime}`;
    const first = firstLater
      ? `On ${firstDate} at ${firstTime} (${zoneLabel}) it posts ${next} after that.`
      : `It posts ${next} within a minute.`;
    save(
      {
        name: name.trim() || text.title.trim(),
        ...scheduleInput(schedule),
        timezone: zone,
        ...(editing ? {} : { firstRun: firstLater ? `${firstDate}T${firstTime}` : 'now' }),
        config: {
          serverId,
          channelId,
          ...text,
          weekday: eventWeekday,
          time: eventTime,
          timezone: eventTimezone,
        },
      },
      {
        title: 'Add Recurring Event?',
        message: `${first} Then, ${describeSchedule(schedule)} (${zoneLabel}), it archives the events still open in ${where}, deletes every other message there, pinned ones too, and posts the next one. Deleted messages can’t be brought back.`,
        danger: true,
      },
    );
  };

  return (
    <>
      {dialog}
      <PluginFormFrame
        title={editing ? `Edit ${editing.name}` : 'New Recurring Event'}
        intro="Posts the same sign-up event every week. Each time it runs, it archives the events still open in its channel, deletes every other message there, pinned ones too, and posts the next one. Changes here apply to the events it posts from then on, not to the one already posted. Pause it in the Plugins tab to suspend it."
        back={back}
        busy={busy}
        error={error}
        editing={!!editing}
        onSubmit={handleSubmit}
      >
        <h4 className="tasks-section">The event</h4>
        <div className="form-grid">
          <EventTextFields value={text} onChange={setText} showKind />
          <label className="field">
            Event day
            <Select value={eventWeekday} onChange={(v) => setEventWeekday(Number(v))}>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index + 1}>
                  {day}
                </option>
              ))}
            </Select>
            <small>Each post is for the next one of these days.</small>
          </label>
          <label className="field">
            Event time
            <input
              type="time"
              value={eventTime}
              onChange={(e) => setEventTime(e.target.value)}
              required
            />
          </label>
          <TimezoneField
            value={eventTimezone}
            onChange={setEventTimezone}
            serverTimezone={timezone}
          />
          <div className="field field-wide">
            Sign-up channel
            <ChannelSelect
              groups={usable}
              value={channel}
              onChange={setChannel}
              required
              check={{ guildId: guild.id, use: 'recurring' }}
            />
            <small>
              Emptied each time, pinned messages too: use a channel for this event only.
            </small>
          </div>
        </div>
        <h4 className="tasks-section">When to post the next one</h4>
        <div className="form-grid form-grid-3">
          <label className="field">
            Plugin name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder={text.title || 'Recurring Event'}
            />
          </label>
          <ScheduleFields
            value={schedule}
            onChange={setSchedule}
            frequencies={['WEEKLY']}
            dayLabel="Every"
            timeLabel="At"
          />
          <TimezoneField value={zone} onChange={setZone} serverTimezone={timezone} />
        </div>
        {!editing && (
          <fieldset className="field signup-post-when">
            <legend>First event</legend>
            <label className="field-toggle">
              <input
                type="radio"
                name="first-event"
                checked={!firstLater}
                onChange={() => setFirstLater(false)}
              />
              Post it now
            </label>
            <label className="field-toggle">
              <input
                type="radio"
                name="first-event"
                checked={firstLater}
                onChange={() => setFirstLater(true)}
              />
              At a date and time
            </label>
            {firstLater && (
              <div className="signup-post-at">
                <input
                  type="date"
                  aria-label="First post date"
                  value={firstDate}
                  onChange={(e) => setFirstDate(e.target.value)}
                  required
                />
                <input
                  type="time"
                  aria-label="First post time"
                  value={firstTime}
                  onChange={(e) => setFirstTime(e.target.value)}
                  required
                />
              </div>
            )}
            <small>
              {firstLater
                ? `Then (${zoneLabel}) it posts the event for the next ${WEEKDAYS[eventWeekday - 1]} at ${eventTime}. `
                : `Within a minute it posts the event for the next ${WEEKDAYS[eventWeekday - 1]} at ${eventTime}. `}
              The first post archives and deletes nothing; after it, the weekly schedule above takes
              over.
            </small>
          </fieldset>
        )}
      </PluginFormFrame>
    </>
  );
}
