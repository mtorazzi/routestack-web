import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { redact } from './util.js';

export const PROD_MCP_URL = 'https://mcp.routestack.ai/mcp';
export const SANDBOX_MCP_URL = 'https://evolvemcp.routestack.ai/mcp';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const CONFIG_PATH = path.join(ROOT, 'config', 'secrets.json');

const ENV_KEYS = {
  apiKey: 'ROUTESTACK_API_KEY',
  apiSecret: 'ROUTESTACK_API_SECRET',
  accountId: 'ROUTESTACK_ACCOUNT_ID',
};

const FILE_FIELDS = ['authMode', 'apiKey', 'apiSecret', 'accountId', 'baseUrl', 'sandbox', 'currency', 'timeoutMs'];

const DEFAULTS = {
  authMode: 'partner-token', // 'partner-token' | 'header'
  apiKey: '',
  apiSecret: '',
  accountId: '',
  baseUrl: PROD_MCP_URL,
  sandbox: false,
  currency: 'EUR',
  timeoutMs: 30_000,
};

let cached = null;

function readFile() {
  try {
    const txt = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(txt);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`config/secrets.json non leggibile: ${err.message}`);
  }
}

/**
 * Resolve effective config: file first, environment as fallback.
 * @returns {object} full config including per-field `sources`.
 */
export function loadConfig({ force = false } = {}) {
  if (cached && !force) return cached;
  const file = readFile();
  const out = { ...DEFAULTS };
  const sources = { apiKey: 'none', apiSecret: 'none', accountId: 'none' };

  for (const field of FILE_FIELDS) {
    if (file[field] !== undefined && file[field] !== null && file[field] !== '') out[field] = file[field];
  }
  for (const [field, envName] of Object.entries(ENV_KEYS)) {
    if (!out[field] && process.env[envName]) {
      out[field] = process.env[envName];
      sources[field] = 'env';
    } else if (out[field]) {
      sources[field] = 'file';
    }
  }
  if (process.env.ROUTESTACK_BASE_URL && !file.baseUrl) out.baseUrl = process.env.ROUTESTACK_BASE_URL;

  out.timeoutMs = Number(out.timeoutMs) || DEFAULTS.timeoutMs;
  out.currency = out.currency || DEFAULTS.currency;
  out.authMode = out.authMode === 'header' ? 'header' : 'partner-token';
  out.sandbox = Boolean(out.sandbox);
  out.sources = sources;
  cached = out;
  return out;
}

export function effectiveBaseUrl(cfg = loadConfig()) {
  return cfg.sandbox ? SANDBOX_MCP_URL : cfg.baseUrl || PROD_MCP_URL;
}

export function sourceLabel(cfg = loadConfig()) {
  return cfg.sandbox ? 'sandbox' : 'production';
}

/**
 * Persist a partial config patch (only known, non-secret-empty fields).
 * Secret fields are only overwritten when a non-empty value is provided.
 * @param {object} patch
 */
export function saveConfig(patch = {}) {
  const current = loadConfig();
  const file = readFile();
  const next = { ...file };

  for (const field of FILE_FIELDS) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (field === 'apiKey' || field === 'apiSecret') {
      if (value === null) delete next[field];
      else if (String(value).length > 0) next[field] = String(value);
      continue;
    }
    next[field] = field === 'timeoutMs' ? Number(value) || DEFAULTS.timeoutMs : value;
  }
  if (typeof next.sandbox !== 'boolean') next.sandbox = Boolean(next.sandbox ?? current.sandbox);

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best effort on non-POSIX */
  }
  cached = null;
  return loadConfig({ force: true });
}

/** Remove stored credentials (keeps non-secret preferences). */
export function clearCredentials() {
  const file = readFile();
  delete file.apiKey;
  delete file.apiSecret;
  delete file.accountId;
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best effort */
  }
  cached = null;
  return loadConfig({ force: true });
}

/** Public, browser-safe view of the config. Never contains a real secret. */
export function maskConfig(cfg = loadConfig()) {
  return {
    authMode: cfg.authMode,
    baseUrl: effectiveBaseUrl(cfg),
    prodUrl: PROD_MCP_URL,
    sandboxUrl: SANDBOX_MCP_URL,
    sandbox: cfg.sandbox,
    source: sourceLabel(cfg),
    currency: cfg.currency,
    timeoutMs: cfg.timeoutMs,
    apiKey: redact(cfg.apiKey),
    apiSecret: redact(cfg.apiSecret),
    accountId: redact(cfg.accountId),
    apiKeySet: Boolean(cfg.apiKey),
    apiSecretSet: Boolean(cfg.apiSecret),
    accountIdSet: Boolean(cfg.accountId),
    credentialsResolvedFrom: { ...cfg.sources },
    envVars: { ...ENV_KEYS },
    configPath: CONFIG_PATH,
    host: os.hostname(),
  };
}
