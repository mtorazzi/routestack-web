import { ApiError } from '../util.js';
import { httpErrorFromStatus } from './auth.js';

const PROTOCOL_VERSION = '2025-06-18';
export const CLIENT_INFO = { name: 'routestack-web', version: '1.0.0' };

/**
 * Parse a Streamable-HTTP MCP response body. Supports both plain JSON and SSE
 * (`text/event-stream`, `data: <json>` lines, possibly several events).
 *
 * @param {string} text
 * @param {string} [contentType]
 * @returns {object|null} the JSON-RPC envelope
 */
export function parseMcpBody(text, contentType = '') {
  const body = String(text ?? '').trim();
  if (!body) return null;
  if (/text\/event-stream/i.test(contentType) || body.startsWith('event:') || body.includes('\ndata:')) {
    const events = [];
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trimStart();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        events.push(JSON.parse(data));
      } catch {
        /* ignore keep-alive fragments */
      }
    }
    const withPayload = [...events].reverse().find((e) => e && (e.result !== undefined || e.error !== undefined));
    return withPayload ?? events.at(-1) ?? null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Unwrap a tools/call result into the payload the RouteStack tool produced.
 * Prefers `structuredContent`, otherwise parses the first text content block.
 * @param {object} envelope JSON-RPC envelope
 */
export function extractToolPayload(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new ApiError('UPSTREAM_BAD_RESPONSE', 'Risposta MCP vuota o non valida.', { status: 502 });
  }
  if (envelope.error) {
    throw new ApiError('MCP_ERROR', `MCP error ${envelope.error.code}: ${envelope.error.message}`, {
      status: 502,
      detail: envelope.error.data ?? null,
    });
  }
  const result = envelope.result;
  if (!result) throw new ApiError('UPSTREAM_BAD_RESPONSE', 'Risposta MCP priva di risultato.', { status: 502 });
  if (result.isError) {
    const text = firstText(result) || 'errore tool MCP';
    throw new ApiError('TOOL_ERROR', text, { status: 422, detail: result.structuredContent ?? null });
  }
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  const text = firstText(result);
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  return result;
}

function firstText(result) {
  const content = result?.content;
  if (Array.isArray(content)) {
    const block = content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
    return block?.text ?? null;
  }
  return null;
}

/** Throw a typed error when the RouteStack payload carries success:false. */
export function assertUpstreamSuccess(payload, context = 'RouteStack') {
  if (payload && payload.success === false) {
    throw new ApiError('UPSTREAM_REJECTED', `${context}: ${payload.message || 'richiesta rifiutata.'}`, {
      status: 422,
      detail: { code: payload.code ?? null },
    });
  }
  return payload;
}

function classifyMcpText(text) {
  const t = String(text || '');
  if (/session/i.test(t) && /(not found|invalid|expired|missing)/i.test(t)) return 'SESSION_EXPIRED';
  return null;
}

/**
 * Minimal Streamable-HTTP MCP client: initialize -> notifications/initialized -> tools/call.
 * Re-initializes automatically when the session expires or the JWT is invalidated.
 */
export class McpClient {
  /**
   * @param {object} cfg full config (must expose baseUrl, timeoutMs)
   * @param {{auth: import('./auth.js').AuthProvider, fetchImpl?: Function}} deps
   */
  constructor(cfg, { auth, fetchImpl = globalThis.fetch } = {}) {
    this.cfg = cfg;
    this.baseUrl = cfg.baseUrl;
    this.timeoutMs = cfg.timeoutMs || 30_000;
    this.auth = auth;
    this.fetchImpl = fetchImpl;
    this.sessionId = null;
    this.nextId = 1;
  }

  async #post(body, { timeoutMs = this.timeoutMs } = {}) {
    const authHeaders = await this.auth.authHeaders();
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'user-agent': `${CLIENT_INFO.name}/${CLIENT_INFO.version}`,
      ...authHeaders,
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      res = await this.fetchImpl(this.baseUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new ApiError('UPSTREAM_TIMEOUT', `RouteStack: timeout dopo ${timeoutMs} ms.`, { status: 504 });
      }
      throw new ApiError('UPSTREAM_UNREACHABLE', `RouteStack: rete non raggiungibile (${err.message}).`, { status: 502 });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    return { status: res.status, contentType: res.headers.get('content-type') || '', text };
  }

  async #initialize() {
    this.sessionId = null;
    const res = await this.#post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    });
    if (res.status === 401) throw httpErrorFromStatus(401, 'MCP initialize');
    if (res.status >= 400) {
      const err = httpErrorFromStatus(res.status, 'MCP initialize');
      err.detail = snippet(res.text);
      throw err;
    }
    const envelope = parseMcpBody(res.text, res.contentType);
    if (envelope?.error) {
      throw new ApiError('MCP_ERROR', `MCP initialize: ${envelope.error.message}`, { status: 502 });
    }
    // Fire the required client notification; 202/empty body is expected.
    await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return envelope;
  }

  async #ensureSession() {
    if (!this.sessionId) await this.#initialize();
  }

  #resetSession() {
    this.sessionId = null;
  }

  async #rpc(method, params) {
    await this.#ensureSession();
    const res = await this.#post({ jsonrpc: '2.0', id: this.nextId++, method, params });
    return { res, envelope: parseMcpBody(res.text, res.contentType) };
  }

  /**
   * Call a tool, transparently handling 401 (re-mint token) and session expiry.
   * @param {string} name
   * @param {object} args
   */
  async callTool(name, args = {}) {
    const attempt = async () => {
      const { res, envelope } = await this.#rpc('tools/call', { name, arguments: args });
      return { res, envelope };
    };

    let { res, envelope } = await attempt();

    if (res.status === 401) {
      this.auth.invalidate();
      this.#resetSession();
      ({ res, envelope } = await attempt());
    }

    const sessionIssue =
      (res.status === 400 || res.status === 404 || !envelope) && classifyMcpText(envelope?.error?.message || res.text) === 'SESSION_EXPIRED';
    if (sessionIssue) {
      this.#resetSession();
      ({ res, envelope } = await attempt());
    }

    if (res.status >= 400) {
      const err = httpErrorFromStatus(res.status, `Tool ${name}`);
      err.detail = snippet(res.text);
      throw err;
    }
    if (!envelope) {
      throw new ApiError('UPSTREAM_BAD_RESPONSE', `Tool ${name}: risposta MCP non interpretabile.`, {
        status: 502,
        upstreamStatus: res.status,
        detail: snippet(res.text),
      });
    }
    const payload = extractToolPayload(envelope);
    return { payload, status: res.status };
  }

  async listTools() {
    let { res, envelope } = await this.#rpc('tools/list', {});
    if (res.status === 401) {
      this.auth.invalidate();
      this.#resetSession();
      ({ res, envelope } = await this.#rpc('tools/list', {}));
    }
    if (res.status >= 400 || !envelope) {
      const err = httpErrorFromStatus(res.status || 502, 'tools/list');
      err.detail = snippet(res.text);
      throw err;
    }
    if (envelope.error) throw new ApiError('MCP_ERROR', `tools/list: ${envelope.error.message}`, { status: 502 });
    return envelope.result?.tools ?? [];
  }

  async close() {
    if (!this.sessionId) return;
    const sid = this.sessionId;
    this.sessionId = null;
    try {
      await this.#post({ jsonrpc: '2.0', id: this.nextId++, method: 'sessions/delete', params: {} });
    } catch {
      /* best effort */
    }
    return sid;
  }
}

function snippet(text, max = 240) {
  const s = String(text ?? '').replace(/eyJ[A-Za-z0-9._-]{10,}/g, '[jwt]');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
