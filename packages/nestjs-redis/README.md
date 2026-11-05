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

## Optional atomic operations

```ts
import { RedisAtomicModule, RedisAtomicService } from '@redredgroup/nestjs-redis/atomic';

RedisAtomicModule.forRoot({ host: 'localhost', namespace: 'example' });
// forRootAsync has the same imports/inject/useFactory contract as RedisCacheModule.

// Inject RedisAtomicService into an application provider:
async function example(redis: RedisAtomicService) {
  const acquired = await redis.setIfAbsent('lease', 'unique-owner-token', 5_000);
  const released = await redis.compareDelete('lease', 'unique-owner-token');
  const consumed = await redis.getDel('one-shot');
  const count = await redis.incrementWithExpiry('counter', 60_000);
  return { acquired, released, consumed, count };
}
```

These operations use raw Redis strings under `en:<namespace>:atomic:`. SET NX PX, GETDEL, owner-checked Lua deletion and INCR/PEXPIRE Lua execute atomically on Redis. Atomic expiry must be a positive integer in milliseconds. The counter's expiry starts when its value first reaches 1 and is not extended on subsequent increments; reserve its key for this operation. Numbers outside JavaScript's safe integer range are rejected. A simple lease is **not a fencing guarantee**; owners can pause beyond expiry.

`evalTrusted(script, keys, arguments)` is a small escape hatch for application-trusted Lua. Declared keys receive the atomic prefix. Lua can construct other keys or invoke other commands: this is not a sandbox, so use Redis ACLs and never accept scripts from untrusted input. Results are the SDK's raw Lua result (`unknown`), with no parser. Cluster cross-slot operation is not supported. Authentication, OTP/HMAC policy, permission decisions and business thresholds belong in the application.

The cache-only module opens one connection. Importing the atomic module adds one independently owned connection. Both modules may target different servers/databases. Importing the atomic entry does not start a connection; registering its module does. Nest `close()` destroys each owned connection. Both module entries share one context-local initialization transaction: configuration factories finish before sockets open, and if one Redis connection fails, every Redis connection registered in that context is destroyed. No client is borrowed from the application. An SDK adapter may allocate an unused client object internally, but it never connects it.

This transaction covers this package's own connection initialization. It cannot roll back unrelated application providers or intercept later failures in application lifecycle hooks. Applications must close their Nest application when `init()` or `listen()` fails. In particular, NestFactory's application-context API does not return a context if an unrelated later hook throws. Do not rely on this package to provide application-wide startup rollback.

## Connection policy, TLS and errors

Startup must connect successfully. Defaults: 5,000 ms total connection deadline, 5,000 ms operation deadline, disabled offline queue, no retries. Optional `reconnect: { attempts: 2, delayMs: 100 }` permits two additional **startup-only** attempts after the initial attempt, separated by 100 ms. The total connection deadline includes every attempt and delay. SDK internal reconnection is always disabled; the package owns the startup waits and cancels them through Node's AbortSignal on deadline or shutdown. After initial success, a connection failure requires a new Nest context; there is no runtime failover or automatic replay of application writes. If the deadline is exceeded, the affected connection is destroyed and stays unusable; recreate the Nest context rather than silently falling back. Shutdown rejects outstanding waits and clears deadline timers. Both shutdown and deadline cancellation also abort pending TCP/TLS socket initialization. A command timeout does not roll back writes already received by Redis.

A timed-out write may already have executed on the server. Destroying its socket **does not undo or guarantee cancellation of that write**. Application-level retries require an idempotency strategy.

For TLS, use `rediss://` or host configuration with `tls: { ca, servername, cert, key }`. These values use Node.js TLS types; CA/certificate material is supplied by the application, never loaded by the library. Certificate verification is always enabled. A rediss URL with `tls: false`, a plain redis URL with TLS options, and unsupported TLS options (including `rejectUnauthorized`) are rejected. Do not disable verification to work around fixture certificates.

