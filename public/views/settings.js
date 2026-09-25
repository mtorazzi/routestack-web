/**
 * Impostazioni — credenziali, modalità auth, preferenze e test connessione.
 * I segreti sono sempre mascherati finché non si preme "Modifica".
 */
import { deleteConfig, getConfig, humanError, saveConfig, testConfig } from '../components/api.js';
import { clear, el, icon, render as renderNodes } from '../components/dom.js';
import { checkField, clearErrors, field, fieldset, numberField, radioField, readValues, selectField } from '../components/fields.js';
import { formatDate } from '../components/format.js';
import { buildConfigPatch } from '../components/params.js';
import { errorState, kv } from '../components/states.js';

export function render(ctx) {
  const { outlet, announce, setConfig, config } = ctx;
  const state = { config: config || null, editing: { apiKey: false, apiSecret: false, accountId: false }, test: null };

  renderNodes(outlet, el('p', { class: 'state__text' }, 'Caricamento configurazione…'));

  (async () => {
    try {
      const { data } = state.config ? { data: state.config } : await getConfig();
      state.config = data;
      setConfig?.(data);
      renderSettings();
    } catch (err) {
      renderNodes(outlet, el('div', { class: 'stack' }, el('h1', { text: 'Impostazioni' }), errorState(err)));
    }
  })();

  function renderSettings() {
    const cfg = state.config;

    const authMode = radioField({
      name: 'authMode',
      legend: 'Modalità di autenticazione',
      value: cfg.authMode || 'partner-token',
      options: [
        { value: 'partner-token', label: 'Partner token (JWT)', hint: 'consigliato' },
        { value: 'header', label: 'Header', hint: 'X-Api-Key + X-Account-Id' },
      ],
    });

    const apiKey = secretField({ name: 'apiKey', label: 'API key', set: cfg.apiKeySet, masked: cfg.apiKey, source: cfg.credentialsResolvedFrom?.apiKey });
    const apiSecret = secretField({ name: 'apiSecret', label: 'API secret', set: cfg.apiSecretSet, masked: cfg.apiSecret, source: cfg.credentialsResolvedFrom?.apiSecret });
    const accountId = secretField({ name: 'accountId', label: 'Account ID', set: cfg.accountIdSet, masked: cfg.accountId, source: cfg.credentialsResolvedFrom?.accountId });

    const baseUrl = field({ name: 'baseUrl', label: 'Base URL MCP', value: cfg.baseUrl, hint: `Produzione: ${cfg.prodUrl} · Sandbox: ${cfg.sandboxUrl}` });
    const sandbox = checkField({ name: 'sandbox', label: 'Usa ambiente sandbox', checked: Boolean(cfg.sandbox), hint: cfg.sandbox ? '(sandbox non disponibile con queste credenziali)' : '' });
    const currency = selectField({ name: 'currency', label: 'Valuta predefinita', options: ['EUR', 'USD', 'GBP'], value: cfg.currency });
    const timeout = numberField({ name: 'timeoutMs', label: 'Timeout (ms)', value: String(cfg.timeoutMs), min: 1000, max: 120000, step: 1000 });

    const form = el(
      'form',
      { class: 'form', attrs: { novalidate: '' } },
      fieldset('Autenticazione', [authMode.wrap, apiKey.wrap, apiSecret.wrap, accountId.wrap]),
      fieldset('Connessione', [baseUrl.wrap, sandbox.wrap]),
      fieldset('Preferenze', [el('div', { class: 'grid-2' }, currency.wrap, timeout.wrap)]),
    );

    const testBtn = el('button', { class: 'btn btn--ghost', type: 'button' }, icon('M22 12h-4l-3 9L9 3l-3 9H2', { size: 16 }), 'Test connessione');
    const saveBtn = el('button', { class: 'btn btn--primary', type: 'submit' }, icon('M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8', { size: 16 }), 'Salva');
    const removeBtn = el('button', { class: 'btn btn--danger', type: 'button' }, icon('M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', { size: 16 }), 'Rimuovi credenziali');

    const testResult = el('div', { attrs: { 'aria-live': 'polite' } });

    const actions = el('div', { class: 'row' }, testBtn, saveBtn, removeBtn);
    const panel = el('section', { class: 'panel' }, el('h2', { attrs: { style: 'margin-bottom: var(--space-4)' }, text: 'Credenziali e preferenze' }), form, el('hr', { class: 'divider' }), actions, testResult);

    const resolution = el(
      'aside',
      { class: 'panel' },
      el('h3', { text: 'Ordine di risoluzione' }),
      el('p', { class: 'card__sub', text: 'Le credenziali sono risolte in quest\'ordine: file di configurazione, poi variabili d\'ambiente.' }),
      el(
        'ol',
        { attrs: { style: 'margin: 0; padding-left: 1.2em; font-size: var(--text-sm)' } },
        el('li', {}, el('code', { text: 'config/secrets.json' }), ' (permessi 0600)'),
        el('li', {}, el('code', { text: 'ROUTESTACK_API_KEY' }), ', ', el('code', { text: 'ROUTESTACK_API_SECRET' }), ', ', el('code', { text: 'ROUTESTACK_ACCOUNT_ID' })),
      ),
      el('hr', { class: 'divider' }),
      kv([
        ['Sorgente attiva', cfg.source],
        ['Percorso config', cfg.configPath],
        ['Host', cfg.host],
      ]),
    );

    renderNodes(
      outlet,
      el('div', { class: 'page-head' }, el('div', {}, el('h1', { text: 'Impostazioni' }), el('p', { class: 'page-head__meta', text: 'Configura l\'accesso a RouteStack e le preferenze dell\'interfaccia.' }))),
      el('div', { class: 'vertical-grid' }, panel, resolution),
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      const values = readValues(form);
      const patch = buildConfigPatch(values, state.editing);
      saveBtn.disabled = true;
      try {
        const { data } = await saveConfig(patch);
        state.config = data;
        setConfig?.(data);
        state.editing = { apiKey: false, apiSecret: false, accountId: false };
        renderSettings();
        announce('Impostazioni salvate.');
      } catch (err) {
        testResult.replaceChildren(errorState(err));
        announce(`Errore: ${humanError(err).title}.`);
      } finally {
        saveBtn.disabled = false;
      }
    });

    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      clear(testBtn);
      testBtn.append(el('span', { class: 'spinner' }), ' Verifica…');
      renderNodes(testResult, el('p', { class: 'card__sub', text: 'Mint del partner token e tools/list in corso…' }));
      try {
        const { data } = await testConfig();
        state.test = data;
        renderNodes(testResult, testBlock(data));
        announce('Test connessione completato.');
      } catch (err) {
        renderNodes(testResult, errorState(err));
        announce(`Errore: ${humanError(err).title}.`);
      } finally {
        testBtn.disabled = false;
        clear(testBtn);
        testBtn.append(icon('M22 12h-4l-3 9L9 3l-3 9H2', { size: 16 }), 'Test connessione');
      }
    });

    removeBtn.addEventListener('click', async () => {
      if (!window.confirm('Rimuovere le credenziali salvate? Le preferenze resteranno invariate.')) return;
      removeBtn.disabled = true;
      try {
        const { data } = await deleteConfig();
        state.config = data;
        setConfig?.(data);
        state.editing = { apiKey: false, apiSecret: false, accountId: false };
        renderSettings();
        announce('Credenziali rimosse.');
      } catch (err) {
        testResult.replaceChildren(errorState(err));
      } finally {
        removeBtn.disabled = false;
      }
    });

    function secretField({ name, label, set, masked, source }) {
      const editing = state.editing[name];
      const hint = !set
        ? 'Non configurato'
        : editing
          ? 'Inserisci il nuovo valore e salva'
          : `Salvato: ${masked || '••••'}${source ? ` (da ${source})` : ''}`;
      const f = field({ name, label, type: 'password', value: '', placeholder: set ? '••••••••' : '', hint, attrs: { autocomplete: 'off' } });
      if (set && !editing) {
        f.control.readOnly = true;
        f.control.setAttribute('aria-readonly', 'true');
      }
      if (set) {
        const wrap = f.wrap;
        const btn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, editing ? 'Annulla' : 'Modifica');
        btn.addEventListener('click', () => {
          state.editing[name] = !state.editing[name];
          renderSettings();
        });
        wrap.append(btn);
      }
      return f;
    }
  }
}

function testBlock(data) {
  const ok = data.mintStatus === 200 || data.mode === 'header';
  return el(
    'div',
    { class: `callout ${ok ? 'callout--success' : 'callout--warning'}`, attrs: { style: 'margin-top: var(--space-4)' } },
    el('strong', { text: ok ? 'Connessione riuscita' : 'Attenzione' }),
    el(
      'div',
      { attrs: { style: 'margin-top: var(--space-2)' } },
      kv([
        ['Modalità', data.mode],
        ['Mint status', data.mintStatus],
        ['Lunghezza token', data.tokenLength],
        ['Scadenza JWT', data.tokenExpiresAt ? formatDate(data.tokenExpiresAt) : null],
        ['Validità', data.tokenExpiresIn],
        ['Tool disponibili', data.toolsCount],
        ['Durata', data.durationMs != null ? `${data.durationMs} ms` : null],
        ['Sorgente', data.source],
        ['Base URL', data.baseUrl],
      ]),
    ),
  );
}

export default { render };
