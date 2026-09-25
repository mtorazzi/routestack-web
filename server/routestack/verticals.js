/**
 * Thin, typed wrappers around the RouteStack MCP tools, plus normalization of
 * the various upstream payload shapes into a stable shape for the UI.
 *
 * Canonical tool names are the ones returned by `tools/list` on production.
 */
import { effectiveBaseUrl, loadConfig, sourceLabel } from '../config.js';
import { ApiError } from '../util.js';
import { AuthProvider } from './auth.js';
import { McpClient, assertUpstreamSuccess } from './mcp.js';

/** Canonical tool names (one per operation). */
export const TOOLS = {
  hotelDestinations: 'search_destinations',
  hotelSearch: 'hotel_search',
  hotelRooms: 'hotel_get_rooms_and_rates',
  hotelRevalidate: 'hotel_revalidate_rate',
  hotelDetails: 'hotel_get_details',
  hotelCheckout: 'hotel_get_checkout_url',
  flightSession: 'flight_session',
  flightLocations: 'flight_locations',
  flightSearch: 'flight_search',
  flightRevalidate: 'flight_revalidate',
  flightCheckout: 'flight_get_checkout_url',
  carLocations: 'car_locations',
  carSearch: 'car_search',
  carRevalidate: 'car_revalidate',
  carCheckout: 'car_get_checkout_url',
};

/** Effective config for network calls (sandbox toggle applied). */
export function runtimeConfig() {
  const cfg = loadConfig();
  return { ...cfg, baseUrl: effectiveBaseUrl(cfg), source: sourceLabel(cfg) };
}

export function makeClient(cfg = runtimeConfig()) {
  const auth = new AuthProvider(cfg);
  const client = new McpClient(cfg, { auth });
  return { client, auth, cfg };
}

/** Run a tool and normalize its payload. */
async function run(tool, args, normalize) {
  const cfg = runtimeConfig();
  const { client } = makeClient(cfg);
  const { payload } = await client.callTool(tool, args ?? {});
  assertUpstreamSuccess(payload, tool);
  return {
    raw: payload,
    data: normalize ? normalize(payload) : payload,
    tool,
    source: cfg.source,
  };
}

export async function testConnection() {
  const cfg = runtimeConfig();
  const { client, auth } = makeClient(cfg);
  const diag = await auth.test({ listTools: (a) => client.listTools() });
  return { ...diag, baseUrl: cfg.baseUrl, source: cfg.source };
}

// ---------------------------------------------------------------------------
// generic helpers
// ---------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);

export function firstNum(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function firstStr(...vals) {
  for (const v of vals) if (typeof v === 'string' && v.trim() !== '') return v;
  return null;
}

export function firstBool(...vals) {
  for (const v of vals) {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 'yes' || v === 1) return true;
    if (v === 'false' || v === 'no' || v === 0) return false;
  }
  return null;
}

