import test from 'node:test';
import assert from 'node:assert/strict';
import { emailInput, emailPattern, taxIdInput, taxIdPattern } from './validation.js';

test('email inputs normalize case and preserve plus addressing and internal single-label domains', () => {
  assert.equal(emailInput(' Owner+FrontDesk@Example.COM '), 'owner+frontdesk@example.com');
  assert.equal(emailInput('owner@local'), 'owner@local');
  assert.equal(emailInput("a!#$%&'*+/=?^_`{|}~@example.com"), "a!#$%&'*+/=?^_`{|}~@example.com");
});

test('email validation rejects malformed local parts, hostnames and controls before an API write', () => {
  const invalid = ['', 'owner', 'owner@@example.com', '.owner@example.com', 'owner.@example.com', 'ow..ner@example.com', 'owner@example..com', 'owner@-example.com', 'owner@example-.com', 'owner@exa_mple.com', 'a'.repeat(65) + '@example.com', 'owner@' + 'a'.repeat(64) + '.com', 'owner\u0000@example.com', 'owner@examp\u007fle.com', null, 123];
  const expression = new RegExp(`^(?:${emailPattern})$`, 'v');
  for (const value of invalid) {
    assert.throws(() => emailInput(value), /email/i, String(value));
    if (typeof value === 'string') assert.equal(expression.test(value), false, value);
  }
  const maximum = 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(61);
  assert.equal(emailInput(maximum).length, 254);
  assert.throws(() => emailInput(maximum + 'd'), /email/i);
  assert.equal(expression.test('Owner+Desk@Example.COM'), true);
});

test('tax ID inputs accept existing numeric identifiers and optional three-digit branches', () => {
  for (const value of ['', '01012345', '0101234567', '0101234567001', '0101234567-001', '1'.repeat(40)]) assert.equal(taxIdInput(` ${value} `), value);
  for (const value of ['ABC123', '01 012345', '0101234567-01', '0101234567-0001', '+0101234567', '1'.repeat(41), null]) assert.throws(() => taxIdInput(value), /thuế/i);
  const expression = new RegExp(`^(?:${taxIdPattern})$`, 'v');
  assert.equal(expression.test('0101234567-001'), true);
  assert.equal(expression.test('0101234567-01'), false);
});
