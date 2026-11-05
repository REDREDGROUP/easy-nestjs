import type { OnModuleDestroy } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { type OperationGuard, RedisOperationError } from './operation-guard';

export interface CacheSetOptions<T> {
  key: string;
  value: T;
  ttlMs?: number;
}

export class RedisCacheService implements OnModuleDestroy {
  constructor(
    private readonly cache: Cache,
    private readonly guard: OperationGuard,
    private readonly defaultTtlMs: number,
    private readonly commandTimeoutMs: number,
  ) {
    for (const event of ['get', 'set', 'del'] as const) {
      cache.on(event, (data?: { error?: unknown }) => {
        if (data?.error) guard.close();
      });
    }
    cache.on('clear', (error: unknown) => {
      if (error) guard.close();
    });
  }

  private key(key: string): string {
    if (typeof key !== 'string' || !key) throw new RedisOperationError();
    return key;
  }

  private ttl(ttlMs = this.defaultTtlMs): number {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 0)
      throw new RedisOperationError();
    return ttlMs;
  }

  async set<T>({ key, value, ttlMs }: CacheSetOptions<T>): Promise<void> {
    if (value === undefined) throw new RedisOperationError();
    await this.guard.run(
      () => this.cache.set(this.key(key), value, this.ttl(ttlMs)),
      this.commandTimeoutMs,
    );
  }

  get<T>(key: string): Promise<T | undefined> {
    return this.guard.run(
      () => this.cache.get<T>(this.key(key)),
      this.commandTimeoutMs,
    );
  }

  async del(key: string): Promise<void> {
    await this.guard.run(
      () => this.cache.del(this.key(key)),
      this.commandTimeoutMs,
    );
  }

  wrap<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    return this.guard.run(
      () =>
        this.cache.wrap(
          this.key(key),
          async () => {
            this.guard.assertOpen();
            const value = await loader();
            this.guard.assertOpen();
            if (value === undefined) throw new RedisOperationError();
            return value;
          },
          this.ttl(ttlMs),
        ),
      this.commandTimeoutMs,
    );
  }

  async clear(): Promise<void> {
    await this.guard.run(() => this.cache.clear(), this.commandTimeoutMs);
  }

  onModuleDestroy(): void {
    this.guard.close();
  }
}
