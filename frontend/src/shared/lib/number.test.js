import test from 'node:test';
import assert from 'node:assert/strict';
import { decimalInput } from './number.js';

test('decimal inputs preserve exact strings, leading zeroes and supported precision', () => {
  assert.equal(decimalInput(' 0012.3400 '), '0012.3400');
  assert.equal(decimalInput('999999999999999.9999'), '999999999999999.9999');
  assert.equal(decimalInput('0.00000001', { precision: 8, min: '0.00000001' }), '0.00000001');
  assert.equal(decimalInput('-100', { min: '-100', max: '1000' }), '-100');
  assert.equal(decimalInput('3', { precision: 0, min: '1', max: '10' }), '3');
});

test('decimal inputs reject malformed numbers, excess precision and exact bound violations', () => {
  for (const value of ['', ' ', '1e3', '1,5', '+1', '-1', 'NaN', 'Infinity', '1.00001', '1000000000000000', null, undefined]) assert.throws(() => decimalInput(value), String(value));
  assert.throws(() => decimalInput('0', { min: '0.0001' }));
  assert.throws(() => decimalInput('900719925474099.0002', { max: '900719925474099.0001' }));
  assert.throws(() => decimalInput('-100.0001', { min: '-100' }));
  assert.throws(() => decimalInput('3.0', { precision: 0 }));
  assert.throws(() => decimalInput('0.000000001', { precision: 8 }));
});
