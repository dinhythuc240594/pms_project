import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticDayPlans, automaticPlanDates, automaticPlanShiftPaths } from './automaticPlan.js';

test('automatic plans include both endpoints across leap days and year boundaries', () => {
  assert.deepEqual(automaticPlanDates('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.deepEqual(automaticPlanDates('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
  assert.deepEqual(automaticPlanDates('9999-12-31', '9999-12-31'), ['9999-12-31']);
});

test('automatic plans reject invalid dates, reverse ranges and more than 31 inclusive days', () => {
  for (const [start, end] of [['', '2026-10-17'], ['2026-02-29', '2026-03-01'], ['2026-10-18', '2026-10-17'], ['2026-10-01', '2026-11-01'], ['2026-1-01', '2026-01-02']]) {
    assert.deepEqual(automaticPlanDates(start, end), []);
  }
  assert.equal(automaticPlanDates('2026-10-01', '2026-10-31').length, 31);
});

test('shift reads cover the full inclusive selection with a single bounded request', () => {
  assert.deepEqual(automaticPlanShiftPaths('2026-10-01', '2026-10-31'), ['/housekeeping/shifts?start_date=2026-10-01&end_date=2026-11-01']);
  assert.deepEqual(automaticPlanShiftPaths('2026-12-31', '2027-01-01'), ['/housekeeping/shifts?start_date=2026-12-31&end_date=2027-01-02']);
  assert.deepEqual(automaticPlanShiftPaths('2026-10-01', '2026-11-01'), []);
  assert.deepEqual(automaticPlanShiftPaths('9999-12-31', '9999-12-31'), ['/housekeeping/shifts?date=9999-12-31']);
  assert.deepEqual(automaticPlanShiftPaths('9999-12-30', '9999-12-31'), ['/housekeeping/shifts?start_date=9999-12-30&end_date=9999-12-31', '/housekeeping/shifts?date=9999-12-31']);
});

test('daily payload keeps explicit no-shift and room choices, excluding deselected dates and staff', () => {
  const configurations = {
    '2026-10-17': { roomIds: ['room-a'], shifts: { a: 'late', b: 'none', removed: 'other' } },
    '2026-10-18': { roomIds: ['room-b'], shifts: { a: 'old-day' } },
    '2026-10-19': { roomIds: null, shifts: { a: 'auto', b: 'none' } },
  };
  const payload = automaticDayPlans(['2026-10-17', '2026-10-19'], ['a', 'b'], configurations);
  assert.deepEqual(payload, [
    { date: '2026-10-17', roomIds: ['room-a'], shifts: [{ staffId: 'a', shiftId: 'late' }, { staffId: 'b', shiftId: null }] },
    { date: '2026-10-19', shifts: [{ staffId: 'b', shiftId: null }] },
  ]);
  payload[0].roomIds.push('room-c');
  assert.deepEqual(configurations['2026-10-17'].roomIds, ['room-a']);
});

test('daily payload preserves an empty explicit room choice for validation and omits automatic defaults', () => {
  assert.deepEqual(automaticDayPlans(['2026-10-17'], ['a'], {}), []);
  assert.deepEqual(automaticDayPlans(['2026-10-17'], ['a'], { '2026-10-17': { roomIds: [], shifts: { a: 'auto' } } }), [{ date: '2026-10-17', roomIds: [] }]);
});
