import type { Honeypot } from '../types';
import type { useChannels } from '../useChannels';

/**
 * Honeypot, shown as one of the plugins: in the Plugins page's catalog and among the guild's
 * plugins. It keeps its own data and API (/api/guilds/:guildId/honeypots, /api/honeypots/:id),
 * so the API's plugin kinds don't list it; the backoffice adds it here.
 */
export const HONEYPOT_KIND = {
  /** `plugins/create/honeypot`. */
  path: 'honeypot',
  label: 'Honeypot',
  description:
    'A channel where anyone who posts is permanently banned (spam bots), their messages from the last hour deleted. Starts in test mode, which only reports what it would do.',
};

/** Its card's summary line: the channel, and where it reports (which may be another server's). */
export function honeypotSummary(
  honeypot: Honeypot,
  { channels, channelName }: ReturnType<typeof useChannels>,
): string {
  const channel = channelName(honeypot.serverId, honeypot.channelId) ?? honeypot.channelId;
  const log =
    channelName(honeypot.serverId, honeypot.logChannelId) ??
    channels.flatMap((group) => group.channels).find((c) => c.id === honeypot.logChannelId)?.name ??
    honeypot.logChannelId;
  return `#${channel}${honeypot.createdChannel ? ' (created by the bot)' : ''} · logs to #${log}`;
}
