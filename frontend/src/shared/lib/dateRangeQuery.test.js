import test from 'node:test';
import assert from 'node:assert/strict';
import { dateRangeParams } from './dateRangeQuery.js';

test('date range queries send canonical keys without changing dates or filter state', () => {
  const filters = Object.freeze({ start: '2028-02-29', end: '2028-03-01', currency: 'USD', page: 2, active: false, cursor: 'cursor/+&=?' });
  const params = dateRangeParams(filters);
  assert.ok(params instanceof URLSearchParams);
  assert.deepEqual(Object.fromEntries(params), { start_date: '2028-02-29', end_date: '2028-03-01', currency: 'USD', page: '2', active: 'false', cursor: 'cursor/+&=?' });
  assert.equal(new URLSearchParams(params.toString()).get('cursor'), filters.cursor);
  assert.deepEqual(dateRangeParams({ start: '9999-12-31', end: '9999-12-31' }).getAll('end_date'), ['9999-12-31']);
});

test('empty values are omitted while canonical dates and zero values remain intact', () => {
  assert.equal(dateRangeParams().toString(), '');
  assert.equal(dateRangeParams(null).toString(), '');
  assert.deepEqual(Object.fromEntries(dateRangeParams({ start: '', end: null, absent: undefined, empty: '', start_date: '2026-11-01', page: 0 })), { start_date: '2026-11-01', page: '0' });
});

test('camel-case and history aliases are mapped only when explicitly selected', () => {
  assert.deepEqual(Object.fromEntries(dateRangeParams({ startDate: '2026-11-01', endDate: '2026-11-02', fundId: 'cash' }, { startKey: 'startDate', endKey: 'endDate' })), { start_date: '2026-11-01', end_date: '2026-11-02', fundId: 'cash' });
  assert.deepEqual(Object.fromEntries(dateRangeParams({ dateFrom: '2026-11-01', dateTo: '2026-11-02', revisionId: 'revision-1' }, { startKey: 'dateFrom', endKey: 'dateTo' })), { start_date: '2026-11-01', end_date: '2026-11-02', revisionId: 'revision-1' });
  assert.deepEqual(Object.fromEntries(dateRangeParams({ startDate: '2026-11-01', dateTo: '2026-11-02' })), { startDate: '2026-11-01', dateTo: '2026-11-02' });
});

test('matching aliases are collapsed and conflicting aliases fail in either key order', () => {
  for (const filters of [{ start: '2026-11-01', start_date: '2026-11-01', end: '2026-11-02', end_date: '2026-11-02' }, { start_date: '2026-11-01', start: '2026-11-01', end_date: '2026-11-02', end: '2026-11-02' }]) {
    assert.deepEqual(Object.fromEntries(dateRangeParams(filters)), { start_date: '2026-11-01', end_date: '2026-11-02' });
  }
  for (const filters of [{ start: '2026-11-01', start_date: '2026-11-02' }, { start_date: '2026-11-01', start: '2026-11-02' }, { end: '2026-11-01', end_date: '2026-11-02' }, { end_date: '2026-11-01', end: '2026-11-02' }]) {
    assert.throws(() => dateRangeParams(filters), /không khớp/);
  }
  assert.throws(() => dateRangeParams({ dateFrom: '2026-11-01', start_date: '2026-11-02' }, { startKey: 'dateFrom', endKey: 'dateTo' }), /không khớp/);
});
