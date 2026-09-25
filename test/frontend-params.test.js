import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCarSearchArgs,
  buildConfigPatch,
  buildFlightSearchArgs,
  buildHotelSearchArgs,
  clean,
  missingRequired,
  stopsFromMax,
  toList,
} from '../public/components/params.js';
import { formatDate, formatDuration, formatPrice, paxSummary, splitDateTime } from '../public/components/format.js';

test('clean drops empty values and nested empties', () => {
  assert.deepEqual(clean({ a: 1, b: '', c: null, d: [], e: {}, f: { g: '' } }), { a: 1 });
});

test('toList splits, trims and drops empties', () => {
  assert.deepEqual(toList('EK, LH , '), ['EK', 'LH']);
  assert.deepEqual(toList(['a', ' b ']), ['a', 'b']);
});

test('stopsFromMax maps 0/1/2 and caps at 3', () => {
  assert.deepEqual(stopsFromMax('0'), [0]);
  assert.deepEqual(stopsFromMax(1), [0, 1]);
  assert.deepEqual(stopsFromMax(9), [0, 1, 2, 3]);
  assert.equal(stopsFromMax(''), undefined);
});

test('buildFlightSearchArgs builds a round-trip body', () => {
  const args = buildFlightSearchArgs({
    tripType: 'RoundTrip',
    origin: 'mxp',
    destination: 'bkk',
    departureDate: '2027-08-20',
    returnDate: '2027-08-27',
    adults: '2',
    children: '1',
    infants: '0',
    cabinClass: 'Economy',
    maxStops: '1',
    priceMin: '100',
    priceMax: '900',
    airlines: 'EK, LH',
    refundability: 'true',
    sortBy: 'price',
    limit: '20',
  });
  assert.equal(args.origin, 'MXP');
  assert.equal(args.destination, 'BKK');
  assert.equal(args.returnDate, '2027-08-27');
  assert.deepEqual(args.filters.price, { min: 100, max: 900 });
  assert.deepEqual(args.filters.stops, [0, 1]);
  assert.deepEqual(args.filters.airlines, ['EK', 'LH']);
  assert.equal(args.filters.refundability, 'true');
  assert.equal(args.adults, 2);
  assert.equal(args.cabinClass, 'Economy');
  assert.equal(args.limit, 20);
});

test('buildFlightSearchArgs drops the return date for OneWay', () => {
  const args = buildFlightSearchArgs({ tripType: 'OneWay', origin: 'MXP', destination: 'BKK', departureDate: '2027-08-20', returnDate: '2027-08-27' });
  assert.equal(args.tripType, 'OneWay');
  assert.equal(args.returnDate, undefined);
});

test('buildHotelSearchArgs builds rooms and filters', () => {
  const args = buildHotelSearchArgs({
    destinationId: 'ChIJw0rXGxGKJRMRAIE4sppPCQM',
    destinationType: 'City',
    checkIn: '2027-08-20',
    checkOut: '2027-08-25',
    roomCount: '2',
    adults: '2',
    children: '1',
    stars: ['5', '4'],
    priceMax: '300',
    freeCancellation: true,
    propertyType: 'Hotel',
  });
  assert.equal(args.currency, 'EUR');
  assert.equal(args.roomCount, 2);
  assert.equal(args.rooms.length, 2);
  assert.deepEqual(args.rooms[0], { adults: 2, children: 1 });
  assert.deepEqual(args.rooms[1], { adults: 2, children: 0 });
  assert.deepEqual(args.filters.starRating, [5, 4]);
  assert.deepEqual(args.filters.price, { max: 300 });
  assert.equal(args.filters.freeCancellation, true);
  assert.equal(args.filters.propertyType, 'Hotel');
});

