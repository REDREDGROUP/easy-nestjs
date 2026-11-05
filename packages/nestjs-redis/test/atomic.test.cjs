const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createClient } = require('@redis/client');
const { RedisAtomicService } = require('../dist/atomic.js');
const { OperationGuard } = require('../dist/operation-guard.js');

function fixture(context, method) {
  const client = createClient(); // No connect; only the command failure boundary is replaced.
  const command = context.mock.method(client, method, async () => {
    throw new Error('secret-provider-payload');
  });
  const service = new RedisAtomicService({
    client,
    options: { namespace: 'test', commandTimeoutMs: 50 },
    initialized: true,
    guard: new OperationGuard(() => {}),
    async connect() {},
  });
  return { service, command };
}

const safeFailure = (operation) =>
  assert.rejects(operation, (error) => {
    assert.equal(error.message, 'Redis operation failed');
    assert.equal(error.cause, undefined);
    return true;
  });

test('SET NX dispatches raw prefixed key and PX milliseconds through official SDK', async (context) => {
  const { service, command } = fixture(context, 'set');
  await safeFailure(service.setIfAbsent('lease', 'owner', 123));
  assert.deepEqual(command.mock.calls[0].arguments, [
    'en:test:atomic:lease',
    'owner',
    { NX: true, PX: 123 },
  ]);
});

test('GETDEL dispatches one SDK command, never cache get then delete', async (context) => {
  const { service, command } = fixture(context, 'getDel');
  await safeFailure(service.getDel('one-shot'));
  assert.deepEqual(command.mock.calls[0].arguments, [
    'en:test:atomic:one-shot',
  ]);
});

test('owner compare-delete uses trusted Lua with owner as an argument', async (context) => {
  const { service, command } = fixture(context, 'eval');
  await safeFailure(service.compareDelete('lease', 'owner'));
  const [script, args] = command.mock.calls[0].arguments;
  assert.match(script, /redis.call\('GET'/);
  assert.match(script, /redis.call\('DEL'/);
  assert.deepEqual(args, {
    keys: ['en:test:atomic:lease'],
    arguments: ['owner'],
  });
});

test('expiry counter dispatches INCR/PEXPIRE Lua with explicit millisecond argument', async (context) => {
  const { service, command } = fixture(context, 'eval');
  await safeFailure(service.incrementWithExpiry('counter', 321));
  const [script, args] = command.mock.calls[0].arguments;
  assert.match(script, /redis.call\('INCR'/);
  assert.match(script, /redis.call\('PEXPIRE'/);
  assert.deepEqual(args, {
    keys: ['en:test:atomic:counter'],
    arguments: ['321'],
  });
});

test('trusted Lua prefixes only declared keys and preserves application arguments', async (context) => {
  const { service, command } = fixture(context, 'eval');
  await safeFailure(service.evalTrusted('return ARGV[1]', ['key'], ['value']));
  assert.deepEqual(command.mock.calls[0].arguments, [
    'return ARGV[1]',
    { keys: ['en:test:atomic:key'], arguments: ['value'] },
  ]);
});

test('invalid atomic expiry is rejected before SDK dispatch and closed service cannot issue commands', async (context) => {
  const { service, command } = fixture(context, 'set');
  for (const ttl of [0, -1, 1.5, NaN, Infinity])
    await assert.rejects(service.setIfAbsent('lease', 'owner', ttl));
  assert.equal(command.mock.callCount(), 0);
  service.onModuleDestroy();
  await assert.rejects(service.setIfAbsent('lease', 'owner', 1));
  assert.equal(command.mock.callCount(), 0);
});
