import assert from 'node:assert/strict';
import test from 'node:test';

import { base64url, decodeJwtPayload, partnerTokenUrl, signHmac } from '../server/routestack/auth.js';

test('base64url has no padding and uses URL-safe alphabet', () => {
  assert.equal(base64url(Buffer.from('hello')), 'aGVsbG8');
  assert.equal(base64url(Buffer.from([251, 255, 190])), '-_--');
  assert.equal(base64url('test'), 'dGVzdA');
});

test('signHmac matches the fixed vector', () => {
  const apiKey = 'rst_key';
  const apiSecret = 's3cr3t';
  const timestamp = 1_700_000_000;
  const nonce = '11111111-2222-3333-4444-555555555555';
  const expected = '172SqiH3ySc5nVRgmKP9m1CqqZjTOt_KLOznczkpzGY';
  assert.equal(signHmac({ apiKey, apiSecret, timestamp, nonce }), expected);
  // message is exactly apiKey:timestamp:nonce
  assert.equal(signHmac({ apiKey, apiSecret, timestamp, nonce }), expected);
});

test('signHmac is sensitive to every input', () => {
  const base = { apiKey: 'a', apiSecret: 's', timestamp: 1, nonce: 'n' };
  const a = signHmac(base);
  assert.notEqual(a, signHmac({ ...base, apiKey: 'b' }));
  assert.notEqual(a, signHmac({ ...base, apiSecret: 'x' }));
  assert.notEqual(a, signHmac({ ...base, timestamp: 2 }));
  assert.notEqual(a, signHmac({ ...base, nonce: 'm' }));
});

test('partnerTokenUrl builds the mint endpoint from an MCP url', () => {
  assert.equal(partnerTokenUrl('https://mcp.routestack.ai/mcp'), 'https://mcp.routestack.ai/mcp/auth/partner-token');
  assert.equal(partnerTokenUrl('https://evolvemcp.routestack.ai/mcp/'), 'https://evolvemcp.routestack.ai/mcp/auth/partner-token');
  assert.equal(partnerTokenUrl('https://mcp.routestack.ai'), 'https://mcp.routestack.ai/mcp/auth/partner-token');
});

test('decodeJwtPayload reads the exp claim', () => {
  const payload = base64url(JSON.stringify({ accountId: '123', exp: 1_790_436_849 }));
  const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
  assert.equal(decodeJwtPayload(token).exp, 1_790_436_849);
  assert.equal(decodeJwtPayload('garbage'), null);
});
