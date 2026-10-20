/**
 * Where cached values live. The API runs as a single instance today, so the store is in memory
 * (`MemoryCacheStore`); a shared store (e.g. Redis: GET / SET with PX / DEL) can replace it by
 * providing another implementation under `CACHE_STORE` in `CacheModule`. Values are JSON, as they
 * would be in Redis, so nothing relies on sharing objects by reference.
 */
export interface CacheStore {
  /** The value's JSON, or undefined when it isn't there or has expired. */
  get(key: string): Promise<string | undefined>;
  /** Keeps the JSON for `ttlMs`. */
  set(key: string, json: string, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The Nest token the store is provided under. */
export const CACHE_STORE = Symbol('CACHE_STORE');

/** At most this many entries; past it, the ones that expire first go. */
const MAX_ENTRIES = 5000;

/** A `CacheStore` in this process's memory. */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, { json: string; expiresAt: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  get(key: string): Promise<string | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(undefined);
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.json);
  }

  set(key: string, json: string, ttlMs: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { json, expiresAt: this.clock() + ttlMs });
    if (this.entries.size > MAX_ENTRIES) this.evict();
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  /** Drops the expired entries, then (still too many) the ones closest to expiring. */
  private evict(): void {
    const now = this.clock();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    if (this.entries.size <= MAX_ENTRIES) return;
    const soonest = [...this.entries].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key] of soonest.slice(0, this.entries.size - MAX_ENTRIES)) this.entries.delete(key);
  }
}
