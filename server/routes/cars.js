import { Router } from 'express';

import { cars, checkoutModeOf, findUrl, getCarSession, rememberCarSession } from '../routestack/verticals.js';
import { asyncHandler, clean, requireBody, requireString, sendOk } from './_helpers.js';

const router = Router();

function buildPlace(place, fallbackDate, fallbackTime) {
  if (!place) return undefined;
  const name = requireString(place.name ?? place, 'pickup/dropoff name');
  return clean({ name, code: place.code, date: place.date ?? fallbackDate, time: place.time ?? fallbackTime });
}

/** Pickup/dropoff location lookup (free). */
router.post(
  '/locations',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const term = requireString(body.term, 'term');
    const r = await cars.locations({ term });
    sendOk(res, r.data, { source: r.source, tool: r.tool });
  }),
);

/** Car search (billable). */
router.post(
  '/search',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const pickup = buildPlace(body.pickup, body.pickupDate, body.pickupTime);
    const dropoff = buildPlace(body.dropoff, body.dropoffDate, body.dropoffTime);
    const args = clean({
      pickup,
      dropoff,
      sortBy: body.sortBy,
      filters: body.filters,
      limit: body.limit,
      page: body.page,
    });
    const r = await cars.search({ filter: args });
    rememberCarSession(r.data.correlationId);
    sendOk(res, r.data, { source: r.source, tool: r.tool });
  }),
);

/** Revalidate a chosen offer (free). */
router.post(
  '/revalidate',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const args = clean({
      offerId: body.offerId,
      fareCode: body.fareCode,
      correlationId: body.correlationId ?? getCarSession(),
      car: body.car,
      prepaid: body.prepaid,
    });
    const r = await cars.revalidate(args);
    sendOk(res, { ...r.data, url: findUrl(r.data) }, { source: r.source, tool: r.tool });
  }),
);

/** Checkout link (free). */
router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const body = requireBody(req);
    const args = clean({
      correlationId: body.correlationId ?? getCarSession(),
      offerId: body.offerId,
      fareCode: body.fareCode,
      pickup: body.pickup,
      dropoff: body.dropoff,
      pickupDate: body.pickupDate,
      dropoffDate: body.dropoffDate,
      pickupTime: body.pickupTime,
      dropoffTime: body.dropoffTime,
      car: requireBody(req).car,
      routestack_external_userid: body.routestack_external_userid || 'routestack-web',
      routestack_metadata: body.routestack_metadata,
    });
    const r = await cars.checkout(args);
    const url = findUrl(r.data);
    sendOk(res, { url, checkoutMode: checkoutModeOf(r.data, url), raw: r.data }, { source: r.source, tool: r.tool });
  }),
);

export default router;
