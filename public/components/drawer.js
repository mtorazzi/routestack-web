/**
 * Accessible side drawer with focus trap. Returns a controller with close().
 */
import { clear, el, icon } from './dom.js';

let openInstance = null;

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {Node|Node[]} opts.body
 * @param {Node|Node[]} [opts.footer]
 * @param {() => void} [opts.onClose]
 */
export function openDrawer({ title, body, footer, onClose }) {
  if (openInstance) openInstance.close({ silent: true });
  const previouslyFocused = document.activeElement;

  const closeBtn = el(
    'button',
    { class: 'btn btn--icon', type: 'button', attrs: { 'aria-label': 'Chiudi pannello' }, onClick: () => close() },
    icon('M18 6 6 18M6 6l12 12'),
  );

  const panel = el(
    'div',
    {
      class: 'drawer',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drawer-title' },
    },
    el(
      'div',
      { class: 'drawer__head' },
      el('h2', { class: 'drawer__title', id: 'drawer-title', text: title || 'Dettaglio' }),
      closeBtn,
    ),
    el('div', { class: 'drawer__body' }, ...(Array.isArray(body) ? body : [body])),
    footer ? el('div', { class: 'drawer__foot' }, ...(Array.isArray(footer) ? footer : [footer])) : null,
  );

  const overlay = el('div', { class: 'drawer-overlay', onClick: (e) => { if (e.target === overlay) close(); } }, panel);
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';

  function focusables() {
    return Array.from(panel.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = focusables();
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function close({ silent = false } = {}) {
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    document.body.style.overflow = '';
    if (openInstance === instance) openInstance = null;
    if (!silent) {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      onClose?.();
    }
  }

  document.addEventListener('keydown', onKeydown, true);
  setTimeout(() => (focusables()[0] || closeBtn).focus(), 0);
  const instance = {
    panel,
    close,
    setBody(nodes) {
      const target = panel.querySelector('.drawer__body');
      clear(target);
      target.append(...(Array.isArray(nodes) ? nodes : [nodes]));
    },
  };
  openInstance = instance;
  return instance;
}
