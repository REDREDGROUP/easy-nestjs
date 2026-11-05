require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const sdk = require('@redis/client');
const { RedisCacheModule, RedisCacheService } = require('../dist/index.js');
const { RedisAtomicModule, RedisAtomicService } = require('../dist/atomic.js');
const options = {
  host: 'localhost',
  namespace: 'unit',
  connectTimeoutMs: 20,
  commandTimeoutMs: 20,
};
const start = (module) =>
  NestFactory.createApplicationContext(module, {
    logger: false,
    abortOnError: false,
  });

// Only transport is replaced: actual SDK clients, adapters, Keyv, cache-manager,
// built package exports and Nest providers are used. No Redis server is contacted.
function transport(context, behavior = async () => {}) {
  const original = sdk.createClient;
  const clients = [];
  let connections = 0;
  context.mock.method(sdk, 'createClient', (config) => {
    const client = original(config);
    const connect = context.mock.method(client, 'connect', () =>
      behavior(connections++, client),
    );
    const destroy = context.mock.method(client, 'destroy', () => {});
    context.mock.getter(client, 'isOpen', () => true);
    clients.push({ client, config, connect, destroy });
    return client;
  });
  return clients;
}

function root(imports) {
  class Root {}
  Module({ imports })(Root);
  return Root;
}

test('cache-only async factory/injection initializes exactly one client and shutdown closes it', async (context) => {
  const clients = transport(context);
  const CONFIG = Symbol('configuration');
  class Config {}
  Module({
    providers: [{ provide: CONFIG, useValue: options }],
    exports: [CONFIG],
  })(Config);
  let factories = 0;
  const app = await start(
    RedisCacheModule.forRootAsync({
      imports: [Config],
      inject: [CONFIG],
      useFactory: async (value) => {
        factories++;
        return value;
      },
    }),
  );
  try {
    assert(app.get(RedisCacheService) instanceof RedisCacheService);
    assert.equal(factories, 1);
    const selected = clients.filter(
      ({ connect }) => connect.mock.callCount() > 0,
    );
    assert.equal(selected.length, 1);
    assert.equal(clients[0].connect.mock.callCount(), 1);
  } finally {
    await app.close();
  }
  assert.equal(clients[0].destroy.mock.callCount(), 1);
  await assert.rejects(app.get(RedisCacheService).get('after-close'));
});

test('cache plus atomic share startup transaction, own two clients and clean both on startup failure', async (context) => {
  const clients = transport(context, async (index) => {
    if (index === 1) throw new Error('redis://secret/payload');
  });
  let app;
  try {
    await assert.rejects(
      async () => {
        app = await start(
          root([
            RedisCacheModule.forRoot(options),
            RedisAtomicModule.forRoot(options),
          ]),
        );
      },
      { message: 'Redis operation failed' },
    );
    const selected = clients.filter(
      ({ connect }) => connect.mock.callCount() > 0,
    );
    assert.equal(selected.length, 2);
    assert.equal(clients[0].connect.mock.callCount(), 1);
    assert.equal(selected[1].connect.mock.callCount(), 1);
    assert.deepEqual(
      clients
        .filter(({ connect }) => connect.mock.callCount() > 0)
        .map(({ destroy }) => destroy.mock.callCount()),
      [1, 1],
    );
  } finally {
    if (app) await app.close();
  }
});

test('successful cache plus atomic initialization has two clients and closes both', async (context) => {
  const clients = transport(context);
  const app = await start(
    root([
      RedisCacheModule.forRoot(options),
      RedisAtomicModule.forRoot(options),
    ]),
  );
  try {
    assert(app.get(RedisAtomicService) instanceof RedisAtomicService);
    const selected = clients.filter(
      ({ connect }) => connect.mock.callCount() > 0,
    );
    assert.equal(selected.length, 2);
    assert.deepEqual(
      clients
        .filter(({ connect }) => connect.mock.callCount() > 0)
        .map(({ connect }) => connect.mock.callCount()),
      [1, 1],
    );
  } finally {
    await app.close();
  }
  assert.deepEqual(
    clients
      .filter(({ connect }) => connect.mock.callCount() > 0)
      .map(({ destroy }) => destroy.mock.callCount()),
    [1, 1],
  );
});

test('startup deadline destroys the client even when connect never settles', async (context) => {
  const clients = transport(context, () => new Promise(() => {}));
  let app;
  try {
    await assert.rejects(
      async () => {
        app = await start(RedisAtomicModule.forRoot(options));
      },
      { message: 'Redis operation failed' },
    );
    assert.equal(clients[0].destroy.mock.callCount(), 1);
  } finally {
    if (app) await app.close();
  }
});

