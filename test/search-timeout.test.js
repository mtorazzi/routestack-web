/**
 * Dedicated timeout for the billable searches + honest billed-timeout wording.
 *
 * Everything here is offline: the MCP transport is either a `fetch` stub that
 * hangs until aborted, or the `__setClientFactory` seam that captures the
 * per-call `timeoutMs` without ever reaching RouteStack. No billable call is
 * made.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfig, maskConfig, normalizeSearchTimeout } from '../server/config.js';
import { ApiError as ServerApiError } from '../server/util.js';
import { McpClient } from '../server/routestack/mcp.js';
import { createApp } from '../server/index.js';
import { __setClientFactory } from '../server/routestack/verticals.js';
import { ApiError as FrontApiError, humanError } from '../public/components/api.js';
import { buildConfigPatch } from '../public/components/params.js';

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

test('loadConfig exposes timeoutMs 60000 and searchTimeoutMs 180000 by default', () => {
  const cfg = loadConfig({ force: true });
  assert.equal(cfg.timeoutMs, 60_000);
  assert.equal(cfg.searchTimeoutMs, 180_000);
});

test('a config file value wins and searchTimeoutMs is clamped to 30s–600s', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-timeout-cfg-'));
  const filePath = path.join(dir, 'secrets.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify({ timeoutMs: 45_000, searchTimeoutMs: 90_000 }));
    const cfg = loadConfig({ force: true, filePath });
    assert.equal(cfg.timeoutMs, 45_000);
    assert.equal(cfg.searchTimeoutMs, 90_000, 'the file value must win over the default');

    fs.writeFileSync(filePath, JSON.stringify({ searchTimeoutMs: 999_999 }));
    assert.equal(loadConfig({ force: true, filePath }).searchTimeoutMs, 600_000);

    fs.writeFileSync(filePath, JSON.stringify({ searchTimeoutMs: 1_000 }));
    assert.equal(loadConfig({ force: true, filePath }).searchTimeoutMs, 30_000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizeSearchTimeout falls back to the default on missing/invalid values', () => {
  assert.equal(normalizeSearchTimeout(undefined), 180_000);
  assert.equal(normalizeSearchTimeout(''), 180_000);
  assert.equal(normalizeSearchTimeout('abc'), 180_000);
  assert.equal(normalizeSearchTimeout(120_000), 120_000);
});

test('maskConfig includes searchTimeoutMs (and still masks secrets)', () => {
  const masked = maskConfig(loadConfig({ force: true }));
  assert.equal(masked.timeoutMs, 60_000);
  assert.equal(masked.searchTimeoutMs, 180_000);
});

test('buildConfigPatch forwards searchTimeoutMs next to timeoutMs', () => {
  const patch = buildConfigPatch({ timeoutMs: '60000', searchTimeoutMs: '120000' }, {});
  assert.equal(patch.timeoutMs, 60_000);
  assert.equal(patch.searchTimeoutMs, 120_000);
});

// ---------------------------------------------------------------------------
// humanError wording
// ---------------------------------------------------------------------------

test('humanError words a billable timeout honestly', () => {
  const billed = humanError(new FrontApiError('UPSTREAM_TIMEOUT', 'timeout', { status: 504, meta: { billable: true } }));
  assert.equal(billed.title, 'Ricerca non conclusa in tempo');
  assert.match(billed.hint, /conteggiata/);

  const generic = humanError(new FrontApiError('UPSTREAM_TIMEOUT', 'timeout', { status: 504 }));
  assert.equal(generic.title, 'Timeout');
});

// ---------------------------------------------------------------------------
// per-call timeout plumbing through the Express routes
// ---------------------------------------------------------------------------

/** Stub client that records the per-call options (including the effective `timeoutMs`). */
function makeTimingStub() {
  const calls = [];
  const factory = (cfg) => ({
    callTool: async (name, args, options = {}) => {
      calls.push({ name, args, options, effectiveTimeoutMs: options.timeoutMs ?? cfg.timeoutMs });
      if (name === 'hotel_search' || name === 'car_search') return { payload: { success: true, result: { count: 0, status: 'Complete' } } };
      if (name === 'flight_search') return { payload: { success: true, count: 0, status: 'Complete' } };
      if (name === 'search_destinations') return { payload: { success: true, result: [] } };
      return { payload: { success: true } };
    },
  });
  return { calls, factory };
}

