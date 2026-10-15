import type { ConfigService } from '@nestjs/config';
import { APP_CONFIG } from './app.config';

/**
 * The link that adds the bot to a Discord server: `BOT_INVITE_URL` when it is set, otherwise
 * built from the application id with the permissions the bot needs (`APP_CONFIG`). Shown on the
 * public landing page and in the guild setup instructions.
 */
export function botInviteUrl(config: Pick<ConfigService, 'get' | 'getOrThrow'>): string {
  const fromEnv = config.get<string>('BOT_INVITE_URL')?.trim();
  if (fromEnv) return fromEnv;
  const params = new URLSearchParams({
    client_id: config.getOrThrow<string>('DISCORD_APPLICATION_ID'),
    scope: 'bot applications.commands',
    permissions: APP_CONFIG.botInvitePermissions,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
