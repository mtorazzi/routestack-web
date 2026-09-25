/**
 * Pure builders that turn flat form values into the request bodies the backend
 * expects. Kept DOM-free so they can be unit tested in Node.
 */

/** Recursively drop undefined / null / '' / empty array / empty object. */
export function clean(value) {
  if (Array.isArray(value)) return value.map(clean).filter((v) => v !== undefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = clean(v);
      if (c === undefined || c === null || c === '') continue;
      if (Array.isArray(c) && c.length === 0) continue;
      if (typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out;
  }
  if (value === '') return undefined;
  return value;
}

export function toInt(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function toNum(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** "EK, LH , " -> ['EK','LH']; supports arrays too. */
export function toList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** 0/1/2 -> [0], [0,1], [0,1,2]; empty -> undefined. */
export function stopsFromMax(maxStops) {
  const max = toInt(maxStops, null);
  if (max === null) return undefined;
  const capped = Math.min(Math.max(max, 0), 3);
  return Array.from({ length: capped + 1 }, (_, i) => i);
}

/**
 * @param {object} v form values
 * @returns {object} body for POST /api/flights/search
 */
export function buildFlightSearchArgs(v = {}) {
  const price = clean({ min: toNum(v.priceMin, undefined), max: toNum(v.priceMax, undefined) });
  const filters = clean({
    price: Object.keys(price).length ? price : undefined,
    airlines: toList(v.airlines),
    stops: stopsFromMax(v.maxStops),
    refundability: v.refundability || undefined,
  });
  return clean({
    tripType: v.tripType || 'OneWay',
    origin: (v.origin || '').trim().toUpperCase(),
    destination: (v.destination || '').trim().toUpperCase(),
    departureDate: v.departureDate,
    returnDate: v.tripType === 'RoundTrip' ? v.returnDate : undefined,
    adults: toInt(v.adults, 1),
    children: toInt(v.children, 0),
    infants: toInt(v.infants, 0),
    cabinClass: v.cabinClass,
    filters: Object.keys(filters).length ? filters : undefined,
    sortBy: v.sortBy || undefined,
    limit: toInt(v.limit, undefined),
    page: toInt(v.page, undefined),
  });
}

/** Build the `rooms` array expected by the hotels backend. Children go on the first room. */
export function buildRooms(v = {}) {
  const count = Math.min(Math.max(toInt(v.roomCount, 1) || 1, 1), 8);
  const adults = Math.min(Math.max(toInt(v.adults, 2) || 2, 1), 8);
  const children = Math.min(Math.max(toInt(v.children, 0) || 0, 0), 8);
  return Array.from({ length: count }, (_, i) => ({ adults, children: i === 0 ? children : 0 }));
}

/**
 * @param {object} v form values
 * @returns {object} body for POST /api/hotels/search
 */
export function buildHotelSearchArgs(v = {}) {
  const stars = Array.isArray(v.stars) ? v.stars.map((s) => toInt(s)).filter((s) => s !== null) : [];
  const filters = clean({
    starRating: stars,
    price: clean({ min: toNum(v.priceMin, undefined), max: toNum(v.priceMax, undefined) }),
    freeCancellation: v.freeCancellation === true ? true : undefined,
    freeBreakfast: v.freeBreakfast === true ? true : undefined,
    refundable: v.refundable === true ? true : undefined,
    payAtHotel: v.payAtHotel === true ? true : undefined,
    propertyType: v.propertyType || undefined,
    chains: toList(v.chains),
    amenities: toList(v.amenities),
  });
  const rooms = buildRooms(v);
  return clean({
    destinationId: v.destinationId || undefined,
    destination: v.destination || undefined,
    destinationType: v.destinationType || undefined,
    checkIn: v.checkIn,
    checkOut: v.checkOut,
    roomCount: rooms.length,
    adults: rooms[0]?.adults,
    rooms,
    currency: v.currency || 'EUR',
    filters: Object.keys(filters).length ? filters : undefined,
    sortBy: v.sortBy || undefined,
    limit: toInt(v.limit, undefined),
    nextResultsKey: v.nextResultsKey || undefined,
    correlationId: v.correlationId || undefined,
    token: v.token || undefined,
  });
}

/** Pickup/dropoff place object. `place` is {name,code}. */
function buildPlace(place, date, time) {
  if (!place || !place.name) return undefined;
  return clean({ name: String(place.name).trim(), code: place.code || undefined, date, time });
}

/**
 * @param {object} v form values, with v.pickup / v.dropoff as {name,code}
 * @returns {object} body for POST /api/cars/search
 */
export function buildCarSearchArgs(v = {}) {
  const filters = clean({
    carType: v.carType || undefined,
    transmission: v.transmission || undefined,
    fuel: v.fuel || undefined,
    mileage: v.mileage || undefined,
    payment: v.payment || undefined,
    freeCancellation: v.freeCancellation === true ? true : undefined,
    passengersMin: toInt(v.passengersMin, undefined),
    passengersMax: toInt(v.passengersMax, undefined),
    agency: v.agency || undefined,
  });
  return clean({
    pickup: buildPlace(v.pickup, v.pickupDate, v.pickupTime),
    dropoff: buildPlace(v.dropoff, v.dropoffDate, v.dropoffTime),
    sortBy: v.sortBy || undefined,
    filters: Object.keys(filters).length ? filters : undefined,
    limit: toInt(v.limit, undefined),
    page: toInt(v.page, undefined),
  });
}

/**
 * Build the POST /api/config patch.
 *
 * Secret controls are rendered masked/read-only (and submit `''`) until the
 * user presses "Modifica". On a fresh install `apiKeySet`/`apiSecretSet` are
 * false, so no "Modifica" button exists — but the fields are editable and the
 * first typed value must still be saved. Therefore a non-empty submitted secret
 * is always included, regardless of the editing flag; an untouched secret
 * submits `''` and is left out. `accountId` can be explicitly cleared (null)
 * only while editing it.
 *
 * @param {object} values flat form values from `readValues(form)`
 * @param {{apiKey?:boolean,apiSecret?:boolean,accountId?:boolean}} [editing]
 * @returns {object} body for POST /api/config
 */
export function buildConfigPatch(values = {}, editing = {}) {
  const patch = {
    authMode: values.authMode,
    baseUrl: values.baseUrl,
    sandbox: values.sandbox === true,
    currency: values.currency,
    timeoutMs: Number(values.timeoutMs) || 30000,
  };

  if (typeof values.apiKey === 'string' && values.apiKey !== '') patch.apiKey = values.apiKey;
  if (typeof values.apiSecret === 'string' && values.apiSecret !== '') patch.apiSecret = values.apiSecret;

  if (typeof values.accountId === 'string' && values.accountId !== '') patch.accountId = values.accountId;
  else if (editing.accountId) patch.accountId = null;

  return patch;
}

/** Which required fields are missing, for client-side validation. */
export function missingRequired(kind, v = {}) {
  const missing = [];
  if (kind === 'flights') {
    if (!v.origin) missing.push('origine');
    if (!v.destination) missing.push('destinazione');
    if (!v.departureDate) missing.push('data di andata');
    if (!v.cabinClass) missing.push('classe');
    if (v.tripType === 'RoundTrip' && !v.returnDate) missing.push('data di ritorno');
  } else if (kind === 'hotels') {
    if (!v.destination) missing.push('destinazione');
    if (!v.checkIn) missing.push('check-in');
    if (!v.checkOut) missing.push('check-out');
  } else if (kind === 'cars') {
    if (!v.pickup?.name) missing.push('luogo di ritiro');
    if (!v.pickupDate) missing.push('data di ritiro');
    if (!v.dropoff?.name) missing.push('luogo di riconsegna');
    if (!v.dropoffDate) missing.push('data di riconsegna');
  }
  return missing;
}
