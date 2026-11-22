import test from 'node:test';
import assert from 'node:assert/strict';
import { profileName, passwordChangeInput } from './profileForm.js';

test('profile names retain Vietnamese names and trim surrounding whitespace', () => {
  assert.equal(profileName('  Nguyễn Thị Ánh  '), 'Nguyễn Thị Ánh');
  assert.equal(profileName('An'), 'An');
  assert.equal(profileName('x'.repeat(160)).length, 160);
});

test('profile names reject blank or overlong values', () => {
  for (const value of ['', '   ', 'x'.repeat(161)]) {
    assert.throws(() => profileName(value), /1.*160/);
  }
});

test('password changes require the current password and a matching new password', () => {
  const draft = { currentPassword: 'old password', newPassword: '  new password  ', confirm: '  new password  ' };
  assert.deepEqual(passwordChangeInput(draft), { currentPassword: 'old password', newPassword: '  new password  ' });
  assert.throws(() => passwordChangeInput({ ...draft, currentPassword: '' }), /hiện tại/);
  assert.throws(() => passwordChangeInput({ ...draft, confirm: 'different' }), /không khớp/);
});

test('new passwords enforce both length boundaries without trimming', () => {
  for (const length of [11, 129]) {
    assert.throws(() => passwordChangeInput({ currentPassword: 'old', newPassword: 'x'.repeat(length), confirm: 'x'.repeat(length) }), /12.*128/);
  }
  for (const length of [12, 128]) {
    assert.equal(passwordChangeInput({ currentPassword: 'old', newPassword: 'x'.repeat(length), confirm: 'x'.repeat(length) }).newPassword.length, length);
  }
});
