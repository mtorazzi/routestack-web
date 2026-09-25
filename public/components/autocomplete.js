/**
 * Debounced, keyboard-accessible autocomplete (combobox/listbox pattern).
 * The user must explicitly pick an option; free text is never auto-selected.
 */
import { el, icon } from './dom.js';

let idSeq = 0;

/**
 * @param {HTMLInputElement} input
 * @param {object} opts
 * @param {(term:string)=>Promise<any[]>} opts.load
 * @param {(item:any|null)=>void} opts.onSelect called with the chosen item (or null when invalidated)
 * @param {(item:any)=>string} [opts.itemLabel]
 * @param {(item:any)=>string} [opts.itemSub]
 * @param {number} [opts.minChars=2]
 * @param {number} [opts.debounceMs=250]
 * @param {string} [opts.emptyText]
 */
export function attachAutocomplete(input, opts) {
  const {
    load,
    onSelect,
    itemLabel = (it) => it.label ?? it.name ?? String(it),
    itemSub = (it) => it.sub ?? it.city ?? '',
    minChars = 2,
    debounceMs = 250,
    emptyText = 'Nessun risultato',
  } = opts;

  const listId = `ac-list-${(idSeq += 1)}`;
  let items = [];
  let active = -1;
  let timer = null;
  let reqSeq = 0;
  let selected = null;

  const list = el('ul', { class: 'autocomplete__list', id: listId, attrs: { role: 'listbox', hidden: true } });
  const status = el('span', { class: 'autocomplete__status', attrs: { 'aria-live': 'polite' } });

  const anchor = input.parentElement?.classList.contains('autocomplete') ? input.parentElement : input;
  if (anchor === input) {
    const wrap = el('div', { class: 'autocomplete' });
    input.replaceWith(wrap);
    wrap.append(input);
  }
  input.after(list, status);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('autocomplete', 'off');

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function renderOptions() {
    list.replaceChildren();
    items.forEach((item, index) => {
      const optionId = `${listId}-opt-${index}`;
      const li = el(
        'li',
        {
          class: 'autocomplete__option',
          id: optionId,
          attrs: { role: 'option', 'aria-selected': String(index === active) },
          onMousedown: (e) => e.preventDefault(),
          onClick: () => choose(index),
        },
        el('span', { text: itemLabel(item) }),
        itemSub(item) ? el('small', { text: itemSub(item) }) : null,
      );
      list.append(li);
    });
    if (!items.length) {
      list.append(el('li', { class: 'autocomplete__empty', attrs: { role: 'presentation' }, text: emptyText }));
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${listId}-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function setActive(index) {
    if (!items.length) return;
    active = (index + items.length) % items.length;
    for (const [i, li] of Array.from(list.children).entries()) {
      if (li.getAttribute('role') !== 'option') continue;
      li.setAttribute('aria-selected', String(i === active));
    }
    const id = `${listId}-opt-${active}`;
    input.setAttribute('aria-activedescendant', id);
    list.querySelector(`#${cssId(id)}`)?.scrollIntoView({ block: 'nearest' });
  }

  function choose(index) {
    const item = items[index];
    if (!item) return;
    selected = item;
    input.value = itemLabel(item);
    close();
    status.textContent = '';
    onSelect(item);
  }

  async function run(term) {
    const seq = (reqSeq += 1);
    status.textContent = 'Ricerca…';
    try {
      const found = (await load(term)) || [];
      if (seq !== reqSeq) return;
      items = found;
      active = -1;
      if (found.length) {
        status.textContent = `${found.length} risultati disponibili. Usa le frecce per navigare.`;
        renderOptions();
      } else {
        status.textContent = emptyText;
        renderOptions();
      }
    } catch (err) {
      if (seq !== reqSeq) return;
      items = [];
      status.textContent = err?.message || 'Errore durante la ricerca.';
      close();
    }
  }

  input.addEventListener('input', () => {
    if (selected && input.value !== itemLabel(selected)) {
      selected = null;
      onSelect(null);
    }
    clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < minChars) {
      close();
      status.textContent = '';
      return;
    }
    timer = setTimeout(() => run(term), debounceMs);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden && items.length) renderOptions();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Enter') {
      if (!list.hidden && active >= 0) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 120));

  return {
    get selected() {
      return selected;
    },
    clear() {
      selected = null;
      input.value = '';
      items = [];
      close();
      status.textContent = '';
      onSelect(null);
    },
    close,
  };
}

/** Build a small inline search icon, exported for reuse in inputs. */
export function searchIcon() {
  return icon('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35', { size: 16 });
}

function cssId(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
