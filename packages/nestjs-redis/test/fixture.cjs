const { readFileSync } = require('node:fs');

function fixture(tls = false) {
  const raw = process.env[tls ? 'REDIS_TEST_TLS_URL' : 'REDIS_TEST_URL'];
  if (!raw)
    throw new Error(
      tls
        ? 'REDIS_TEST_TLS_URL is required; no tests skipped'
        : 'REDIS_TEST_URL is required; no tests skipped',
    );
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid disposable fixture URL');
  }
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    parsed.protocol !== (tls ? 'rediss:' : 'redis:')
  ) {
    throw new Error(
      'Only an explicit loopback disposable Redis fixture is allowed',
    );
  }
  const options = {
    url: raw,
    namespace: `fixture_${process.pid}_${Date.now()}`,
    connectTimeoutMs: 1000,
    commandTimeoutMs: 1000,
  };
  if (tls) {
    if (!process.env.REDIS_TEST_TLS_CA)
      throw new Error('REDIS_TEST_TLS_CA is required');
    options.tls = {
      ca: readFileSync(process.env.REDIS_TEST_TLS_CA),
      servername: process.env.REDIS_TEST_TLS_SERVERNAME || 'localhost',
    };
  }
  return options;
}

module.exports = { fixture };
