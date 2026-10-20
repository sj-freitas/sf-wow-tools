import { useMemo } from 'react';
import type { EventKind } from './signupApi';

export const MAX_TITLE = 100;
export const MAX_DESCRIPTION = 2000;

/** Every IANA zone the browser knows (most do), for events not in server time. */
function allTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? ['UTC'];
}

/** What an event says about itself: shared by the event form and Recurring Event plugins. */
export interface EventText {
  kind: EventKind;
  title: string;
  location: string;
  description: string;
}

/** Type (when it can still be picked), name, location and description. */
export function EventTextFields({
  value,
  onChange,
  showKind,
}: {
  value: EventText;
  onChange: (value: EventText) => void;
  showKind: boolean;
}) {
  const set = (patch: Partial<EventText>) => onChange({ ...value, ...patch });
  return (
    <>
      {showKind && (
        <label className="field field-wide">
          Type
          <select value={value.kind} onChange={(e) => set({ kind: e.target.value as EventKind })}>
            <option value="CHARACTERS">
              Characters: sign up with a character and role (raid groups, assignments)
            </option>
            <option value="MEMBERS">Members: sign up as yourself (a list of who is invited)</option>
          </select>
          <small>Can’t be changed later.</small>
        </label>
      )}
      <label className="field field-wide">
        Name
        <input
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          maxLength={MAX_TITLE}
          placeholder="e.g. Molten Core, Warsong Gulch, Guild Meeting"
          required
        />
      </label>
      <label className="field field-wide">
        Location (optional)
        <input
          value={value.location}
          onChange={(e) => set({ location: e.target.value })}
          maxLength={100}
          placeholder="e.g. Naxxramas, or Goldshire inn"
        />
      </label>
      <label className="field field-wide">
        Description
        <textarea
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
          maxLength={MAX_DESCRIPTION}
          rows={5}
          placeholder="Shown in the post. Discord formatting works (**bold**, lists, links)."
        />
        <small>
          {value.description.length} / {MAX_DESCRIPTION}
        </small>
      </label>
    </>
  );
}

/** `ST` (server time), UTC or any zone the browser knows. */
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
      Timezone
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="ST">Server time (ST · {serverTimezone})</option>
        <option value="UTC">UTC</option>
        {zones
          .filter((zone) => zone !== 'UTC')
          .map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
      </select>
      <small>Discord shows everyone the time in their own timezone.</small>
    </label>
  );
}
