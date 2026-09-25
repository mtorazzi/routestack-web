/**
 * Local, pure result sorting for the three verticals.
 *
 * Sorting is deliberately client-side: the RouteStack `/search` calls are
 * **billable**, so changing the results-header order must never re-issue one.
 *
 * Guarantees, for every comparator:
 * - stable (equal values keep their original relative order);
 * - missing / unparseable values always sort **last**, in both directions;
 * - never throws, never mutates the input array (a new array is returned);
 * - an empty or unknown `sortBy`, or an unknown vertical, keeps the original
 *   order unchanged.
 *
 * The input elements are the normalised offers produced by
 * `server/routestack/verticals.js` (`ourprice`, `duration`, `departureTime`,
 * `stars`, `rating`, `savingsPercent`, …). Extra fallbacks are accepted so the
 * helper also works with raw / partially-shaped rows.
 */

const ASC = 'asc';
const DESC = 'desc';

/** First value that parses as a finite number, else null. */
function firstNum(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** First non-empty value as a string, else null. */
function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    return String(value);
  }
  return null;
}

/**
 * Parse a flight duration to minutes.
 * Accepts a number of minutes, a numeric string, `"13h 20m"` / `"13h"` /
 * `"45m"` and the ISO-8601 form `"PT13H20M"`. Unparseable -> null.
 */
export function parseDuration(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(',', '.'));
  const hm = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/i.exec(text);
  if (hm && (hm[1] !== undefined || hm[2] !== undefined)) {
    return Number(hm[1] || 0) * 60 + Number(hm[2] || 0);
  }
  const iso = /^PT?(?:(\d+)H)?(?:(\d+)M)?$/i.exec(text);
  if (iso && (iso[1] !== undefined || iso[2] !== undefined)) {
    return Number(iso[1] || 0) * 60 + Number(iso[2] || 0);
  }
  return null;
}

/** Parse a datetime (ISO string / Date) to a timestamp; unparseable -> null. */
function parseTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Sort specification per vertical. Quality metrics (stars / rating / savings)
 * sort **descending** — best first; price / duration / departure ascending —
 * cheapest / shortest / earliest first.
 */
const SPECS = {
  flights: {
    price: { get: (o) => firstNum(o.ourprice, o.price), dir: ASC },
    duration: { get: (o) => parseDuration(o.duration), dir: ASC },
    departure: { get: (o) => parseTime(o.departureTime), dir: ASC },
  },
  hotels: {
    price: { get: (o) => firstNum(o.ourprice, o.price), dir: ASC },
    stars: { get: (o) => firstNum(o.stars, o.starRating), dir: DESC },
    savings: { get: (o) => firstNum(o.savingsPercent, o.savings), dir: DESC },
    rating: { get: (o) => firstNum(o.rating, o.guestRating, o.reviewScore), dir: DESC },
  },
  cars: {
    price: { get: (o) => firstNum(o.ourprice, o.price), dir: ASC },
    supplier: { get: (o) => firstText(o.supplier), dir: ASC },
  },
};

/** Compare two extracted values; missing always last. */
function compareValues(a, b, dir) {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  let cmp;
  if (typeof a === 'number' && typeof b === 'number') {
    cmp = a < b ? -1 : a > b ? 1 : 0;
  } else {
    cmp = String(a).localeCompare(String(b), 'it', { numeric: true, sensitivity: 'base' });
  }
  return dir === DESC ? -cmp : cmp;
}

/**
 * Return a locally sorted copy of `offers`.
 *
 * @param {Array<object>} offers normalised offers for the vertical
 * @param {string} [sortBy] one of the keys in SPECS[vertical]; empty/unknown
 *   returns the original order
 * @param {'flights'|'hotels'|'cars'} [vertical]
 * @returns {Array<object>} a new array — the input is never mutated
 */
export function sortOffers(offers, sortBy, vertical) {
  const rows = Array.isArray(offers) ? offers : [];
  const spec = sortBy ? SPECS[vertical]?.[sortBy] : null;
  if (!spec) return rows.slice();
  return rows
    .map((offer, index) => ({ offer, index, value: offer == null ? null : spec.get(offer) }))
    .sort((a, b) => compareValues(a.value, b.value, spec.dir) || a.index - b.index)
    .map((entry) => entry.offer);
}

/** The sort keys supported for a vertical (used by tests / callers). */
export function sortKeys(vertical) {
  return Object.keys(SPECS[vertical] || {});
}

export default { sortOffers, parseDuration, sortKeys };