/** Depth-limited search for the first array whose items satisfy `pred`. */
export function findRowArray(root, pred, depth = 0) {
  if (depth > 8 || root == null) return null;
  if (Array.isArray(root)) {
    const items = root.filter(isObj);
    if (items.length && items.some(pred)) return root;
    for (const it of root) {
      const r = findRowArray(it, pred, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isObj(root)) {
    for (const v of Object.values(root)) {
      const r = findRowArray(v, pred, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/** Depth-limited search for the first object satisfying `pred`. */
export function findObject(root, pred, depth = 0) {
  if (depth > 8 || root == null) return null;
  if (Array.isArray(root)) {
    for (const it of root) {
      const r = findObject(it, pred, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isObj(root)) {
    if (pred(root)) return root;
    for (const v of Object.values(root)) {
      const r = findObject(v, pred, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

export function findUrl(payload) {
  const keys = ['checkoutUrl', 'checkout_url', 'url', 'link', 'deeplink', 'deepLink', 'redirectUrl', 'redirect_url', 'portalUrl'];
  const obj = findObject(payload, (o) => keys.some((k) => typeof o[k] === 'string' && /^https?:\/\//i.test(o[k])));
  if (obj) {
    for (const k of keys) if (typeof obj[k] === 'string' && /^https?:\/\//i.test(obj[k])) return obj[k];
  }
  // fallback: first http(s) string anywhere
  let found = null;
  const walk = (node, d = 0) => {
    if (found || d > 8 || node == null) return;
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node)) found = node;
      return;
    }
    if (isObj(node)) for (const v of Object.values(node)) walk(v, d + 1);
    else if (Array.isArray(node)) for (const v of node) walk(v, d + 1);
  };
  walk(payload);
  return found;
}

export function checkoutModeOf(payload, url) {
  const mode = firstStr(payload?.checkoutMode, payload?.mode, payload?.result?.checkoutMode);
  if (mode) return mode.toLowerCase();
  return /acp|agentic/i.test(String(url)) ? 'acp' : 'deeplink';
}

// ---------------------------------------------------------------------------
// hotels
// ---------------------------------------------------------------------------

const hotelRow = (o) =>
  isObj(o) &&
  (o.hotelId || o.hotel_id || (o.id && o.name)) &&
  (o.ourprice !== undefined || o.publishedRate !== undefined || o.price !== undefined || o.amount !== undefined);

const metaObject = (o) =>
  isObj(o) && (o.correlationId || o.correlation_id) && (o.token || o.nextResultsKey !== undefined || o.count !== undefined || o.status !== undefined);

export function normalizeDestinationRow(r) {
  const coords = r.coordinates || r.location || {};
  return {
    destinationId: firstStr(r.id, r.destinationId, r.placeId, r.referenceId),
    name: firstStr(r.fullName, r.name, r.label, r.city) || 'Destinazione',
    displayName: firstStr(r.city, r.name, r.fullName) || firstStr(r.fullName) || 'Destinazione',
    type: firstStr(r.type, r.destinationType) || 'City',
    city: firstStr(r.city),
    country: firstStr(r.country),
    lat: firstNum(coords.lat, coords.latitude, r.lat),
    long: firstNum(coords.long, coords.lng, coords.longitude, r.long),
    raw: r,
  };
}

export function normalizeDestinations(payload) {
  const rows = findRowArray(payload, (o) => o.fullName || o.id || o.destinationId) ?? [];
  return { destinations: rows.map(normalizeDestinationRow), count: rows.length, raw: payload };
}

export function normalizeHotelRow(r) {
  const ourprice = firstNum(r.ourprice, r.ourPrice, r.our_price, r.price?.ourprice, r.price?.amount, r.amount, typeof r.price === 'number' ? r.price : null, r.totalPrice);
  const publishedRate = firstNum(r.publishedRate, r.published_rate, r.publishedPrice, r.price?.publishedRate, r.publishedPrice ?? null);
  const savings = firstNum(r.savings, r.saving, r.savingAmount) ?? (publishedRate && ourprice ? Math.max(0, publishedRate - ourprice) : null);
  const savingsPercent = publishedRate && ourprice && publishedRate > 0 ? Math.round(((publishedRate - ourprice) / publishedRate) * 100) : null;
  const images = arr(r.images).map((i) => (typeof i === 'string' ? i : firstStr(i.url, i.link))).filter(Boolean);
  return {
    hotelId: firstStr(r.hotelId, r.hotel_id, r.id),
    name: firstStr(r.name, r.hotelName, r.hotel_name) || 'Hotel',
    stars: firstNum(r.starRating, r.star_rating, r.stars, r.rating?.stars),
    rating: firstNum(r.rating, r.guestRating, r.reviewScore, r.review?.score, typeof r.rating === 'number' ? r.rating : null),
    reviews: firstNum(r.reviewCount, r.reviews, r.review?.count),
    ourprice,
    publishedRate,
    price: ourprice,
    currency: firstStr(r.currency, r.price?.currency) || 'EUR',
    savings,
    savingsPercent,
    image: firstStr(r.image, r.imageUrl, r.heroImage, r.thumbnail, images[0]),
    address: firstStr(r.address, r.location?.address, r.location),
    city: firstStr(r.city, r.location?.city),
    distance: firstStr(r.distance, r.distanceFromCenter),
    freeCancellation: firstBool(r.freeCancellation, r.free_cancellation, r.refundable, r.cancellation?.free, r.cancellationPolicy?.refundable),
    freeBreakfast: firstBool(r.freeBreakfast, r.free_breakfast, r.breakfastIncluded),
    roomName: firstStr(r.roomName, r.roomType, r.room),
    supplier: firstStr(r.supplier, r.provider, r.source),
    raw: r,
  };
}

export function normalizeHotelSearch(payload) {
  const rows = findRowArray(payload, hotelRow) ?? [];
  const meta = findObject(payload, metaObject) ?? {};
  return {
    hotels: rows.map(normalizeHotelRow),
    count: firstNum(meta.count, payload?.count, rows.length) ?? rows.length,
    status: firstStr(meta.status, payload?.status) || 'Complete',
    correlationId: firstStr(meta.correlationId, meta.correlation_id),
    token: firstStr(meta.token),
    nextResultsKey: firstStr(meta.nextResultsKey, meta.next_results_key),
    currency: firstStr(rows[0]?.currency, meta.currency) || 'EUR',
    raw: payload,
  };
}

export function normalizeRoomOffer(r) {
  const board = firstStr(r.board, r.boardName, r.mealPlan, r.boardType, r.meal, r.boardBasis?.displayText, r.boardBasis?.description, r.boardBasis?.type);
  const cancellation = firstStr(
    r.cancellationPolicy,
    r.cancellation,
    r.freeCancellationText,
    r.refundability,
    r.refundabilityText,
  );
  return {
    roomId: firstStr(r.id, r.roomId, r.room_id),
    recommendationId: firstStr(r.recommendationId, r.recommendation_id, r.recommendation),
    name: firstStr(r.name, r.roomName, r.room_name, r.roomType) || 'Camera',
    board,
    ourprice: firstNum(r.ourprice, r.ourPrice, r.price?.amount, r.totalPrice, typeof r.price === 'number' ? r.price : null),
    publishedRate: firstNum(r.publishedRate, r.published_rate),
    currency: firstStr(r.currency, r.price?.currency) || 'EUR',
    cancellation,
    freeCancellation: firstBool(r.freeCancellation, r.refundable, r.cancellation?.free),
    refundable: firstBool(r.refundable, r.freeCancellation),
    beds: arr(r.beds).map((b) => firstStr(b.type, b.name)).filter(Boolean),
    smokingAllowed: firstBool(r.smokingAllowed),
    raw: r,
  };
}

export function normalizeHotelRooms(payload) {
  const offers = [];
  const groups = arr(findObject(payload, (o) => Array.isArray(o.groups))?.groups);
  for (const g of groups) {
    for (const room of arr(g.rooms)) {
      offers.push({ ...normalizeRoomOffer(room), group: firstStr(g.name, g.groupName), groupRaw: undefined });
    }
  }
  if (!offers.length) {
    const flat = findRowArray(payload, (o) => o.recommendationId || o.roomId || o.id) ?? [];
    for (const room of flat) offers.push(normalizeRoomOffer(room));
  }
  const meta = findObject(payload, metaObject) ?? {};
  return {
    offers,
    groups,
    correlationId: firstStr(meta.correlationId, meta.correlation_id),
    token: firstStr(meta.token),
    currency: firstStr(offers[0]?.currency, meta.currency) || 'EUR',
    raw: payload,
  };
}

// ---------------------------------------------------------------------------
// flights
// ---------------------------------------------------------------------------

function segmentsOf(o) {
  return arr(o?.flights).length ? arr(o.flights) : arr(o?.segments);
}

function formatDuration(minutes) {
  const m = firstNum(minutes);
  if (m == null || m <= 0) return null;
  return `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;
}

function baggageText(list) {
  const parts = arr(list).map((b) => (typeof b === 'string' ? b : firstStr(b.value, b.weight, b.description))).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function normalizeFlightOffer(o) {
  const segs = segmentsOf(o);
  const first = segs[0] || {};
  const last = segs.at(-1) || first;
  const totalMinutes = segs.reduce((sum, s) => sum + (firstNum(s.triptime, s.tripTime) ?? 0), 0);
  const penalty = arr(o.penaltydetails).find((p) => firstBool(p.refundAllowed) === true) ?? arr(o.penaltydetails)[0] ?? null;
  return {
    fareSourceCode: firstStr(o.fareSourceCode, o.fare_source_code, o.fareCode, o.id),
    ourprice: firstNum(o.ourprice, o.ourPrice, o.our_price, o.convertedCoin, o.showOurprice, o.price?.amount, typeof o.price === 'number' ? o.price : null),
    publishedPrice: firstNum(o.showOurprice, o.totalFare, o.baseFare, o.publishedPrice),
    currency: firstStr(o.currency, o.price?.currency) || null,
    airline: firstStr(first.airline, first.airlineName, o.airline, o.airlineName, o.carrier, o.validatingAirline),
    airlineCode: firstStr(first.flightCode, first.airlineCode, first.carrierCode, o.airlineCode, o.carrier),
    flightNumber: firstStr(first.flightNumber, first.number, o.flightNumber),
    origin: firstStr(first.departure, first.origin, first.from, first.departureAirport, first.departure?.airport),
    originName: firstStr(first.departurelocation, first.departairport, first.originName),
    destination: firstStr(last.arrival, last.destination, last.to, last.arrivalAirport, last.arrival?.airport),
    destinationName: firstStr(last.arrivallocation, last.arrivalairport, last.destinationName),
    departureTime: firstStr(first.departureTime, first.departure, first.departureDate, first.departure?.time),
    arrivalTime: firstStr(last.arrivalTime, last.arrival, last.arrivalDate, last.arrival?.time),
    duration: firstStr(o.duration, o.totalDuration) || formatDuration(totalMinutes),
    stops: firstNum(o.stops, o.flight?.stops, segs.length ? segs.length - 1 : null),
    segments: segs.map((s) => ({
      airline: firstStr(s.airline, s.airlineName, s.carrier),
      flightNumber: firstStr(s.flightNumber, s.number),
      origin: firstStr(s.departure, s.origin, s.from, s.departureAirport),
      originName: firstStr(s.departurelocation, s.departairport),
      destination: firstStr(s.arrival, s.destination, s.to, s.arrivalAirport),
      destinationName: firstStr(s.arrivallocation, s.arrivalairport),
      departureTime: firstStr(s.departureTime, s.departure, s.departureDate),
      arrivalTime: firstStr(s.arrivalTime, s.arrival, s.arrivalDate),
      duration: formatDuration(s.triptime),
      raw: s,
    })),
    refundable: firstBool(o.refundable, o.isRefundable, penalty?.refundAllowed),
    changeable: firstBool(o.changeable, penalty?.changeAllowed),
    baggage: baggageText(first.checkInBaggage),
    cabinBaggage: baggageText(first.cabinBaggage),
    cabin: firstStr(first.cabin, o.cabin, o.cabinClass),
    fareFamily: firstStr(first.fareFamily, o.fareFamily),
    remainingSeats: firstNum(first.remainingSeats),
    supplier: firstStr(o.supplier, o.provider),
    raw: o,
  };
}

export function normalizeFlightSearch(payload) {
  const rows = findRowArray(payload, (o) => o.fareSourceCode || o.fare_source_code || (o.ourprice !== undefined && (o.flights || o.flight || o.segments))) ?? [];
  const searchFilterObj = parseMaybeJson(payload?.searchFilterObj) ?? (payload?.searchFilterObj ?? null);
  return {
    offers: rows.map(normalizeFlightOffer),
    count: firstNum(payload?.count, rows.length) ?? rows.length,
    status: firstStr(payload?.status) || 'Complete',
    correlationId: firstStr(payload?.correlationId, payload?.correlation_id),
    searchFilterObj: typeof searchFilterObj === 'string' ? searchFilterObj : JSON.stringify(searchFilterObj),
    currency: firstStr(payload?.currency, rows[0]?.currency) || 'EUR',
    raw: payload,
  };
}

function parseMaybeJson(v) {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export function normalizeLocationRow(r) {
  return {
    name: firstStr(r.name, r.fullname, r.label, r.city) || 'Luogo',
    code: firstStr(r.code, r.iata, r.iataCode, r.airportCode),
    city: firstStr(r.city),
    country: firstStr(r.country),
    fullname: firstStr(r.fullname, r.fullName, r.label, r.name),
    type: firstStr(r.type, r.placeType),
    raw: r,
  };
}

export function normalizeLocations(payload) {
  const rows = findRowArray(payload, (o) => o.code || o.name || o.fullname || o.fullName) ?? [];
  return { locations: rows.map(normalizeLocationRow), count: rows.length, raw: payload };
}

// ---------------------------------------------------------------------------
// cars
// ---------------------------------------------------------------------------

export function normalizeCarOffer(o) {
  const prepaid = isObj(o.price_prepaid) ? o.price_prepaid : null;
  const postpaid = isObj(o.price_postpaid) ? o.price_postpaid : null;
  const chosen = prepaid || postpaid || {};
  const fareCode = firstStr(o.fareCode, o.fare_code, chosen.fareCode, chosen.fare_code, o.offerId, o.offer_id);
  return {
    offerId: firstStr(o.offerId, o.offer_id, o.id),
    fareCode,
    prepaid: Boolean(prepaid && (prepaid.fareCode || prepaid.fare_code || prepaid.amount)),
    carType: firstStr(o.carType, o.category, o.vehicle?.category, o.carClass),
    model: firstStr(o.model, o.carModel, o.vehicle?.model, o.vehicle?.name, o.modelName, o.carType) || 'Veicolo',
    supplier: firstStr(o.supplier, o.vendor, o.rentalAgency, o.company, chosen.supplier),
    seats: firstNum(o.seats, o.passengers, o.carCapacity, o.vehicle?.seats),
    doors: firstNum(o.doors, o.vehicle?.doors),
    transmission: firstStr(o.transmission, o.vehicle?.transmission, o.transmissionType),
    fuel: firstStr(o.fuel, o.fuelType, o.vehicle?.fuelType, o.fuel_type),
    mileage: firstStr(o.mileage, o.mileageType, o.mileageTypeDescription, o.mileage_type),
    airConditioning: firstBool(o.airConditioning, o.aircon, o.vehicle?.airConditioning),
    freeCancellation: firstBool(o.freeCancellation, o.free_cancellation, o.cancellation?.free, chosen.freeCancellation),
    price: firstNum(o.ourprice, o.ourPrice, o.totalPrice, o.total, o.price?.amount, chosen.amount, typeof o.price === 'number' ? o.price : null),
    currency: firstStr(o.currency, chosen.currency) || 'EUR',
    pickupLocation: firstStr(o.pickupLocation, o.pickup?.name, o.pickup),
    dropoffLocation: firstStr(o.dropoffLocation, o.dropoff?.name, o.dropoff),
    image: firstStr(o.image, o.imageUrl, o.vehicle?.image),
    raw: o,
  };
}

export function normalizeCarSearch(payload) {
  const rows = findRowArray(payload, (o) => o.fareCode || o.offerId || o.price_prepaid || o.carType || o.vehicle) ?? [];
  const meta = findObject(payload, metaObject) ?? {};
  return {
    offers: rows.map(normalizeCarOffer),
    count: firstNum(meta.count, payload?.count, rows.length) ?? rows.length,
    status: firstStr(meta.status, payload?.status) || 'Complete',
    correlationId: firstStr(meta.correlationId, meta.correlation_id),
    currency: firstStr(rows[0]?.currency, meta.currency) || 'EUR',
    raw: payload,
  };
}

// ---------------------------------------------------------------------------
// tool wrappers
// ---------------------------------------------------------------------------

export const hotels = {
  destinations: (args) => run(TOOLS.hotelDestinations, args, normalizeDestinations),
  search: (args) => run(TOOLS.hotelSearch, args, normalizeHotelSearch),
  rooms: (args) => run(TOOLS.hotelRooms, args, normalizeHotelRooms),
  revalidate: (args) => run(TOOLS.hotelRevalidate, args),
  details: (args) => run(TOOLS.hotelDetails, args),
  checkout: (args) => run(TOOLS.hotelCheckout, args),
};

export const flights = {
  session: () => run(TOOLS.flightSession, {}, null),
  locations: (args) => run(TOOLS.flightLocations, args, normalizeLocations),
  search: (args) => run(TOOLS.flightSearch, args, normalizeFlightSearch),
  revalidate: (args) => run(TOOLS.flightRevalidate, args),
  checkout: (args) => run(TOOLS.flightCheckout, args),
};

export const cars = {
  locations: (args) => run(TOOLS.carLocations, args, normalizeLocations),
  search: (args) => run(TOOLS.carSearch, args, normalizeCarSearch),
  revalidate: (args) => run(TOOLS.carRevalidate, args),
  checkout: (args) => run(TOOLS.carCheckout, args),
};

// ---------------------------------------------------------------------------
// in-memory session caches (no database)
// ---------------------------------------------------------------------------

const hotelSessions = new Map();
export function rememberHotelSession(correlationId, token, extra = {}) {
  if (!correlationId) return;
  hotelSessions.set(correlationId, { token, ...extra, updatedAt: Date.now() });
}
export function getHotelSession(correlationId) {
  return correlationId ? hotelSessions.get(correlationId) ?? null : null;
}

let flightSessionId = null;
export function rememberFlightSession(id) {
  if (id) flightSessionId = id;
}
export function getFlightSession() {
  return flightSessionId;
}

let lastCarSession = null;
export function rememberCarSession(correlationId) {
  if (correlationId) lastCarSession = correlationId;
}
export function getCarSession() {
  return lastCarSession;
}

/** Hotel checkout requires a token + recommendationId + correlationId. */
export function requireHotelSession({ correlationId, token }) {
  if (!correlationId || !token) {
    throw new ApiError('HOTEL_SESSION_REQUIRED', 'Sessione hotel non valida: correlationId/token mancanti (riesegui la ricerca).', {
      status: 409,
    });
  }
}
