/** Messages this recent are deleted together with the ban. */
export const BAN_DELETE_SECONDS = 60 * 60;

export interface HoneypotAuthor {
  userId: string;
  /** The Guild Assistant bot itself. */
  botUserId: string;
  isBot: boolean;
  isServerOwner: boolean;
  isAdministrator: boolean;
  /** The author's role ids in the guild's main server (where the Officer role lives). */
  mainServerRoleIds: readonly string[];
}

export type HoneypotDecision =
  { action: 'IGNORE' | 'EXEMPT'; reason: string } | { action: 'WOULD_BAN' | 'BAN' };

/**
 * What to do about someone who posted in a honeypot channel. The bot itself, other bots,
 * the guild's Officers, the server owner and Administrators are never touched. In test mode
 * the outcome is WOULD_BAN: it is only logged.
 */
export function decideHoneypot(
  author: HoneypotAuthor,
  officerRoleId: string | null,
  testMode: boolean,
): HoneypotDecision {
  if (author.userId === author.botUserId) return { action: 'IGNORE', reason: 'the bot itself' };
  if (author.isBot) return { action: 'IGNORE', reason: 'a bot' };
  if (officerRoleId && author.mainServerRoleIds.includes(officerRoleId)) {
    return { action: 'EXEMPT', reason: 'an Officer' };
  }
  if (author.isServerOwner) return { action: 'EXEMPT', reason: 'the server owner' };
  if (author.isAdministrator) return { action: 'EXEMPT', reason: 'an Administrator' };
  return { action: testMode ? 'WOULD_BAN' : 'BAN' };
}
