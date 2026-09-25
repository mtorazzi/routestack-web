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
      { value: 'MultiCity', label: 'Più tratte (MultiCity)' },
    ],
    onChange: () => syncTripTypeUI(),
  });

  const originField = textField({ name: 'originDisplay', label: 'Origine', placeholder: 'Es. MXP, Milano…', hint: 'Città o aeroporto di partenza', required: true });
  const destField = textField({ name: 'destinationDisplay', label: 'Destinazione', placeholder: 'Es. BKK, Bangkok…', hint: 'Città o aeroporto di arrivo', required: true });
  const depField = dateField({ name: 'departureDate', label: 'Data di andata', required: true });
  const retField = dateField({ name: 'returnDate', label: 'Data di ritorno' });
  retField.wrap.hidden = true;

  /* Single-itinerary fields: hidden and disabled while MultiCity is active so
     they neither render nor reach the payload. */
  const singleFields = el('div', { class: 'stack' }, originField.wrap, destField.wrap, el('div', { class: 'grid-2' }, depField.wrap, retField.wrap));

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

  /* ---------------- MultiCity leg editor ---------------- */
  const MAX_LEGS = 5;
  const FIXED_LEGS = 2; // the first two legs cannot be removed
  let legSeq = 0;
  const legs = [];

  const loadLocations = async (term) => (await apiV.locations({ term })).data.locations || [];
  const attachLocation = (input, onSelect) =>
    attachAutocomplete(input, {
      load: loadLocations,
      itemLabel: (it) => (it.code ? `${it.code} · ${it.name}` : it.name),
      itemSub: (it) => [it.city, it.country].filter(Boolean).join(', '),
      onSelect,
    });

  const legBody = el('div', { class: 'stack' });
  const addLegBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('M12 5v14M5 12h14', { size: 14 }), 'Aggiungi tratta');

  function makeLeg() {
    legSeq += 1;
    const originF = textField({ name: `leg${legSeq}Origin`, label: 'Origine', placeholder: 'Es. MXP, Milano…', required: true });
    const destF = textField({ name: `leg${legSeq}Destination`, label: 'Destinazione', placeholder: 'Es. BKK, Bangkok…', required: true });
    const dateF = dateField({ name: `leg${legSeq}Date`, label: 'Data', required: true });
    const legend = el('legend', { text: 'Tratta' });
    const removeBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, icon('M6 6l12 12M18 6 6 18', { size: 14 }), 'Rimuovi');
    const leg = { originF, destF, dateF, legend, removeBtn, sel: { origin: null, destination: null }, group: null };
    attachLocation(originF.control, (it) => {
      leg.sel.origin = it;
    });
    attachLocation(destF.control, (it) => {
      leg.sel.destination = it;
    });
    removeBtn.addEventListener('click', () => {
      const index = legs.indexOf(leg);
      if (index < FIXED_LEGS) return;
      legs.splice(index, 1);
      leg.group.remove();
      syncLegsUi();
    });
    leg.group = el(
      'fieldset',
      { class: 'fieldset leg' },
      legend,
      originF.wrap,
      destF.wrap,
      dateF.wrap,
      el('div', { class: 'row', attrs: { style: 'justify-content: flex-end' } }, removeBtn),
    );
    return leg;
  }

  function addLeg(seed = {}) {
    if (legs.length >= MAX_LEGS) return;
    const leg = makeLeg();
    if (seed.origin) {
      leg.originF.control.value = seed.origin.value || '';
      leg.sel.origin = seed.origin.sel || null;
    }
    if (seed.destination) {
      leg.destF.control.value = seed.destination.value || '';
      leg.sel.destination = seed.destination.sel || null;
    }
    if (seed.date) leg.dateF.control.value = seed.date;
    legs.push(leg);
    legBody.append(leg.group);
    syncLegsUi();
  }

  addLegBtn.addEventListener('click', () => {
    const previous = legs[legs.length - 1];
    const seed = previous && previous.sel.destination
      ? { origin: { value: previous.destF.control.value, sel: previous.sel.destination } }
      : {};
    addLeg(seed);
  });

  const legsEditor = el(
    'fieldset',
    { class: 'fieldset' },
    el('legend', { text: 'Tratte (2–5)' }),
    legBody,
    el('div', { class: 'row' }, addLegBtn),
  );
  legsEditor.hidden = true;

  function syncLegsUi() {
    legs.forEach((leg, index) => {
      leg.legend.textContent = `Tratta ${index + 1}`;
      leg.removeBtn.hidden = index < FIXED_LEGS;
    });
    addLegBtn.disabled = legs.length >= MAX_LEGS;
  }

  function currentTripType() {
    return form.querySelector('input[name="tripType"]:checked')?.value || 'OneWay';
  }

  /** Seed leg 1 from the single-itinerary fields (only where still empty). */
  function seedLegOne() {
    const leg = legs[0];
    if (!leg) return;
    if (!leg.originF.control.value && originField.control.value) {
      leg.originF.control.value = originField.control.value;
      leg.sel.origin = sel.origin;
    }
    if (!leg.destF.control.value && destField.control.value) {
      leg.destF.control.value = destField.control.value;
      leg.sel.destination = sel.destination;
    }
    if (!leg.dateF.control.value && depField.control.value) {
      leg.dateF.control.value = depField.control.value;
    }
  }

  function syncTripTypeUI() {
    const type = currentTripType();
    const multi = type === 'MultiCity';
    singleFields.hidden = multi;
    legsEditor.hidden = !multi;
    for (const control of singleFields.querySelectorAll('input, select')) control.disabled = multi;
    for (const leg of legs) {
      for (const field of [leg.originF, leg.destF, leg.dateF]) field.control.disabled = !multi;
    }
    if (multi) seedLegOne();
    else retField.wrap.hidden = type !== 'RoundTrip';
    syncLegsUi();
  }

  const form = el('form', { class: 'form', attrs: { novalidate: '' } }, tripType.wrap, singleFields, legsEditor, pax, cabin.wrap, adv, submitBtn);

  attachLocation(originField.control, (it) => {
    sel.origin = it;
  });
  attachLocation(destField.control, (it) => {
    sel.destination = it;
  });

  addLeg();
  addLeg();
  syncTripTypeUI();

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
    if (currentTripType() === 'MultiCity') {
      const leg = legs[0];
      if (leg) {
        leg.originF.control.value = 'MXP';
        leg.sel.origin = { code: 'MXP', name: 'Malpensa' };
        leg.destF.control.value = 'BKK';
        leg.sel.destination = { code: 'BKK', name: 'Bangkok' };
        leg.dateF.control.value = isoDateInDays(30);
      }
      announce('Esempio compilato: MXP → BKK (tratta 1).');
      return;
    }
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

  /** Resolve one leg to the payload shape, preferring the picked location. */
  function legValues(leg) {
    return {
      origin: leg.sel.origin?.code || leg.sel.origin?.name || leg.originF.control.value.trim(),
      destination: leg.sel.destination?.code || leg.sel.destination?.name || leg.destF.control.value.trim(),
      departureDate: leg.dateF.control.value,
    };
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const values = { ...readValues(form) };
    values.tripType = values.tripType || 'OneWay';
    if (values.tripType === 'MultiCity') {
      values.destinations = legs.map(legValues);
    } else {
      values.origin = sel.origin?.code || sel.origin?.name || values.originDisplay || '';
      values.destination = sel.destination?.code || sel.destination?.name || values.destinationDisplay || '';
    }
    const missing = missingRequired('flights', values);
    if (missing.length) {
      announce(`Campi mancanti: ${missing.join(', ')}.`);
      if (values.tripType === 'MultiCity') {
        legs.forEach((leg) => {
          const v = legValues(leg);
          if (!v.origin) setError(form, leg.originF.control.name, 'Seleziona un\'origine dall\'elenco.');
          if (!v.destination) setError(form, leg.destF.control.name, 'Seleziona una destinazione dall\'elenco.');
          if (!v.departureDate) setError(form, leg.dateF.control.name, 'Inserisci la data della tratta.');
        });
      } else {
        if (!values.origin) setError(form, 'originDisplay', 'Seleziona un\'origine dall\'elenco.');
        if (!values.destination) setError(form, 'destinationDisplay', 'Seleziona una destinazione dall\'elenco.');
        if (!values.departureDate) setError(form, 'departureDate', 'Inserisci la data di andata.');
        if (values.tripType === 'RoundTrip' && !values.returnDate) setError(form, 'returnDate', 'Inserisci la data di ritorno.');
      }
      if (!values.cabinClass) setError(form, 'cabinClass', 'Seleziona la classe di viaggio.');
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
          flight: offer.raw,
          tripType: state.lastArgs?.tripType,
          destinations: state.lastArgs?.destinations,
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
