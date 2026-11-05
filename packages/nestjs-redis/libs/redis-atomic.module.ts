import { type DynamicModule, Module } from '@nestjs/common';
import { createConnection } from './connection';
import type { RedisAsyncOptions } from './module-options';
import { RedisAtomicService } from './redis-atomic.service';
import {
  RedisConnections,
  RedisLifecycleModule,
} from './redis-lifecycle.module';
import type { RedisOptions } from './redis-options';

const OPTIONS = Symbol('REDIS_ATOMIC_OPTIONS');
export class RedisAtomicModule {
  static forRoot(options: RedisOptions): DynamicModule {
    return RedisAtomicModule.forRootAsync({ useFactory: () => options });
  }
  static forRootAsync(options: RedisAsyncOptions): DynamicModule {
    return {
      module: RedisAtomicModule,
      imports: [RedisLifecycleModule, ...(options.imports ?? [])],
      providers: [
        {
          provide: OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        {
          provide: RedisAtomicService,
          useFactory: (input: RedisOptions, registry: RedisConnections) => {
            const connection = createConnection(input);
            registry.register(connection);
            return new RedisAtomicService(connection);
          },
          inject: [OPTIONS, RedisConnections],
        },
      ],
      exports: [RedisAtomicService],
    };
  }
}
Module({})(RedisAtomicModule);
