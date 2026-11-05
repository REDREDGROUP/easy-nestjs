const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateOptions } = require('../dist/redis-options.js');

test('rejects ambiguous URL and host configuration without echoing secrets', () => {
  assert.throws(
    () =>
      validateOptions({
        url: 'redis://user:secret@localhost/2',
        host: 'localhost',
        namespace: 'test',
      }),
    { message: 'Invalid Redis options' },
  );
});

test('rejects TLS downgrade for rediss', () => {
  assert.throws(
    () =>
      validateOptions({
        url: 'rediss://localhost',
        tls: false,
        namespace: 'test',
      }),
    { message: 'Invalid Redis options' },
  );
});

test('preserves encoded URL credentials and database', () => {
  const url = 'redis://user:p%40ss@localhost:6379/2';
  assert.equal(validateOptions({ url, namespace: 'test' }).url, url);
});

test('rejects unsafe namespaces, invalid deadlines, and contradictory TLS', () => {
  for (const patch of [
    { namespace: '*' },
    { port: 0 },
    { database: -1 },
    { commandTimeoutMs: 0 },
    { defaultTtlMs: -1 },
    { tls: { rejectUnauthorized: false } },
    { url: 'redis://localhost', tls: {} },
    { reconnect: { attempts: Infinity, delayMs: 1 } },
  ]) {
    assert.throws(
      () =>
        validateOptions({
          host: 'localhost',
          namespace: 'test',
          ...patch,
        }),
      { message: 'Invalid Redis options' },
    );
  }
});

test('requires a connection target and rejects URL query options', () => {
  assert.throws(() => validateOptions({ namespace: 'test' }));
  assert.throws(() =>
    validateOptions({
      url: 'redis://localhost/1?password=secret',
      namespace: 'test',
    }),
  );
});
