import { Router } from 'express';

import {
  checkoutModeOf,
  findUrl,
  flights,
  getFlightSession,
  rememberFlightSession,
} from '../routestack/verticals.js';
import { asyncHandler, clean, requireBody, requireString, sendOk } from './_helpers.js';

const router = Router();

function buildStops(maxStops) {
  if (maxStops === undefined || maxStops === null || maxStops === '') return undefined;
  const max = Number(maxStops);
  if (!Number.isFinite(max)) return undefined;
  return Array.from({ length: Math.min(Math.max(max, 0), 3) + 1 }, (_, i) => i);
}

function buildFilter(body = {}) {
  const price = body.filters?.price;
  const filters = clean({
    price: price && (price.min !== undefined || price.max !== undefined) ? { min: Number(price.min) || 0, max: Number(price.max) || undefined } : undefined,
    airlines: body.filters?.airlines,
    stops: body.filters?.stops ?? buildStops(body.maxStops),
    refundability: body.filters?.refundability,
  });
  return clean({
    origin: body.origin,
    destination: body.destination,
    departureDate: body.departureDate,
    returnDate: body.returnDate,
    tripType: body.tripType,
    type: body.tripType,
    adults: body.adults,
    children: body.children,
    infants: body.infants,
    cabinClass: body.cabinClass,
    filters: Object.keys(filters).length ? filters : undefined,
    sortBy: body.sortBy,
    limit: body.limit,
    page: body.page,
  });
}

/** Start a flight session (free). */
router.post(
  '/session',
  asyncHandler(async (req, res) => {
    const r = await flights.session();
    const sessionId = r.data?.sessionId ?? r.data?.result?.sessionId ?? null;
    rememberFlightSession(sessionId);
    sendOk(res, { sessionId }, { source: r.source, tool: r.tool });
  }),
);

/** Airport/city autocomplete (free). */
router.post(
  '/locations',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const term = requireString(body.term, 'term');
    const r = await flights.locations({ term });
    sendOk(res, r.data, { source: r.source, tool: r.tool });
  }),
);

/** Flight search (billable). */
router.post(
  '/search',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    if (!getFlightSession()) {
      try {
        const s = await flights.session();
        rememberFlightSession(s.data?.sessionId ?? null);
      } catch {
        /* flight_session is optional; continue without it */
      }
    }
    const filter = buildFilter(requireBody(req));
    requireString(filter.origin, 'origin');
    requireString(filter.destination, 'destination');
    requireString(filter.departureDate, 'departureDate');
    const r = await flights.search({ filter });
    sendOk(res, r.data, { source: r.source, tool: r.tool });
  }),
);

/** Revalidate a selected fare (free). */
router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const args = clean({
      fareSourceCode: requireString(body.fareSourceCode, 'fareSourceCode'),
      searchListPrice: body.searchListPrice,
      searchFilterObj: body.searchFilterObj,
      correlationId: body.correlationId,
    });
    const r = await flights.revalidate(args);
    sendOk(res, { ...r.data, url: findUrl(r.data) }, { source: r.source, tool: r.tool });
  }),
);

/** Checkout link (free). */
router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const args = clean({
      fareSourceCode: body.fareSourceCode,
      offerId: body.offerId,
      flight: body.flight,
      origin: body.origin,
      destination: body.destination,
      departureDate: body.departureDate,
      returnDate: body.returnDate,
      adults: body.adults,
      children: body.children,
      infants: body.infants,
      exchangeRate: body.exchangeRate,
      correlationId: body.correlationId,
      searchFilterObj: body.searchFilterObj,
      sessionId: body.sessionId ?? getFlightSession(),
      routestack_external_userid: body.routestack_external_userid || 'routestack-web',
      routestack_metadata: body.routestack_metadata,
    });
    const r = await flights.checkout(args);
    const url = findUrl(r.data);
    sendOk(res, { url, checkoutMode: checkoutModeOf(r.data, url), raw: r.data }, { source: r.source, tool: r.tool });
  }),
);

export default router;
