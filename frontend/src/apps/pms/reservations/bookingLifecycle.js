import { bookingRooms } from '../data/model.js';

// This is an early UI check. The API rechecks current data under room locks.
export function checkInBlockReason(booking, rooms, bookings, day) {
  if (booking.status !== 'CONFIRMED') return 'invalid_transition';
  if (!day || day < booking.checkIn || day >= booking.checkOut) return 'outside_stay';
  const selected = bookingRooms(booking);
  if (!selected.length || selected.some(id => {
    const room = rooms.find(item => String(item.id) === id);
    return !room || room.active === false || room.condition !== 'clean';
  })) return 'room_not_ready';
  if (bookings.some(other => other.id !== booking.id && other.status === 'IN_HOUSE'
    && bookingRooms(other).some(id => selected.includes(id)))) return 'room_occupied';
  return '';
}
