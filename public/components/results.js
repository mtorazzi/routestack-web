/**
 * Results header and card builders for the three verticals.
 */
import { el, icon } from './dom.js';
import { formatDate, formatDuration, formatPrice, formatTime } from './format.js';
import { badge } from './states.js';

/** Header with result count, status, source and optional sort control. */
export function resultsHeader({ count, status, source, sortBy, sortOptions, onSort, extra }) {
  const meta = el(
    'div',
    { class: 'results-head__meta' },
    badge(`sorgente: ${source || 'production'}`, source === 'sandbox' ? 'warning' : 'info'),
    status ? badge(`stato: ${status}`, /complete/i.test(status) ? 'success' : 'warning') : null,
    extra || null,
  );
  return el(
    'div',
    { class: 'results-head' },
    el('span', { class: 'results-head__count', attrs: { 'aria-live': 'polite' }, text: `${count} risultati` }),
    el(
      'div',
      { class: 'row' },
      meta,
      sortOptions && onSort
        ? el(
            'label',
            { class: 'row', attrs: { style: 'gap: var(--space-2); font-size: var(--text-sm)' } },
            'Ordina:',
            el(
              'select',
              { class: 'select', attrs: { 'aria-label': 'Ordina i risultati' }, onChange: (e) => onSort(e.target.value) },
              ...sortOptions.map((o) => el('option', { value: o.value, text: o.label, selected: o.value === sortBy })),
            ),
          )
        : null,
    ),
  );
}

function airlineLine(offer) {
  const airline = offer.airline || offer.supplier || 'Compagnia';
  return offer.flightNumber ? `${airline} · ${offer.flightNumber}` : airline;
}

/** Flight result card. */
export function flightCard(offer, { onOpen, currency } = {}) {
  const stopsLabel = offer.stops === 0 ? 'Diretto' : `${offer.stops} ${offer.stops === 1 ? 'scalo' : 'scali'}`;
  return el(
    'article',
    {
      class: 'card',
      attrs: { tabindex: '0', role: 'button', 'aria-label': `Volo ${offer.origin || ''} ${offer.destination || ''} ${airlineLine(offer)}` },
      onClick: () => onOpen?.(offer),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.(offer);
        }
      },
    },
    el(
      'div',
      { class: 'card__top' },
      el('div', {}, el('div', { class: 'card__title', text: airlineLine(offer) }), el('div', { class: 'card__sub', text: offer.supplier && offer.supplier !== offer.airline ? offer.supplier : '' })),
      el('div', { class: 'card__price' }, formatPrice(offer.ourprice, offer.currency || currency), el('small', { text: ' a persona' })),
    ),
    el(
      'div',
      { class: 'card__route' },
      `${offer.origin || '—'} → ${offer.destination || '—'}`,
    ),
    el(
      'div',
      { class: 'card__times' },
      `${formatTime(offer.departureTime) || '—'} · ${formatDuration(offer.duration) || ''}`,
    ),
    el(
      'div',
      { class: 'card__meta' },
      badge(stopsLabel, offer.stops === 0 ? 'success' : ''),
      offer.refundable === true ? badge('rimborsabile', 'success') : offer.refundable === false ? badge('non rimborsabile') : null,
      offer.baggage ? badge(`bagaglio: ${offer.baggage}`) : null,
      offer.cabin ? badge(offer.cabin) : null,
    ),
    el(
      'div',
      { class: 'card__foot' },
      el('span', { class: 'card__sub', text: offer.airlineCode || '' }),
      el('span', { class: 'btn btn--ghost btn--sm' }, 'Dettagli', icon('M9 18l6-6-6-6', { size: 14 })),
    ),
  );
}

/** Hotel result card. */
export function hotelCard(hotel, { onOpen } = {}) {
  const media = hotel.image
    ? el('img', { class: 'card__media', src: hotel.image, alt: '', loading: 'lazy' })
    : el('div', { class: 'card__media', attrs: { 'aria-hidden': 'true' } });
  return el(
    'article',
    {
      class: 'card',
      attrs: { tabindex: '0', role: 'button', 'aria-label': `Hotel ${hotel.name}` },
      onClick: () => onOpen?.(hotel),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.(hotel);
        }
      },
    },
    media,
    el(
      'div',
      { class: 'card__top' },
      el('div', {}, el('div', { class: 'card__title', text: hotel.name }), el('div', { class: 'card__sub', text: [hotel.city, hotel.address].filter(Boolean).join(' · ') })),
      el('div', { class: 'card__price' }, formatPrice(hotel.ourprice ?? hotel.price, hotel.currency)),
    ),
    el(
      'div',
      { class: 'card__meta' },
      hotel.stars ? badge(`${'★'.repeat(Math.min(Math.round(hotel.stars), 5))} ${hotel.stars}`, 'accent') : null,
      hotel.rating ? badge(`${hotel.rating}/10`, 'info') : null,
      hotel.freeCancellation ? badge('cancellazione gratuita', 'success') : null,
      hotel.freeBreakfast ? badge('colazione inclusa', 'success') : null,
      hotel.distance ? badge(hotel.distance) : null,
    ),
    el(
      'div',
      { class: 'card__foot' },
      hotel.publishedRate && hotel.publishedRate > (hotel.ourprice ?? hotel.price)
        ? el('span', {}, el('span', { class: 'strike', text: formatPrice(hotel.publishedRate, hotel.currency) }), ' ', el('span', { class: 'price-save', text: `-${hotel.savingsPercent ?? ''}%` }))
        : el('span', { class: 'card__sub', text: hotel.supplier || '' }),
      el('span', { class: 'btn btn--ghost btn--sm' }, 'Camere', icon('M9 18l6-6-6-6', { size: 14 })),
    ),
  );
}

/** Car result card. */
export function carCard(offer, { onOpen } = {}) {
  return el(
    'article',
    {
      class: 'card',
      attrs: { tabindex: '0', role: 'button', 'aria-label': `Auto ${offer.model} ${offer.supplier || ''}` },
      onClick: () => onOpen?.(offer),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.(offer);
        }
      },
    },
    el(
      'div',
      { class: 'card__top' },
      el('div', {}, el('div', { class: 'card__title', text: offer.model || 'Veicolo' }), el('div', { class: 'card__sub', text: offer.supplier || '' })),
      el('div', { class: 'card__price' }, formatPrice(offer.price, offer.currency), el('small', { text: ' totale' })),
    ),
    el(
      'div',
      { class: 'card__meta' },
      offer.carType ? badge(offer.carType, 'accent') : null,
      offer.transmission ? badge(offer.transmission) : null,
      offer.fuel ? badge(offer.fuel) : null,
      offer.seats ? badge(`${offer.seats} posti`) : null,
      offer.freeCancellation ? badge('cancellazione gratuita', 'success') : null,
      offer.prepaid ? badge('prepagato', 'info') : badge('pagamento in loco'),
    ),
    el(
      'div',
      { class: 'card__foot' },
      el('span', { class: 'card__sub', text: offer.mileage || '' }),
      el('span', { class: 'btn btn--ghost btn--sm' }, 'Dettagli', icon('M9 18l6-6-6-6', { size: 14 })),
    ),
  );
}

export { formatDate };
