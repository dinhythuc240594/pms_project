import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOTEL_CURRENCIES, HOTEL_CURRENCY_CODES, isHotelCurrency } from './currencies.js';

test('hotel currency choices and backend validation offer the same 20 common Channex currencies', () => {
  const backend = readFileSync(new URL('../../../../backend/pms_api/currencies.py', import.meta.url), 'utf8');
  const catalog = backend.match(/HOTEL_CURRENCIES\s*=\s*\(([\s\S]*?)\)/)?.[1];
  assert.ok(catalog, 'Backend must publish the hotel currency catalog');
  const backendCodes = [...catalog.matchAll(/["']([A-Z]{3})["']/g)].map(match => match[1]);
  assert.deepEqual(HOTEL_CURRENCY_CODES, backendCodes);
  assert.equal(HOTEL_CURRENCY_CODES.length, 20);
  assert.equal(new Set(HOTEL_CURRENCY_CODES).size, 20);
  assert.equal(HOTEL_CURRENCY_CODES[0], 'VND');
  assert.ok(HOTEL_CURRENCIES.every(({ code, label }) => isHotelCurrency(code) && label.startsWith(code)));
});

test('currency validation rejects malformed or unsupported codes while retaining exact casing', () => {
  for (const value of ['XXX', 'US1', '', 'eur', ' EUR ', null, undefined, [], {}, 123]) {
    assert.equal(isHotelCurrency(value), false, String(value));
  }
  for (const value of ['EUR', 'JPY', 'THB', 'KRW', 'SGD', 'AED']) assert.equal(isHotelCurrency(value), true);
});
