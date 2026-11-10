import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPhone, phoneInput, phonePattern } from './phone.js';

test('optional phone inputs preserve local and international formatting within 7–15 digits', () => {
  for (const phone of ['', '1234567', '090 123 4567', '+84 (90) 123-4567', '123456789012345']) {
    assert.equal(isValidPhone(phone), true);
    assert.equal(phoneInput(` ${phone} `), phone);
  }
});

test('phone inputs reject misplaced plus, letters, non-ASCII digits and invalid digit counts', () => {
  for (const phone of ['123456', '1234567890123456', '++84901234567', '090+1234567', 'abc0901234567', '(---)', '０９０１２３４５６７', null, 901234567]) {
    assert.equal(isValidPhone(phone), false, String(phone));
    assert.throws(() => phoneInput(phone), /điện thoại/i);
  }
});

test('the HTML phone pattern enforces the same digit count and character rules', () => {
  const expression = new RegExp(`^(?:${phonePattern})$`, 'v');
  for (const value of ['1234567', '+84 (90) 123-4567', '123456789012345']) assert.equal(expression.test(value), true);
  for (const value of ['123456', '1234567890123456', '090+1234567']) assert.equal(expression.test(value), false);
});
