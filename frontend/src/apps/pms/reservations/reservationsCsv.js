import { bookingRooms, statusLabels } from '../data/model.js';

export const reservationCsvHeaders = ['Mã booking', 'Khách', 'Phòng', 'Nhận', 'Trả', 'Trạng thái', 'Nguồn', 'Tổng tiền', 'Tiền tệ'];

export function reservationCsvRows(bookings) {
  return bookings.map(booking => [booking.id, booking.guest, bookingRooms(booking).join(', '), booking.checkIn, booking.checkOut, statusLabels[booking.status], booking.source, booking.total, booking.currency]);
}
