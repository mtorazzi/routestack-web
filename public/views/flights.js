/**
 * Voli — search form (with advanced filters) + results + detail drawer.
 */
import { attachAutocomplete } from '../components/autocomplete.js';
import { humanError, openCheckout, vertical } from '../components/api.js';
import { openDrawer } from '../components/drawer.js';
import { clear, el, icon, render as renderNodes } from '../components/dom.js';
import { advanced, clearErrors, dateField, fieldset, numberField, radioField, readValues, selectField, setError, textField } from '../components/fields.js';
import { formatDate, formatDuration, formatPrice, formatTime, isoDateInDays } from '../components/format.js';
import { buildFlightSearchArgs, missingRequired } from '../components/params.js';
import { badge, errorState, emptyState, idleState, kv, skeletonGrid } from '../components/states.js';
import { flightCard, resultsHeader } from '../components/results.js';

const CABIN_OPTIONS = [
  { value: '', label: 'Seleziona la classe…' },
  { value: 'Economy', label: 'Economy' },
  { value: 'Business', label: 'Business' },
  { value: 'First', label: 'First' },
];

const SORT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'price', label: 'Prezzo più basso' },
  { value: 'duration', label: 'Durata minore' },
  { value: 'departure', label: 'Partenza più presto' },
];

export function render(ctx) {
  const { outlet, announce, config } = ctx;
  const apiV = vertical('flights');
  const state = { offers: [], meta: null, currency: config?.currency || 'EUR', lastArgs: null };
  const sel = { origin: null, destination: null };

  /* ---------------- form ---------------- */
  const tripType = radioField({
    name: 'tripType',
    legend: 'Tipo di viaggio',
    value: 'OneWay',
    options: [
      { value: 'OneWay', label: 'Solo andata' },
      { value: 'RoundTrip', label: 'Andata e ritorno' },
    ],
    onChange: () => {
      retField.wrap.hidden = readValues(form)?.tripType !== 'RoundTrip';
    },
  });

  const originField = textField({ name: 'originDisplay', label: 'Origine', placeholder: 'Es. MXP, Milano…', hint: 'Città o aeroporto di partenza', required: true });
  const destField = textField({ name: 'destinationDisplay', label: 'Destinazione', placeholder: 'Es. BKK, Bangkok…', hint: 'Città o aeroporto di arrivo', required: true });
  const depField = dateField({ name: 'departureDate', label: 'Data di andata', required: true });
  const retField = dateField({ name: 'returnDate', label: 'Data di ritorno' });
  retField.wrap.hidden = true;

  const pax = fieldset('Passeggeri', [
    el('div', { class: 'grid-3' }, numberField({ name: 'adults', label: 'Adulti', value: '1', min: 1, max: 9 }).wrap, numberField({ name: 'children', label: 'Bambini', value: '0', min: 0, max: 8 }).wrap, numberField({ name: 'infants', label: 'Neonati', value: '0', min: 0, max: 4 }).wrap),
  ]);
  const cabin = selectField({ name: 'cabinClass', label: 'Classe', options: CABIN_OPTIONS, required: true, hint: 'Obbligatoria: nessun valore predefinito' });

  const adv = advanced([
    selectField({
      name: 'maxStops',
      label: 'Numero massimo di scali',
      options: [
        { value: '', label: 'Qualsiasi' },
        { value: '0', label: 'Solo voli diretti' },
        { value: '1', label: 'Fino a 1 scalo' },
        { value: '2', label: 'Fino a 2 scali' },
      ],
    }).wrap,
    el('div', { class: 'grid-2' }, numberField({ name: 'priceMin', label: 'Prezzo minimo', min: 0, placeholder: '€' }).wrap, numberField({ name: 'priceMax', label: 'Prezzo massimo', min: 0, placeholder: '€' }).wrap),
    textField({ name: 'airlines', label: 'Compagnie', placeholder: 'Es. EK, LH', hint: 'Codici IATA separati da virgola' }).wrap,
    selectField({
      name: 'refundability',
      label: 'Rimborsabilità',
      options: [
        { value: '', label: 'Indifferente' },
        { value: 'true', label: 'Solo rimborsabili' },
        { value: 'false', label: 'Solo non rimborsabili' },
      ],
    }).wrap,
    el('div', { class: 'grid-2' }, selectField({ name: 'sortBy', label: 'Ordina per', options: SORT_OPTIONS }).wrap, numberField({ name: 'limit', label: 'Risultati per pagina', min: 1, max: 100, placeholder: 'auto' }).wrap),
  ]);

  const submitBtn = el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, icon('M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', { size: 16 }), 'Cerca voli');
  const form = el('form', { class: 'form', attrs: { novalidate: '' } }, tripType.wrap, originField.wrap, destField.wrap, el('div', { class: 'grid-2' }, depField.wrap, retField.wrap), pax, cabin.wrap, adv, submitBtn);

  attachAutocomplete(originField.control, {
    load: async (term) => (await apiV.locations({ term })).data.locations || [],
    itemLabel: (it) => (it.code ? `${it.code} · ${it.name}` : it.name),
    itemSub: (it) => [it.city, it.country].filter(Boolean).join(', '),
    onSelect: (it) => {
      sel.origin = it;
    },
  });
  attachAutocomplete(destField.control, {
    load: async (term) => (await apiV.locations({ term })).data.locations || [],
    itemLabel: (it) => (it.code ? `${it.code} · ${it.name}` : it.name),
    itemSub: (it) => [it.city, it.country].filter(Boolean).join(', '),
    onSelect: (it) => {
      sel.destination = it;
    },
  });

  /* ---------------- layout ---------------- */
  const resultsEl = el('div', { class: 'results' });
  const panel = el('section', { class: 'panel panel--sticky' }, el('h2', { attrs: { style: 'font-size: var(--text-xl); margin-bottom: var(--space-4)' }, text: 'Cerca voli' }), form);
  renderNodes(
    outlet,
    el(
      'div',
      { class: 'page-head' },
      el('div', {}, el('h1', { text: 'Voli' }), el('p', { class: 'page-head__meta', text: 'Ricerca in tempo reale sull\'inventario RouteStack.' })),
      el('button', { class: 'example', type: 'button', onClick: () => fillExample() }, icon('M12 5v14M5 12h14', { size: 16 }), 'Esempio: MXP → BKK'),
    ),
    el('div', { class: 'vertical-grid' }, panel, resultsEl),
  );

  showIdle();

  /* ---------------- behaviour ---------------- */
  function fillExample() {
    originField.control.value = 'MXP';
    sel.origin = { code: 'MXP', name: 'Malpensa' };
    destField.control.value = 'BKK';
    sel.destination = { code: 'BKK', name: 'Bangkok' };
    depField.control.value = isoDateInDays(30);
    const rt = form.querySelector('input[name="tripType"][value="RoundTrip"]');
    if (rt) rt.checked = false;
    retField.wrap.hidden = true;
    announce('Esempio compilato: MXP → BKK.');
  }

  function showIdle() {
    renderNodes(resultsEl, idleState({ title: 'Pronto per cercare', text: 'Compila origine, destinazione e data di andata, poi premi “Cerca voli”. Seleziona la classe per procedere.', exampleLabel: 'Prova MXP → BKK', onExample: fillExample }));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const values = { ...readValues(form) };
    values.origin = sel.origin?.code || sel.origin?.name || values.originDisplay || '';
    values.destination = sel.destination?.code || sel.destination?.name || values.destinationDisplay || '';
    const missing = missingRequired('flights', values);
    if (missing.length) {
      announce(`Campi mancanti: ${missing.join(', ')}.`);
      if (!values.origin) setError(form, 'originDisplay', 'Seleziona un\'origine dall\'elenco.');
      if (!values.destination) setError(form, 'destinationDisplay', 'Seleziona una destinazione dall\'elenco.');
      if (!values.departureDate) setError(form, 'departureDate', 'Inserisci la data di andata.');
      if (!values.cabinClass) setError(form, 'cabinClass', 'Seleziona la classe di viaggio.');
      if (values.tripType === 'RoundTrip' && !values.returnDate) setError(form, 'returnDate', 'Inserisci la data di ritorno.');
      return;
    }

    const args = buildFlightSearchArgs(values);
    state.lastArgs = args;
    submitBtn.disabled = true;
    clear(submitBtn);
    submitBtn.append(el('span', { class: 'spinner' }), ' Ricerca in corso…');
    announce('Ricerca voli in corso.');
    showSkeletons();
    try {
      const { data, meta } = await apiV.search(args);
      state.offers = data.offers || [];
      state.meta = { ...data, ...meta };
      state.currency = data.currency || state.currency;
      if (!state.offers.length) {
        renderNodes(resultsEl, emptyState({ title: 'Nessun volo trovato', text: 'Prova a cambiare date, aeroporti o a rimuovere i filtri avanzati.' }));
        announce('Nessun volo trovato.');
      } else {
        renderResults();
        announce(`${state.offers.length} voli trovati.`);
      }
    } catch (err) {
      renderNodes(resultsEl, errorState(err));
      announce(`Errore: ${humanError(err).title}.`);
    } finally {
      submitBtn.disabled = false;
      clear(submitBtn);
      submitBtn.append(icon('M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', { size: 16 }), 'Cerca voli');
    }
  });

  function showSkeletons() {
    const wrap = el('div', { class: 'results', attrs: { 'aria-busy': 'true' } }, skeletonGrid(6));
    renderNodes(resultsEl, wrap);
  }

  function renderResults() {
    const grid = el('div', { class: 'card-grid' });
    for (const offer of state.offers) grid.append(flightCard(offer, { onOpen: (o) => openFlight(o), currency: state.currency }));
    renderNodes(
      resultsEl,
      resultsHeader({
        count: state.meta?.count ?? state.offers.length,
        status: state.meta?.status,
        source: state.meta?.source,
        sortBy: state.lastArgs?.sortBy || '',
        sortOptions: SORT_OPTIONS,
        onSort: (v) => {
          state.lastArgs = { ...state.lastArgs, sortBy: v || undefined };
          resubmit();
        },
      }),
      grid,
    );
  }

  async function resubmit() {
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  function openFlight(offer) {
    const body = el(
      'div',
      { class: 'stack' },
      el('div', { class: 'row row--between' }, el('div', {}, el('div', { class: 'card__route', text: `${offer.origin || '—'} → ${offer.destination || '—'}` }), el('div', { class: 'card__sub', text: [offer.originName, offer.destinationName].filter(Boolean).join(' → ') }))),
      kv([
        ['Compagnia', offer.airline],
        ['Volo', offer.flightNumber],
        ['Partenza', `${formatDate(offer.departureTime)} ${formatTime(offer.departureTime)}`],
        ['Arrivo', `${formatDate(offer.arrivalTime)} ${formatTime(offer.arrivalTime)}`],
        ['Durata', formatDuration(offer.duration)],
        ['Scali', offer.stops === 0 ? 'Diretto' : String(offer.stops)],
        ['Cabina', offer.cabin],
        ['Bagaglio', offer.baggage],
        ['Prezzo', formatPrice(offer.ourprice, offer.currency || state.currency)],
        ['Pubblicato', offer.publishedPrice ? formatPrice(offer.publishedPrice, offer.currency || state.currency) : null],
      ]),
      el('div', { class: 'card__meta' }, offer.refundable === true ? badge('rimborsabile', 'success') : offer.refundable === false ? badge('non rimborsabile') : null, offer.supplier ? badge(offer.supplier) : null),
      segmentsBlock(offer),
    );

    const checkoutBtn = el('button', { class: 'btn btn--accent btn--block', type: 'button' }, icon('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3', { size: 16 }), 'Link di checkout');
    const resultLine = el('p', { class: 'card__sub', attrs: { role: 'status' } });
    checkoutBtn.addEventListener('click', async () => {
      checkoutBtn.disabled = true;
      clear(checkoutBtn);
      checkoutBtn.append(el('span', { class: 'spinner' }), ' Generazione link…');
      resultLine.textContent = '';
      try {
        const { data } = await apiV.checkout({
          fareSourceCode: offer.fareSourceCode,
          origin: state.lastArgs?.origin,
          destination: state.lastArgs?.destination,
          departureDate: state.lastArgs?.departureDate,
          returnDate: state.lastArgs?.returnDate,
          adults: state.lastArgs?.adults,
          children: state.lastArgs?.children,
          infants: state.lastArgs?.infants,
          searchFilterObj: state.meta?.searchFilterObj || undefined,
          correlationId: state.meta?.correlationId,
          sessionId: state.meta?.sessionId,
        });
        const opened = openCheckout(data.url);
        resultLine.textContent = data.url
          ? `Modalità ${data.checkoutMode}: link ${opened ? 'aperto in una nuova scheda' : 'generato (consenti i popup per aprirlo)'}.`
          : 'Nessun link di checkout restituito.';
      } catch (err) {
        resultLine.textContent = `${humanError(err).title}: ${err.message}`;
      } finally {
        checkoutBtn.disabled = false;
        clear(checkoutBtn);
        checkoutBtn.append(icon('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3', { size: 16 }), 'Link di checkout');
      }
    });

    openDrawer({ title: `${offer.origin || ''} → ${offer.destination || ''}`.trim() || 'Dettaglio volo', body, footer: [checkoutBtn, resultLine] });
  }

  function segmentsBlock(offer) {
    if (!offer.segments?.length) return null;
    const list = el('ul', { class: 'seg-list' });
    for (const seg of offer.segments) {
      list.append(
        el(
          'li',
          { class: 'seg' },
          el('div', { class: 'seg__route', text: `${seg.origin || '—'} → ${seg.destination || '—'}` }),
          el('div', { class: 'seg__times', text: `${formatDate(seg.departureTime)} ${formatTime(seg.departureTime)} · ${seg.airline || ''} ${seg.flightNumber || ''}` }),
        ),
      );
    }
    return el('div', {}, el('h3', { text: 'Tratte', attrs: { style: 'margin-bottom: var(--space-3)' } }), list);
  }
}

export default { render };
