import test from 'node:test';
import assert from 'node:assert/strict';
import { featureOverridePayload, overrideExpiry, displayDate } from './featureOverride.js';

test('a 30-day trial sends a server-compatible expiry instead of a local trialDays value', () => {
  const now = Date.parse('2026-10-09T04:00:00.000Z');
  assert.deepEqual(featureOverridePayload({ overrideType: 'TRIAL', notes: ' Try POS ' }, now), {
    enabled: true, isTrial: true, expiresAt: '2026-11-08T04:00:00.000Z', notes: 'Try POS',
  });
  assert.deepEqual(featureOverridePayload({ overrideType: 'FORCE_DISABLE', notes: '' }, now), {
    enabled: false, isTrial: false, expiresAt: null, notes: '',
  });
  assert.deepEqual(featureOverridePayload({ overrideType: 'FORCE_ENABLE', notes: '' }, now), {
    enabled: true, isTrial: false, expiresAt: null, notes: '',
  });
});

test('remaining days use real expiry, show expired trials, and never invent dates', () => {
  const now = Date.parse('2026-10-09T04:00:00.000Z');
  assert.deepEqual(overrideExpiry('2026-10-10T03:00:00.000Z', now), { daysRemaining: 1, expired: false });
  assert.deepEqual(overrideExpiry('2026-10-09T04:00:00.000Z', now), { daysRemaining: 0, expired: true });
  assert.deepEqual(overrideExpiry('not-a-date', now), { daysRemaining: null, expired: false });
  assert.deepEqual(overrideExpiry(null, now), { daysRemaining: null, expired: false });
  assert.equal(displayDate(null), '—');
  assert.equal(displayDate('not-a-date'), '—');
  assert.equal(displayDate('2026-10-09T04:00:00.000Z'), '09/10/2026');
});
