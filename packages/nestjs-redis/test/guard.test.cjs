const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OperationGuard } = require('../dist/operation-guard.js');

test('bounds a pending command, destroys once and refuses subsequent operations', async () => {
  let destroyed = 0;
  const guard = new OperationGuard(() => {
    destroyed++;
  });
  await assert.rejects(
    guard.run(() => new Promise((resolve) => setTimeout(resolve, 30)), 10),
    { message: 'Redis operation failed' },
  );
  guard.close();
  assert.equal(destroyed, 1);
  let invoked = false;
  await assert.rejects(
    guard.run(async () => {
      invoked = true;
    }, 10),
  );
  assert.equal(invoked, false);
});

test('removes provider payload and cause from errors', async () => {
  const guard = new OperationGuard(() => {});
  await assert.rejects(
    guard.run(async () => {
      throw new Error('redis://secret/payload');
    }, 20),
    (error) => {
      assert.equal(error.message, 'Redis operation failed');
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('successful operations leave the connection open until explicit shutdown', async () => {
  let destroyed = 0;
  const guard = new OperationGuard(() => {
    destroyed++;
  });
  assert.equal(await guard.run(async () => 42, 20), 42);
  assert.equal(destroyed, 0);
  guard.close();
  guard.close();
  assert.equal(destroyed, 1);
});

test('shutdown immediately rejects outstanding waits without advancing deadline timers', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let destroyed = 0;
  const guard = new OperationGuard(() => {
    destroyed++;
  });
  const pending = guard.run(() => new Promise(() => {}), 100_000);
  await Promise.resolve();
  guard.close();
  await assert.rejects(pending, { message: 'Redis operation failed' });
  context.mock.timers.tick(100_000);
  assert.equal(destroyed, 1);
});
