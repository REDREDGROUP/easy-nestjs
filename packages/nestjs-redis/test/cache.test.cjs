const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCache } = require('cache-manager');
const { Keyv } = require('keyv');
const { RedisCacheService } = require('../dist/index.js');
const { OperationGuard } = require('../dist/operation-guard.js');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

for (const mode of ['pending', 'reject', 'scan-failure']) {
  test(`clear observes batch failures before the next SCAN (${mode})`, () => {
    const result = spawnSync(
      process.execPath,
      [
        '--unhandled-rejections=strict',
        path.join(__dirname, 'clear-failure.cjs'),
        mode,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

function cacheFixture(ttl = 0) {
  const store = new Keyv();
  const cache = createCache({ stores: [store] });
  const guard = new OperationGuard(() => {});
  return {
    store,
    cache,
    service: new RedisCacheService(cache, guard, ttl, 1000),
  };
}

test('built cache uses real cache-manager/Keyv for JSON, null, miss and del', async () => {
  const { service } = cacheFixture();
  try {
    assert.equal(await service.get('missing'), undefined);
    await service.set({ key: 'json', value: { count: 2 } });
    assert.deepEqual(await service.get('json'), { count: 2 });
    await service.set({ key: 'null', value: null });
    assert.equal(await service.get('null'), null);
    await service.del('json');
    assert.equal(await service.get('json'), undefined);
    await assert.rejects(service.set({ key: 'bad', value: undefined }));
  } finally {
    service.onModuleDestroy();
  }
});

test('cache TTL is milliseconds, omission uses default and zero never expires', async (context) => {
  let now = Date.now();
  context.mock.method(Date, 'now', () => now);
  const { service } = cacheFixture(20);
  try {
    await service.set({ key: 'default', value: 1 });
    await service.set({ key: 'explicit', value: 2, ttlMs: 10 });
    await service.set({ key: 'forever', value: 3, ttlMs: 0 });
    now += 11;
    assert.equal(await service.get('explicit'), undefined);
    assert.equal(await service.get('default'), 1);
    now += 10;
    assert.equal(await service.get('default'), undefined);
    assert.equal(await service.get('forever'), 3);
    for (const ttlMs of [-1, 1.5, NaN, Infinity]) {
      await assert.rejects(service.set({ key: 'invalid', value: 1, ttlMs }));
    }
  } finally {
    service.onModuleDestroy();
  }
});

test('wrap delegates SDK coalescing and refuses invalid key or undefined loader value', async () => {
  const { service } = cacheFixture();
  let loads = 0;
  try {
    const load = async () => {
      loads++;
      await Promise.resolve();
      return { ok: true };
    };
    assert.deepEqual(
      await Promise.all(
        Array.from({ length: 5 }, () => service.wrap('wrapped', load)),
      ),
      Array(5).fill({ ok: true }),
    );
    assert.equal(loads, 1);
    assert.deepEqual(await service.get('wrapped'), { ok: true });
    await assert.rejects(service.wrap('undefined', async () => undefined));
    await assert.rejects(service.get(''));
    await assert.rejects(service.del(''));
    await assert.rejects(service.set({ key: '', value: 1 }));
  } finally {
    service.onModuleDestroy();
  }
});

test('clear only invokes this cache store; another independent store survives', async () => {
  const a = cacheFixture().service;
  const b = cacheFixture().service;
  try {
    await a.set({ key: 'same', value: 'a' });
    await b.set({ key: 'same', value: 'b' });
    await a.clear();
    assert.equal(await a.get('same'), undefined);
    assert.equal(await b.get('same'), 'b');
  } finally {
    a.onModuleDestroy();
    b.onModuleDestroy();
  }
});
