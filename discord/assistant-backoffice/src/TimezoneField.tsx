import { useMemo } from 'react';
import { Help } from './Help';
import { Select } from './Select';

/** Every IANA zone the browser knows (most do), for events not in server time. */
function allTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? ['UTC'];
}

/**
 * The timezone a form's times are written in: `ST` (the guild's server time), UTC or any zone the
 * browser knows. Used by every form with a time (events, posts, plugins).
 */
export function TimezoneField({
  value,
  onChange,
  serverTimezone,
}: {
  value: string;
  onChange: (value: string) => void;
  serverTimezone: string;
}) {
  const zones = useMemo(allTimezones, []);
  return (
    <label className="field">
      <span className="field-label">
        Timezone <Help>Discord shows everyone the time in their own timezone.</Help>
      </span>
      <Select
        value={value}
        onChange={(v) => onChange(v)}
        searchable
        searchPlaceholder="Search timezones… (e.g. new york)"
      >
        <option value="ST">Server time (ST · {serverTimezone})</option>
        <option value="UTC">UTC</option>
        {zones
          .filter((zone) => zone !== 'UTC')
          .map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
      </Select>
    </label>
  );
}
