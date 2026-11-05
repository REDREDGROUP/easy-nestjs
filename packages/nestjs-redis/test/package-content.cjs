const assert = require('node:assert/strict');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const manifest = require('../package.json');
for (const entry of Object.values(manifest.exports)) {
  for (const file of Object.values(entry))
    assert(existsSync(resolve(root, file)), `Missing build output: ${file}`);
}
for (const name of readdirSync(resolve(root, 'dist'))) {
  if (name.endsWith('.d.ts'))
    assert(
      !/\.pnpm|node_modules|\/Users\//.test(
        readFileSync(resolve(root, 'dist', name), 'utf8'),
      ),
      `Nonportable declaration: ${name}`,
    );
}
assert.equal(
  typeof require('../dist/index.js').RedisOperationError,
  'function',
);
console.log('PASS: declared exports and portable declaration artifacts');
