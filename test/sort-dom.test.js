/**
 * DOM-stub regression test for the results-header sort.
 *
 * The defect: changing the header "Ordina" select used to dispatch a form
 * `submit`, which re-ran `POST /api/{flights,hotels,cars}/search` — three
 * **billable** calls. The fix reorders the already-fetched rows locally and
 * re-renders.
 *
 * This test loads the real view modules in Node against an extended version of
 * the minimal DOM stub used by `test/settings-dom.test.js` (the three views also
 * exercise the autocomplete, which needs `replaceWith` / `after` /
 * `parentElement`). Each vertical is rendered, a search is driven once through a
 * stubbed `fetch`, then the header select is changed and we assert:
 *   (a) the rendered order changed as expected, and
 *   (b) `fetch` was called **zero extra times** for that interaction.
 *
 * The same stub serves all three views cheaply, so flights, hotels and cars are
 * all covered — no network, no billable call.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// ---------------------------------------------------------------------------
// Minimal DOM stub (settings-dom.test.js + autocomplete needs)
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
    this.offsetParent = null;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get parentElement() {
    return this.parentNode;
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

  replaceWith(node) {
    const parent = this.parentNode;
    if (!parent) return;
    const i = parent.children.indexOf(this);
    const child = node instanceof Node ? node : new TextNode(node);
    child.parentNode = parent;
    parent.children.splice(i, 1, child);
    this.parentNode = null;
  }

  after(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const i = parent.children.indexOf(this);
    const inserted = nodes.map((n) => (n instanceof Node ? n : new TextNode(n)));
    for (const n of inserted) n.parentNode = parent;
    parent.children.splice(i + 1, 0, ...inserted);
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  focus() {}
  scrollIntoView() {}

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
  activeElement: null,
  body: new Element('body'),
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  createTextNode: (text) => new TextNode(text),
  addEventListener: () => {},
  removeEventListener: () => {},
};

globalThis.Node = Node;
globalThis.HTMLElement = Element;
globalThis.document = documentStub;
globalThis.window = { confirm: () => true, open: () => null };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function okResponse(data) {
  return {
    status: 200,
    ok: true,
    async json() {
      return { ok: true, data, meta: {} };
    },
  };
}

const baseConfig = { currency: 'EUR', sandbox: false, baseUrl: 'x' };

/** Cards' titles in DOM order (flights/hotels/cars set them as text). */
function titlesInOrder(root) {
  const grid = root.querySelector('.card-grid');
  assert.ok(grid, 'expected a rendered .card-grid');
  return grid.querySelectorAll('.card__title').map((n) => n.textContent);
}

/** Change the results-header sort select and dispatch a real change event. */
function chooseSort(root, value) {
  const select = root.querySelector('select[aria-label="Ordina i risultati"]');
  assert.ok(select, 'expected the results-header sort <select>');
  select.value = value;
  select.dispatchEvent({ type: 'change' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('flights: header sort reorders locally and never re-searches', async () => {
  const { render } = await import('../public/views/flights.js?sort-dom-flights');
  const outlet = documentStub.createElement('div');
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : undefined });
    return okResponse({
      offers: [
        { fareSourceCode: 'F3', ourprice: 300, airline: 'Charlie', departureTime: '2027-08-20T18:00:00', duration: '13h 20m', currency: 'EUR' },
        { fareSourceCode: 'F1', ourprice: 100, airline: 'Alpha', departureTime: '2027-08-20T06:00:00', duration: '10h 00m', currency: 'EUR' },
        { fareSourceCode: 'F2', ourprice: 200, airline: 'Bravo', departureTime: '2027-08-20T12:00:00', duration: '11h 30m', currency: 'EUR' },
      ],
      count: 3,
      status: 'Complete',
      source: 'production',
    });
  };

  render({ outlet, config: baseConfig, announce: () => {} });
  const form = outlet.querySelector('form');
  form.querySelector('input[name="originDisplay"]').value = 'MXP';
  form.querySelector('input[name="destinationDisplay"]').value = 'BKK';
  form.querySelector('input[name="departureDate"]').value = '2027-08-20';
  form.querySelector('select[name="cabinClass"]').value = 'Economy';

  form.dispatchEvent({ type: 'submit', preventDefault() { this.defaultPrevented = true; } });
  await flush();

  assert.deepEqual(titlesInOrder(outlet), ['Charlie', 'Alpha', 'Bravo'], 'initial server order');
  const afterSearch = calls.length;
  assert.equal(afterSearch, 1, 'exactly one billable search so far');
  assert.match(calls[0].url, /\/api\/flights\/search$/);

  chooseSort(outlet, 'price');
  await flush();

  assert.deepEqual(titlesInOrder(outlet), ['Alpha', 'Bravo', 'Charlie'], 'cheapest first');
  assert.equal(calls.length, afterSearch, 'the sort must not call fetch again');

  chooseSort(outlet, 'duration');
  await flush();
  assert.deepEqual(titlesInOrder(outlet), ['Alpha', 'Bravo', 'Charlie'], 'shortest first');
  assert.equal(calls.length, afterSearch, 'duration sort is still local');
});