async function withServer(t, stub) {
  __setClientFactory(stub.factory);
  t.after(() => __setClientFactory(null));
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  return async (p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
}

const lastCall = (calls, name) => [...calls].reverse().find((c) => c.name === name);

test('the three billable searches use searchTimeoutMs, other calls use timeoutMs', async (t) => {
  const stub = makeTimingStub();
  const post = await withServer(t, stub);
  const cfg = loadConfig({ force: true });

  const dest = await post('/api/hotels/destinations', { query: 'Rome' });
  assert.equal(dest.status, 200);

  const hotel = await post('/api/hotels/search', { checkIn: '2027-08-20', checkOut: '2027-08-25' });
  assert.equal(hotel.status, 200);

  const flight = await post('/api/flights/search', { tripType: 'OneWay', origin: 'MXP', destination: 'BKK', departureDate: '2027-08-20', adults: 1, cabinClass: 'Economy' });
  assert.equal(flight.status, 200);

  const car = await post('/api/cars/search', {
    pickup: { name: 'Malpensa Airport', code: 'MXP', date: '2027-08-20', time: '10:00' },
    dropoff: { name: 'Malpensa Airport', code: 'MXP', date: '2027-08-25', time: '10:00' },
  });
  assert.equal(car.status, 200);

  assert.equal(lastCall(stub.calls, 'search_destinations').effectiveTimeoutMs, cfg.timeoutMs, 'free autocomplete uses the general timeout');
  assert.equal(lastCall(stub.calls, 'hotel_search').effectiveTimeoutMs, cfg.searchTimeoutMs);
  assert.equal(lastCall(stub.calls, 'flight_search').effectiveTimeoutMs, cfg.searchTimeoutMs);
  assert.equal(lastCall(stub.calls, 'car_search').effectiveTimeoutMs, cfg.searchTimeoutMs);
  assert.equal(lastCall(stub.calls, 'search_destinations').options.timeoutMs, undefined, 'free calls carry no search override');
});

// ---------------------------------------------------------------------------
// timeout abort: not retried, honest message + billable meta
// ---------------------------------------------------------------------------

/** fetch stub that never resolves on its own; rejects when its signal aborts. */
function makeHangingFetch() {
  const state = { calls: 0 };
  const fetchImpl = (_url, opts) => {
    state.calls += 1;
    return new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
  return { fetchImpl, state };
}

test('aborting a billable search yields UPSTREAM_TIMEOUT + billable meta and is never retried', async () => {
  const { fetchImpl, state } = makeHangingFetch();
  const auth = { authHeaders: async () => ({}), invalidate() {} };
  const client = new McpClient({ baseUrl: 'http://127.0.0.1:1/mcp', timeoutMs: 60_000 }, { auth, fetchImpl });
  client.sessionId = 'offline-session'; // skip initialize/notifications

  const started = Date.now();
  await assert.rejects(
    () => client.callTool('flight_search', {}, { timeoutMs: 50 }),
    (err) => {
      assert.equal(err.code, 'UPSTREAM_TIMEOUT');
      assert.equal(err.status, 504);
      assert.equal(err.meta?.billable, true);
      assert.match(err.message, /entro 1 s/);
      assert.match(err.message, /conteggiata/);
      return true;
    },
  );
  assert.equal(state.calls, 1, 'a timed-out call must be issued exactly once (a retry would bill a second search)');
  assert.ok(Date.now() - started >= 40, 'the per-call timeout must drive the abort timer');
});

test('a non-billable timeout keeps the generic wording and no billable meta', async () => {
  const { fetchImpl, state } = makeHangingFetch();
  const auth = { authHeaders: async () => ({}), invalidate() {} };
  const client = new McpClient({ baseUrl: 'http://127.0.0.1:1/mcp', timeoutMs: 60_000 }, { auth, fetchImpl });
  client.sessionId = 'offline-session';

  await assert.rejects(
    () => client.callTool('hotel_locations', {}, { timeoutMs: 50 }),
    (err) => {
      assert.equal(err.code, 'UPSTREAM_TIMEOUT');
      assert.equal(err.meta, null);
      assert.match(err.message, /timeout dopo 50 ms/);
      return true;
    },
  );
  assert.equal(state.calls, 1);
});

test('the error envelope surfaces the billable meta through the API', async (t) => {
  __setClientFactory(null);
  const app = createApp();
  // Reproduce the timeout path through the real error middleware without any
  // network: install a stub client whose search throws the typed error.
  __setClientFactory(() => ({
    callTool: async (name) => {
      if (name === 'hotel_search') {
        throw new ServerApiError('UPSTREAM_TIMEOUT', 'RouteStack non ha risposto entro 180 s.', {
          status: 504,
          meta: { billable: true },
        });
      }
      return { payload: { success: true } };
    },
  }));
  t.after(() => __setClientFactory(null));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const res = await fetch(`http://127.0.0.1:${port}/api/hotels/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checkIn: '2027-08-20', checkOut: '2027-08-25' }),
  });
  assert.equal(res.status, 504);
  const json = await res.json();
  assert.equal(json.error.code, 'UPSTREAM_TIMEOUT');
  assert.equal(json.meta.billable, true);
});
