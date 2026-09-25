import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, errorEnvelope, successEnvelope } from '../server/util.js';

test('errorEnvelope wraps an ApiError with code and upstream status', () => {
  const err = new ApiError('QUOTA_EXCEEDED', 'quota esaurita', { status: 402, upstreamStatus: 402 });
  const env = errorEnvelope(err, { path: '/api/hotels/search' });
  assert.deepEqual(env, {
    ok: false,
    error: { code: 'QUOTA_EXCEEDED', message: 'quota esaurita', upstreamStatus: 402 },
    meta: { path: '/api/hotels/search' },
  });
});

test('errorEnvelope maps unknown errors to INTERNAL_ERROR', () => {
  const env = errorEnvelope(new Error('boom'), { path: '/x' });
  assert.equal(env.ok, false);
  assert.equal(env.error.code, 'INTERNAL_ERROR');
  assert.equal(env.error.upstreamStatus, null);
  assert.equal(env.error.message, 'Errore interno inatteso.');
});

test('successEnvelope shape', () => {
  assert.deepEqual(successEnvelope({ a: 1 }, { source: 'production' }), {
    ok: true,
    data: { a: 1 },
    meta: { source: 'production' },
  });
});
