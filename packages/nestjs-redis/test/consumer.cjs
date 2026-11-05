const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, existsSync } = require('node:fs');
const { isAbsolute, join } = require('node:path');
const { tmpdir } = require('node:os');
const { fixture } = require('./fixture.cjs');
let phase = 'fixture and tarball preconditions';

function main() {
  fixture(); // Validate operator-supplied loopback fixture before installing or connecting.
  const tarball = process.env.REDIS_TEST_TARBALL;
  assert(
    tarball && isAbsolute(tarball) && existsSync(tarball),
    'REDIS_TEST_TARBALL must name an existing absolute tarball path',
  );
  const cwd = mkdtempSync(join(tmpdir(), 'nestjs-redis-consumer-'));
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        private: true,
        dependencies: {
          '@redredgroup/nestjs-redis': `file:${tarball}`,
          '@nestjs/common': '11.1.21',
          '@nestjs/core': '11.1.21',
          'reflect-metadata': '0.1.13',
          rxjs: '7.8.2',
          typescript: '6.0.3',
          '@types/node': '25.8.0',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    `${cwd}/consumer.ts`,
    `
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Inject, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RedisCacheModule, RedisCacheService, type CacheSetOptions } from '@redredgroup/nestjs-redis';
import { RedisAtomicModule, RedisAtomicService } from '@redredgroup/nestjs-redis/atomic';
const options = { url: process.env.REDIS_TEST_URL!, namespace: 'pack_' + process.pid, connectTimeoutMs: 1000, commandTimeoutMs: 1000 };
@Injectable()
class Probe {
  constructor(@Inject(RedisCacheService) readonly cache: RedisCacheService, @Inject(RedisAtomicService) readonly atomic: RedisAtomicService) {}
}
@Module({ imports: [RedisCacheModule.forRootAsync({ useFactory: async () => options }), RedisAtomicModule.forRoot(options)], providers: [Probe] })
class App {}
async function main() {
  const app = await NestFactory.createApplicationContext(App, { logger: false, abortOnError: false });
  try {
    const probe = app.get(Probe);
    const input: CacheSetOptions<{ ok: boolean }> = { key: 'roundtrip', value: { ok: true }, ttlMs: 1000 };
    await probe.cache.set(input);
    assert.deepEqual(await probe.cache.get(input.key), input.value);
    assert.equal(await probe.atomic.setIfAbsent('owner', 'consumer', 1000), true);
    assert.equal(await probe.atomic.compareDelete('owner', 'consumer'), true);
    await probe.cache.clear();
  } finally { await app.close(); }
}
main().catch(() => { console.error('Consumer bootstrap failed'); process.exitCode = 1; });
`,
  );
  const run = (command, args) =>
    execFileSync(command, args, {
      cwd,
      stdio: 'pipe',
      env: process.env,
      timeout: 120_000,
    });
  phase = 'external dependency installation';
  run('pnpm', ['install', '--ignore-scripts']);
  phase = 'external strict TypeScript consumer';
  run('pnpm', [
    'exec',
    'tsc',
    '--strict',
    '--target',
    'es2022',
    '--module',
    'Node16',
    '--moduleResolution',
    'Node16',
    '--experimentalDecorators',
    '--emitDecoratorMetadata',
    '--esModuleInterop',
    'consumer.ts',
  ]);
  phase = 'packed CommonJS and dynamic-import exports';
  run(process.execPath, [
    '-e',
    "Promise.all([import('@redredgroup/nestjs-redis'), import('@redredgroup/nestjs-redis/atomic')]).then(([c,a]) => { if (!c.RedisCacheModule || !a.RedisAtomicModule) process.exit(1); })",
  ]);
  phase = 'external Nest constructor injection and Redis roundtrip';
  run(process.execPath, ['consumer.js']);
  console.log(
    `PASS: external tarball consumer exports, TypeScript and Nest DI (${cwd})`,
  );
}
try {
  main();
} catch {
  console.error(
    `FAIL: external tarball consumer during ${phase}; build, pack, dependencies and explicit loopback fixture are required`,
  );
  process.exitCode = 1;
}
