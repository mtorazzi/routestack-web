/** Shared Express route helpers. */
import { ApiError } from '../util.js';

/** Wrap an async handler so rejected promises hit the error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function sendOk(res, data, meta = {}) {
  res.json({ ok: true, data, meta });
}

export function requireBody(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new ApiError('BAD_REQUEST', 'Body JSON mancante o non valido.', { status: 400 });
  }
  return req.body;
}

/** Remove undefined / null / '' entries; drop nested empty objects/arrays. */
export function clean(obj) {
  if (Array.isArray(obj)) return obj.map(clean).filter((v) => v !== undefined);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const c = clean(v);
      if (c === undefined || c === null || c === '') continue;
      if (Array.isArray(c) && c.length === 0) continue;
      if (typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out;
  }
  if (obj === '') return undefined;
  return obj;
}

export function requireString(value, field) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw new ApiError('BAD_REQUEST', `Campo obbligatorio mancante: ${field}.`, { status: 400 });
  return v;
}

export function toInt(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
