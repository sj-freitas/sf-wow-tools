import { EVENT_KIND_LABELS, type EventKind } from './signupApi';
import { Help } from '../Help';
import { Select } from '../Select';

export const MAX_TITLE = 100;
export const MAX_DESCRIPTION = 2000;

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
          <span className="field-label">
            Type <Help>Can’t be changed later.</Help>
          </span>
          <Select value={value.kind} onChange={(v) => set({ kind: v as EventKind })}>
            <option value="CHARACTERS">{EVENT_KIND_LABELS.CHARACTERS}</option>
            <option value="MEMBERS">{EVENT_KIND_LABELS.MEMBERS}</option>
          </Select>
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
