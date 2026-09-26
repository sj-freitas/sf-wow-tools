import { useState, type FormEvent } from 'react';
import { createHoneypot } from './api';
import { splitChannelKey } from './channelKey';
import { ChannelSelect } from './ChannelSelect';
import type { Guild, ServerChannels } from './types';

interface Props {
  guild: Guild;
  channels: ServerChannels[];
  onSaved: () => void;
  onCancel: () => void;
}

const DEFAULT_POST =
  '⚠️ **Do not post in this channel.**\nAnyone who posts here is permanently banned.';

export function HoneypotForm({ guild, channels, onSaved, onCancel }: Props) {
  const usable = channels.filter((group) => group.channels.length > 0 || !group.error);
  const [name, setName] = useState('');
  const [serverId, setServerId] = useState(
    guild.servers.find((s) => s.isMain)?.discordId ?? guild.servers[0]?.discordId ?? '',
  );
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [existing, setExisting] = useState('');
  const [newChannelName, setNewChannelName] = useState('do-not-post');
  const [topic, setTopic] = useState('Do not post here. Anyone who does is banned.');
  const [initialPost, setInitialPost] = useState(DEFAULT_POST);
  const [logChannel, setLogChannel] = useState('');
  const [testMode, setTestMode] = useState(true);
  const [confirmLive, setConfirmLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const log = splitChannelKey(logChannel);
    createHoneypot(guild.id, {
      name: name.trim(),
      testMode,
      confirmLive: !testMode && confirmLive,
      serverId,
      ...(mode === 'existing'
        ? { channelId: splitChannelKey(existing).channelId }
        : { newChannelName: newChannelName.trim(), topic }),
      initialPost,
      logServerId: log.serverId,
      logChannelId: log.channelId,
    })
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <form className="card-body task-form" onSubmit={handleSubmit}>
      <h3>New honeypot channel</h3>
      <p className="muted">
        Anyone who posts in this channel is permanently banned, and their messages from the last
        hour are deleted. The bot, other bots, Officers, the server owner and Administrators are
        never touched.
      </p>
      {!guild.officerRole && (
        <p className="status-error">
          The guild has no Officer role yet. Set it under Manage guild → Discord roles first, so
          Officers are never banned.
        </p>
      )}
      <div className="form-grid form-grid-3">
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <label className="field">
          Server
          <select value={serverId} onChange={(e) => setServerId(e.target.value)}>
            {guild.servers.map((server) => (
              <option key={server.discordId} value={server.discordId}>
                {server.name || server.discordId}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Channel
          <select value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'existing')}>
            <option value="new">Create a new channel</option>
            <option value="existing">Use an existing channel</option>
          </select>
        </label>
        {mode === 'new' ? (
          <>
            <label className="field">
              New channel name
              <input
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                maxLength={100}
                placeholder="🍯-do-not-post"
                title="Letters, numbers, emojis, - and _. Discord makes it lower case and turns spaces into hyphens."
                required
              />
              <small className="muted">
                Emojis are fine. Discord lower-cases the name and turns spaces into hyphens.
              </small>
            </label>
            <label className="field field-span-2">
              Channel description (topic)
              <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} />
            </label>
          </>
        ) : (
          <div className="field">
            Existing channel
            <ChannelSelect
              groups={usable}
              onlyServer={serverId}
              value={existing}
              onChange={setExisting}
              required
            />
          </div>
        )}
        <div className="field">
          Log channel (where the bot reports)
          <ChannelSelect groups={usable} value={logChannel} onChange={setLogChannel} required />
        </div>
      </div>

      <label className="field task-text">
        First post in the channel (optional)
        <textarea
          value={initialPost}
          onChange={(e) => setInitialPost(e.target.value)}
          rows={4}
          maxLength={2000}
        />
      </label>

      <div className="mode-box">
        <label className="field-toggle">
          <input
            type="checkbox"
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)}
          />
          Test mode: only report in the log channel what would happen, ban nobody
        </label>
        {!testMode && (
          <label className="field-toggle field-toggle-danger">
            <input
              type="checkbox"
              checked={confirmLive}
              onChange={(e) => setConfirmLive(e.target.checked)}
            />
            I understand this permanently bans people who post in the channel
          </label>
        )}
      </div>

      {error && <p className="status-error">{error}</p>}
      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!guild.officerRole || (!testMode && !confirmLive)}
        >
          Create honeypot
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
