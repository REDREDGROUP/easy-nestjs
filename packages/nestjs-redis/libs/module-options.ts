import type { FactoryProvider, ModuleMetadata } from '@nestjs/common';
import type { RedisOptions } from './redis-options';

export interface RedisAsyncOptions {
  imports?: ModuleMetadata['imports'];
  inject?: FactoryProvider['inject'];
  useFactory: FactoryProvider<RedisOptions>['useFactory'];
}
