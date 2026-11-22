import { money, today } from '../../pms/data/model.js';
import { parseIsoDate } from '../../../shared/lib/date.js';

export function defaultChannexAccount(accounts) {
  const configured = accounts.filter(account => account.configured);
  return (configured.find(account => account.id === 'system:staging')
    || configured.find(account => account.environment === 'staging') || configured[0])?.id || '';
}

export function channexMoney(amount, currency) {
  if (amount == null || amount === '' || !currency) return '—';
  return /^-?\d+\.\d{5,}$/.test(String(amount)) ? `${amount} ${currency}` : money(amount, currency);
}
export const inventoryValue = value => value == null ? '—' : value;
export const environmentLabel = environment => environment === 'production' ? 'Production' : 'Staging';
export const dateLabel = value => value ? value.slice(0, 10).split('-').reverse().join('/') : '—';

export function inventoryDateError(start, end) {
  const from = parseIsoDate(start), to = parseIsoDate(end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return 'Chọn đủ ngày bắt đầu và ngày kết thúc hợp lệ.';
  }
  if (to < from) return 'Ngày kết thúc phải từ ngày bắt đầu trở đi.';
  if ((to - from) / 86400000 >= 31) return 'Chỉ xem tối đa 31 ngày, bao gồm ngày kết thúc.';
  return '';
}
export function channexToday(timezone) {
  try { return today(timezone || 'Asia/Ho_Chi_Minh'); }
  catch { return today(); }
}

export function channexCatalogInput(kind, draft, editing) {
  const name = draft.name.trim();
  if (!name || name.length > 255) throw new Error('Tên phải có 1–255 ký tự.');
  if (kind === 'room') return { name, ...Object.fromEntries([
    ['countOfRooms', 1, 10000], ['adults', 1, 50], ['children', 0, 50], ['infants', 0, 50],
  ].map(([field, min, max]) => {
    const text = String(draft[field]).trim(), value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isInteger(value) || value < min || value > max) throw new Error(`Số lượng phải là số nguyên từ ${min} đến ${max}.`);
    return [field, value];
  })) };
  const rate = String(draft.rate).trim();
  if (!/^\d{1,15}(?:\.\d{1,4})?$/.test(rate)) throw new Error('Giá phải từ 0 trở lên, tối đa 15 chữ số nguyên và 4 chữ số thập phân.');
  if (!editing && (!draft.roomTypeId || !/^[A-Z]{3}$/.test(draft.currency))) throw new Error('Chọn loại phòng và mã tiền tệ gồm 3 chữ cái viết hoa.');
  const input = { name, rate };
  return editing ? input : { ...input, roomTypeId: draft.roomTypeId, currency: draft.currency };
}
