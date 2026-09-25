/**
 * Hotel — destination autocomplete, rich filters, paginated results,
 * room/rate drawer and checkout.
 */
import { attachAutocomplete } from '../components/autocomplete.js';
import { humanError, openCheckout, vertical } from '../components/api.js';
import { openDrawer } from '../components/drawer.js';
import { clear, el, icon, render as renderNodes } from '../components/dom.js';
import { advanced, checkField, checkGroup, clearErrors, dateField, fieldset, numberField, readValues, selectField, setError, textField } from '../components/fields.js';
import { formatPrice, isoDateInDays } from '../components/format.js';
import { buildHotelSearchArgs, missingRequired } from '../components/params.js';
import { badge, emptyState, errorState, idleState, kv, LONG_SEARCH_HINT, searchCostHint, skeletonGrid, startSearchClock } from '../components/states.js';
import { hotelCard, resultsHeader } from '../components/results.js';
import { sortOffers } from '../components/sort.js';

const CURRENCIES = ['EUR', 'USD', 'GBP'];
const SORT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'price', label: 'Prezzo più basso' },
  { value: 'stars', label: 'Categoria' },
  { value: 'rating', label: 'Punteggio ospiti' },
];

export function render(ctx) {
  const { outlet, announce, config } = ctx;
  const apiV = vertical('hotels');
  const state = { hotels: [], meta: null, currency: config?.currency || 'EUR', lastArgs: null, nextKey: null };
  const sel = { destination: null };

  /* ---------------- form ---------------- */
  const destField = textField({ name: 'destinationDisplay', label: 'Destinazione', placeholder: 'Es. Roma, Hotel…', hint: 'Città, area o nome struttura', required: true });
  const checkIn = dateField({ name: 'checkIn', label: 'Check-in', required: true });
  const checkOut = dateField({ name: 'checkOut', label: 'Check-out', required: true });
  const roomsField = numberField({ name: 'roomCount', label: 'Camere', value: '1', min: 1, max: 8 });
  const adultsField = numberField({ name: 'adults', label: 'Adulti per camera', value: '2', min: 1, max: 8 });
  const childrenField = numberField({ name: 'children', label: 'Bambini', value: '0', min: 0, max: 8 });
  const currencyField = selectField({ name: 'currency', label: 'Valuta', options: CURRENCIES, value: state.currency });

  const stars = checkGroup({
    name: 'stars',
    legend: 'Stelle',
    options: [5, 4, 3, 2, 1].map((n) => ({ value: n, label: `${n}★` })),
  });

  const adv = advanced([
    el('div', { class: 'grid-2' }, numberField({ name: 'priceMin', label: 'Prezzo minimo', min: 0 }).wrap, numberField({ name: 'priceMax', label: 'Prezzo massimo', min: 0 }).wrap),
    checkField({ name: 'freeCancellation', label: 'Cancellazione gratuita' }).wrap,
    checkField({ name: 'freeBreakfast', label: 'Colazione inclusa' }).wrap,
    checkField({ name: 'refundable', label: 'Rimborsabile' }).wrap,
    checkField({ name: 'payAtHotel', label: 'Paga in hotel' }).wrap,
    textField({ name: 'propertyType', label: 'Tipo struttura', placeholder: 'Es. Hotel, Resort, Appartamento' }).wrap,
    textField({ name: 'chains', label: 'Catene / brand', placeholder: 'Es. Hilton, Marriott' }).wrap,
    textField({ name: 'amenities', label: 'Servizi', placeholder: 'Es. wifi, piscina, spa', hint: 'Separati da virgola' }).wrap,
    el('div', { class: 'grid-2' }, selectField({ name: 'sortBy', label: 'Ordina per', options: SORT_OPTIONS }).wrap, numberField({ name: 'limit', label: 'Risultati per pagina', min: 1, max: 100, placeholder: 'auto' }).wrap),
  ]);

  const submitBtn = el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, icon('M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', { size: 16 }), 'Cerca hotel');
  // Reserved-height line: setting/clearing the hint never shifts the layout.
  const searchHint = el('p', { class: 'card__sub', attrs: { 'aria-live': 'polite', style: 'min-height: 1.2em; margin: 0' } });
  const form = el(
    'form',
    { class: 'form', attrs: { novalidate: '' } },
    destField.wrap,
    el('div', { class: 'grid-2' }, checkIn.wrap, checkOut.wrap),
    fieldset('Sistemazione', [el('div', { class: 'grid-3' }, roomsField.wrap, adultsField.wrap, childrenField.wrap), currencyField.wrap]),
    stars.wrap,
    adv,
    submitBtn,
    searchCostHint(),
    searchHint,
  );

  attachAutocomplete(destField.control, {
    load: async (term) => (await apiV.destinations({ query: term })).data.destinations || [],
    itemLabel: (it) => `${it.displayName || it.name} · ${it.type || 'City'}`,
    itemSub: (it) => [it.city, it.country].filter(Boolean).join(', '),
    onSelect: (it) => {
      sel.destination = it;
    },
  });

  /* ---------------- layout ---------------- */
  const resultsEl = el('div', { class: 'results' });
  const panel = el('section', { class: 'panel panel--sticky' }, el('h2', { attrs: { style: 'font-size: var(--text-xl); margin-bottom: var(--space-4)' }, text: 'Cerca hotel' }), form);
  renderNodes(
    outlet,
    el(
      'div',
      { class: 'page-head' },
      el('div', {}, el('h1', { text: 'Hotel' }), el('p', { class: 'page-head__meta', text: 'Tariffe e disponibilità sull\'inventario RouteStack.' })),
      el('button', { class: 'example', type: 'button', onClick: fillExample }, icon('M12 5v14M5 12h14', { size: 16 }), 'Esempio: Roma, 5 notti'),
    ),
    el('div', { class: 'vertical-grid' }, panel, resultsEl),
  );

  showIdle();

  /* ---------------- behaviour ---------------- */
  function fillExample() {
    destField.control.value = 'Rome, Italy · City';
    sel.destination = { destinationId: 'ChIJw0rXGxGKJRMRAIE4sppPCQM', name: 'Rome, Italy', displayName: 'Rome', type: 'City' };
    checkIn.control.value = isoDateInDays(30);
    checkOut.control.value = isoDateInDays(35);
    announce('Esempio compilato: Roma, 5 notti.');
  }

  function showIdle() {
    renderNodes(resultsEl, idleState({ title: 'Cerca una destinazione', text: 'Inserisci città o nome hotel, scegli le date e premi “Cerca hotel”. Usa i filtri avanzati per stelle, prezzo e servizi.', exampleLabel: 'Prova Roma', onExample: fillExample }));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const values = { ...readValues(form) };
    values.destination = sel.destination?.destinationId || sel.destination?.displayName || values.destinationDisplay || '';
    values.destinationType = sel.destination?.type;
    const missing = missingRequired('hotels', values);
    if (missing.length) {
      announce(`Campi mancanti: ${missing.join(', ')}.`);
      if (!values.destination) setError(form, 'destinationDisplay', 'Seleziona una destinazione dall\'elenco.');
      if (!values.checkIn) setError(form, 'checkIn', 'Inserisci la data di check-in.');
      if (!values.checkOut) setError(form, 'checkOut', 'Inserisci la data di check-out.');
      return;
    }

    const args = buildHotelSearchArgs(values);
    state.lastArgs = args;
    state.nextKey = null;
    await runSearch(args, { append: false });
  });

  async function runSearch(args, { append }) {
    submitBtn.disabled = true;
    clear(submitBtn);
    const searchLabel = el('span', { text: 'Ricerca in corso…' });
    submitBtn.append(el('span', { class: 'spinner' }), ' ', searchLabel);
    searchHint.textContent = LONG_SEARCH_HINT;
    const stopClock = startSearchClock({ onTick: (s) => { searchLabel.textContent = `Ricerca in corso… ${s}s`; } });
    announce('Ricerca hotel in corso.');
    if (!append) showSkeletons();
    try {
      const { data, meta } = await apiV.search(args);
      state.meta = { ...data, ...meta };
      state.currency = data.currency || state.currency;
      state.nextKey = data.nextResultsKey || null;
      const incoming = data.hotels || [];
      state.hotels = append ? [...state.hotels, ...incoming] : incoming;
      if (!state.hotels.length) {
        renderNodes(resultsEl, emptyState({ title: 'Nessun hotel trovato', text: 'Prova a spostare le date o ad allargare i filtri.' }));
        announce('Nessun hotel trovato.');
      } else {
        renderResults();
        announce(`${state.hotels.length} hotel trovati.`);
      }
    } catch (err) {
      renderNodes(resultsEl, errorState(err));
      announce(`Errore: ${humanError(err).title}.`);
    } finally {
      stopClock();
      searchHint.textContent = '';
      submitBtn.disabled = false;
      clear(submitBtn);
      submitBtn.append(icon('M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', { size: 16 }), 'Cerca hotel');
    }
  }

  function showSkeletons() {
    renderNodes(resultsEl, el('div', { class: 'results', attrs: { 'aria-busy': 'true' } }, skeletonGrid(6)));
  }

  function renderResults() {
    const grid = el('div', { class: 'card-grid' });
    for (const hotel of state.hotels) grid.append(hotelCard(hotel, { onOpen: openHotel }));
    const children = [
      resultsHeader({
        count: state.meta?.count ?? state.hotels.length,
        status: state.meta?.status,
        source: state.meta?.source,
        sortBy: state.lastArgs?.sortBy || '',
        sortOptions: SORT_OPTIONS,
        // Local sort only: reorder the already-fetched hotels and re-render.
        // Never re-submit — the /search call is billable.
        onSort: (v) => {
          state.lastArgs = { ...state.lastArgs, sortBy: v || undefined };
          state.hotels = sortOffers(state.hotels, v, 'hotels');
          renderResults();
        },
      }),
      grid,
    ];
    if (state.nextKey) {
      const moreBtn = el('button', { class: 'btn btn--ghost btn--block', type: 'button' }, 'Carica altri risultati (nuova ricerca fatturata)');
      moreBtn.addEventListener('click', async () => {
        moreBtn.disabled = true;
        moreBtn.textContent = 'Caricamento…';
        const nextArgs = { ...state.lastArgs, nextResultsKey: state.nextKey, correlationId: state.meta?.correlationId, token: state.meta?.token };
        await runSearch(nextArgs, { append: true });
      });
      children.push(el('div', { attrs: { style: 'text-align: center' } }, moreBtn));
    }
    renderNodes(resultsEl, ...children);
  }

  function roomsArgs(hotel) {
    return {
      hotelId: hotel.hotelId,
      hotelName: hotel.name,
      publishedRate: hotel.publishedRate,
      token: state.meta?.token,
      correlationId: state.meta?.correlationId,
      checkIn: state.lastArgs?.checkIn,
      checkOut: state.lastArgs?.checkOut,
      currency: state.lastArgs?.currency,
      rooms: state.lastArgs?.rooms,
    };
  }

  function openHotel(hotel) {
    const roomsHost = el('div', {}, el('div', { class: 'skeleton skeleton--line', attrs: { style: 'height: 60px; margin-bottom: var(--space-3)' } }), el('div', { class: 'skeleton skeleton--line', attrs: { style: 'height: 60px' } }));
    const body = el(
      'div',
      { class: 'stack' },
      hotel.image ? el('img', { class: 'card__media', src: hotel.image, alt: '', style: 'height: 180px' }) : null,
      el('div', { class: 'card__meta' }, hotel.stars ? badge(`${hotel.stars}★`, 'accent') : null, hotel.rating ? badge(`${hotel.rating}/10`, 'info') : null, hotel.freeCancellation ? badge('cancellazione gratuita', 'success') : null, hotel.freeBreakfast ? badge('colazione inclusa', 'success') : null),
      kv([
        ['Indirizzo', hotel.address],
        ['Città', hotel.city],
        ['Distanza', hotel.distance],
        ['Prezzo', formatPrice(hotel.ourprice ?? hotel.price, hotel.currency)],
        ['Pubblicato', hotel.publishedRate ? formatPrice(hotel.publishedRate, hotel.currency) : null],
        ['Fornitore', hotel.supplier],
      ]),
      el('hr', { class: 'divider' }),
      el('h3', { text: 'Camere e tariffe' }),
      roomsHost,
    );
    const drawer = openDrawer({ title: hotel.name, body });
    loadRooms(hotel, roomsHost, drawer);
  }

  async function loadRooms(hotel, host, drawer) {
    if (!state.meta?.token || !state.meta?.correlationId) {
      renderNodes(host, el('p', { class: 'card__sub', text: 'Sessione hotel non disponibile: riesegui la ricerca.' }));
      return;
    }
    try {
      const { data } = await apiV.rooms(roomsArgs(hotel));
      const offers = data.offers || [];
      if (!offers.length) {
        renderNodes(host, el('p', { class: 'card__sub', text: 'Nessuna camera disponibile per queste date.' }));
        return;
      }
      const list = el('div', { class: 'room-list' });
      for (const offer of offers) list.append(roomRow(hotel, offer));
      renderNodes(host, list);
    } catch (err) {
      renderNodes(host, errorState(err));
    }
  }

  function roomRow(hotel, offer) {
    const price = formatPrice(offer.ourprice, offer.currency || state.currency);
    const reserveBtn = el('button', { class: 'btn btn--accent btn--sm', type: 'button' }, 'Riserva');
    const status = el('p', { class: 'card__sub', attrs: { role: 'status', style: 'margin: 0' } });
    reserveBtn.addEventListener('click', async () => {
      reserveBtn.disabled = true;
      clear(reserveBtn);
      reserveBtn.append(el('span', { class: 'spinner' }), ' Attendi…');
      status.textContent = 'Revalidazione della tariffa…';
      try {
        const reval = await apiV.revalidate({
          hotelId: hotel.hotelId,
          recommendationId: offer.recommendationId,
          token: state.meta?.token,
          correlationId: state.meta?.correlationId,
          publishedRate: offer.publishedRate ?? hotel.publishedRate,
        });
        status.textContent = 'Generazione del link di checkout…';
        const { data } = await apiV.checkout({
          hotelId: hotel.hotelId,
          hotelName: hotel.name,
          hotelImage: hotel.image,
          hotelAddress: hotel.address,
          hotelStarRating: hotel.stars,
          hotelRating: hotel.rating,
          destination: state.lastArgs?.destination,
          roomId: offer.roomId,
          recommendationId: offer.recommendationId,
          token: state.meta?.token,
          correlationId: state.meta?.correlationId,
          checkIn: state.lastArgs?.checkIn,
          checkOut: state.lastArgs?.checkOut,
          displayedPrice: offer.ourprice,
          rooms: state.lastArgs?.rooms,
        });
        const opened = openCheckout(data.url);
        status.textContent = data.url ? `Modalità ${data.checkoutMode}: link ${opened ? 'aperto in una nuova scheda' : 'generato (consenti i popup)'}.` : 'Nessun link restituito.';
      } catch (err) {
        status.textContent = `${humanError(err).title}: ${err.message}`;
      } finally {
        reserveBtn.disabled = false;
        clear(reserveBtn);
        reserveBtn.textContent = 'Riserva';
      }
    });
    return el(
      'div',
      { class: 'room' },
      el(
        'div',
        { class: 'room__head' },
        el('div', {}, el('div', { class: 'room__name', text: offer.name || 'Camera' }), el('div', { class: 'card__meta' }, offer.board ? badge(offer.board) : null, offer.freeCancellation ? badge('cancellazione gratuita', 'success') : null, offer.refundable ? badge('rimborsabile', 'success') : null)),
        el('div', { class: 'room__price', text: price }),
      ),
      offer.beds?.length ? el('div', { class: 'card__sub', text: `Letti: ${offer.beds.join(', ')}` }) : null,
      el('div', { class: 'row row--between' }, reserveBtn, status),
    );
  }
}

export default { render };
