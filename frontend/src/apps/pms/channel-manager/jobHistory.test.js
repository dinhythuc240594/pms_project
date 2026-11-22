import test from 'node:test';
import assert from 'node:assert/strict';
import { channelHistoryPath, channelHistoryReducer, createChannelHistory } from './jobHistory.js';

test('job history sends every filter to the tenant API and encodes exact revision IDs', () => {
  const state = channelHistoryReducer(createChannelHistory(), { type: 'filter', filters: { status: 'failed', kind: 'pull_bookings', revisionId: ' revision/+&=? ', dateFrom: '2026-10-01', dateTo: '2026-10-22', tenantId: 'other-tenant' } });
  const path = new URL(channelHistoryPath(state), 'https://loha.test');
  assert.equal(path.pathname, '/channels/jobs');
  assert.deepEqual(Object.fromEntries(path.searchParams), { pageSize: '25', status: 'failed', kind: 'pull_bookings', revisionId: 'revision/+&=?', start_date: '2026-10-01', end_date: '2026-10-22' });
});

test('previous and next pages retain the server snapshot, including the first page', () => {
  let state = channelHistoryReducer(createChannelHistory(), { type: 'filter', filters: { status: 'succeeded' } });
  state = channelHistoryReducer(state, { type: 'next', index: 0, currentCursor: 'snapshot-1-page-1', nextCursor: 'snapshot-1-page-2' });
  assert.equal(new URL(channelHistoryPath(state), 'https://loha.test').searchParams.get('cursor'), 'snapshot-1-page-2');
  assert.equal(state.filters.status, 'succeeded');
  state = channelHistoryReducer(state, { type: 'next', index: 1, currentCursor: 'snapshot-1-page-2', nextCursor: 'snapshot-1-page-3' });
  state = channelHistoryReducer(state, { type: 'previous' });
  state = channelHistoryReducer(state, { type: 'previous' });
  assert.equal(new URL(channelHistoryPath(state), 'https://loha.test').searchParams.get('cursor'), 'snapshot-1-page-1');
  assert.equal(state.index, 0);
});

test('changing filters and explicit refresh discard old cursors and request a fresh snapshot', () => {
  let state = channelHistoryReducer(createChannelHistory(), { type: 'next', index: 0, currentCursor: 'old-page-1', nextCursor: 'old-page-2' });
  state = channelHistoryReducer(state, { type: 'filter', filters: { revisionId: 'revision-99' } });
  assert.equal(state.index, 0);
  assert.deepEqual(state.cursors, [null]);
  assert.equal(state.revision, 1);
  state = channelHistoryReducer(state, { type: 'next', index: 0, currentCursor: 'new-page-1', nextCursor: 'new-page-2' });
  state = channelHistoryReducer(state, { type: 'refresh' });
  assert.equal(state.index, 0);
  assert.deepEqual(state.cursors, [null]);
  assert.equal(state.filters.revisionId, 'revision-99');
  assert.equal(state.revision, 2);
});

test('cursor navigation ignores duplicate next actions and unavailable pages', () => {
  const initial = createChannelHistory();
  assert.equal(channelHistoryReducer(initial, { type: 'previous' }), initial);
  assert.equal(channelHistoryReducer(initial, { type: 'next', index: 0, currentCursor: 'page-1', nextCursor: null }), initial);
  const next = channelHistoryReducer(initial, { type: 'next', index: 0, currentCursor: 'page-1', nextCursor: 'page-2' });
  assert.equal(channelHistoryReducer(next, { type: 'next', index: 0, currentCursor: 'page-1', nextCursor: 'page-2' }), next);
});
