import type { OnModuleDestroy } from '@nestjs/common';
import { COMPARE_DELETE, INCREMENT_WITH_EXPIRY } from './atomic-scripts';
import type { RedisConnection } from './connection';
import { RedisOperationError } from './operation-guard';

export class RedisAtomicService implements OnModuleDestroy {
  constructor(private readonly connection: RedisConnection) {}

  private key(key: string): string {
    if (typeof key !== 'string' || !key) throw new RedisOperationError();
    return `en:${this.connection.options.namespace}:atomic:${key}`;
  }

  private expiry(ttlMs: number): number {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)
      throw new RedisOperationError();
    return ttlMs;
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    return this.connection.guard.run(
      operation,
      this.connection.options.commandTimeoutMs ?? 5_000,
    );
  }

  async setIfAbsent(
    key: string,
    value: string,
    ttlMs: number,
  ): Promise<boolean> {
    return (
      (await this.run(() =>
        this.connection.client.set(this.key(key), value, {
          NX: true,
          PX: this.expiry(ttlMs),
        }),
      )) === 'OK'
    );
  }

  getDel(key: string): Promise<string | null> {
    return this.run(() => this.connection.client.getDel(this.key(key)));
  }

  async compareDelete(key: string, owner: string): Promise<boolean> {
    return (await this.evalTrusted(COMPARE_DELETE, [key], [owner])) === 1;
  }

  async incrementWithExpiry(key: string, ttlMs: number): Promise<number> {
    const result = await this.evalTrusted(
      INCREMENT_WITH_EXPIRY,
      [key],
      [String(this.expiry(ttlMs))],
    );
    if (typeof result !== 'number' || !Number.isSafeInteger(result))
      throw new RedisOperationError();
    return result;
  }

  /** Only application-trusted scripts: prefixing is not a Lua security sandbox. */
  evalTrusted(
    script: string,
    keys: readonly string[],
    arguments_: readonly string[] = [],
  ): Promise<unknown> {
    return this.run(() =>
      this.connection.client.eval(script, {
        keys: keys.map((key) => this.key(key)),
        arguments: [...arguments_],
      }),
    );
  }

  onModuleDestroy(): void {
    this.connection.guard.close();
  }
}
