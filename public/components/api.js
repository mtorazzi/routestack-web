/**
 * API client for the local Express backend.
 * All responses use the envelope { ok, data, meta } / { ok:false, error, meta }.
 */

export class ApiError extends Error {
  constructor(code, message, { upstreamStatus = null, detail = null, status = null, meta = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.upstreamStatus = upstreamStatus;
    this.detail = detail;
    this.status = status;
    this.meta = meta;
  }
}

/**
 * Call the backend.
 * @param {string} path e.g. '/hotels/search'
 * @param {object} [body] JSON body; omit for GET
 * @param {{method?:string}} [opts]
 * @returns {Promise<{data:any, meta:object}>}
 */
export async function api(path, body, opts = {}) {
  const method = opts.method || (body === undefined ? 'GET' : 'POST');
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError('NETWORK', 'Impossibile contattare il server locale. Verifica che sia in esecuzione.', {
      detail: String(err?.message || err),
    });
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', `Risposta non valida dal server (HTTP ${res.status}).`, { status: res.status });
  }

  if (!json || typeof json !== 'object' || !('ok' in json)) {
    throw new ApiError('BAD_ENVELOPE', 'Il server ha restituito una risposta inattesa.', { status: res.status, detail: json });
  }

  if (!json.ok) {
    const e = json.error || {};
    throw new ApiError(e.code || 'ERROR', e.message || `Errore (HTTP ${res.status}).`, {
      upstreamStatus: e.upstreamStatus ?? null,
      detail: e.detail ?? null,
      status: res.status,
      meta: json.meta ?? null,
    });
  }

  return { data: json.data, meta: json.meta || {} };
}

/** GET helpers. */
export const getConfig = () => api('/config');
export const getHealth = () => api('/health');

/** Save a partial config patch. */
export const saveConfig = (patch) => api('/config', patch);
export const deleteConfig = () => api('/config', undefined, { method: 'DELETE' });
export const testConfig = () => api('/config/test', {});

/** POST helper bound to a vertical prefix. */
export function vertical(prefix) {
  return {
    destinations: (body) => api(`/${prefix}/destinations`, body),
    locations: (body) => api(`/${prefix}/locations`, body),
    search: (body) => api(`/${prefix}/search`, body),
    rooms: (body) => api(`/${prefix}/rooms`, body),
    revalidate: (body) => api(`/${prefix}/revalidate`, body),
    details: (body) => api(`/${prefix}/details`, body),
    checkout: (body) => api(`/${prefix}/checkout`, body),
    session: (body = {}) => api(`/${prefix}/session`, body),
  };
}

/**
 * Open a checkout URL in a new tab.
 * @returns {boolean} whether a popup could be opened
 */
export function openCheckout(url) {
  if (!url) return false;
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  return Boolean(win);
}

/**
 * Map an error to a human Italian headline + hint.
 * @param {ApiError|Error} err
 */
export function humanError(err) {
  const code = err?.code || '';
  const upstream = err?.upstreamStatus;
  // A timed-out billable search was very likely counted upstream, so it must
  // not invite an immediate retry the way a generic timeout does.
  if (code === 'UPSTREAM_TIMEOUT' && err?.meta?.billable === true) {
    return {
      title: 'Ricerca non conclusa in tempo',
      hint: 'La ricerca potrebbe essere ancora in corso e la chiamata è stata conteggiata: attendi qualche minuto prima di ripetere.',
    };
  }
  const byCode = {
    CREDENTIALS_MISSING: { title: 'Credenziali mancanti', hint: 'Apri Impostazioni e inserisci API key e API secret.' },
    CREDENTIALS_INVALID: { title: 'Credenziali non valide', hint: 'Controlla API key/secret oppure rigenera il partner token nelle Impostazioni.' },
    QUOTA_EXCEEDED: { title: 'Quota esaurita', hint: 'Il piano RouteStack ha raggiunto il limite di richieste.' },
    PARTNER_TOKEN_NOT_CONFIGURED: { title: 'Partner token non configurato', hint: 'Il servizio non è disponibile o il partner token non è configurato.' },
    RATE_LIMITED: { title: 'Troppe richieste', hint: 'Attendi qualche secondo e riprova.' },
    UPSTREAM_TIMEOUT: { title: 'Timeout', hint: 'RouteStack non ha risposto in tempo. Riprova.' },
    UPSTREAM_UNREACHABLE: { title: 'Rete non raggiungibile', hint: 'Verifica la connettività verso mcp.routestack.ai.' },
    NETWORK: { title: 'Server locale non raggiungibile', hint: 'Avvia il backend con "npm start".' },
    BAD_REQUEST: { title: 'Dati non validi', hint: 'Controlla i campi obbligatori del modulo.' },
    HOTEL_SESSION_REQUIRED: { title: 'Sessione hotel scaduta', hint: 'Riesegui la ricerca dell\'hotel.' },
  };
  if (byCode[code]) return byCode[code];
  if (upstream === 401 || code === 'UNAUTHORIZED') return { title: 'Credenziali non valide o token scaduto', hint: 'Controlla le credenziali nelle Impostazioni.' };
  if (upstream === 402) return { title: 'Quota esaurita', hint: 'Il piano RouteStack ha raggiunto il limite.' };
  if (upstream === 503) return { title: 'Partner token non configurato', hint: 'Il servizio è momentaneamente non disponibile.' };
  return { title: 'Si è verificato un errore', hint: 'Riprova o controlla i dettagli tecnici.' };
}
