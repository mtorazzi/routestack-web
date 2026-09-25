/**
 * Offline unit tests for the flight request filter builder.
 *
 * `buildFilter` is the seam between the HTTP body and the `flight_search`
 * `filter` envelope. These tests pin the MultiCity shape (the leg date key is
 * `departureDate`, confirmed from the production tool schema) and prove that
 * OneWay/RoundTrip requirements are unchanged. No network, no billable call.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFilter, sanitizeDestinations } from '../server/routes/flights.js';

const isBadRequest = (err) => err?.code === 'BAD_REQUEST' && err?.status === 400;

test('buildFilter forwards sanitised MultiCity destinations and drops the top-level itinerary', () => {
  const filter = buildFilter({
    tripType: 'MultiCity',
    origin: 'should-be-ignored',
    destination: 'also-ignored',
    departureDate: '2027-01-01',
    destinations: [
      { origin: ' mxp ', destination: 'BKK', departureDate: '2027-08-20' },
      { origin: 'BKK', destination: 'SYD', date: '2027-08-27' },
      { origin: '', destination: 'AKL', departureDate: '2027-09-03' },
    ],
    adults: 2,
    children: 1,
    cabinClass: 'Economy',
  });

  assert.equal(filter.tripType, 'MultiCity');
  assert.equal(filter.type, 'MultiCity');
  assert.deepEqual(filter.destinations, [
    { origin: 'mxp', destination: 'BKK', departureDate: '2027-08-20' },
    { origin: 'BKK', destination: 'SYD', departureDate: '2027-08-27' },
  ]);
  assert.equal(filter.origin, undefined);
  assert.equal(filter.destination, undefined);
  assert.equal(filter.departureDate, undefined);
  assert.equal(filter.returnDate, undefined);
  assert.equal(filter.adults, 2);
  assert.equal(filter.children, 1);
});

test('buildFilter rejects MultiCity with fewer than two valid legs', () => {
  const cases = [
    [],
    undefined,
    [{ origin: 'MXP', destination: 'BKK' }],
    [{ origin: 'MXP', destination: 'BKK', departureDate: '' }],
    [{ origin: 'MXP', destination: 'BKK', departureDate: '2027-08-20' }],
  ];
  for (const destinations of cases) {
    assert.throws(
      () => buildFilter({ tripType: 'MultiCity', destinations }),
      (err) => isBadRequest(err) && /MultiCity/.test(err.message),
      `expected BAD_REQUEST for ${JSON.stringify(destinations)}`,
    );
  }
});

test('buildFilter still requires origin/destination/departureDate for OneWay and RoundTrip', () => {
  for (const tripType of ['OneWay', 'RoundTrip']) {
    assert.throws(() => buildFilter({ tripType }), (err) => isBadRequest(err) && /origin/.test(err.message));
    assert.throws(() => buildFilter({ tripType, origin: 'MXP' }), (err) => isBadRequest(err) && /destination/.test(err.message));
    assert.throws(
      () => buildFilter({ tripType, origin: 'MXP', destination: 'BKK' }),
      (err) => isBadRequest(err) && /departureDate/.test(err.message),
    );
  }
  assert.throws(() => buildFilter({}), (err) => isBadRequest(err) && /origin/.test(err.message), 'an unspecified trip type defaults to the single itinerary');
});

test('buildFilter keeps OneWay and RoundTrip bodies intact', () => {
  const one = buildFilter({ tripType: 'OneWay', origin: ' MXP ', destination: 'BKK', departureDate: '2027-08-20', returnDate: '2027-08-27' });
  assert.equal(one.origin, ' MXP ');
  assert.equal(one.destination, 'BKK');
  assert.equal(one.departureDate, '2027-08-20');
  assert.equal(one.returnDate, '2027-08-27', 'the pre-MultiCity passthrough is preserved');
  assert.equal(one.destinations, undefined);

  const rt = buildFilter({ tripType: 'RoundTrip', origin: 'MXP', destination: 'BKK', departureDate: '2027-08-20', returnDate: '2027-08-27' });
  assert.equal(rt.type, 'RoundTrip');
  assert.equal(rt.tripType, 'RoundTrip');
  assert.equal(rt.returnDate, '2027-08-27');
  assert.equal(rt.destinations, undefined);
});

test('sanitizeDestinations drops malformed legs and normalises the date alias', () => {
  assert.deepEqual(
    sanitizeDestinations([
      { origin: 'MXP', destination: 'BKK', departureDate: '2027-08-20' },
      null,
      'nope',
      { origin: 'BKK', destination: 'SYD' },
      { origin: 'SYD', destination: 'AKL', date: '2027-09-03' },
      { origin: 42, destination: 'CAI', departureDate: '2027-09-10' },
    ]),
    [
      { origin: 'MXP', destination: 'BKK', departureDate: '2027-08-20' },
      { origin: 'SYD', destination: 'AKL', departureDate: '2027-09-03' },
    ],
  );
});
