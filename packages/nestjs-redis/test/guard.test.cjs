const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OperationGuard } = require('../dist/operation-guard.js');
const { createConnection } = require('../dist/connection.js');
const net = require('node:net');
const tls = require('node:tls');
const { setTimeout: delay } = require('node:timers/promises');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

for (const mode of ['deadline', 'close', 'exhaustion', 'default', 'zero']) {
  test(`owned startup retry lifecycle (${mode})`, () => {
    const child = spawnSync(
      process.execPath,
      [
        '--unhandled-rejections=strict',
        path.join(__dirname, 'startup-retry.cjs'),
        mode,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr || child.stdout);
  });
}

for (const secure of [false, true]) {
  for (const shutdown of [false, true]) {
    test(`pending SDK ${secure ? 'TLS' : 'TCP'} socket is cancelled on ${shutdown ? 'close' : 'deadline'}`, async (context) => {
      let pending;
      let writes = 0;
      context.mock.method(
        secure ? tls : net,
        secure ? 'connect' : 'createConnection',
        (options) => {
          pending = new net.Socket({ signal: options.signal });
          pending.setTimeout = () => pending;
          pending.write = () => {
            writes++;
            return true;
          };
          return pending;
        },
      );
      const connection = createConnection({
        url: `${secure ? 'rediss' : 'redis'}://127.0.0.1:6379`,
        namespace: 'pending_socket',
        connectTimeoutMs: shutdown ? 1000 : 20,
      });
      let ready = 0;
      connection.client.on('ready', () => ready++);
      const connecting = connection.connect();
      const rejected = assert.rejects(connecting, {
        message: 'Redis operation failed',
      });
      try {
        await delay(5);
        assert.ok(pending, 'official SDK must reach the socket factory');
        if (shutdown) connection.guard.close();
        await rejected;
        await delay(5);
        assert.equal(pending.destroyed, true);
        // Even a stale transport event must not resume the SDK handshake.
        pending.emit(secure ? 'secureConnect' : 'connect');
        await delay(5);
        assert.equal(writes, 0);
        assert.equal(ready, 0);
        assert.equal(connection.client.isOpen, false);
        assert.equal(connection.initialized, false);
      } finally {
        connection.guard.close();
        pending?.destroy(new Error('Synthetic cleanup'));
        await delay(5);
      }
    });
  }
}

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
