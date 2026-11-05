require('reflect-metadata');

const assert = require('node:assert/strict');

const { test } = require('node:test');

const { Module } = require('@nestjs/common');

const { NestFactory } = require('@nestjs/core');

const sdk = require('@redis/client');

const { RedisCacheModule, RedisCacheService } = require('../dist/index.js');

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
