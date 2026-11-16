import { bookingRooms } from '../data/model.js';
import { phoneInput } from '../../../shared/lib/phone.js';
import { emailInput } from '../../../shared/lib/validation.js';

export function bookingGuestInput(guest) {
  const name = (guest.name || '').trim();
  if (!name || name.length > 160) throw new Error('Tên khách cần từ 1 đến 160 ký tự.');
  return { ...guest, name, ...(guest.phone !== undefined ? { phone: phoneInput(guest.phone || '') } : {}), ...(guest.email !== undefined ? { email: guest.email?.trim() ? emailInput(guest.email) : '' } : {}) };
}

export function bookingEditInput(draft) {
  if (!draft.checkIn || !draft.checkOut || draft.checkOut <= draft.checkIn) throw new Error('Ngày trả phòng phải sau ngày nhận phòng.');
  const primary = {...draft.guests?.[0],name:draft.guest,phone:draft.phone,email:draft.email,identityNumber:draft.identity,nationality:draft.nationality};
  return {expectedVersion:draft.version,rooms:bookingRooms(draft),checkIn:draft.checkIn,checkOut:draft.checkOut,source:draft.source,guests:[primary,...(draft.guests||[]).slice(1)].map(bookingGuestInput)};
}
