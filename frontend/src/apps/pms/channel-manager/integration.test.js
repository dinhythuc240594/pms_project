import test from 'node:test';
import assert from 'node:assert/strict';
import { channelCompletionAccess, integrationState, integrationTab, syncRangeError } from './integration.js';

test('operational expiry grants only expose recovery controls after role and feature checks', () => {
  const pms = { subscription: { operationalAccess: { active: true, until: new Date(Date.now() + 60_000).toISOString() } } };
  assert.equal(channelCompletionAccess(pms, { allowed: false, reason: 'expired' }), true);
  for (const reason of ['role', 'feature', 'suspended', 'session']) {
    assert.equal(channelCompletionAccess(pms, { allowed: false, reason }), false);
  }
  assert.equal(channelCompletionAccess({}, { allowed: false, reason: 'expired' }), false);
  assert.equal(channelCompletionAccess({ subscription: { operationalAccess: { active: true, until: '2000-01-01' } } }, { allowed: false, reason: 'expired' }), false);
});

test('integration readiness requires verified credentials and mappings to current active PMS rooms', () => {
  const connection = { credentialsConfigured: true, verifiedAt: '2026-10-15T00:00:00Z', active: true, inventoryReconciledAt: '2026-10-15T00:05:00Z' };
  const roomTypes = [{ id: 'standard' }, { id: 'suite' }];
  const mappings = [
    { roomTypeId: 'standard', active: true },
    { roomTypeId: 'suite', active: true, pauseRequested: true },
    { roomTypeId: 'archived', active: true },
  ];
  const snapshot = { connection, roomTypes, mappings };
  assert.equal(integrationState(snapshot).mapped, 1);
  assert.equal(integrationState(snapshot).total, 2);
  assert.equal(integrationState(snapshot).ready, true);
  for (const change of [{ active: false }, { credentialsConfigured: false }, { verifiedAt: null }, { inventoryReconciledAt: null }]) {
    assert.equal(integrationState({ ...snapshot, connection: { ...connection, ...change } }).ready, false);
    assert.equal(integrationState({ ...snapshot, connection: { ...connection, ...change } }).next, 'connection');
  }
  assert.equal(integrationState({ ...snapshot, roomTypes: [] }).ready, false);
  assert.equal(integrationState().next, 'connection');
});

test('webhook setup is not presented as a successful data sync and unknown tabs keep users in the hub', () => {
  const jobs = [{ kind: 'setup_webhook', status: 'succeeded' }, { kind: 'push_ari', status: 'queued' }, { kind: 'pull_bookings', status: 'failed' }];
  const state = integrationState({ jobs });
  assert.equal(state.latest.kind, 'push_ari');
  assert.equal(state.pending.length, 1);
  assert.equal(state.failed.length, 1);
  assert.equal(integrationTab('channels'), 'channels');
  assert.equal(integrationTab('connection'), 'connection');
  assert.equal(integrationTab('history'), 'history');
  assert.equal(integrationTab('unknown'), 'overview');
});

test('durable booking review count remains visible beyond the latest job window and separate from retries', () => {
  const state = integrationState({ bookingReviewCount: 72, jobs: [
    { kind: 'pull_bookings', status: 'needs_review' },
    { kind: 'ack_revision', status: 'queued' },
    { kind: 'push_ari', status: 'succeeded' },
  ] });
  assert.equal(state.bookingReviewCount, 72);
  assert.equal(state.pending.length, 1);
  assert.equal(state.failed.length, 0);
  assert.equal(integrationState().bookingReviewCount, 0);
});

test('sync range uses exclusive end, real dates and a maximum of 31 days', () => {
  assert.equal(syncRangeError('2026-12-15', '2027-01-15'), '');
  assert.equal(syncRangeError('2028-02-28', '2028-03-01'), '');
  for (const range of [['2026-01-01', '2026-01-01'], ['2026-01-02', '2026-01-01'], ['2026-02-29', '2026-03-01'], ['2026-01-01', '2026-02-02'], ['', '2026-01-01']]) {
    assert.ok(syncRangeError(...range));
  }
});
