/**
 * Offline proof that `/checkout` forwards the exact payload upstream requires.
 *
 * The MCP client is stubbed via the `__setClientFactory` seam, so every
 * `tools/call` is captured locally and **no billable `/search` ever leaves the
 * machine**. Each vertical's checkout is exercised through the real Express
 * routes, after a stubbed search populates the in-memory session cache.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/index.js';
import { __setClientFactory } from '../server/routestack/verticals.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const flightSearchFixture = () => JSON.parse(fs.readFileSync(path.join(dir, 'flight-search.json'), 'utf8'));

const CHECKOUT_URL = 'https://mcp.routestack.ai/checkout/r/offline-test';

/** Stub MCP client: records every `tools/call` and returns canned payloads. */
function makeStub() {
  const calls = [];
  const payloadFor = (name) => {
    if (name === 'flight_session') return { success: true, sessionId: 'flight-sess-1' };
    if (name === 'flight_search') return flightSearchFixture();
    if (name === 'car_search') {
      return {
        success: true,
        result: {
          count: 1,
          status: 'Complete',
          correlationId: 'car-corr-1',
          offers: [
            {
              offerId: 'car-offer-1',
              fareCode: 'CAR-FARE-1',
              carType: 'Compact',
              model: 'Fiat 500',
              supplier: 'Hertz',
              price_prepaid: { fareCode: 'CAR-FARE-1', amount: 88.4, currency: 'EUR' },
            },
          ],
        },
      };
    }
    if (name.endsWith('_get_checkout_url')) return { success: true, result: { checkoutUrl: CHECKOUT_URL } };
    return { success: true };
  };
  const factory = () => ({
    callTool: async (name, args) => {
      calls.push({ name, args });
      return { payload: payloadFor(name) };
    },
  });
  return { calls, factory };
}

/** Boot the real app on an ephemeral port with the stub installed. */
async function withServer(t, stub) {
  __setClientFactory(stub.factory);
  t.after(() => __setClientFactory(null));
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const post = async (p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  return { post };
}

/** Last captured tools/call for a given tool name. */
const lastCall = (calls, name) => [...calls].reverse().find((c) => c.name === name);

test('flight checkout fills fareSourceCode + flight + itinerary from the cached search', async (t) => {
  const stub = makeStub();
  const { post } = await withServer(t, stub);

  const search = await post('/api/flights/search', {
    tripType: 'OneWay',
    origin: 'MXP',
    destination: 'BKK',
    departureDate: '2027-08-20',
    adults: 1,
    children: 0,
    infants: 0,
    cabinClass: 'Economy',
  });
  assert.equal(search.status, 200);
  assert.equal(search.json.ok, true);
  const offer = search.json.data.offers[0];
  assert.ok(offer.fareSourceCode);

  const checkout = await post('/api/flights/checkout', { fareSourceCode: offer.fareSourceCode });
  assert.equal(checkout.status, 200);

  const call = lastCall(stub.calls, 'flight_get_checkout_url');
  assert.ok(call, 'flight_get_checkout_url must be called');
  const a = call.args;
  assert.equal(a.fareSourceCode, offer.fareSourceCode);
  assert.ok(a.flight, 'the raw itinerary object must be forwarded');
  assert.equal(a.flight.fareSourceCode, offer.fareSourceCode);
  assert.equal(a.origin, 'MXP');
  assert.equal(a.destination, 'BKK');
  assert.equal(a.departureDate, '2027-08-20');
  assert.equal(a.adults, 1);
  assert.ok(a.searchFilterObj);
  assert.equal(a.correlationId, '1790351064956-hmc5xztsp');
  assert.equal(a.sessionId, 'flight-sess-1');
});

test('flight checkout lets an explicit body win over the cached context', async (t) => {
  const stub = makeStub();
  const { post } = await withServer(t, stub);

  await post('/api/flights/search', {
    tripType: 'OneWay',
    origin: 'MXP',
    destination: 'BKK',
    departureDate: '2027-08-20',
    adults: 1,
    cabinClass: 'Economy',
  });

  const checkout = await post('/api/flights/checkout', {
    fareSourceCode: 'EXPLICIT-FARE',
    origin: 'FCO',
    destination: 'JFK',
    departureDate: '2030-01-01',
    adults: 3,
    flight: { fareSourceCode: 'EXPLICIT-FARE', custom: true },
  });
  assert.equal(checkout.status, 200);

  const a = lastCall(stub.calls, 'flight_get_checkout_url').args;
  assert.equal(a.fareSourceCode, 'EXPLICIT-FARE');
  assert.equal(a.origin, 'FCO');
  assert.equal(a.destination, 'JFK');
  assert.equal(a.departureDate, '2030-01-01');
  assert.equal(a.adults, 3);
  assert.equal(a.flight.custom, true);
});

test('car checkout forwards the raw car row cached by the search', async (t) => {
  const stub = makeStub();
  const { post } = await withServer(t, stub);

  const search = await post('/api/cars/search', {
    pickup: { name: 'Malpensa Airport', code: 'MXP', date: '2027-08-20', time: '10:00' },
    dropoff: { name: 'Malpensa Airport', code: 'MXP', date: '2027-08-25', time: '10:00' },
  });
  assert.equal(search.status, 200);
  assert.equal(search.json.data.offers.length, 1);

  const checkout = await post('/api/cars/checkout', { offerId: 'car-offer-1', fareCode: 'CAR-FARE-1' });
  assert.equal(checkout.status, 200);

  const a = lastCall(stub.calls, 'car_get_checkout_url').args;
  assert.ok(a.car, 'the raw car row must be forwarded');
  assert.equal(a.car.offerId, 'car-offer-1');
  assert.equal(a.car.fareCode, 'CAR-FARE-1');
  assert.equal(a.correlationId, 'car-corr-1');
});

test('hotel checkout keeps token + recommendationId + correlationId', async (t) => {
  const stub = makeStub();
  const { post } = await withServer(t, stub);

  const checkout = await post('/api/hotels/checkout', {
    hotelId: 'hotel-1',
    token: 'tok-123',
    correlationId: 'corr-123',
    roomId: 'room-1',
    recommendationId: 'rec-1',
  });
  assert.equal(checkout.status, 200);

  const a = lastCall(stub.calls, 'hotel_get_checkout_url').args;
  assert.equal(a.token, 'tok-123');
  assert.equal(a.recommendationId, 'rec-1');
  assert.equal(a.correlationId, 'corr-123');
  assert.equal(a.roomId, 'room-1');
});
