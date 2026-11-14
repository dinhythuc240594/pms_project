import { getIntlLocale, tr } from '../../../shared/i18n/store.js';
import { HOTEL_CURRENCIES } from '../../../shared/lib/currencies.js';

const currencyLocales = new Map(HOTEL_CURRENCIES.map(({ code, locale }) => [code, locale]));
const moneyFormats = new Map();

function moneyFormat(currency) {
  const locale = currencyLocales.get(currency) ?? getIntlLocale();
  const key = `${locale}:${currency}`;
  if (!moneyFormats.has(key)) {
    const minimumFractionDigits = currencyLocales.has(currency)
      ? new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().minimumFractionDigits
      : 2;
    const number = new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits: 4 });
    moneyFormats.set(key, {
      minimumFractionDigits, number,
      integer: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
      separator: number.formatToParts(1.1).find(part => part.type === 'decimal').value,
    });
  }
  return moneyFormats.get(key);
}

export const today = (timezone = 'Asia/Ho_Chi_Minh') => new Date().toLocaleDateString('en-CA', { timeZone: timezone });
export const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const nights = (start, end) => (Date.parse(end) - Date.parse(start)) / 86400000;
export const moneyAmount = (value, currency = 'VND') => {
  const { minimumFractionDigits, number, integer, separator } = moneyFormat(currency);
  const match = String(value ?? 0).match(/^(-?)(\d+)(?:\.(\d{0,4}))?$/);
  if (!match) return number.format(Number(value));
  // Preserve exact API decimals, including fractions smaller than the currency's minor unit.
  const fraction = (match[3] || '').replace(/0+$/, '').padEnd(minimumFractionDigits, '0');
  return match[1] + integer.format(BigInt(match[2])) + (fraction ? separator + fraction : '');
};
export const money = (value, currency = 'VND') => moneyAmount(value, currency) + ' ' + (currency === 'VND' ? '₫' : currency);
export const statusLabels = {
  get CONFIRMED() { return tr('Đã xác nhận'); },
  get IN_HOUSE() { return tr('Đang ở'); },
  get CHECKED_OUT() { return tr('Đã trả phòng'); },
  get CANCELLED() { return tr('Đã hủy'); },
  get NO_SHOW() { return tr('Không đến'); },
};
export const bookingRooms = booking => booking.rooms?.length ? booking.rooms.map(String) : booking.room ? [String(booking.room)] : [];
export const bookingRoomStays = booking => booking.roomStays?.length ? booking.roomStays : bookingRooms(booking).map(room => ({ room, start: booking.checkIn, end: booking.checkOut }));
export const roomCount = bookings => bookings.reduce((count, booking) => count + bookingRooms(booking).length, 0);
export const active = booking => ['CONFIRMED', 'IN_HOUSE'].includes(booking.status);
export const overlaps = (booking, start, end) => active(booking) && booking.checkIn < end && booking.checkOut > start;
export const roomIsBlocked = (room, blocks, start, end) => room.condition === 'maintenance' || blocks.some(block =>
  (block.room === room.id || (room.uuid != null && block.roomId === room.uuid)) && block.start < end && block.end > start);
export function availableRooms(rooms, bookings, start, end, typeId = '', excludeId = '') {
  if (!start || !end || nights(start, end) <= 0) return [];
  return rooms.filter(room => room.active !== false && (!typeId || room.typeId === typeId) && room.condition !== 'maintenance' && !bookings.some(b => b.id !== excludeId && active(b) && bookingRoomStays(b).some(stay => String(stay.room) === String(room.id) && stay.start < end && stay.end > start)));
}
export function validateBooking(input, rooms, bookings) {
  if (!input.guest?.trim()) throw new Error('Vui lòng nhập tên khách.');
  if (!input.checkIn || !input.checkOut || !Number.isFinite(nights(input.checkIn, input.checkOut)) || nights(input.checkIn, input.checkOut) <= 0) throw new Error('Ngày trả phòng phải sau ngày nhận phòng.');
  if (!availableRooms(rooms, bookings, input.checkIn, input.checkOut).some(r => r.id === input.room)) throw new Error('Phòng không còn trống trong khoảng ngày đã chọn.');
}
