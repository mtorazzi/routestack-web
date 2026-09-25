/**
 * Static assets must never be cached by the browser. `maxAge: 0` still allowed
 * revalidation caching, so after a deploy the browser could keep running an old
 * bundle (the root cause of a UI fix that never reached the user). Every shipped
 * asset, plus the SPA catch-all, must answer with `cache-control: no-store`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp } from '../server/index.js';

function start() {
  return new Promise((resolve) => {
    const server = createApp().listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('static assets and catch-all are served with cache-control: no-store', async (t) => {
  const server = await start();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  // `/` is served by express.static (index.html); `/app.js` and the views are
  // regular assets; `/impostazioni` is an SPA route handled by the catch-all.
  for (const path of ['/', '/app.js', '/views/settings.js', '/styles/tokens.css', '/impostazioni']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, `${path} should be served (got ${res.status})`);
    const cacheControl = res.headers.get('cache-control') || '';
    assert.match(cacheControl, /no-store/, `${path} must be no-store (got "${cacheControl}")`);
    await res.arrayBuffer();
  }
});
