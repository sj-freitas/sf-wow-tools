import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createHoneypot } from '../api';
import { splitChannelKey } from '../channelKey';
import { ChannelSelect } from '../ChannelSelect';
import { guildPath } from '../guildPath';
import type { Guild } from '../types';
import { useChannels } from '../useChannels';
import { Select } from '../Select';
import { PluginFormFrame } from './PluginFormFrame';

const DEFAULT_POST =
  '⚠️ **Do not post in this channel.**\nAnyone who posts here is permanently banned.';

/**
 * `/plugins/create/honeypot`: a new honeypot channel, in the frame of the other plugins' forms.
 * Honeypots can't be edited, only switched between test and live mode, paused or removed.
 */
export function HoneypotForm({ guild }: { guild: Guild }) {
  const navigate = useNavigate();
  const back = guildPath(guild, 'plugins');
  const { channels } = useChannels(guild.id);
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
  const [busy, setBusy] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
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
      .then(() => navigate(back))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <PluginFormFrame
      title="New Honeypot"
      intro="Anyone who posts in this channel is permanently banned, and their messages from the last hour are deleted. The bot, other bots, Officers, the server owner and Administrators are never touched."
      back={back}
      busy={busy}
      error={error}
      editing={false}
      disabled={!guild.officerRole || (!testMode && !confirmLive)}
      onSubmit={handleSubmit}
    >
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
          <Select value={serverId} onChange={(v) => setServerId(v)}>
            {guild.servers.map((server) => (
              <option key={server.discordId} value={server.discordId}>
                {server.name || server.discordId}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          Channel
          <Select value={mode} onChange={(v) => setMode(v as 'new' | 'existing')}>
            <option value="new">Create a new channel</option>
            <option value="existing">Use an existing channel</option>
          </Select>
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
              check={{ guildId: guild.id, use: 'honeypot' }}
              required
            />
          </div>
        )}
        <div className="field">
          Log channel (where the bot reports)
          <ChannelSelect
            groups={usable}
            value={logChannel}
            onChange={setLogChannel}
            required
            check={{ guildId: guild.id, use: 'post' }}
          />
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
        {/* Always there (usable once test mode is off), so switching mode moves nothing. */}
        <label className="field-toggle field-toggle-danger">
          <input
            type="checkbox"
            checked={confirmLive && !testMode}
            disabled={testMode}
            onChange={(e) => setConfirmLive(e.target.checked)}
          />
          I understand this permanently bans people who post in the channel
        </label>
      </div>
    </PluginFormFrame>
  );
}
