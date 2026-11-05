const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { createClient } = require('@redis/client');
const { Keyv } = require('keyv');
const { createCache } = require('cache-manager');
const { OwnedRedisStore } = require('../dist/owned-redis-store.js');
const { OperationGuard } = require('../dist/operation-guard.js');
const { RedisCacheService } = require('../dist/redis-cache.service.js');

async function main() {
  const client = createClient();
  Object.defineProperty(client, 'isOpen', { value: true });
  let scans = 0;
  let release;
  const mode = process.argv[2];
  client.scan = async (_cursor, options) => {
    assert.equal(options.MATCH, 'en:clear_failure:cache:*');
    assert.equal(options.TYPE, 'string');
    scans++;
    if (scans === 1)
      return { cursor: '1', keys: ['en:clear_failure:cache:key'] };
    if (mode === 'pending')
      return new Promise((resolve) => {
        release = resolve;
      });
    throw new Error('Synthetic scan failure');
  };
  let deletes = 0;
  client.unlink = async (keys) => {
    deletes++;
    assert.deepEqual(keys, ['en:clear_failure:cache:key']);
    if (mode !== 'scan-failure') throw new Error('Synthetic unlink failure');
    return 1;
  };
  const guard = new OperationGuard(() => {});
  const store = new OwnedRedisStore({
    client,
    guard,
    initialized: true,
    options: { namespace: 'clear_failure' },
  });
  const keyv = new Keyv({
    store,
    namespace: store.namespace,
    useKeyPrefix: false,
    throwOnErrors: true,
  });
  keyv.on('error', () => guard.close());
  const service = new RedisCacheService(
    createCache({ stores: [keyv] }),
    guard,
    0,
    200,
  );
  let error;
  const operation = service.clear().catch((caught) => {
    error = caught;
  });
  try {
    await delay(30);
    assert.equal(error?.message, 'Redis operation failed');
    assert.equal(error.cause, undefined);
    assert.equal(scans, mode === 'scan-failure' ? 2 : 1);
    assert.equal(deletes, 1);
    await assert.rejects(service.clear(), {
      message: 'Redis operation failed',
    });
  } finally {
    release?.({ cursor: '0', keys: [] });
    guard.close();
    await operation;
    await delay(10);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
