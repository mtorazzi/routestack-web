import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../server/util.js';
import { assertUpstreamSuccess, extractToolPayload, parseMcpBody } from '../server/routestack/mcp.js';

test('parseMcpBody parses plain JSON bodies', () => {
  const envelope = { jsonrpc: '2.0', id: 1, result: { ok: true } };
  assert.deepEqual(parseMcpBody(JSON.stringify(envelope), 'application/json'), envelope);
});

test('parseMcpBody parses SSE bodies and picks the payload event', () => {
  const sse = ['event: message', 'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}', '', ''].join('\n');
  const parsed = parseMcpBody(sse, 'text/event-stream');
  assert.equal(parsed.id, 2);
  assert.deepEqual(parsed.result.tools, []);
});

test('parseMcpBody skips keep-alive events and returns the last payload', () => {
  const sse = [
    'data: {"jsonrpc":"2.0","method":"ping"}',
    'data: {"jsonrpc":"2.0","id":5,"result":{"value":42}}',
    'data: [DONE]',
  ].join('\n');
  const parsed = parseMcpBody(sse, 'text/event-stream');
  assert.equal(parsed.id, 5);
  assert.equal(parsed.result.value, 42);
});

test('parseMcpBody returns null for empty bodies', () => {
  assert.equal(parseMcpBody('', 'application/json'), null);
});

test('extractToolPayload prefers structuredContent', () => {
  const envelope = {
    result: {
      content: [{ type: 'text', text: '{"ignored":true}' }],
      structuredContent: { success: true, result: [1, 2] },
    },
  };
  assert.deepEqual(extractToolPayload(envelope).result, [1, 2]);
});

test('extractToolPayload parses a text content block', () => {
  const envelope = { result: { content: [{ type: 'text', text: '{"success":true,"count":3}' }] } };
  assert.equal(extractToolPayload(envelope).count, 3);
});

test('extractToolPayload surfaces JSON-RPC errors as ApiError', () => {
  assert.throws(() => extractToolPayload({ error: { code: -32601, message: 'Method not found' } }), ApiError);
});

test('extractToolPayload surfaces tool isError', () => {
  const envelope = { result: { isError: true, content: [{ type: 'text', text: 'CAR_SEARCH_INVALID_INPUT' }] } };
  assert.throws(() => extractToolPayload(envelope), /CAR_SEARCH_INVALID_INPUT/);
});

test('assertUpstreamSuccess throws on success:false', () => {
  assert.throws(() => assertUpstreamSuccess({ success: false, message: 'quota' }, 'hotel_search'), /quota/);
  assert.deepEqual(assertUpstreamSuccess({ success: true }), { success: true });
});
