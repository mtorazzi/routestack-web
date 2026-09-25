/**
 * Locale-aware formatters (it-IT). Pure functions — safe to unit test in Node.
 */

const LOCALE = 'it-IT';

/** Format a number with up to 2 decimals, it-IT grouping. */
export function formatNumber(value, digits = 2) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}

/** Format a price in the given currency (fallback EUR). */
export function formatPrice(value, currency = 'EUR') {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  const code = /^[A-Za-z]{3}$/.test(String(currency || '')) ? String(currency).toUpperCase() : 'EUR';
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${formatNumber(n)} ${code}`;
  }
}

/** Format an ISO date/datetime as a short it-IT date. */
export function formatDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

/** Format a time (HH:mm) from an ISO datetime or a plain time string. */
export function formatTime(value) {
  if (!value) return '';
  const match = /T?(\d{2}):(\d{2})/.exec(String(value));
  if (match && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${match[1]}:${match[2]}`;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Human duration from minutes or a "13h 20m" string. */
export function formatDuration(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /[a-z]/i.test(value)) return value;
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return String(value);
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A short "2 adulti, 1 bambino" summary. */
export function paxSummary({ adults = 0, children = 0, infants = 0 } = {}) {
  const parts = [];
  if (adults) parts.push(`${adults} ${adults === 1 ? 'adulto' : 'adulti'}`);
  if (children) parts.push(`${children} ${children === 1 ? 'bambino' : 'bambini'}`);
  if (infants) parts.push(`${infants} ${infants === 1 ? 'neonato' : 'neonati'}`);
  return parts.join(', ');
}

/** Split an ISO datetime into { date, time } parts (YYYY-MM-DD, HH:mm). */
export function splitDateTime(value) {
  if (!value) return { date: '', time: '' };
  const s = String(value);
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(s)?.[1] ?? '';
  const time = /T?(\d{2}:\d{2})/.exec(s)?.[1] ?? '';
  return { date, time };
}

/** Date N days from now as YYYY-MM-DD (used for empty-state examples). */
export function isoDateInDays(days = 0, from = new Date()) {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
