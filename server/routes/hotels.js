import { Router } from 'express';

import {
  checkoutModeOf,
  findUrl,
  getHotelSession,
  hotels,
  rememberHotelSession,
  requireHotelSession,
} from '../routestack/verticals.js';
import { asyncHandler, clean, requireBody, requireString, sendOk } from './_helpers.js';

const router = Router();

function buildRooms(input) {
  if (Array.isArray(input.rooms) && input.rooms.length) {
    return input.rooms
      .map((r) => ({
        adults: Number(r.adults) || 1,
        children: Number(r.children) || 0,
        ...(Array.isArray(r.childAges) && r.childAges.length ? { childAges: r.childAges.map(Number) } : {}),
      }))
      .slice(0, 8);
  }
  const count = Math.min(Math.max(Number(input.roomCount) || 1, 1), 8);
  const adults = Math.min(Math.max(Number(input.adults) || 2, 1), 8);
  return Array.from({ length: count }, () => ({ adults, children: 0 }));
}

/** Step 1 — destination autocomplete. */
router.post(
  '/destinations',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const query = requireString(body.query, 'query');
    const r = await hotels.destinations(clean({ query, type: body.type }));
    sendOk(res, r.data, { source: r.source, tool: r.tool });
  }),
);

/** Step 2 — hotel search (billable). */
router.post(
  '/search',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const rooms = buildRooms(body);
    const args = clean({
      destinationId: body.destinationId,
      destination: body.destination,
      destinationType: body.destinationType,
      isFromSingleHotel: body.isFromSingleHotel,
      lat: body.lat,
      long: body.long,
      checkIn: requireString(body.checkIn, 'checkIn'),
      checkOut: requireString(body.checkOut, 'checkOut'),
      roomCount: rooms.length,
      adults: rooms[0]?.adults,
      rooms,
      currency: body.currency,
      filters: body.filters,
      sortBy: body.sortBy,
      limit: body.limit,
      page: body.page,
      correlationId: body.correlationId,
      token: body.token,
      nextResultsKey: body.nextResultsKey,
    });
    const r = await hotels.search(args);
    rememberHotelSession(r.data.correlationId, r.data.token, {
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      rooms,
      destination: args.destination,
    });
    sendOk(res, r.data, { source: r.source, tool: r.tool });
  }),
);

/** Step 3 — rooms & rates for a chosen hotel (free). */
router.post(
  '/rooms',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const cached = getHotelSession(body.correlationId) ?? {};
    const rooms = buildRooms(body.rooms ? body : cached);
    const args = clean({
      hotelId: requireString(body.hotelId, 'hotelId'),
      hotelName: body.hotelName ?? cached.hotelName,
      publishedRate: body.publishedRate,
      token: requireString(body.token, 'token'),
      correlationId: requireString(body.correlationId, 'correlationId'),
      checkIn: requireString(body.checkIn ?? cached.checkIn, 'checkIn'),
      checkOut: requireString(body.checkOut ?? cached.checkOut, 'checkOut'),
      currency: body.currency,
      rooms,
    });
    const r = await hotels.rooms(args);
    rememberHotelSession(args.correlationId, args.token, {
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      rooms,
      hotelName: args.hotelName,
    });
    sendOk(res, r.data, { source: r.source, tool: r.tool });
  }),
);

/** Step 4 — revalidate a chosen rate (free). */
router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const args = clean({
      hotelId: requireString(body.hotelId, 'hotelId'),
      recommendationId: requireString(body.recommendationId, 'recommendationId'),
      token: requireString(body.token, 'token'),
      correlationId: requireString(body.correlationId, 'correlationId'),
      publishedRate: body.publishedRate,
    });
    const r = await hotels.revalidate(args);
    sendOk(res, { ...r.data, url: findUrl(r.data) }, { source: r.source, tool: r.tool });
  }),
);

/** Optional — property details (free). */
router.post(
  '/details',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const args = clean({
      hotelId: requireString(body.hotelId, 'hotelId'),
      token: requireString(body.token, 'token'),
      correlationId: requireString(body.correlationId, 'correlationId'),
    });
    const r = await hotels.details(args);
    sendOk(res, r.data, { source: r.source, tool: r.tool });
  }),
);

/** Step 5 — checkout link (free). */
router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    requireHotelSession({ correlationId: body.correlationId, token: body.token });
    const cached = getHotelSession(body.correlationId) ?? {};
    const rooms = Array.isArray(body.rooms) && body.rooms.length ? buildRooms(body) : cached.rooms;
    const args = clean({
      hotelId: body.hotelId,
      hotelName: body.hotelName ?? cached.hotelName,
      hotelImage: body.hotelImage,
      hotelAddress: body.hotelAddress,
      hotelStarRating: body.hotelStarRating,
      hotelRating: body.hotelRating,
      destination: body.destination ?? cached.destination,
      roomId: requireString(body.roomId, 'roomId'),
      recommendationId: requireString(body.recommendationId, 'recommendationId'),
      token: body.token,
      correlationId: body.correlationId,
      checkIn: body.checkIn ?? cached.checkIn,
      checkOut: body.checkOut ?? cached.checkOut,
      displayedPrice: body.displayedPrice,
      rooms,
      routestack_external_userid: body.routestack_external_userid || 'routestack-web',
      routestack_metadata: body.routestack_metadata,
    });
    const r = await hotels.checkout(args);
    const url = findUrl(r.data);
    sendOk(res, { url, checkoutMode: checkoutModeOf(r.data, url), raw: r.data }, { source: r.source, tool: r.tool });
  }),
);

export default router;
