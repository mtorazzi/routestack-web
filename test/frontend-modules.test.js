/**
 * Frontend syntax + import guard.
 *
 * The rest of the suite only exercises pure modules, so a syntax error in the
 * view layer could ship unnoticed. Here we check every shipped browser module
 * with `node --check` and, where possible, import it in Node.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const publicDir = join(root, 'public');

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listJsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

const files = listJsFiles(publicDir);

// `public/app.js` touches the DOM at import time, so it is checked for syntax
// only and never imported here. Every other module only defines functions at
// module scope (router.js defaults its `location.hash` argument lazily).
// `public/router.js` is also import-only.
const importSkip = new Set([join(publicDir, 'app.js')]);
const importTargets = files.filter((f) => !importSkip.has(f));

test('public/**/*.js parses cleanly with node --check', () => {
  assert.ok(files.length > 0, 'expected to find frontend modules under public/');
  for (const file of files) {
    const rel = relative(root, file);
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      assert.fail(`node --check failed for ${rel}: ${err.stderr?.toString().trim() || err.message}`);
    }
  }
});

test('frontend modules import cleanly in Node', async () => {
  assert.ok(importTargets.length > 0, 'expected importable frontend modules');
  for (const file of importTargets) {
    const rel = relative(root, file).split(sep).join('/');
    try {
      const mod = await import(`../${rel}`);
      assert.equal(typeof mod, 'object');
    } catch (err) {
      assert.fail(`import failed for ${rel}: ${err.message}`);
    }
  }
});

test('view modules keep a callable render export', async () => {
  for (const name of ['flights', 'hotels', 'cars', 'settings']) {
    const mod = await import(`../public/views/${name}.js`);
    assert.equal(typeof mod.render, 'function', `${name}.js must export render(ctx)`);
    assert.equal(typeof mod.default?.render, 'function', `${name}.js must default-export { render }`);
  }
});
