import { addDays } from '../data/model';
import { tr } from '../../../shared/i18n/store.js';
export { shortDate } from '../../../shared/i18n/formatters.js';

export const taskKinds = { arrival: 'Khách đến', departure: 'Khách rời', stayover: 'Khách lưu trú', dirty: 'Phòng bẩn', checkout: 'Sau trả phòng' };
export const taskStatuses = { pending: 'Chờ dọn', in_progress: 'Đang dọn', inspection: 'Chờ kiểm tra', completed: 'Hoàn tất', cancelled: 'Đã hủy' };
export const isClosed = task => ['completed', 'cancelled'].includes(task.status);
export const taskKind = task => tr(task.source === 'manual' ? 'Dọn phòng thủ công' : taskKinds[task.kind] || 'Dọn phòng');

export function calendarWeek(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const start = addDays(date, -((weekday + 6) % 7));
  return { start, end: addDays(start, 7), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
}
