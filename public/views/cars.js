/**
 * Auto — pickup/dropoff autocomplete with explicit airport choice, filters,
 * results and checkout.
 */
import { attachAutocomplete } from '../components/autocomplete.js';
import { humanError, openCheckout, vertical } from '../components/api.js';
import { openDrawer } from '../components/drawer.js';
import { clear, el, icon, render as renderNodes } from '../components/dom.js';
import { advanced, checkField, clearErrors, dateField, field, fieldset, numberField, readValues, selectField, setError, textField } from '../components/fields.js';
import { formatDate, formatPrice, formatTime, isoDateInDays } from '../components/format.js';
import { buildCarSearchArgs, missingRequired } from '../components/params.js';
import { badge, emptyState, errorState, idleState, kv, LONG_SEARCH_HINT, searchCostHint, skeletonGrid, startSearchClock } from '../components/states.js';
import { carCard, resultsHeader } from '../components/results.js';
import { sortOffers } from '../components/sort.js';

const SORT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'price', label: 'Prezzo più basso' },
  { value: 'supplier', label: 'Agenzia' },
];

export function render(ctx) {
  const { outlet, announce } = ctx;
  const apiV = vertical('cars');
  const state = { offers: [], meta: null, lastArgs: null };
  const sel = { pickup: null, dropoff: null };

  /* ---------------- form ---------------- */
  const pickupField = textField({ name: 'pickupDisplay', label: 'Luogo di ritiro', placeholder: 'Es. MXP, Malpensa…', hint: 'Scegli un aeroporto dall\'elenco', required: true });
  const dropoffField = textField({ name: 'dropoffDisplay', label: 'Luogo di riconsegna', placeholder: 'Es. MXP, Malpensa…', required: true });
  const pickupDate = dateField({ name: 'pickupDate', label: 'Data di ritiro', required: true });
  const pickupTime = field({ name: 'pickupTime', type: 'time', label: 'Ora di ritiro', value: '10:00' });
  const dropoffDate = dateField({ name: 'dropoffDate', label: 'Data di riconsegna', required: true });
  const dropoffTime = field({ name: 'dropoffTime', type: 'time', label: 'Ora di riconsegna', value: '10:00' });

  const adv = advanced([
    selectField({
      name: 'carType',
      label: 'Tipo auto',
      options: ['', 'Economy', 'Compact', 'Midsize', 'Fullsize', 'SUV', 'Minivan', 'Luxury'].map((v) => ({ value: v, label: v || 'Qualsiasi' })),
    }).wrap,
    el('div', { class: 'grid-2' }, selectField({ name: 'transmission', label: 'Cambio', options: [{ value: '', label: 'Qualsiasi' }, { value: 'Automatic', label: 'Automatico' }, { value: 'Manual', label: 'Manuale' }] }).wrap, selectField({ name: 'fuel', label: 'Carburante', options: [{ value: '', label: 'Qualsiasi' }, { value: 'Petrol', label: 'Benzina' }, { value: 'Diesel', label: 'Diesel' }, { value: 'Electric', label: 'Elettrico' }, { value: 'Hybrid', label: 'Ibrido' }] }).wrap),
    el('div', { class: 'grid-2' }, selectField({ name: 'mileage', label: 'Chilometraggio', options: [{ value: '', label: 'Qualsiasi' }, { value: 'Unlimited', label: 'Illimitato' }, { value: 'Limited', label: 'Limitato' }] }).wrap, selectField({ name: 'payment', label: 'Pagamento', options: [{ value: '', label: 'Qualsiasi' }, { value: 'prepaid', label: 'Prepagato' }, { value: 'postpaid', label: 'Pagamento in loco' }] }).wrap),
    checkField({ name: 'freeCancellation', label: 'Cancellazione gratuita' }).wrap,
    el('div', { class: 'grid-2' }, numberField({ name: 'passengersMin', label: 'Passeggeri min', min: 1, max: 9 }).wrap, numberField({ name: 'passengersMax', label: 'Passeggeri max', min: 1, max: 9 }).wrap),
    textField({ name: 'agency', label: 'Agenzia', placeholder: 'Es. Hertz, Avis' }).wrap,
    el('div', { class: 'grid-2' }, selectField({ name: 'sortBy', label: 'Ordina per', options: SORT_OPTIONS }).wrap, numberField({ name: 'limit', label: 'Risultati per pagina', min: 1, max: 100, placeholder: 'auto' }).wrap),
  ]);

  const submitBtn = el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, icon('M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', { size: 16 }), 'Cerca auto');
  // Reserved-height line: setting/clearing the hint never shifts the layout.
  const searchHint = el('p', { class: 'card__sub', attrs: { 'aria-live': 'polite', style: 'min-height: 1.2em; margin: 0' } });
  const form = el(
    'form',
    { class: 'form', attrs: { novalidate: '' } },
    fieldset('Ritiro', [pickupField.wrap, el('div', { class: 'grid-2' }, pickupDate.wrap, pickupTime.wrap)]),
    fieldset('Riconsegna', [dropoffField.wrap, el('div', { class: 'grid-2' }, dropoffDate.wrap, dropoffTime.wrap)]),
    adv,
    submitBtn,
    searchCostHint(),
    searchHint,
  );

  const attachLocations = (input, onPick) =>
    attachAutocomplete(input, {
      load: async (term) => (await apiV.locations({ term })).data.locations || [],
      itemLabel: (it) => (it.code ? `${it.code} · ${it.name}` : it.name),
      itemSub: (it) => [it.city, it.country].filter(Boolean).join(', '),
      onSelect: onPick,
    });
  attachLocations(pickupField.control, (it) => {
    sel.pickup = it;
  });
  attachLocations(dropoffField.control, (it) => {
    sel.dropoff = it;
  });

  /* ---------------- layout ---------------- */
  const resultsEl = el('div', { class: 'results' });
  const panel = el('section', { class: 'panel panel--sticky' }, el('h2', { attrs: { style: 'font-size: var(--text-xl); margin-bottom: var(--space-4)' }, text: 'Cerca auto' }), form);
  renderNodes(
    outlet,
    el(
      'div',
      { class: 'page-head' },
      el('div', {}, el('h1', { text: 'Auto' }), el('p', { class: 'page-head__meta', text: 'Noleggio auto sull\'inventario RouteStack.' })),
      el('button', { class: 'example', type: 'button', onClick: fillExample }, icon('M12 5v14M5 12h14', { size: 16 }), 'Esempio: Malpensa, 5 giorni'),
    ),
    el('div', { class: 'vertical-grid' }, panel, resultsEl),
  );

  showIdle();

  /* ---------------- behaviour ---------------- */
  function fillExample() {
    pickupField.control.value = 'MXP · Malpensa Airport';
    sel.pickup = { code: 'MXP', name: 'Malpensa Airport' };
    dropoffField.control.value = 'MXP · Malpensa Airport';
    sel.dropoff = { code: 'MXP', name: 'Malpensa Airport' };
    pickupDate.control.value = isoDateInDays(30);
    dropoffDate.control.value = isoDateInDays(35);
    announce('Esempio compilato: ritiro e riconsegna a Malpensa.');
  }

  function showIdle() {
    renderNodes(resultsEl, idleState({ title: 'Cerca un\'auto', text: 'Scegli i luoghi di ritiro e riconsegna dall\'elenco, indica date e orari, poi premi “Cerca auto”.', exampleLabel: 'Prova Malpensa', onExample: fillExample }));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const values = { ...readValues(form) };
    values.pickup = sel.pickup || { name: pickupField.control.value, code: '' };
    values.dropoff = sel.dropoff || { name: dropoffField.control.value, code: '' };
    const missing = missingRequired('cars', values);
    if (missing.length) {
      announce(`Campi mancanti: ${missing.join(', ')}.`);
      if (!values.pickup?.name) setError(form, 'pickupDisplay', 'Scegli un luogo di ritiro dall\'elenco.');
      if (!values.pickupDate) setError(form, 'pickupDate', 'Inserisci la data di ritiro.');
      if (!values.dropoff?.name) setError(form, 'dropoffDisplay', 'Scegli un luogo di riconsegna dall\'elenco.');
      if (!values.dropoffDate) setError(form, 'dropoffDate', 'Inserisci la data di riconsegna.');
      return;
    }

    const args = buildCarSearchArgs(values);
    state.lastArgs = args;
    submitBtn.disabled = true;
    clear(submitBtn);
    const searchLabel = el('span', { text: 'Ricerca in corso…' });
    submitBtn.append(el('span', { class: 'spinner' }), ' ', searchLabel);
    searchHint.textContent = LONG_SEARCH_HINT;
    const stopClock = startSearchClock({ onTick: (s) => { searchLabel.textContent = `Ricerca in corso… ${s}s`; } });
    announce('Ricerca auto in corso.');
    showSkeletons();
    try {
      const { data, meta } = await apiV.search(args);
      state.offers = data.offers || [];
      state.meta = { ...data, ...meta };
      if (!state.offers.length) {
        renderNodes(resultsEl, emptyState({ title: 'Nessuna auto trovata', text: 'Prova a cambiare luoghi, date o a rimuovere i filtri.' }));
        announce('Nessuna auto trovata.');
      } else {
        renderResults();
        announce(`${state.offers.length} auto trovate.`);
      }
    } catch (err) {
      renderNodes(resultsEl, errorState(err));
      announce(`Errore: ${humanError(err).title}.`);
    } finally {
      stopClock();
      searchHint.textContent = '';
      submitBtn.disabled = false;
      clear(submitBtn);
      submitBtn.append(icon('M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', { size: 16 }), 'Cerca auto');
    }
  });

  function showSkeletons() {
    renderNodes(resultsEl, el('div', { class: 'results', attrs: { 'aria-busy': 'true' } }, skeletonGrid(6)));
  }

  function renderResults() {
    const grid = el('div', { class: 'card-grid' });
    for (const offer of state.offers) grid.append(carCard(offer, { onOpen: openCar }));
    renderNodes(
      resultsEl,
      resultsHeader({
        count: state.meta?.count ?? state.offers.length,
        status: state.meta?.status,
        source: state.meta?.source,
        sortBy: state.lastArgs?.sortBy || '',
        sortOptions: SORT_OPTIONS,
        // Local sort only: reorder the already-fetched offers and re-render.
        // Never re-submit — the /search call is billable.
        onSort: (v) => {
          state.lastArgs = { ...state.lastArgs, sortBy: v || undefined };
          state.offers = sortOffers(state.offers, v, 'cars');
          renderResults();
        },
      }),
      grid,
    );
  }

  function openCar(offer) {
    const body = el(
      'div',
      { class: 'stack' },
      el('div', {}, el('div', { class: 'card__title', text: offer.model || 'Veicolo' }), el('div', { class: 'card__sub', text: offer.supplier || '' })),
      kv([
        ['Categoria', offer.carType],
        ['Cambio', offer.transmission],
        ['Carburante', offer.fuel],
        ['Posti', offer.seats],
        ['Porte', offer.doors],
        ['Chilometraggio', offer.mileage],
        ['Aria condizionata', offer.airConditioning === true ? 'Sì' : offer.airConditioning === false ? 'No' : null],
        ['Ritiro', offer.pickupLocation || state.lastArgs?.pickup?.name],
        ['Riconsegna', offer.dropoffLocation || state.lastArgs?.dropoff?.name],
        ['Prezzo', formatPrice(offer.price, offer.currency)],
        ['Fare code', offer.fareCode],
      ]),
      el('div', { class: 'card__meta' }, offer.prepaid ? badge('prepagato', 'info') : badge('pagamento in loco'), offer.freeCancellation ? badge('cancellazione gratuita', 'success') : null),
      el('p', { class: 'card__sub', text: `Ritiro previsto: ${formatDate(state.lastArgs?.pickup?.date)} ${formatTime(state.lastArgs?.pickup?.time)}` }),
    );

    const checkoutBtn = el('button', { class: 'btn btn--accent btn--block', type: 'button' }, icon('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3', { size: 16 }), 'Link di checkout');
    const status = el('p', { class: 'card__sub', attrs: { role: 'status' } });
    checkoutBtn.addEventListener('click', async () => {
      checkoutBtn.disabled = true;
      clear(checkoutBtn);
      checkoutBtn.append(el('span', { class: 'spinner' }), ' Generazione…');
      status.textContent = 'Revalidazione dell\'offerta…';
      try {
        await apiV.revalidate({ offerId: offer.offerId, fareCode: offer.fareCode, correlationId: state.meta?.correlationId, car: offer.raw, prepaid: offer.prepaid });
        status.textContent = 'Generazione del link di checkout…';
        const { data } = await apiV.checkout({
          correlationId: state.meta?.correlationId,
          offerId: offer.offerId,
          fareCode: offer.fareCode,
          pickup: state.lastArgs?.pickup,
          dropoff: state.lastArgs?.dropoff,
          pickupDate: state.lastArgs?.pickup?.date,
          dropoffDate: state.lastArgs?.dropoff?.date,
          pickupTime: state.lastArgs?.pickup?.time,
          dropoffTime: state.lastArgs?.dropoff?.time,
          car: offer.raw,
        });
        const opened = openCheckout(data.url);
        status.textContent = data.url ? `Modalità ${data.checkoutMode}: link ${opened ? 'aperto in una nuova scheda' : 'generato (consenti i popup)'}.` : 'Nessun link restituito.';
      } catch (err) {
        status.textContent = `${humanError(err).title}: ${err.message}`;
      } finally {
        checkoutBtn.disabled = false;
        clear(checkoutBtn);
        checkoutBtn.append(icon('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3', { size: 16 }), 'Link di checkout');
      }
    });

    openDrawer({ title: offer.model || 'Dettaglio auto', body, footer: [checkoutBtn, status] });
  }
}

export default { render };
