import assert from 'node:assert/strict';
import test from 'node:test';

import { maskConfig } from '../server/config.js';
import { redact } from '../server/util.js';

test('redact masks short values entirely', () => {
  assert.equal(redact(''), '');
  assert.equal(redact('abc'), '••••');
});

test('redact keeps a short prefix and the last 4 chars only', () => {
  const masked = redact('rst_0123456789abcdef');
  assert.equal(masked, 'rst_…cdef');
  assert.ok(!masked.includes('0123456789ab'));
});

test('maskConfig never exposes the full apiKey or apiSecret', () => {
  const cfg = {
    authMode: 'partner-token',
    apiKey: 'rst_0123456789abcdef',
    apiSecret: 'super-secret-value-that-must-never-leak',
    accountId: 'acct_1234567890',
    baseUrl: 'https://mcp.routestack.ai/mcp',
    sandbox: false,
    currency: 'EUR',
    timeoutMs: 30000,
    sources: { apiKey: 'file', apiSecret: 'env', accountId: 'none' },
  };
  const masked = maskConfig(cfg);
  const json = JSON.stringify(masked);
  assert.ok(!json.includes(cfg.apiKey));
  assert.ok(!json.includes(cfg.apiSecret));
  assert.ok(!json.includes(cfg.accountId));
  assert.equal(masked.apiKeySet, true);
  assert.equal(masked.apiSecretSet, true);
  assert.equal(masked.apiKey, 'rst_…cdef');
  assert.equal(masked.credentialsResolvedFrom.apiSecret, 'env');
});

test('maskConfig defaults to production base url', () => {
  const masked = maskConfig({
    authMode: 'partner-token', apiKey: '', apiSecret: '', accountId: '',
    baseUrl: 'https://mcp.routestack.ai/mcp', sandbox: false, currency: 'EUR', timeoutMs: 30000,
    sources: { apiKey: 'none', apiSecret: 'none', accountId: 'none' },
  });
  assert.equal(masked.source, 'production');
  assert.equal(masked.apiKeySet, false);
});
