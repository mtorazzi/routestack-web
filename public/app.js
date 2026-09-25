/**
 * RouteStack Web — bootstrap.
 * Hash routing, theme toggle, accessible tablist and shared context.
 */
import { getConfig } from './components/api.js';
import { $, $$ } from './components/dom.js';
import { createRouter } from './router.js';
import carsView from './views/cars.js';
import flightsView from './views/flights.js';
import hotelsView from './views/hotels.js';
import settingsView from './views/settings.js';

const THEME_KEY = 'routestack-web:theme';
const liveRegion = $('#live-region');
const outlet = $('#app');
const tabs = $$('.tab');
const tabRoutes = tabs.map((tab) => tab.dataset.route);

let config = null;

/* --------------------------------------------------------------------------
   Theme
   -------------------------------------------------------------------------- */
function preferredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = $('#theme-toggle');
  if (toggle) {
    const dark = theme === 'dark';
    toggle.setAttribute('aria-label', dark ? 'Attiva tema chiaro' : 'Attiva tema scuro');
    toggle.setAttribute('aria-pressed', String(dark));
    toggle.replaceChildren(
      dark
        ? svgIcon('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z')
        : svgIcon('M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'),
    );
  }
}

function svgIcon(d) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}

/* --------------------------------------------------------------------------
   Shared helpers
   -------------------------------------------------------------------------- */
function announce(message) {
  if (!liveRegion) return;
  liveRegion.textContent = '';
  setTimeout(() => {
    liveRegion.textContent = message;
  }, 30);
}

const ctx = {
  outlet,
  announce,
  get config() {
    return config;
  },
  setConfig(next) {
    config = next;
  },
  navigate: (hash) => router.navigate(hash),
  reloadConfig: async () => {
    try {
      config = (await getConfig()).data;
    } catch {
      /* keep previous */
    }
    return config;
  },
};

/* --------------------------------------------------------------------------
   Tablist keyboard navigation (automatic activation)
   -------------------------------------------------------------------------- */
function setActiveTab(name) {
  const index = tabRoutes.indexOf(`#/${name}`);
  tabs.forEach((tab, i) => {
    const selected = i === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
}

function activateTab(tab) {
  const route = tab.dataset.route;
  router.navigate(route);
  tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    activateTab(tabs[next]);
  });
});

/* --------------------------------------------------------------------------
   Router
   -------------------------------------------------------------------------- */
const routes = {
  flights: flightsView.render,
  hotels: hotelsView.render,
  cars: carsView.render,
  settings: settingsView.render,
};

const router = createRouter({
  outlet,
  routes,
  fallback: flightsView.render,
  ctx,
  onNavigate: (name) => {
    setActiveTab(name);
    const main = $('#app');
    main?.focus({ preventScroll: true });
  },
});

/* --------------------------------------------------------------------------
   Start
   -------------------------------------------------------------------------- */
$('#theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});
$('#settings-link')?.addEventListener('click', () => router.navigate('#/settings'));

applyTheme(preferredTheme());

(async () => {
  try {
    config = (await getConfig()).data;
  } catch {
    config = { currency: 'EUR', source: 'production' };
  }
  if (!location.hash) location.hash = '#/flights';
  else router.render();
})();
