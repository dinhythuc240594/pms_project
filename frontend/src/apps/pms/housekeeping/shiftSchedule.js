import { parseIsoDate } from '../../../shared/lib/date.js';

export function shiftCreationDates(value, period = 'day') {
  if (!['day', 'week', 'month'].includes(period)) return [];
  const first = new Date(parseIsoDate(value));
  if (!Number.isFinite(first.getTime()) || first.getUTCFullYear() < 1) return [];
  let count = period === 'day' ? 1 : 7;
  if (period === 'month') {
    const lastCurrent = new Date(first), lastNext = new Date(first);
    lastCurrent.setUTCMonth(first.getUTCMonth() + 1, 0);
    lastNext.setUTCMonth(first.getUTCMonth() + 2, 0);
    count = lastCurrent.getUTCDate() - first.getUTCDate() + Math.min(first.getUTCDate(), lastNext.getUTCDate());
  }
  const last = new Date(first.getTime() + (count - 1) * 86400000);
  if (last.getUTCFullYear() > 9999) return [];
  return Array.from({ length: count }, (_, index) => new Date(first.getTime() + index * 86400000).toISOString().slice(0, 10));
}
