import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateRangeError, selectedRateRanges } from './rateRange.js';

test('rate ranges validate real dates and exclusive end without silent truncation', () => {
  assert.equal(rateRangeError({ start: '2026-10-01', end: '2026-11-01' }, 31), '');
  assert.equal(rateRangeError({ start: '2024-02-29', end: '2024-03-01' }), '');
  for (const range of [{ start: '', end: '2026-10-02' }, { start: '2026-02-30', end: '2026-03-03' }, { start: '2026-10-02', end: '2026-10-02' }, { start: '2026-10-03', end: '2026-10-02' }, { start: '2026-10-01', end: '2026-11-02' }]) assert.ok(rateRangeError(range, 31));
});

test('selected rate ranges group adjacent dates per room with an exclusive end', () => {
  const types = [{ id: 'standard' }, { id: 'deluxe' }];
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
  const selected = new Set(['standard:2026-10-01', 'standard:2026-10-02', 'standard:2026-10-04', 'deluxe:2026-10-02', 'deluxe:2026-10-03']);
  assert.deepEqual(selectedRateRanges(types, days, selected), [
    { roomTypeId: 'standard', start: '2026-10-01', end: '2026-10-03' },
    { roomTypeId: 'standard', start: '2026-10-04', end: '2026-10-05' },
    { roomTypeId: 'deluxe', start: '2026-10-02', end: '2026-10-04' },
  ]);
});

test('selected rate ranges never fill calendar gaps or include hidden cells', () => {
  const types = [{ id: 'standard' }];
  const days = ['2024-02-28', '2024-02-29', '2024-03-02'];
  const selected = new Set(['standard:2024-02-28', 'standard:2024-02-29', 'standard:2024-03-02', 'standard:2024-03-01', 'deluxe:2024-02-28']);
  assert.deepEqual(selectedRateRanges(types, days, selected), [
    { roomTypeId: 'standard', start: '2024-02-28', end: '2024-03-01' },
    { roomTypeId: 'standard', start: '2024-03-02', end: '2024-03-03' },
  ]);
  assert.deepEqual(selectedRateRanges(types, days, new Set()), []);
  assert.deepEqual(selectedRateRanges([], days, selected), []);
  assert.deepEqual(selectedRateRanges(types, [], selected), []);
});
