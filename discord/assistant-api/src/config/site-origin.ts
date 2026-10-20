import type { ConfigService } from '@nestjs/config';

const DEFAULT_SITE = 'https://guildassistant.app';

/**
 * The website's address, for links the bot puts in Discord: `SITE_URL`, else the origin of the
 * OAuth redirect (the site the API serves), else the production site. The worker may run without
 * the login settings, hence the last fallback.
 */
export function siteOrigin(config: ConfigService): string {
  const explicit = config.get<string>('SITE_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  const redirect = config.get<string>('DISCORD_OAUTH_REDIRECT_URI');
  if (redirect) {
    try {
      return new URL(redirect).origin;
    } catch {
      // Fall through to the default.
    }
  }
  return DEFAULT_SITE;
}
