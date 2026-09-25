/**
 * Small shared helpers: typed API errors and the standard response envelope.
 *
 * Success: { ok: true, data, meta }
 * Failure: { ok: false, error: { code, message, upstreamStatus }, meta }
 */

export class ApiError extends Error {
  /**
   * @param {string} code    machine code, e.g. UPSTREAM_ERROR
   * @param {string} message human (Italian) message
   * @param {object} [opts]
   * @param {number} [opts.status]         HTTP status to send to the browser
   * @param {number|null} [opts.upstreamStatus] status observed from RouteStack
   * @param {unknown} [opts.detail]        technical detail (redacted by caller)
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = opts.status ?? 502;
    this.upstreamStatus = opts.upstreamStatus ?? null;
    this.detail = opts.detail ?? null;
  }
}

/**
 * Build a failure envelope. Never includes credentials.
 * @param {ApiError|Error} err
 * @param {object} [meta]
 */
export function errorEnvelope(err, meta = {}) {
  const isApi = err instanceof ApiError;
  return {
    ok: false,
    error: {
      code: isApi ? err.code : 'INTERNAL_ERROR',
      message: isApi ? err.message : 'Errore interno inatteso.',
      upstreamStatus: isApi ? err.upstreamStatus : null,
      ...(isApi && err.detail != null ? { detail: err.detail } : {}),
    },
    meta,
  };
}

export function successEnvelope(data, meta = {}) {
  return { ok: true, data, meta };
}

/** Never leak a secret: show at most a short prefix + last 4 chars. */
export function redact(value) {
  const s = String(value ?? '');
  if (s.length <= 8) return s ? '••••' : '';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export function nowMs() {
  return Date.now();
}
