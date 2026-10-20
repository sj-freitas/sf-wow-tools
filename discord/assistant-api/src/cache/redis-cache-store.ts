import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import type { CacheStore } from './cache-store';

/**
 * A `CacheStore` in Redis (Render Key Value), shared by every API instance and the worker. It is
 * only a cache: while Redis is unreachable, reads miss and writes are skipped (logged) instead of
 * failing the request, and commands fail fast rather than queueing until it is back.
 */
export class RedisCacheStore implements CacheStore, OnApplicationShutdown {
  private readonly logger = new Logger(RedisCacheStore.name);
  private readonly client: Redis;
  private down = false;

  constructor(url: string) {
    this.client = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    // Log once when the connection drops and once when it is back, not on every retry.
    this.client.on('error', (error: Error) => {
      if (this.down) return;
      this.down = true;
      this.logger.warn(`Redis unreachable, caching is skipped until it is back: ${error.message}`);
    });
    this.client.on('ready', () => {
      if (this.down) this.logger.log('Redis is back');
      this.down = false;
    });
  }

  async get(key: string): Promise<string | undefined> {
    try {
      return (await this.client.get(key)) ?? undefined;
    } catch (error) {
      this.logger.debug(`get ${key} failed: ${String(error)}`);
      return undefined;
    }
  }

  async set(key: string, json: string, ttlMs: number): Promise<void> {
    try {
      await this.client.set(key, json, 'PX', Math.max(1, Math.round(ttlMs)));
    } catch (error) {
      this.logger.debug(`set ${key} failed: ${String(error)}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.warn(`delete ${key} failed, it stays until it expires: ${String(error)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
