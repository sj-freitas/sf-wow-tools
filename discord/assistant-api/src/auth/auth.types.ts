import type { Request } from 'express';

export interface SessionUser {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
}

export type AuthenticatedRequest = Request & { user: SessionUser; sessionToken: string };
