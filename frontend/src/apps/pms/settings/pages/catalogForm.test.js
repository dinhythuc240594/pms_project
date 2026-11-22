import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogNumericInput } from './catalogForm.js';

test('catalog numeric fields preserve exact money and enforce the API capacity and percentage bounds', () => {
  assert.equal(catalogNumericInput('capacity', '50'), 50);
  assert.equal(catalogNumericInput('price', '999999999999999.9999'), '999999999999999.9999');
  assert.equal(catalogNumericInput('commission', '0.0001'), '0.0001');
  assert.equal(catalogNumericInput('tax', '100'), '100');
  for (const value of ['0', '51', '1e1', '1.5', '']) assert.throws(() => catalogNumericInput('capacity', value));
  for (const value of ['101', '-1', '1e1', '1,5', '1.00001']) assert.throws(() => catalogNumericInput('tax', value));
});
