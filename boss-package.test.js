import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

test('boss package is self-contained and publishes its shared helpers', async () => {
  const indexSource = await readFile(join(here, 'index.js'), 'utf8');
  const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));

  assert.doesNotMatch(indexSource, /\.\.\/\.\.\/src\/shared\//);
  assert.ok(Array.isArray(pkg.files));
  assert.ok(pkg.files.includes('shared'));
  assert.deepEqual(pkg.dependencies, {
    ws: '^8.19.0',
  });
});
