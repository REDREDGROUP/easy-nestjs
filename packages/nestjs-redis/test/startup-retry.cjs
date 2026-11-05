const assert = require('node:assert/strict');
const { createHook } = require('node:async_hooks');
const net = require('node:net');
const { performance } = require('node:perf_hooks');
const { createConnection } = require('../dist/connection.js');

const mode = process.argv[2];
const timers = new Map();
const hook = createHook({
  init(id, type, _trigger, resource) {
    if (type === 'Timeout') timers.set(id, resource);
  },
  destroy(id) {
    timers.delete(id);
  },
}).enable();
let attempts = 0;
const attemptTimes = [];
const original = net.createConnection;
net.createConnection = (options) => {
  attempts++;
  attemptTimes.push(performance.now());
  const socket = new net.Socket({ signal: options.signal });
  process.nextTick(() =>
    socket.destroy(new Error('Synthetic transport failure')),
  );
  return socket;
};
const cancellation = mode === 'deadline' || mode === 'close';
const started = performance.now();
const connection = createConnection({
  host: '127.0.0.1',
  namespace: 'startup_retry',
  connectTimeoutMs: mode === 'deadline' ? 30 : 2000,
  reconnect:
    mode === 'default'
      ? false
      : {
          attempts: mode === 'zero' ? 0 : 2,
          delayMs: cancellation ? 1000 : 25,
        },
});
let settled = false;
let lateEvents = 0;
connection.client.on('reconnecting', () => {
  if (settled) lateEvents++;
});

async function main() {
  const pending = connection.connect();
  const rejected = assert.rejects(pending, {
    message: 'Redis operation failed',
  });
  if (mode === 'close') setTimeout(() => connection.guard.close(), 30);
  await rejected;
  settled = true;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    attempts,
    cancellation || mode === 'default' || mode === 'zero' ? 1 : 3,
  );
  if (mode === 'exhaustion') {
    assert.ok(attemptTimes[1] - attemptTimes[0] >= 20);
    assert.ok(attemptTimes[2] - attemptTimes[1] >= 20);
  }
  assert.equal(
    [...timers.values()].filter((timer) => timer.hasRef()).length,
    0,
    'no referenced retry timer after settlement',
  );
  await assert.rejects(connection.connect(), {
    message: 'Redis operation failed',
  });
  assert.equal(
    attempts,
    cancellation || mode === 'default' || mode === 'zero' ? 1 : 3,
  );
}

process.once('beforeExit', () => {
  try {
    assert.equal(
      attempts,
      cancellation || mode === 'default' || mode === 'zero' ? 1 : 3,
      'no attempt after settlement',
    );
    assert.equal(lateEvents, 0, 'no reconnecting event after settlement');
    if (cancellation)
      assert.ok(
        performance.now() - started < 700,
        'child must naturally exit before the retry delay',
      );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
  net.createConnection = original;
  hook.disable();
});
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
