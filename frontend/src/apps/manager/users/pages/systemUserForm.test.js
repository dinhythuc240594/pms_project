import test from 'node:test';
import assert from 'node:assert/strict';
import { systemUserInput } from './systemUserForm.js';

const draft = { name: '  Nguyễn An  ', email: ' an@example.com ', password: 'initial-password', globalRole: 'SYSTEM_MANAGER', active: true };

test('creating a system account sends only persisted fields and initial credentials', () => {
  assert.deepEqual(systemUserInput({ ...draft, department: 'Operations', twoFactor: true, permissions: ['*'] }), {
    name: 'Nguyễn An', email: 'an@example.com', password: 'initial-password', globalRole: 'SYSTEM_MANAGER', active: true,
  });
});

test('editing an account excludes immutable email and password', () => {
  assert.deepEqual(systemUserInput({ ...draft, active: false }, 'account-id'), {
    id: 'account-id', name: 'Nguyễn An', globalRole: 'SYSTEM_MANAGER', active: false,
  });
});

test('account input rejects unsupported display roles and invalid account status', () => {
  assert.throws(() => systemUserInput({ ...draft, globalRole: 'Customer Support Lead' }), /vai trò/i);
  assert.throws(() => systemUserInput({ ...draft, active: 'false' }), /trạng thái/i);
});

test('account input requires a nonblank name and valid email for creation', () => {
  assert.throws(() => systemUserInput({ ...draft, name: '   ' }), /họ và tên/i);
  assert.throws(() => systemUserInput({ ...draft, name: 'x'.repeat(161) }), /160/);
  assert.throws(() => systemUserInput({ ...draft, email: 'invalid' }), /email/i);
  assert.throws(() => systemUserInput({ ...draft, email: `${'x'.repeat(250)}@local` }), /email/i);
  assert.equal(systemUserInput({ ...draft, email: 'an@local' }).email, 'an@local');
  assert.doesNotThrow(() => systemUserInput({ ...draft, email: '' }, 'account-id'));
});

test('initial passwords must contain 12 to 128 characters without changing their value', () => {
  assert.throws(() => systemUserInput({ ...draft, password: 'short' }), /12.*128/);
  assert.throws(() => systemUserInput({ ...draft, password: 'x'.repeat(129) }), /12.*128/);
  assert.equal(systemUserInput({ ...draft, password: '  password  ' }).password, '  password  ');
});

test('system account creation rejects malformed email labels and normalizes login email consistently', () => {
  for (const email of ['a..b@example.com', '.a@example.com', 'a.@example.com', 'a@-example.com', 'a@example_.com', 'a\u0000@example.com']) {
    assert.throws(() => systemUserInput({ ...draft, email }), /email/i);
  }
  assert.equal(systemUserInput({ ...draft, email: ' AN+Admin@Example.COM ' }).email, 'an+admin@example.com');
});
