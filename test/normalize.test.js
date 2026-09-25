import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkoutModeOf,
  findUrl,
  normalizeCarSearch,
  normalizeDestinations,
  normalizeFlightSearch,
  normalizeHotelRooms,
  normalizeHotelSearch,
  normalizeLocations,
} from '../server/routestack/verticals.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

test('normalizeDestinations maps real destination rows', () => {
  const out = normalizeDestinations(fixture('destinations.json'));
  assert.ok(out.destinations.length >= 1);
  const rome = out.destinations.find((d) => d.name === 'Rome, Italy');
  assert.equal(rome.destinationId, 'ChIJw0rXGxGKJRMRAIE4sppPCQM');
  assert.equal(rome.type, 'City');
});

test('normalizeLocations handles flight location rows', () => {
  const out = normalizeLocations(fixture('flight-locations.json'));
  assert.equal(out.locations[0].code, 'MXP');
  assert.equal(out.locations[0].city, 'Milan');
});

test('normalizeLocations handles car location rows', () => {
  const out = normalizeLocations(fixture('car-locations.json'));
  assert.equal(out.locations[0].code, 'MXP');
  assert.equal(out.locations[0].name, 'Malpensa Airport');
});

test('normalizeHotelSearch reads a real production payload', () => {
  const out = normalizeHotelSearch(fixture('hotel-search.json'));
  assert.equal(out.count, 141);
  assert.equal(out.hotels.length, 5);
  assert.ok(out.correlationId);
  assert.ok(out.token);
  assert.ok(out.nextResultsKey);
  assert.equal(out.status, 'InProgress');
  const cheapest = [...out.hotels].sort((a, b) => a.ourprice - b.ourprice)[0];
  assert.ok(cheapest.ourprice > 0);
  assert.equal(cheapest.currency, 'EUR');
});

test('normalizeHotelRooms flattens real groups[].rooms[]', () => {
  const out = normalizeHotelRooms(fixture('hotel-rooms.json'));
  assert.ok(out.offers.length >= 1);
  assert.ok(out.groups.length >= 1);
  assert.ok(out.offers[0].roomId);
  assert.ok(out.offers[0].recommendationId);
  assert.ok(out.offers[0].board); // boardBasis.displayText
});

test('normalizeFlightSearch maps a real production payload', () => {
  const out = normalizeFlightSearch(fixture('flight-search.json'));
  assert.equal(out.count, 420);
  assert.equal(out.offers.length, 3);
  assert.equal(out.currency, 'USD');
  assert.ok(out.correlationId);
  const first = out.offers[0];
  assert.equal(first.airline, 'Oman Air');
  assert.equal(first.origin, 'MXP');
  assert.equal(first.destination, 'BKK');
  assert.equal(first.ourprice, 489.34);
  assert.equal(first.stops, 2);
  assert.equal(first.segments.length, 3);
  assert.equal(first.refundable, true);
  assert.ok(first.duration);
  // searchFilterObj is stored as a JSON string for round-tripping
  assert.equal(typeof out.searchFilterObj, 'string');
  assert.equal(JSON.parse(out.searchFilterObj).adult, 1);
});

test('normalizeCarSearch maps prepaid fare codes', () => {
  const payload = {
    success: true,
    result: {
      count: 1,
      status: 'Complete',
      correlationId: 'cc-1',
      offers: [
        {
          offerId: 'o1',
          carType: 'Compact',
          model: 'Fiat 500',
          supplier: 'Hertz',
          seats: 5,
          transmission: 'Manual',
          fuel: 'Petrol',
          mileage: 'Unlimited',
          freeCancellation: true,
          price_prepaid: { fareCode: 'PRE-1', amount: 88.4, currency: 'EUR' },
        },
      ],
    },
  };
  const out = normalizeCarSearch(payload);
  assert.equal(out.count, 1);
  assert.equal(out.offers[0].fareCode, 'PRE-1');
  assert.equal(out.offers[0].prepaid, true);
  assert.equal(out.offers[0].price, 88.4);
  assert.equal(out.offers[0].supplier, 'Hertz');
});

test('findUrl + checkoutModeOf read the real checkout payload', () => {
  const payload = fixture('hotel-checkout.json');
  const url = findUrl(payload);
  assert.equal(url, 'https://mcp.routestack.ai/checkout/r/o9x8l2M6LIyi6-NPfvCEbw');
  assert.equal(checkoutModeOf(payload, url), 'deeplink');
});