test('buildCarSearchArgs builds pickup/dropoff places', () => {
  const args = buildCarSearchArgs({
    pickup: { name: 'Malpensa Airport', code: 'MXP' },
    dropoff: { name: 'Malpensa Airport', code: 'MXP' },
    pickupDate: '2027-08-20',
    pickupTime: '10:00',
    dropoffDate: '2027-08-25',
    dropoffTime: '10:00',
    transmission: 'Automatic',
    payment: 'prepaid',
    freeCancellation: true,
    passengersMin: '5',
    limit: '10',
  });
  assert.deepEqual(args.pickup, { name: 'Malpensa Airport', code: 'MXP', date: '2027-08-20', time: '10:00' });
  assert.equal(args.dropoff.date, '2027-08-25');
  assert.equal(args.filters.transmission, 'Automatic');
  assert.equal(args.filters.payment, 'prepaid');
  assert.equal(args.filters.passengersMin, 5);
  assert.equal(args.limit, 10);
  assert.equal(args.sortBy, undefined);
});

test('missingRequired reports the relevant missing fields', () => {
  assert.deepEqual(missingRequired('flights', { tripType: 'OneWay', origin: 'MXP', destination: 'BKK' }), ['data di andata', 'classe']);
  assert.deepEqual(missingRequired('hotels', { destination: 'Rome' }), ['check-in', 'check-out']);
  assert.deepEqual(missingRequired('cars', {}), ['luogo di ritiro', 'data di ritiro', 'luogo di riconsegna', 'data di riconsegna']);
});

test('buildConfigPatch saves first-entry credentials even when editing is false', () => {
  const patch = buildConfigPatch(
    { authMode: 'partner-token', baseUrl: 'https://mcp.routestack.ai/mcp', sandbox: false, currency: 'EUR', timeoutMs: '30000', apiKey: 'rst_TESTKEY1234', apiSecret: 'test-secret-1234', accountId: '' },
    { apiKey: false, apiSecret: false, accountId: false },
  );
  assert.equal(patch.apiKey, 'rst_TESTKEY1234');
  assert.equal(patch.apiSecret, 'test-secret-1234');
  assert.ok(!('accountId' in patch));
});

test('buildConfigPatch leaves untouched (masked, empty) secrets out of the patch', () => {
  const patch = buildConfigPatch(
    { authMode: 'partner-token', baseUrl: 'https://mcp.routestack.ai/mcp', sandbox: true, currency: 'USD', timeoutMs: '45000', apiKey: '', apiSecret: '', accountId: '' },
    { apiKey: false, apiSecret: false, accountId: false },
  );
  assert.ok(!('apiKey' in patch));
  assert.ok(!('apiSecret' in patch));
  assert.ok(!('accountId' in patch));
  assert.equal(patch.sandbox, true);
  assert.equal(patch.currency, 'USD');
  assert.equal(patch.timeoutMs, 45000);
});

test('buildConfigPatch clears accountId only when explicitly editing', () => {
  const cleared = buildConfigPatch(
    { authMode: 'header', baseUrl: 'x', sandbox: false, currency: 'EUR', timeoutMs: '30000', apiKey: '', apiSecret: '', accountId: '' },
    { apiKey: false, apiSecret: false, accountId: true },
  );
  assert.equal(cleared.accountId, null);
  assert.equal(cleared.authMode, 'header');
});

test('buildConfigPatch keeps sandbox a real boolean and never emits undefined/empty secrets', () => {
  const off = buildConfigPatch({ sandbox: undefined, timeoutMs: '', apiKey: undefined, apiSecret: undefined }, {});
  assert.equal(off.sandbox, false);
  assert.ok(!('apiKey' in off));
  assert.ok(!('apiSecret' in off));
  assert.equal(typeof off.sandbox, 'boolean');

  const on = buildConfigPatch({ sandbox: 'true' }, {});
  assert.equal(on.sandbox, false, 'a truthy non-boolean string must not become sandbox=true');
});

test('format helpers produce it-IT output', () => {
  assert.match(formatPrice(88.4, 'EUR'), /88,40/);
  assert.equal(formatDuration('13h 20m'), '13h 20m');
  assert.equal(formatDuration(125), '2h 5m');
  assert.equal(formatDate('2027-08-20'), '20 ago 2027');
  assert.equal(paxSummary({ adults: 2, children: 1 }), '2 adulti, 1 bambino');
  assert.deepEqual(splitDateTime('2027-08-20T10:00'), { date: '2027-08-20', time: '10:00' });
});
