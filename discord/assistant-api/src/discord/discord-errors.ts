import { DiscordAPIError } from '@discordjs/rest';

/** A short, plain-language explanation of a failed Discord call, for officers. */
export function describeDiscordError(error: unknown): string {
  if (error instanceof DiscordAPIError) {
    switch (error.code) {
      case 50013:
        return "The bot is missing a permission for this. Check the bot's role and the channel's permissions.";
      case 50001:
        return 'The bot cannot see that channel or server.';
      case 10003:
        return 'That channel no longer exists.';
      case 10008:
        return 'That message no longer exists.';
      case 10013:
        return 'That user does not exist.';
      case 10007:
        return 'That member is not in the server.';
      default:
        return `Discord refused the request: ${error.message}`;
    }
  }
  if (error instanceof Error && /rate ?limit|429/i.test(error.message)) {
    return 'Discord is rate limiting the bot. Try again shortly.';
  }
  return error instanceof Error ? error.message : String(error);
}

export const isDiscordError = (error: unknown, code: number): boolean =>
  error instanceof DiscordAPIError && error.code === code;

export const UNKNOWN_MESSAGE = 10008;
