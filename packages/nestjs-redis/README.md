# @redredgroup/nestjs-redis

Unpublished integration under development (`0.0.0`). This package provides Redis-backed cache-manager/Keyv caching and an optional, separate atomic Redis module. It does not require applications to share a Redis server or keyspace.

## Application configuration

After building and packing locally, install the generated tarball in your application. No npm release exists yet.

```ts
import { Module } from '@nestjs/common';
import { RedisCacheModule } from '@redredgroup/nestjs-redis';

@Module({
  imports: [
    RedisCacheModule.forRoot({
      url: 'redis://localhost:6379/2',
      namespace: 'example',
      defaultTtlMs: 60_000,
    }),
  ],
})
export class AppModule {}
```

A URL must use `redis://` or `rediss://`; percent-encoded credentials and the database path are passed unchanged to node-redis. Query strings and fragments are rejected. URL configuration cannot be combined with host, port, username, password or database. Use an application-owned secret provider for real credentials.

Host configuration instead accepts:

```ts
RedisCacheModule.forRoot({
  host: 'localhost',
  port: 6379,
  database: 2,
  namespace: 'example',
  // username and password may be supplied by the application.
});
```

The package never loads environment files or depends on ConfigService. The application can use `@nestjs/config`:

```ts
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisCacheModule, type RedisOptions } from '@redredgroup/nestjs-redis';

RedisCacheModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (config: ConfigService): Promise<RedisOptions> => ({
    url: config.getOrThrow<string>('REDIS_URL'),
    namespace: 'example',
    connectTimeoutMs: 5_000,
    commandTimeoutMs: 2_000,
  }),
});
```

Applications own ConfigModule initialization and secret retrieval. Each module registration owns its connection; register once per intended connection and import the registering application module in consumers.

## Cache API and storage

```ts
import { Injectable } from '@nestjs/common';
import { RedisCacheService } from '@redredgroup/nestjs-redis';

@Injectable()
export class ExampleService {
  constructor(private readonly cache: RedisCacheService) {}

  async example() {
    await this.cache.set({ key: 'item', value: { enabled: true }, ttlMs: 1_000 });
    const item = await this.cache.get<{ enabled: boolean }>('item');
    const derived = await this.cache.wrap('derived', async () => ({ count: 1 }), 1_000);
    await this.cache.del('item');
    return { item, derived };
  }
}
```

All TTLs are **milliseconds**. Omitted TTL uses `defaultTtlMs`; its default is `0`, meaning no expiration. An explicit `0` always means no expiration. Negative, fractional and nonfinite TTLs are rejected. A miss returns `undefined`; stored `null` remains `null`. Keys must be nonempty strings. Values must be compatible with Keyv's default serialization. `undefined` is not supported; functions, symbols, cyclic objects and custom class identity are not a portable storage contract. There is no custom serializer or parser.

The storage namespace is `en:<namespace>:cache`; Keyv's own key prefixing is disabled and @keyv/redis owns prefixing. Namespace identifiers accept only ASCII letters, digits, `_` and `-` (1–64 characters), preventing scan pattern injection. The owned adapter's `clear()` uses the official client's namespace-scoped SCAN iterator and awaits bounded UNLINK batches sequentially, never FLUSHDB. It is not a transactional snapshot when concurrent writes occur. Cache entries contain Keyv serialization metadata; do not read or write them with the atomic API. A Redis protocol integration test verifies the exact prefix, TTL and clear behavior before release.

`wrap` uses cache-manager's SDK coalescing for concurrent callers in this process. It does not provide a distributed lock. Its command deadline includes the loader and subsequent cache write; application loaders should have their own cancellation/lifecycle policy. Cache failures have no memory fallback.

## Connection policy, TLS and errors

Startup must connect successfully. Defaults: 5,000 ms total connection deadline, 5,000 ms operation deadline, disabled offline queue, no retries. Optional `reconnect: { attempts: 2, delayMs: 100 }` permits two additional **startup-only** attempts after the initial attempt, separated by 100 ms. The total connection deadline includes every attempt and delay. SDK internal reconnection is always disabled; the package owns the startup waits and cancels them through Node's AbortSignal on deadline or shutdown. After initial success, a connection failure requires a new Nest context; there is no runtime failover or automatic replay of application writes. If the deadline is exceeded, the affected connection is destroyed and stays unusable; recreate the Nest context rather than silently falling back. Shutdown rejects outstanding waits and clears deadline timers. Both shutdown and deadline cancellation also abort pending TCP/TLS socket initialization. A command timeout does not roll back writes already received by Redis.

A timed-out write may already have executed on the server. Destroying its socket **does not undo or guarantee cancellation of that write**. Application-level retries require an idempotency strategy.

For TLS, use `rediss://` or host configuration with `tls: { ca, servername, cert, key }`. These values use Node.js TLS types; CA/certificate material is supplied by the application, never loaded by the library. Certificate verification is always enabled. A rediss URL with `tls: false`, a plain redis URL with TLS options, and unsupported TLS options (including `rejectUnauthorized`) are rejected. Do not disable verification to work around fixture certificates.

Invalid configuration produces `Error('Invalid Redis options')`. Connection and operation failures produce `RedisOperationError('Redis operation failed')`, without an underlying cause or SDK payload. Library code does not log URLs, credentials, keys or values. Configuration factories and loaders are application-owned; applications must sanitize their own logging and exceptions too. The installed cache-manager catches get errors as misses, and wrap silently catches its store reads. Adapter/Keyv error handlers therefore invalidate the connection before those calls return, and wrap checks connection state before invoking the application loader. A transport failure is rejected rather than accepted as a miss or successful clear. The small owned-store subclass overrides the adapter's public getClient and clear methods to prevent reopening a destroyed client and to observe each deletion failure before continuing a scan. Serialization and Redis commands use the SDKs.
