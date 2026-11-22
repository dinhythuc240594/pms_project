import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftCreationDates } from './shiftSchedule.js';

test('one-day and seven-day shifts use consecutive business dates across boundaries', () => {
  assert.deepEqual(shiftCreationDates('2026-10-17'), ['2026-10-17']);
  assert.deepEqual(shiftCreationDates('2026-12-29', 'week'), ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04']);
  assert.equal(shiftCreationDates('2028-02-27', 'week').at(-1), '2028-03-04');
});

test('calendar-month shifts clamp the next-month anniversary and exclude that boundary', () => {
  for (const [start, count, last] of [['2026-10-17', 31, '2026-11-16'], ['2026-01-31', 28, '2026-02-27'], ['2028-02-01', 29, '2028-02-29'], ['2026-12-17', 31, '2027-01-16'], ['9999-12-01', 31, '9999-12-31']]) {
    const days = shiftCreationDates(start, 'month');
    assert.equal(days[0], start);
    assert.equal(days.length, count);
    assert.equal(days.at(-1), last);
  }
});

test('shift previews reject malformed dates, unsupported periods and overflow before submission', () => {
  for (const [date, period] of [['', 'day'], ['2026-02-29', 'week'], ['0000-01-01', 'day'], ['2026-1-01', 'day'], ['2026-10-17', 'year'], ['2026-10-17', null], ['9999-12-26', 'week'], ['9999-12-02', 'month']]) {
    assert.deepEqual(shiftCreationDates(date, period), []);
  }
  assert.deepEqual(shiftCreationDates('9999-12-31', 'day'), ['9999-12-31']);
});
