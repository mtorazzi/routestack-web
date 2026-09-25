/**
 * Unit tests for the local, no-network result sorting.
 *
 * Sorting must be purely client-side: the three `/search` calls are billable,
 * so changing the results-header order must never touch the network. These
 * tests pin the comparator contract per vertical and key: ascending for
 * price/duration/departure (and supplier), descending for stars/rating/savings,
 * missing/unparseable values last, stable ties, input never mutated.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDuration, sortKeys, sortOffers } from '../public/components/sort.js';

const ids = (rows) => rows.map((r) => r.id);

test('flights/price sorts cheapest first', () => {
  const rows = [
    { id: 'c', ourprice: 300 },
    { id: 'a', ourprice: 100 },
    { id: 'b', ourprice: 200 },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'price', 'flights')), ['a', 'b', 'c']);
});

test('flights/duration sorts shortest first and parses string durations', () => {
  const rows = [
    { id: 'long', duration: '13h 20m' },
    { id: 'short', duration: '2h 5m' },
    { id: 'mid', duration: 500 },
    { id: 'iso', duration: 'PT5H30M' },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'duration', 'flights')), ['short', 'iso', 'mid', 'long']);
});

test('flights/departure sorts earliest first', () => {
  const rows = [
    { id: 'late', departureTime: '2027-08-20T18:30:00' },
    { id: 'early', departureTime: '2027-08-20T06:10:00' },
    { id: 'mid', departureTime: '2027-08-20T11:00:00' },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'departure', 'flights')), ['early', 'mid', 'late']);
});

test('hotels/price sorts cheapest first', () => {
  const rows = [
    { id: 'c', ourprice: 300 },
    { id: 'a', price: 100 },
    { id: 'b', ourprice: 200 },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'price', 'hotels')), ['a', 'b', 'c']);
});

test('hotels/stars sorts best first (descending)', () => {
  const rows = [
    { id: 'three', stars: 3 },
    { id: 'five', stars: 5 },
    { id: 'four', stars: 4 },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'stars', 'hotels')), ['five', 'four', 'three']);
});

test('hotels/savings sorts biggest discount first (descending)', () => {
  const rows = [
    { id: 'ten', savingsPercent: 10 },
    { id: 'forty', savingsPercent: 40 },
    { id: 'twentyfive', savingsPercent: 25 },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'savings', 'hotels')), ['forty', 'twentyfive', 'ten']);
});

test('hotels/rating sorts best score first (descending)', () => {
  const rows = [
    { id: 'seven', rating: 7.2 },
    { id: 'nine', rating: 9.1 },
    { id: 'eight', rating: 8.4 },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'rating', 'hotels')), ['nine', 'eight', 'seven']);
});

test('cars/price uses ourprice, price or amount fallbacks', () => {
  const rows = [
    { id: 'c', price: 300 },
    { id: 'a', ourprice: 100 },
    { id: 'b', price: 200 },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'price', 'cars')), ['a', 'b', 'c']);
});

test('cars/supplier sorts alphabetically (existing header option)', () => {
  const rows = [
    { id: 'z', supplier: 'Hertz' },
    { id: 'a', supplier: 'Avis' },
    { id: 'm', supplier: 'Green Motion' },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'supplier', 'cars')), ['a', 'm', 'z']);
});

test('missing and unparseable values sort last, in both directions', () => {
  const cheapest = [
    { id: 'none', ourprice: null },
    { id: 'cheap', ourprice: 100 },
    { id: 'bad', ourprice: 'not-a-number' },
    { id: 'pricey', ourprice: 300 },
  ];
  assert.deepEqual(ids(sortOffers(cheapest, 'price', 'flights')), ['cheap', 'pricey', 'none', 'bad']);

  const stars = [
    { id: 'none', stars: undefined },
    { id: 'five', stars: 5 },
    { id: 'bad', stars: 'x' },
    { id: 'three', stars: 3 },
  ];
  assert.deepEqual(ids(sortOffers(stars, 'stars', 'hotels')), ['five', 'three', 'none', 'bad']);
});

test('durations and dates that cannot be parsed never throw and sort last', () => {
  const rows = [
    { id: 'bad-duration', duration: 'quanto basta' },
    { id: 'ok-duration', duration: '1h' },
    { id: 'missing', duration: null },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'duration', 'flights')), ['ok-duration', 'bad-duration', 'missing']);

  const dated = [
    { id: 'bad', departureTime: 'domani' },
    { id: 'ok', departureTime: '2027-01-01T00:00:00' },
    { id: 'missing' },
  ];
  assert.deepEqual(ids(sortOffers(dated, 'departure', 'flights')), ['ok', 'bad', 'missing']);
});

test('ties keep the original relative order (stable)', () => {
  const rows = [
    { id: 'first', ourprice: 100 },
    { id: 'second', ourprice: 100 },
    { id: 'third', ourprice: 100 },
  ];
  assert.deepEqual(ids(sortOffers(rows, 'price', 'flights')), ['first', 'second', 'third']);
});

test('empty/unknown sortBy and unknown vertical keep the original order', () => {
  const rows = [
    { id: 'a', ourprice: 300 },
    { id: 'b', ourprice: 100 },
  ];
  assert.deepEqual(ids(sortOffers(rows, '', 'flights')), ['a', 'b']);
  assert.deepEqual(ids(sortOffers(rows, undefined, 'flights')), ['a', 'b']);
  assert.deepEqual(ids(sortOffers(rows, 'nope', 'flights')), ['a', 'b']);
  assert.deepEqual(ids(sortOffers(rows, 'price', 'trains')), ['a', 'b']);
});

test('the input array and its rows are never mutated', () => {
  const rows = [
    { id: 'c', ourprice: 300, nested: { v: 1 } },
    { id: 'a', ourprice: 100, nested: { v: 2 } },
  ];
  const before = structuredClone(rows);
  const sorted = sortOffers(rows, 'price', 'flights');
  assert.notEqual(sorted, rows, 'a new array is returned');
  assert.deepEqual(rows, before, 'the input order and rows are untouched');
  assert.deepEqual(ids(sorted), ['a', 'c']);
});

test('non-array input returns an empty array and never throws', () => {
  assert.deepEqual(sortOffers(null, 'price', 'flights'), []);
  assert.deepEqual(sortOffers(undefined, 'price', 'hotels'), []);
  assert.deepEqual(sortOffers({}, 'price', 'cars'), []);
});

test('null/undefined rows never throw and sort last', () => {
  const rows = [{ id: 'b', ourprice: 200 }, null, { id: 'a', ourprice: 100 }, undefined];
  const sorted = sortOffers(rows, 'price', 'flights');
  assert.deepEqual(sorted.filter(Boolean).map((r) => r.id), ['a', 'b']);
  assert.equal(sorted[2], null);
  assert.equal(sorted[3], undefined);
  assert.equal(sorted.length, rows.length, 'no rows are dropped');
});

test('parseDuration handles the shapes the normaliser can emit', () => {
  assert.equal(parseDuration(125), 125);
  assert.equal(parseDuration('125'), 125);
  assert.equal(parseDuration('13h 20m'), 800);
  assert.equal(parseDuration('13h20m'), 800);
  assert.equal(parseDuration('45m'), 45);
  assert.equal(parseDuration('PT13H20M'), 800);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration(null), null);
  assert.equal(parseDuration('nope'), null);
});

test('sortKeys exposes the supported keys per vertical', () => {
  assert.deepEqual(sortKeys('flights').sort(), ['departure', 'duration', 'price']);
  assert.deepEqual(sortKeys('hotels').sort(), ['price', 'rating', 'savings', 'stars']);
  assert.deepEqual(sortKeys('cars').sort(), ['price', 'supplier']);
});
