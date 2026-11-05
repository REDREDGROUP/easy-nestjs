import { type DynamicModule, Module } from '@nestjs/common';
import { createCache } from 'cache-manager';
import Keyv from 'keyv';
import { createConnection } from './connection';
import type { RedisAsyncOptions } from './module-options';
import { OwnedRedisStore } from './owned-redis-store';
import { RedisCacheService } from './redis-cache.service';
import {
  RedisConnections,
  RedisLifecycleModule,
} from './redis-lifecycle.module';
import type { RedisOptions } from './redis-options';

const OPTIONS = Symbol('REDIS_CACHE_OPTIONS');

function createService(
  input: RedisOptions,
  registry: RedisConnections,
): RedisCacheService {
  const connection = createConnection(input);
  registry.register(connection);
  const store = new OwnedRedisStore(connection);
  const keyv = new Keyv({
    store,
    namespace: store.namespace,
    useKeyPrefix: false,
    throwOnErrors: true,
  });
  keyv.on('error', () => {
    if (connection.initialized) connection.guard.close();
  });
  const cache = createCache({ stores: [keyv] });
  return new RedisCacheService(
    cache,
    connection.guard,
    connection.options.defaultTtlMs ?? 0,
    connection.options.commandTimeoutMs ?? 5_000,
  );
}

export class RedisCacheModule {
  static forRoot(options: RedisOptions): DynamicModule {
    return RedisCacheModule.forRootAsync({ useFactory: () => options });
  }

  static forRootAsync(options: RedisAsyncOptions): DynamicModule {
    return {
      module: RedisCacheModule,
      imports: [RedisLifecycleModule, ...(options.imports ?? [])],
      providers: [
        {
          provide: OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        {
          provide: RedisCacheService,
          useFactory: createService,
          inject: [OPTIONS, RedisConnections],
        },
      ],
      exports: [RedisCacheService],
    };
  }
}
Module({})(RedisCacheModule);
