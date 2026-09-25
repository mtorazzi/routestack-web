/**
 * Minimal hash router. Routes: #/flights, #/hotels, #/cars, #/settings.
 */

export function parseHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#\/?/, '').split('?')[0];
  const parts = raw.split('/').filter(Boolean);
  return { name: parts[0] || 'flights', params: parts.slice(1) };
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.outlet
 * @param {Record<string, (ctx:object)=>void>} opts.routes
 * @param {(ctx:object)=>void} [opts.fallback]
 * @param {(name:string)=>void} [opts.onNavigate]
 * @param {object} [opts.ctx] extra context merged into each render
 */
export function createRouter({ outlet, routes, fallback, onNavigate, ctx = {} }) {
  function render() {
    const { name, params } = parseHash();
    const route = routes[name] || fallback || routes.flights;
    outlet.scrollTop = 0;
    onNavigate?.(name, params);
    route({ ...ctx, outlet, routeName: name, params });
  }

  function navigate(hash) {
    const target = hash.startsWith('#') ? hash : `#/${hash.replace(/^\/+/, '')}`;
    if (location.hash === target) render();
    else location.hash = target;
  }

  window.addEventListener('hashchange', render);
  return { render, navigate, current: parseHash };
}
