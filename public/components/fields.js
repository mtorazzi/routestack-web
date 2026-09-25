/**
 * Accessible form field builders. Every control gets a real <label>, an
 * optional hint and an error slot wired through aria-describedby.
 */
import { el } from './dom.js';

let seq = 0;
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`;

/**
 * Generic field.
 * @returns {{wrap:HTMLElement, control:HTMLElement}}
 */
export function field(opts = {}) {
  const {
    label,
    name,
    type = 'text',
    value = '',
    placeholder,
    hint,
    required = false,
    options,
    onInput,
    onChange,
    attrs = {},
    className = '',
  } = opts;

  const id = opts.id || uid(name || 'field');
  const hintId = hint ? `${id}-hint` : null;
  const errId = `${id}-error`;
  const describedBy = [hintId, errId].filter(Boolean).join(' ');

  let control;
  if (Array.isArray(options)) {
    control = el('select', { class: `select ${className}`, id, name, attrs: { ...attrs, 'aria-describedby': describedBy } });
    for (const o of options) {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      control.append(el('option', { value: opt.value, text: opt.label, selected: String(opt.value) === String(value) }));
    }
    control.value = String(value ?? '');
    if (onChange) control.addEventListener('change', onChange);
  } else {
    control = el('input', {
      class: `input ${className}`,
      id,
      name,
      type,
      value: value === null || value === undefined ? '' : String(value),
      placeholder,
      attrs: { ...attrs, 'aria-describedby': describedBy },
    });
    if (onInput) control.addEventListener('input', onInput);
    if (onChange) control.addEventListener('change', onChange);
  }

  const wrap = el(
    'div',
    { class: 'field', dataset: { field: name || '' } },
    el('label', { attrs: { for: id }, html: `${escapeHtml(label)}${required ? ' <span class="field__req" aria-hidden="true">*</span>' : ''}` }),
    control,
    hint ? el('span', { class: 'field__hint', id: hintId, text: hint }) : null,
    el('span', { class: 'field__error', id: errId, attrs: { role: 'alert' } }),
  );
  if (required) control.setAttribute('aria-required', 'true');
  return { wrap, control };
}

export function textField(opts) {
  return field({ type: 'text', ...opts });
}
export function dateField(opts) {
  return field({ type: 'date', ...opts });
}
export function numberField(opts) {
  return field({ type: 'number', attrs: { min: opts.min ?? undefined, max: opts.max ?? undefined, step: opts.step ?? undefined, inputmode: 'numeric', ...(opts.attrs || {}) }, ...opts });
}
export function selectField(opts) {
  return field({ ...opts, options: opts.options });
}

/** A single checkbox styled as a row. */
export function checkField({ name, label, checked = false, hint, onChange } = {}) {
  const id = uid(name || 'check');
  const control = el('input', { type: 'checkbox', id, name, checked: Boolean(checked) });
  if (onChange) control.addEventListener('change', onChange);
  const wrap = el(
    'label',
    { class: 'check', attrs: { for: id } },
    control,
    el('span', { class: 'check__text' }, label, hint ? el('small', { text: ` ${hint}` }) : null),
  );
  return { wrap, control };
}

/** Radio group inside a fieldset with legend. */
export function radioField({ name, legend, options, value, hint, onChange } = {}) {
  const groupName = name || uid('radio');
  const controls = [];
  const body = el('div', { class: 'stack stack--sm' });
  for (const o of options) {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    const id = uid(`${groupName}-${opt.value}`);
    const control = el('input', { type: 'radio', id, name: groupName, value: opt.value, checked: String(opt.value) === String(value) });
    if (onChange) control.addEventListener('change', onChange);
    controls.push(control);
    body.append(
      el('label', { class: 'check', attrs: { for: id } }, control, el('span', { class: 'check__text' }, opt.label, opt.hint ? el('small', { text: ` ${opt.hint}` }) : null)),
    );
  }
  const wrap = el(
    'fieldset',
    { class: 'fieldset', dataset: { field: groupName } },
    el('legend', { text: legend }),
    body,
    hint ? el('span', { class: 'field__hint', text: hint }) : null,
  );
  return { wrap, control: controls[0], controls };
}

/** Multi-checkbox group (unchecked ones are simply absent from values). */
export function checkGroup({ name, legend, options, values = [], hint } = {}) {
  const controls = [];
  const body = el('div', { class: 'row', attrs: { style: 'gap: var(--space-3)' } });
  for (const o of options) {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    const id = uid(`${name}-${opt.value}`);
    const control = el('input', {
      type: 'checkbox',
      id,
      name,
      value: String(opt.value),
      checked: values.map(String).includes(String(opt.value)),
      dataset: { multi: 'true' },
    });
    controls.push(control);
    body.append(el('label', { class: 'check', attrs: { for: id } }, control, el('span', { class: 'check__text' }, opt.label)));
  }
  const wrap = el('fieldset', { class: 'fieldset', dataset: { field: name } }, el('legend', { text: legend }), body, hint ? el('span', { class: 'field__hint', text: hint }) : null);
  return { wrap, controls };
}

/** A fieldset wrapper. */
export function fieldset(legend, children, { id } = {}) {
  return el('fieldset', { class: 'fieldset', attrs: id ? { id } : {} }, el('legend', { text: legend }), ...children);
}

/** A <details> block for advanced filters. */
export function advanced(children, { open = false, label = 'Filtri avanzati' } = {}) {
  return el('details', { class: 'advanced', open }, el('summary', { text: label }), el('div', { class: 'advanced__body stack' }, ...children));
}

/** Read every named control under `root` into a flat object. */
export function readValues(root) {
  const values = {};
  for (const ctrl of root.querySelectorAll('input[name], select[name], textarea[name]')) {
    const name = ctrl.name;
    if (ctrl.disabled) continue;
    if (ctrl.type === 'checkbox') {
      if (ctrl.dataset.multi !== undefined) {
        if (!Array.isArray(values[name])) values[name] = [];
        if (ctrl.checked) values[name].push(ctrl.value);
      } else {
        values[name] = ctrl.checked;
      }
    } else if (ctrl.type === 'radio') {
      if (ctrl.checked) values[name] = ctrl.value;
    } else {
      values[name] = ctrl.value;
    }
  }
  return values;
}

export function clearErrors(root) {
  for (const span of root.querySelectorAll('.field__error')) span.textContent = '';
  for (const ctrl of root.querySelectorAll('[aria-invalid="true"]')) ctrl.removeAttribute('aria-invalid');
}

/** Set an error message on the field named `name`. */
export function setError(root, name, message) {
  const wrap = root.querySelector(`[data-field="${cssEscape(name)}"]`);
  if (!wrap) return;
  const span = wrap.querySelector('.field__error');
  if (span) span.textContent = message;
  const ctrl = wrap.querySelector('input, select, textarea');
  if (ctrl) ctrl.setAttribute('aria-invalid', 'true');
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}