test('node-redis receives intact URL, disabled native retries and verified TLS', async (context) => {
  const clients = transport(context);
  const url = 'rediss://user:p%40ss@localhost:6379/2';
  const app = await start(
    RedisAtomicModule.forRoot({
      namespace: 'unit',
      url,
      tls: { servername: 'localhost' },
      reconnect: { attempts: 2, delayMs: 10 },
    }),
  );
  try {
    const config = clients[0].config;
    assert(config, 'SDK configuration must be supplied');
    assert.equal(config.url, url);
    assert.equal(config.disableOfflineQueue, true);
    assert.equal(config.socket.rejectUnauthorized, true);
    assert.equal(config.socket.tls, true);
    assert.equal(config.socket.reconnectStrategy, false);
  } finally {
    await app.close();
  }
});

for (const operation of ['get', 'set', 'del', 'clear', 'wrap']) {
  test(`real adapter/cache-manager ${operation} transport failure rejects safely and closes owned client`, async (context) => {
    const clients = transport(context);
    const app = await start(RedisCacheModule.forRoot(options));
    const selected = clients.find(
      ({ connect }) => connect.mock.callCount() > 0,
    );
    const failure = async () => {
      throw new Error('redis://secret/key/value/provider-payload');
    };
    for (const method of ['get', 'set', 'unlink', 'scan'])
      context.mock.method(selected.client, method, failure);
    let loaders = 0;
    const cache = app.get(RedisCacheService);
    const run = {
      get: () => cache.get('key'),
      set: () => cache.set({ key: 'key', value: 'secret' }),
      del: () => cache.del('key'),
      clear: () => cache.clear(),
      wrap: () =>
        cache.wrap('key', async () => {
          loaders++;
          return 'value';
        }),
    };
    try {
      await assert.rejects(run[operation](), (error) => {
        assert.equal(error.message, 'Redis operation failed');
        assert.equal(error.cause, undefined);
        assert(!error.stack.includes('provider-payload'));
        return true;
      });
      assert.equal(loaders, 0);
      assert.equal(selected.destroy.mock.callCount(), 1);
      await assert.rejects(cache.get('after-failure'));
    } finally {
      await app.close();
    }
  });
}

test('command deadline closes the cache and refuses subsequent reconnect attempts', async (context) => {
  const clients = transport(context);
  const app = await start(RedisCacheModule.forRoot(options));
  const selected = clients.find(({ connect }) => connect.mock.callCount() > 0);
  context.mock.method(selected.client, 'get', () => new Promise(() => {}));
  try {
    await assert.rejects(app.get(RedisCacheService).get('pending'), {
      message: 'Redis operation failed',
    });
    assert.equal(selected.destroy.mock.callCount(), 1);
    await assert.rejects(app.get(RedisCacheService).get('after-timeout'));
    assert.equal(selected.connect.mock.callCount(), 1);
  } finally {
    await app.close();
  }
});

test('adapter cannot reopen an owned socket after a late scan completes past the deadline', async (context) => {
  const clients = transport(context);
  const app = await start(RedisCacheModule.forRoot(options));
  const selected = clients.find(({ connect }) => connect.mock.callCount() > 0);
  let resolveScan;
  context.mock.method(
    selected.client,
    'scan',
    () =>
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
  );
  let open = true;
  context.mock.getter(selected.client, 'isOpen', () => open);
  context.mock.method(selected.client, 'destroy', () => {
    open = false;
  });
  try {
    const pending = app.get(RedisCacheService).clear();
    await assert.rejects(pending, { message: 'Redis operation failed' });
    assert.equal(open, false);
    resolveScan({ cursor: '0', keys: ['en:unit:cache:late'] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(selected.connect.mock.callCount(), 1);
  } finally {
    await app.close();
  }
});

test('configuration factory failure happens before any Redis socket is opened', async (context) => {
  const clients = transport(context);
  await assert.rejects(
    start(
      root([
        RedisCacheModule.forRoot(options),
        RedisAtomicModule.forRootAsync({
          useFactory: async () => {
            throw new Error('Application configuration failed');
          },
        }),
      ]),
    ),
    { message: 'Application configuration failed' },
  );
  assert.equal(
    clients.reduce((sum, { connect }) => sum + connect.mock.callCount(), 0),
    0,
  );
});

test('startup rollback stays within its Nest context', async (context) => {
  const clients = transport(context, async (ordinal) => {
    if (ordinal === 2) throw new Error('transport failure');
  });
  const first = await start(RedisCacheModule.forRoot(options));
  const firstConnection = clients.find(
    ({ connect }) => connect.mock.callCount() > 0,
  );
  try {
    await assert.rejects(
      start(
        root([
          RedisCacheModule.forRoot(options),
          RedisAtomicModule.forRoot(options),
        ]),
      ),
    );
    assert.equal(firstConnection.destroy.mock.callCount(), 0);
  } finally {
    await first.close();
  }
  assert.equal(firstConnection.destroy.mock.callCount(), 1);
});
