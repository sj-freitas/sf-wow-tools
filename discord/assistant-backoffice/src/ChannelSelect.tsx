import { channelKey } from './channelKey';
import type { ServerChannels } from './types';

interface Props {
  groups: ServerChannels[];
  /** `serverId:channelId`, or '' when nothing is chosen. */
  value: string;
  onChange: (value: string) => void;
  /** Restrict to one server (by id). */
  onlyServer?: string;
  required?: boolean;
}

/** Channel dropdown grouped by Discord server. */
export function ChannelSelect({ groups, value, onChange, onlyServer, required }: Props) {
  const shown = groups.filter((group) => !onlyServer || group.serverId === onlyServer);
  return (
    <>
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required}>
        <option value="">Choose a channel…</option>
        {shown.map((group) => (
          <optgroup key={group.serverId} label={group.serverName}>
            {group.channels.map((channel) => (
              <option key={channel.id} value={channelKey(group.serverId, channel.id)}>
                #{channel.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {shown
        .filter((group) => group.error)
        .map((group) => (
          <small key={group.serverId} className="status-error">
            {group.serverName}: {group.error}
          </small>
        ))}
    </>
  );
}
