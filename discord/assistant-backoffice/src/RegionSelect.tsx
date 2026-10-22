import type { Region } from './types';
import { Select } from './Select';

interface Props {
  regions: Region[];
  value: string;
  onChange: (region: string) => void;
}

/**
 * Region picker: just the region's name. Its timezone (the guild's schedules run in it) comes with
 * the region and isn't shown here.
 */
export function RegionSelect({ regions, value, onChange }: Props) {
  return (
    <label className="field">
      Region
      <Select value={value} onChange={(v) => onChange(v)}>
        {regions.map((region) => (
          <option key={region.id} value={region.id}>
            {region.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
