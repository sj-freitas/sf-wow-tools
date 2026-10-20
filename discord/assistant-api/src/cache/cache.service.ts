import { Inject, Injectable } from '@nestjs/common';
import { CACHE_STORE, type CacheStore } from './cache-store';

/**
 * A short-lived server-side cache for things that are slow or rate-limited to fetch (Discord's
 * channel lists, …). Values must be JSON-serialisable. Whatever stores them (`CacheStore`), loads
 * of one key that overlap in this process share a single fetch.
 */
@Injectable()
export class CacheService {
  private readonly loading = new Map<string, Promise<unknown>>();

  constructor(@Inject(CACHE_STORE) private readonly store: CacheStore) {}

  async get<T>(key: string): Promise<T | undefined> {
    const json = await this.store.get(key);
    return json === undefined ? undefined : (JSON.parse(json) as T);
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.store.set(key, JSON.stringify(value), ttlMs);
  }

  async delete(key: string): Promise<void> {
    await this.store.delete(key);
  }

  /** The cached value, or `load()`'s, which is then kept for `ttlMs`. A failed load isn't kept. */
  async getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;
    const pending = this.loading.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const run = (async () => {
      const value = await load();
      await this.set(key, value, ttlMs);
      return value;
    })().finally(() => this.loading.delete(key));
    this.loading.set(key, run);
    return run;
  }
}
