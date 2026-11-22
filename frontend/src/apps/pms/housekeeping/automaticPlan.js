import { parseIsoDate } from '../../../shared/lib/date.js';
import { dateRangeParams } from '../../../shared/lib/dateRangeQuery.js';

export function automaticPlanDates(start, end) {
  const first = parseIsoDate(start), last = parseIsoDate(end);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
  const length = (last - first) / 86400000 + 1;
  if (length < 1 || length > 31) return [];
  return Array.from({ length }, (_, index) => new Date(first + index * 86400000).toISOString().slice(0, 10));
}

export function automaticPlanShiftPaths(start, end) {
  const days = automaticPlanDates(start, end);
  if (!days.length) return [];
  const path = params => '/housekeeping/shifts?' + dateRangeParams(params);
  if (end === '9999-12-31') return [...(start !== end ? [path({ start, end })] : []), path({ date: end })];
  const exclusiveEnd = new Date(Date.parse(`${end}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return [path({ start, end: exclusiveEnd })];
}

export function automaticDayPlans(dates, staffIds, configurations) {
  return dates.flatMap(date => {
    const configuration = configurations[date] || {};
    const shifts = staffIds.filter(id => configuration.shifts?.[id] && configuration.shifts[id] !== 'auto').map(staffId => ({ staffId, shiftId: configuration.shifts[staffId] === 'none' ? null : configuration.shifts[staffId] }));
    const selectedRooms = Array.isArray(configuration.roomIds);
    return selectedRooms || shifts.length ? [{ date, ...(selectedRooms ? { roomIds: [...configuration.roomIds] } : {}), ...(shifts.length ? { shifts } : {}) }] : [];
  });
}
