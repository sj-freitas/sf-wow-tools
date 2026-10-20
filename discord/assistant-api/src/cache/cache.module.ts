import { Global, Module } from '@nestjs/common';
import { CACHE_STORE, MemoryCacheStore } from './cache-store';
import { CacheService } from './cache.service';

/** The server-side cache. To share it between instances, provide a Redis `CacheStore` here. */
@Global()
@Module({
  providers: [{ provide: CACHE_STORE, useFactory: () => new MemoryCacheStore() }, CacheService],
  exports: [CacheService],
})
export class CacheModule {}
