/**
 * Tiny DOM helpers. No framework, no build step.
 */

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [props] class/text/html/attrs/dataset/on*/DOM props
 * @param {...(Node|string|null|undefined|Array)} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'attrs') {
        for (const [a, b] of Object.entries(value)) {
          if (b === null || b === undefined || b === false) continue;
          node.setAttribute(a, b === true ? '' : String(b));
        }
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node[key] = value;
      }
    }
  }
  append(node, children);
  return node;
}

/** Append children, flattening arrays and skipping empty values. */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Remove all children. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Replace all children of `node` with `children`. */
export function render(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

/** Shorthand for querying. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an inline SVG icon (stroke-based, 24x24 viewBox). */
export function icon(paths, { size = 20, cls = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const list = Array.isArray(paths) ? paths : [paths];
  for (const d of list) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
