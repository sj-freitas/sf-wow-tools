import type { PluginScheduleKind } from './pluginsApi';
import { DAYS_OF_MONTH, WEEKDAYS, type ScheduleValue } from './scheduleValue';

/**
 * How often and when a plugin runs. `frequencies` limits the choice (a Recurring Event is weekly
 * only, and then the "How often" field isn't shown).
 */
export function ScheduleFields({
  value,
  onChange,
  timezone,
  frequencies = ['DAILY', 'WEEKLY', 'MONTHLY'],
  dayLabel = 'Day',
  timeLabel = 'Time',
}: {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  /** Shown after the time's label, when the form has no timezone picker of its own. */
  timezone?: string;
  frequencies?: PluginScheduleKind[];
  dayLabel?: string;
  timeLabel?: string;
}) {
  const set = (patch: Partial<ScheduleValue>) => onChange({ ...value, ...patch });
  return (
    <>
      {frequencies.length > 1 && (
        <label className="field">
          How often
          <select
            value={value.frequency}
            onChange={(e) => set({ frequency: e.target.value as PluginScheduleKind })}
          >
            {frequencies.includes('DAILY') && <option value="DAILY">Daily</option>}
            {frequencies.includes('WEEKLY') && <option value="WEEKLY">Weekly</option>}
            {frequencies.includes('MONTHLY') && <option value="MONTHLY">Monthly</option>}
          </select>
        </label>
      )}
      {value.frequency === 'WEEKLY' && (
        <label className="field">
          {dayLabel}
          <select value={value.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index + 1}>
                {day}
              </option>
            ))}
          </select>
        </label>
      )}
      {value.frequency === 'MONTHLY' && (
        <label className="field">
          Day of the month
          <select
            value={value.dayOfMonth}
            onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}
          >
            {DAYS_OF_MONTH.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
          {value.dayOfMonth > 28 && (
            <small className="muted">Shorter months run on their last day.</small>
          )}
        </label>
      )}
      <label className="field">
        {timeLabel}
        {timezone ? ` (${timezone})` : ''}
        <input
          type="time"
          value={value.timeOfDay}
          onChange={(e) => set({ timeOfDay: e.target.value })}
          required
        />
      </label>
    </>
  );
}