Invalid configuration produces `Error('Invalid Redis options')`. Connection and operation failures produce `RedisOperationError('Redis operation failed')`, without an underlying cause or SDK payload. Library code does not log URLs, credentials, keys or values. Configuration factories and loaders are application-owned; applications must sanitize their own logging and exceptions too. The installed cache-manager catches get errors as misses, and wrap silently catches its store reads. Adapter/Keyv error handlers therefore invalidate the connection before those calls return, and wrap checks connection state before invoking the application loader. A transport failure is rejected rather than accepted as a miss or successful clear. The small owned-store subclass overrides the adapter's public getClient and clear methods to prevent reopening a destroyed client and to observe each deletion failure before continuing a scan. Serialization and Redis commands use the SDKs.

## Local verification

From the workspace root with Node.js 24.13.0 and pnpm 10.11.1:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @redredgroup/nestjs-redis test
pnpm --filter @redredgroup/nestjs-redis lint
pnpm --filter @redredgroup/nestjs-redis type-check
pnpm --filter @redredgroup/nestjs-redis build:production
REDIS_PACK_DIR="$(mktemp -d)"
pnpm --filter @redredgroup/nestjs-redis exec pnpm pack --pack-destination "$REDIS_PACK_DIR"
export REDIS_TEST_TARBALL="$REDIS_PACK_DIR/redredgroup-nestjs-redis-0.0.0.tgz"
```

`test` builds the CommonJS package and runs Node tests against the compiled exports. Package checks do not publish to npm.

Supply disposable loopback fixtures through the operator environment, never a local credential file:

| Variable | Contract |
| --- | --- |
| `REDIS_TEST_URL` | Explicit redis:// URL using localhost, 127.0.0.1 or ::1. A nonzero database is required by test:integration; auth and consumer tests preserve the supplied URL database. Password optional for general protocol tests. |
| `REDIS_TEST_CLOSED_PORT` | Operator-reserved unused loopback port for connection failure verification. |
| `REDIS_TEST_TLS_URL` | Separate rediss:// loopback fixture URL. |
| `REDIS_TEST_TLS_CA` | Path to the fixture's public private-CA certificate, not trusted by the system store. |
| `REDIS_TEST_TLS_SERVERNAME` | Optional certificate SAN match; defaults to localhost. |
| `REDIS_TEST_TARBALL` | Absolute path to the generated local tarball. |

Run sequentially against isolated fixtures with no other clients joining/leaving:

```bash
pnpm --filter @redredgroup/nestjs-redis test:integration
pnpm --filter @redredgroup/nestjs-redis test:auth
pnpm --filter @redredgroup/nestjs-redis test:tls
pnpm --filter @redredgroup/nestjs-redis test:consumer
```

`test:integration` supports a server without a user/password and still checks invalid AUTH rejection. It covers JSON roundtrip, null/miss, TTL, wrap, namespace clear isolation, atomic contention/expiry/ownership, raw/JSON separation, URL database selection, unavailable port and connection counts after close. Its user needs the tested data/Lua commands and CLIENT LIST.

`test:auth` separately requires a **password-protected** disposable fixture and an explicit password in `REDIS_TEST_URL`. It checks authenticated success and incorrect/missing password rejection. Without this input it fails; general no-password protocol success does not count as authentication verification. An operator may configure a synthetic password on the disposable fixture and rerun with that URL. The library/tests never configure server authentication themselves.

`test:tls` checks trusted CA roundtrip, missing trust, hostname mismatch and downgrade rejection. No test starts Redis or Docker. Required missing input fails rather than becoming a successful skip.

`test:consumer` installs the tarball into a fresh directory under the operating system temporary directory, checks CommonJS/dynamic-import exports, compiles a strict Node16-resolution TypeScript consumer without skipLibCheck, and bootstraps/closes actual Nest constructor injection against the explicit loopback fixture. It needs registry access for consumer dependencies. Temporary artifacts remain available for inspection. Failures report the verification stage without printing fixture credentials or provider payloads.
