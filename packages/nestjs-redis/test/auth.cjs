const assert = require('node:assert/strict');
const { fixture } = require('./fixture.cjs');
let phase = 'authenticated fixture precondition';

async function main() {
  const options = fixture();
  const parsed = new URL(options.url);
  if (!parsed.password)
    throw new Error(
      'An explicit disposable fixture password in REDIS_TEST_URL is required',
    );
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { RedisCacheModule, RedisCacheService } = require('../dist/index.js');
  const start = (config) =>
    NestFactory.createApplicationContext(RedisCacheModule.forRoot(config), {
      logger: false,
      abortOnError: false,
    });
  phase = 'valid password bootstrap and cache roundtrip';
  const app = await start(options);
  try {
    const cache = app.get(RedisCacheService);
    await cache.set({ key: 'authenticated', value: { ok: true }, ttlMs: 1000 });
    assert.deepEqual(await cache.get('authenticated'), { ok: true });
    await cache.clear();
  } finally {
    await app.close();
  }
  phase = 'invalid password rejection';
  parsed.password = 'deliberately-invalid-fixture-password';
  await assert.rejects(start({ ...options, url: parsed.toString() }), {
    message: 'Redis operation failed',
  });
  phase = 'missing password rejection';
  parsed.username = '';
  parsed.password = '';
  await assert.rejects(start({ ...options, url: parsed.toString() }), {
    message: 'Redis operation failed',
  });
  console.log(
    'PASS: authenticated startup/roundtrip and invalid/missing password rejection',
  );
}
main().catch(() => {
  console.error(
    `FAIL: Redis authentication (${phase}); requires a password-protected disposable loopback fixture`,
  );
  process.exitCode = 1;
});