test('hotels: header sort reorders locally and never re-searches', async () => {
  const { render } = await import('../public/views/hotels.js?sort-dom-hotels');
  const outlet = documentStub.createElement('div');
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : undefined });
    return okResponse({
      hotels: [
        { hotelId: 'H3', name: 'Charlie', ourprice: 300, stars: 3, rating: 7.1, savingsPercent: 5, currency: 'EUR' },
        { hotelId: 'H1', name: 'Alpha', ourprice: 100, stars: 5, rating: 9.2, savingsPercent: 30, currency: 'EUR' },
        { hotelId: 'H2', name: 'Bravo', ourprice: 200, stars: 4, rating: 8.4, savingsPercent: 15, currency: 'EUR' },
      ],
      count: 3,
      status: 'Complete',
      source: 'production',
      correlationId: 'corr-dummy',
      token: 'tok-dummy',
      nextResultsKey: null,
    });
  };

  render({ outlet, config: baseConfig, announce: () => {} });
  const form = outlet.querySelector('form');
  form.querySelector('input[name="destinationDisplay"]').value = 'Rome, Italy';
  form.querySelector('input[name="checkIn"]').value = '2027-08-20';
  form.querySelector('input[name="checkOut"]').value = '2027-08-25';

  form.dispatchEvent({ type: 'submit', preventDefault() { this.defaultPrevented = true; } });
  await flush();

  assert.deepEqual(titlesInOrder(outlet), ['Charlie', 'Alpha', 'Bravo'], 'initial server order');
  const afterSearch = calls.length;
  assert.equal(afterSearch, 1, 'exactly one billable search so far');
  assert.match(calls[0].url, /\/api\/hotels\/search$/);

  chooseSort(outlet, 'price');
  await flush();
  assert.deepEqual(titlesInOrder(outlet), ['Alpha', 'Bravo', 'Charlie'], 'cheapest first');

  chooseSort(outlet, 'rating');
  await flush();
  assert.deepEqual(titlesInOrder(outlet), ['Alpha', 'Bravo', 'Charlie'], 'best rating first');

  chooseSort(outlet, 'stars');
  await flush();
  assert.deepEqual(titlesInOrder(outlet), ['Alpha', 'Bravo', 'Charlie'], 'best category first');

  assert.equal(calls.length, afterSearch, 'no sort interaction may call fetch again');
});

test('cars: header sort reorders locally and never re-searches', async () => {
  const { render } = await import('../public/views/cars.js?sort-dom-cars');
  const outlet = documentStub.createElement('div');
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : undefined });
    return okResponse({
      offers: [
        { offerId: 'C3', model: 'Charlie', supplier: 'Hertz', price: 300, currency: 'EUR' },
        { offerId: 'C1', model: 'Alpha', supplier: 'Avis', price: 100, currency: 'EUR' },
        { offerId: 'C2', model: 'Bravo', supplier: 'Green Motion', price: 200, currency: 'EUR' },
      ],
      count: 3,
      status: 'Complete',
      source: 'production',
    });
  };

  render({ outlet, config: baseConfig, announce: () => {} });
  const form = outlet.querySelector('form');
  form.querySelector('input[name="pickupDisplay"]').value = 'MXP';
  form.querySelector('input[name="dropoffDisplay"]').value = 'MXP';
  form.querySelector('input[name="pickupDate"]').value = '2027-08-20';
  form.querySelector('input[name="dropoffDate"]').value = '2027-08-25';

  form.dispatchEvent({ type: 'submit', preventDefault() { this.defaultPrevented = true; } });
  await flush();

  assert.deepEqual(titlesInOrder(outlet), ['Charlie', 'Alpha', 'Bravo'], 'initial server order');
  const afterSearch = calls.length;
  assert.equal(afterSearch, 1, 'exactly one billable search so far');
  assert.match(calls[0].url, /\/api\/cars\/search$/);

  chooseSort(outlet, 'price');
  await flush();
  assert.deepEqual(titlesInOrder(outlet), ['Alpha', 'Bravo', 'Charlie'], 'cheapest first');
  assert.equal(calls.length, afterSearch, 'the sort must not call fetch again');
});
