const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { fixture } = require('./fixture.cjs');
let phase = 'fixture preconditions';

async function main() {
  const options = fixture();
  const parsed = new URL(options.url);
  assert(
    Number(parsed.pathname.slice(1)) > 0,
    'A nonzero disposable database is required',
  );
  const port = Number(process.env.REDIS_TEST_CLOSED_PORT);
  assert(
    Number.isInteger(port) && port > 0 && port <= 65535,
    'REDIS_TEST_CLOSED_PORT is required',
  );
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { Module } = require('@nestjs/common');
  const { createClient } = require('@redis/client');
  const { RedisCacheModule, RedisCacheService } = require('../dist/index.js');
  const {
    RedisAtomicModule,
    RedisAtomicService,
  } = require('../dist/atomic.js');
  const contexts = [];
  const context = async (module) => {
    const app = await NestFactory.createApplicationContext(module, {
      logger: false,
      abortOnError: false,
    });
    contexts.push(app);
    return app;
  };
  const CONFIG = Symbol('TEST_CONFIG');
  class Configuration {}
  Module({
    providers: [{ provide: CONFIG, useValue: options }],
    exports: [CONFIG],
  })(Configuration);
  class Root {}
  Module({
    imports: [
      RedisCacheModule.forRootAsync({
        imports: [Configuration],
        inject: [CONFIG],
        useFactory: async (config) => config,
      }),
      RedisAtomicModule.forRoot(options),
    ],
  })(Root);
  const raw = createClient({
    url: options.url,
    socket: { reconnectStrategy: false, connectTimeout: 1000 },
    disableOfflineQueue: true,
  });
  raw.on('error', () => {});
  try {
    phase = 'raw fixture connection and Nest bootstrap';
    await raw.connect();
    const initialConnections = (await raw.clientList()).length;
    const app = await context(Root);
    assert.equal((await raw.clientList()).length, initialConnections + 2);
    const cache = app.get(RedisCacheService);
    const atomic = app.get(RedisAtomicService);
    const otherApp = await context(
      RedisCacheModule.forRoot({
        ...options,
        namespace: `${options.namespace}_other`,
        defaultTtlMs: 40,
      }),
    );
    const other = otherApp.get(RedisCacheService);
    assert.equal((await raw.clientList()).length, initialConnections + 3);
    phase = 'cache roundtrip, TTL and wrap';
    await other.set({ key: 'default-ttl', value: 'expires' });
    assert.equal(await cache.get('missing'), undefined);
    await cache.set({ key: 'json', value: { count: 2 } });
    assert.deepEqual(await cache.get('json'), { count: 2 });
    await cache.set({ key: 'null', value: null, ttlMs: 0 });
    assert.equal(await cache.get('null'), null);
    assert.equal(await raw.pTTL(`en:${options.namespace}:cache:null`), -1);
    await cache.set({ key: 'expires', value: 'value', ttlMs: 40 });
    await delay(100);
    assert.equal(await cache.get('expires'), undefined);
    assert.equal(await other.get('default-ttl'), undefined);
    let loads = 0;
    assert.deepEqual(
      await Promise.all(
        Array.from({ length: 10 }, () =>
          cache.wrap(
            'wrapped',
            async () => {
              loads++;
              await delay(10);
              return 'loaded';
            },
            1000,
          ),
        ),
      ),
      Array(10).fill('loaded'),
    );
    assert.equal(loads, 1);
    phase = 'atomic contention, owner comparison and expiry';
    const winners = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        atomic.setIfAbsent('lease', `owner${i}`, 1000),
      ),
    );
    assert.equal(winners.filter(Boolean).length, 1);
    const winner = winners.findIndex(Boolean);
    assert.equal(await atomic.compareDelete('lease', 'wrong'), false);
    assert.equal(await atomic.compareDelete('lease', `owner${winner}`), true);
    assert.equal(await atomic.setIfAbsent('expires', 'raw', 40), true);
    await delay(100);
    assert.equal(await atomic.getDel('expires'), null);
    assert.equal(await atomic.setIfAbsent('json', 'raw-string', 1000), true);
    assert.deepEqual(await cache.get('json'), { count: 2 });
    assert.equal(await atomic.getDel('json'), 'raw-string');
    assert.equal(await atomic.getDel('json'), null);
    const counters = await Promise.all(
      Array.from({ length: 10 }, () =>
        atomic.incrementWithExpiry('counter', 600),
      ),
    );
    assert.equal(new Set(counters).size, 10);
    assert.equal(Math.max(...counters), 10);
    await delay(700);
    assert.equal(await atomic.incrementWithExpiry('counter', 600), 1);
    phase = 'namespace clear isolation';
    await other.set({ key: 'survivor', value: true, ttlMs: 0 });
    await cache.clear();
    assert.equal(await cache.get('json'), undefined);
    assert.equal(await other.get('survivor'), true);
    assert.equal(await atomic.incrementWithExpiry('counter', 600), 2);
    phase = 'invalid password and unavailable port';
    const wrong = new URL(options.url);
    wrong.password = 'deliberately-invalid-fixture-password';
    await assert.rejects(
      context(RedisCacheModule.forRoot({ ...options, url: wrong.toString() })),
      { message: 'Redis operation failed' },
    );
    await assert.rejects(
      context(
        RedisAtomicModule.forRoot({
          host: '127.0.0.1',
          port,
          namespace: options.namespace,
          connectTimeoutMs: 100,
        }),
      ),
      { message: 'Redis operation failed' },
    );
    await other.clear();
    await atomic.getDel('counter');
    phase = 'shutdown and connection ownership';
    await app.close();
    await delay(20);
    assert.equal((await raw.clientList()).length, initialConnections + 1);
    await otherApp.close();
    await delay(20);
    assert.equal((await raw.clientList()).length, initialConnections);
    await assert.rejects(cache.get('after-close'), {
      message: 'Redis operation failed',
    });
    await assert.rejects(atomic.getDel('after-close'), {
      message: 'Redis operation failed',
    });
    console.log(
      'PASS: real Redis cache, atomic contention, isolation, URL database, wrong password, unavailable port, shutdown. Authenticated success additionally requires test:auth.',
    );
  } finally {
    for (const app of contexts.reverse()) await app.close();
    if (raw.isOpen) raw.destroy();
  }
}
main().catch(() => {
  console.error(
    `FAIL: Redis integration during ${phase}; requires a disposable loopback Redis with nonzero database and REDIS_TEST_CLOSED_PORT`,
  );
  process.exitCode = 1;
});
