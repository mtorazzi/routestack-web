/**
 * Regression test for the "Salva" button that never submitted the form.
 *
 * The settings view used to render the action row (with a `type="submit"`
 * button) *outside* the <form>, so clicking "Salva" did nothing and the submit
 * listener never fired. `public/views/settings.js` touches the document, so we
 * provide a deliberately small DOM stub here, render the view with a stub
 * `ctx`, and then drive a real submit event.
 *
 * The stub is not a browser: it only implements what the settings view, the
 * field helpers and `dom.js` actually use. That is enough to assert the
 * structural invariant (a submit button inside the form) and to prove that a
 * dispatched submit reaches `fetch` with the typed credentials.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// ---------------------------------------------------------------------------
// Minimal DOM stub
// ---------------------------------------------------------------------------

class Node {}

class TextNode extends Node {
  constructor(text) {
    super();
    this.nodeType = 3;
    this.textContent = String(text);
    this.parentNode = null;
    this.children = [];
  }
}

class Element extends Node {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.id = '';
    this.textContent = '';
    this.innerHTML = '';
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this._listeners = new Map();
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get classList() {
    const self = this;
    const parts = () => self.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => parts().includes(c),
      add: (...cs) => {
        const set = new Set(parts());
        for (const c of cs) set.add(c);
        self.className = [...set].join(' ');
      },
      remove: (...cs) => {
        const set = new Set(parts());
        for (const c of cs) set.delete(c);
        self.className = [...set].join(' ');
      },
      toggle: (c) => (parts().includes(c) ? self.classList.remove(c) : self.classList.add(c)),
    };
  }

  append(...nodes) {
    for (const n of nodes) {
      const child = n instanceof Node ? n : new TextNode(n);
      child.parentNode = this;
      this.children.push(child);
    }
    return this;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) {
      this.children.splice(i, 1);
      child.parentNode = null;
    }
    return child;
  }

  replaceChildren(...nodes) {
    this.children = [];
    return this.append(...nodes);
  }

  setAttribute(name, value) {
    const v = String(value);
    this.attributes.set(name, v);
    if (name === 'class') this.className = v;
    if (name === 'id') this.id = v;
  }

  getAttribute(name) {
    if (this.attributes.has(name)) return this.attributes.get(name);
    const v = this[name];
    return v === undefined || v === null ? null : String(v);
  }

  hasAttribute(name) {
    if (this.attributes.has(name)) return true;
    const v = this[name];
    return v !== undefined && v !== null && v !== '' && v !== false;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    for (const handler of this._listeners.get(event.type) || []) handler.call(this, event);
    return !event.defaultPrevented;
  }

  querySelectorAll(selector) {
    const matchers = selector.split(',').map((s) => compile(s.trim()));
    const out = [];
    for (const node of descendants(this)) {
      if (matchers.some((m) => m(node))) out.push(node);
    }
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function* descendants(node) {
  for (const child of node.children || []) {
    if (child.nodeType === 1) {
      yield child;
      yield* descendants(child);
    }
  }
}

function compile(selector) {
  const tag = (selector.match(/^[a-zA-Z][\w-]*/) || [null])[0];
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const idMatch = selector.match(/#([\w-]+)/);
  const attrs = [...selector.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)].map((m) => ({ name: m[1], value: m[2] }));
  return (node) => {
    if (node.nodeType !== 1) return false;
    if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    if (idMatch && node.getAttribute('id') !== idMatch[1]) return false;
    if (classes.some((c) => !node.classList.contains(c))) return false;
    for (const a of attrs) {
      if (!node.hasAttribute(a.name)) return false;
      if (a.value !== undefined && node.getAttribute(a.name) !== a.value) return false;
    }
    return true;
  };
}

const documentStub = {
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  createTextNode: (text) => new TextNode(text),
};

globalThis.Node = Node;
globalThis.document = documentStub;
globalThis.window = { confirm: () => true, open: () => null };

// ---------------------------------------------------------------------------
// Fixture + test
// ---------------------------------------------------------------------------

// Fresh install: no credentials saved yet, so apiKey/apiSecret are editable and
// no "Modifica" buttons are rendered. All values are dummies.
const baseConfig = {
  authMode: 'partner-token',
  apiKeySet: false,
  apiKey: '',
  apiSecretSet: false,
  apiSecret: '',
  accountIdSet: false,
  accountId: '',
  credentialsResolvedFrom: {},
  baseUrl: 'https://mcp.routestack.ai/mcp',
  prodUrl: 'https://mcp.routestack.ai/mcp',
  sandboxUrl: 'https://evolvemcp.routestack.ai/mcp',
  sandbox: false,
  currency: 'EUR',
  timeoutMs: 30000,
  source: 'none',
  configPath: '/tmp/config/secrets.json',
  host: '127.0.0.1',
};

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

test('settings: submit button lives inside the form and Salva posts credentials', async () => {
  const { render } = await import('../public/views/settings.js?settings-dom-test');

  const outlet = documentStub.createElement('div');
  const posted = [];
  const announced = [];

  globalThis.fetch = async (url, opts = {}) => {
    posted.push({
      url,
      method: opts.method,
      body: opts.body ? JSON.parse(opts.body) : undefined,
    });
    return { status: 200, ok: true, async json() { return { ok: true, data: baseConfig }; } };
  };

  render({ outlet, config: baseConfig, announce: (m) => announced.push(m), setConfig: () => {} });
  await flush();

  const form = outlet.querySelector('form');
  assert.ok(form, 'the settings view must render a <form>');

  // Structural invariant that was broken before: the submit button must be a
  // descendant of the form. This is the assertion that fails on the old code.
  const submit = form.querySelector('button[type="submit"]');
  assert.ok(submit, 'a type="submit" button must exist *inside* the form');

  assert.equal(form.getAttribute('id'), 'settings-form');
  assert.equal(submit.getAttribute('form'), 'settings-form', 'submit is also bound via the form attribute');

  // The other action buttons must not submit.
  const nonSubmit = form.querySelectorAll('button[type="button"]').map((b) => b.getAttribute('type'));
  assert.ok(nonSubmit.length >= 2, 'test/remove buttons stay type="button"');

  // Fill the first-entry credentials and drive a real submit event.
  form.querySelector('input[name="apiKey"]').value = 'dummy-key-1234';
  form.querySelector('input[name="apiSecret"]').value = 'dummy-secret-1234';

  let prevented = false;
  form.dispatchEvent({ type: 'submit', preventDefault() { prevented = true; this.defaultPrevented = true; } });
  await flush();

  assert.ok(prevented, 'the submit handler must call preventDefault');

  assert.equal(posted.length, 1, 'exactly one save request');
  assert.equal(posted[0].url, '/api/config');
  assert.equal(posted[0].method, 'POST');
  assert.equal(posted[0].body.apiKey, 'dummy-key-1234');
  assert.equal(posted[0].body.apiSecret, 'dummy-secret-1234');
  assert.deepEqual(announced, ['Impostazioni salvate.']);
});
