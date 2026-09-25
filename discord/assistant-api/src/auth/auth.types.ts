import type { Request } from 'express';

export interface SessionUser {
  id: string;
  discordId: string;
  username: string;
  /** Discord's display name, or the username when the account has none. */
  displayName: string;
  avatar: string | null;
}

export type AuthenticatedRequest = Request & { user: SessionUser; sessionToken: string };
