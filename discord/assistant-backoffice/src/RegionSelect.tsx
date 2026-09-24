import type { Region } from './types';

interface Props {
  regions: Region[];
  value: string;
  onChange: (region: string) => void;
}

/** Region picker; the timezone the guild's schedules run in is part of each option. */
export function RegionSelect({ regions, value, onChange }: Props) {
  return (
    <label className="field">
      Region (schedule timezone)
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {regions.map((region) => (
          <option key={region.id} value={region.id}>
            {region.label} ({region.timezone})
          </option>
        ))}
      </select>
    </label>
  );
}
