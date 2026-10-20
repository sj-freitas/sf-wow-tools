import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_STORE, MemoryCacheStore } from './cache-store';
import { CacheService } from './cache.service';
import { RedisCacheStore } from './redis-cache-store';

/**
 * The server-side cache: in Redis when `REDIS_URL` is set (on Render, shared by the API and the
 * worker), else in this process's memory (local runs, which can't reach Render's Key Value).
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        Logger.log(url ? 'Cache: Redis' : 'Cache: in memory (no REDIS_URL)', 'CacheModule');
        return url ? new RedisCacheStore(url) : new MemoryCacheStore();
      },
    },
    CacheService,
  ],
  exports: [CacheService],
})
export class CacheModule {}
