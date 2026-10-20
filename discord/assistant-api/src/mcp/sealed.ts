import { TokenCrypto } from '../auth/token-crypto';

/**
 * JSON sealed with AES-256-GCM into a URL-safe string, with an expiry: what the MCP OAuth flow
 * hands out instead of storing rows (client ids, consent requests, authorization codes). Only
 * this server can read or forge them. Each `purpose` has its own key, so one kind of value can't
 * be passed off as another.
 */
export class Sealer {
  private readonly crypto: TokenCrypto;

  constructor(secret: string, purpose: string) {
    this.crypto = new TokenCrypto(`${secret}:mcp:${purpose}`);
  }

  seal(value: object, ttlMs?: number): string {
    const payload = { v: value, exp: ttlMs === undefined ? null : Date.now() + ttlMs };
    return Buffer.from(this.crypto.encrypt(JSON.stringify(payload)), 'base64').toString(
      'base64url',
    );
  }

  /** The value, or undefined when it was tampered with, is from another purpose, or expired. */
  open<T>(sealed: string): T | undefined {
    try {
      const json = this.crypto.decrypt(Buffer.from(sealed, 'base64url').toString('base64'));
      const payload = JSON.parse(json) as { v: T; exp: number | null };
      if (payload.exp !== null && payload.exp < Date.now()) return undefined;
      return payload.v;
    } catch {
      return undefined;
    }
  }
}
