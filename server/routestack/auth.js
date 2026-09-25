import crypto from 'node:crypto';

import { ApiError } from '../util.js';

/** base64url without padding, for buffers or UTF-8 strings. */
export function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Partner-token HMAC: base64url( HMAC_SHA256(apiSecret, `${apiKey}:${timestamp}:${nonce}`) ).
 * @param {{apiKey:string, apiSecret:string, timestamp:number, nonce:string}} p
 */
export function signHmac({ apiKey, apiSecret, timestamp, nonce }) {
  const message = `${apiKey}:${timestamp}:${nonce}`;
  return base64url(crypto.createHmac('sha256', apiSecret).update(message).digest());
}

/** https://mcp.routestack.ai/mcp -> https://mcp.routestack.ai/mcp/auth/partner-token */
export function partnerTokenUrl(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const root = base.endsWith('/mcp') ? base : `${base}/mcp`;
  return `${root}/auth/partner-token`;
}

export function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function httpErrorFromStatus(status, context = 'RouteStack') {
  switch (Number(status)) {
    case 400:
      return new ApiError('UPSTREAM_BAD_REQUEST', `${context}: richiesta non valida.`, { status: 400, upstreamStatus: 400 });
    case 401:
      return new ApiError(
        'CREDENTIALS_INVALID',
        `${context}: credenziali non valide o token scaduto. Controlla API key/secret in Impostazioni.`,
        { status: 401, upstreamStatus: 401 },
      );
    case 402:
      return new ApiError('QUOTA_EXCEEDED', `${context}: quota esaurita.`, { status: 402, upstreamStatus: 402 });
    case 403:
      return new ApiError('FORBIDDEN', `${context}: accesso negato.`, { status: 403, upstreamStatus: 403 });
    case 404:
      return new ApiError('UPSTREAM_NOT_FOUND', `${context}: risorsa non trovata.`, { status: 404, upstreamStatus: 404 });
    case 429:
      return new ApiError('RATE_LIMITED', `${context}: troppe richieste, riprova tra poco.`, { status: 429, upstreamStatus: 429 });
    case 503:
      return new ApiError(
        'PARTNER_TOKEN_NOT_CONFIGURED',
        `${context}: servizio non disponibile / partner token non configurato.`,
        { status: 503, upstreamStatus: 503 },
      );
    default:
      return new ApiError('UPSTREAM_ERROR', `${context}: errore upstream (HTTP ${status}).`, {
        status: status >= 500 ? 502 : 400,
        upstreamStatus: status,
      });
  }
}

const MIN_SAFETY_MS = 60_000; // re-mint 60s before expiry
const tokenCache = new Map();

function cacheKey(cfg) {
  const fingerprint = base64url(crypto.createHash('sha256').update(`${cfg.apiKey}`).digest()).slice(0, 12);
  return `${cfg.baseUrl}|${cfg.authMode}|${fingerprint}`;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: ac.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ApiError('UPSTREAM_TIMEOUT', `RouteStack: timeout dopo ${timeoutMs} ms.`, { status: 504 });
    }
    throw new ApiError('UPSTREAM_UNREACHABLE', `RouteStack: rete non raggiungibile (${err.message}).`, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mint a partner token (JWT).
 * @returns {Promise<{token:string, expiresIn:string|number, expiresAtMs:number, status:number}>}
 */
export async function mintPartnerToken(cfg, { fetchImpl = globalThis.fetch } = {}) {
  if (!cfg.apiKey || !cfg.apiSecret) {
    throw new ApiError('CREDENTIALS_MISSING', 'API key e API secret non configurati.', { status: 400 });
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const hmac = signHmac({ apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, timestamp, nonce });

  const res = await fetchWithTimeout(
    fetchImpl,
    partnerTokenUrl(cfg.baseUrl),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ apiKey: cfg.apiKey, hmac, timestamp, nonce }),
    },
    cfg.timeoutMs || 30_000,
  );

  const text = await res.text();
  if (!res.ok) {
    const err = httpErrorFromStatus(res.status, 'Mint partner token');
    err.detail = safeSnippet(text);
    throw err;
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError('UPSTREAM_BAD_RESPONSE', 'Mint partner token: risposta non JSON.', {
      status: 502,
      upstreamStatus: res.status,
      detail: safeSnippet(text),
    });
  }
  const token = body.token || body.access_token;
  if (!token) {
    throw new ApiError('UPSTREAM_BAD_RESPONSE', 'Mint partner token: nessun token nella risposta.', {
      status: 502,
      upstreamStatus: res.status,
    });
  }
  const payload = decodeJwtPayload(token);
  const expMs = payload?.exp ? payload.exp * 1000 : Date.now() + parseExpiresIn(body.expiresIn ?? '24h');
  return { token, expiresIn: body.expiresIn ?? '24h', expiresAtMs: expMs, status: res.status };
}

function parseExpiresIn(v) {
  if (typeof v === 'number') return v * 1000;
  const m = /^(\d+)\s*([smhd])?$/.exec(String(v));
  if (!m) return 24 * 3600 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] || 's'];
  return n * unit;
}

function safeSnippet(text, max = 240) {
  const s = String(text ?? '').replace(/eyJ[A-Za-z0-9._-]{10,}/g, '[jwt]');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Auth provider for MCP calls. Caches the JWT until 60s before expiry.
 * Modes: partner-token (Bearer JWT) | header (X-Api-Key + X-Account-Id).
 */
export class AuthProvider {
  constructor(cfg, { fetchImpl = globalThis.fetch } = {}) {
    this.cfg = cfg;
    this.fetchImpl = fetchImpl;
  }

  /** @returns {Promise<Record<string,string>>} auth headers for MCP calls */
  async authHeaders() {
    if (this.cfg.authMode === 'header') {
      if (!this.cfg.apiKey || !this.cfg.accountId) {
        throw new ApiError('CREDENTIALS_MISSING', 'Modalità header: servono API key e Account ID.', { status: 400 });
      }
      return { 'x-api-key': this.cfg.apiKey, 'x-account-id': this.cfg.accountId };
    }
    const token = await this.#token();
    return { authorization: `Bearer ${token}` };
  }

  invalidate() {
    tokenCache.delete(cacheKey(this.cfg));
  }

  async #token() {
    const key = cacheKey(this.cfg);
    const hit = tokenCache.get(key);
    if (hit && hit.expiresAtMs - MIN_SAFETY_MS > Date.now()) return hit.token;
    const minted = await mintPartnerToken(this.cfg, { fetchImpl: this.fetchImpl });
    tokenCache.set(key, minted);
    return minted.token;
  }

  /** Diagnostics for the Settings "Test connessione" button. */
  async test({ listTools }) {
    const started = Date.now();
    if (this.cfg.authMode === 'header') {
      const tools = await listTools(this);
      return {
        mode: 'header',
        mintStatus: null,
        tokenLength: null,
        tokenExpiresAt: null,
        toolsCount: tools.length,
        durationMs: Date.now() - started,
      };
    }
    const minted = await mintPartnerToken(this.cfg, { fetchImpl: this.fetchImpl });
    tokenCache.set(cacheKey(this.cfg), minted);
    const tools = await listTools(this);
    return {
      mode: 'partner-token',
      mintStatus: minted.status,
      tokenLength: minted.token.length,
      tokenExpiresAt: new Date(minted.expiresAtMs).toISOString(),
      tokenExpiresIn: minted.expiresIn,
      toolsCount: tools.length,
      durationMs: Date.now() - started,
    };
  }
}

export function __clearTokenCache() {
  tokenCache.clear();
}
