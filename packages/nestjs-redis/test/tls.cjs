const assert = require('node:assert/strict');
const { fixture } = require('./fixture.cjs');
let phase = 'TLS fixture preconditions';

async function main() {
  const options = fixture(true);
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { RedisCacheModule, RedisCacheService } = require('../dist/index.js');
  const start = (config) =>
    NestFactory.createApplicationContext(RedisCacheModule.forRoot(config), {
      logger: false,
      abortOnError: false,
    });
  phase = 'verified TLS bootstrap and roundtrip';
  const app = await start(options);
  try {
    const cache = app.get(RedisCacheService);
    await cache.set({ key: 'tls', value: { verified: true }, ttlMs: 1000 });
    assert.deepEqual(await cache.get('tls'), { verified: true });
    await cache.clear();
  } finally {
    await app.close();
  }
  phase = 'untrusted CA rejection';
  // Use a private fixture CA not present in the system trust store.
  await assert.rejects(start({ ...options, tls: undefined }), {
    message: 'Redis operation failed',
  });
  phase = 'hostname mismatch rejection';
  await assert.rejects(
    start({
      ...options,
      tls: {
        ca: options.tls.ca,
        servername: 'invalid-fixture-servername.test',
      },
    }),
    { message: 'Redis operation failed' },
  );
  phase = 'TLS downgrade rejection';
  await assert.rejects(start({ ...options, tls: false }), {
    message: 'Invalid Redis options',
  });
  console.log(
    'PASS: TLS verified roundtrip, untrusted CA, hostname mismatch, downgrade rejection',
  );
}
main().catch(() => {
  console.error(
    `FAIL: TLS integration during ${phase}; requires private-CA disposable loopback Redis and explicit CA path`,
  );
  process.exitCode = 1;
});
