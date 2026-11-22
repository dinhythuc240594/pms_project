import test from 'node:test';
import assert from 'node:assert/strict';
import { quantityText } from './values.js';

test('inventory decimals preserve exact server precision without floating conversion', () => {
  assert.equal(quantityText('9007199254740993.12340000'), '9007199254740993.1234');
  assert.equal(quantityText('0.00000001'), '0.00000001');
  assert.equal(quantityText('-1234567890123456.00010000'), '-1234567890123456.0001');
  assert.equal(quantityText('1000.00000000'), '1000');
  assert.equal(quantityText('1000'), '1000');
  assert.equal(quantityText(null), '0');
});
