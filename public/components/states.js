/**
 * Empty / idle / loading / error states and generic small UI blocks.
 */
import { humanError } from './api.js';
import { el, icon } from './dom.js';

/**
 * Hint shown while a billable search runs. Long-haul / multi-leg searches can
 * take 1–3 minutes and repeating one consumes another billable call, so we tell
 * the user to wait.
 */
export const LONG_SEARCH_HINT = 'Le ricerche lunghe possono richiedere 1–3 minuti: attendi senza ripetere.';

/**
 * Honest, persistent note about what costs money: only the searches are
 * billable, while changing the results-header order is a local sort and never
 * re-issues a search. Shown next to the search button in all three verticals.
 */
export const SEARCH_COST_HINT = "Le ricerche sono fatturate. L'ordinamento dei risultati è locale e non consuma una nuova ricerca.";

/** Rendered note for {@link SEARCH_COST_HINT}. */
export function searchCostHint() {
  return el('p', { class: 'card__sub', attrs: { style: 'margin: 0' }, text: SEARCH_COST_HINT });
}

/**
 * Start a 1-second elapsed-seconds counter for a running search.
 * @param {{onTick?: (seconds:number)=>void}} [handlers]
 * @returns {() => void} stop function — always call it from the `finally` branch
 */
export function startSearchClock({ onTick } = {}) {
  const started = Date.now();
  const tick = () => onTick?.(Math.max(0, Math.floor((Date.now() - started) / 1000)));
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

/** Skeleton grid. */
export function skeletonGrid(count = 6) {
  const grid = el('div', { class: 'card-grid', attrs: { 'aria-hidden': 'true' } });
  for (let i = 0; i < count; i += 1) grid.append(el('div', { class: 'skeleton' }));
  return grid;
}

/** Idle state with a clickable example that fills the form. */
export function idleState({ title, text, exampleLabel, onExample }) {
  return el(
    'div',
    { class: 'state' },
    el('div', { class: 'state__icon' }, icon('M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', { size: 48 })),
    el('h2', { class: 'state__title', text: title }),
    el('p', { class: 'state__text', text }),
    onExample ? el('button', { class: 'example', type: 'button', onClick: onExample }, icon('M12 5v14M5 12h14', { size: 16 }), exampleLabel || 'Prova un esempio') : null,
  );
}

/** Empty (no results) state. */
export function emptyState({ title = 'Nessun risultato', text, onReset, resetLabel = 'Modifica la ricerca' } = {}) {
  return el(
    'div',
    { class: 'state' },
    el('div', { class: 'state__icon' }, icon('M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10', { size: 48 })),
    el('h2', { class: 'state__title', text: title }),
    text ? el('p', { class: 'state__text', text }) : null,
    onReset ? el('button', { class: 'btn btn--ghost', type: 'button', onClick: onReset }, resetLabel) : null,
  );
}

/**
 * Error state: human message + collapsible technical detail.
 * @param {Error & {code?:string, detail?:any, upstreamStatus?:number}} err
 */
export function errorState(err) {
  const { title, hint } = humanError(err);
  const detail = {
    code: err?.code,
    message: err?.message,
    upstreamStatus: err?.upstreamStatus ?? undefined,
    detail: err?.detail ?? undefined,
  };
  return el(
    'div',
    { class: 'state state--error' },
    el('div', { class: 'state__icon' }, icon('M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', { size: 48 })),
    el('h2', { class: 'state__title', text: title }),
    el('p', { class: 'state__text', text: `${hint}${err?.message && err.message !== title ? ` — ${err.message}` : ''}` }),
    el(
      'details',
      { class: 'tech' },
      el('summary', { text: 'Dettagli tecnici' }),
      el('pre', { text: JSON.stringify(prune(detail), null, 2) }),
    ),
  );
}

function prune(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

/** Small labelled key/value list. */
export function kv(pairs) {
  const dl = el('dl', { class: 'kv' });
  for (const [k, v] of pairs) {
    if (v === null || v === undefined || v === '') continue;
    dl.append(el('dt', { text: k }), el('dd', { text: String(v) }));
  }
  return dl;
}

/** A colored badge. */
export function badge(text, kind = '') {
  return el('span', { class: `badge ${kind ? `badge--${kind}` : ''}`, text: text });
}
