import { phoneInput } from '../../../shared/lib/phone.js';
import { emailInput } from '../../../shared/lib/validation.js';
import { isHotelCurrency } from '../../../shared/lib/currencies.js';

export function canCreateChannexProperty(user, account) {
  return ['SUPER_ADMIN', 'SYSTEM_MANAGER'].includes(user?.globalRole)
    && account?.configured === true && ['system:staging', 'system:production'].includes(account.id);
}

export function channexPropertyDraft(hotel = {}, settings = {}) {
  return {
    name: hotel.name || settings.name || '', currency: settings.currency || hotel.currency || 'VND',
    timezone: settings.timezone || hotel.timezone || 'Asia/Ho_Chi_Minh', country: hotel.country || 'VN',
    city: hotel.city || '', address: settings.address || hotel.address || '',
    email: settings.contactEmail || hotel.contactEmail || '', phone: settings.phone || hotel.contactPhone || '',
  };
}

export function channexPropertyInput(accountId, draft) {
  const values = Object.fromEntries([
    ['name', 'Tên khách sạn', 255], ['currency', 'Tiền tệ', 3], ['timezone', 'Múi giờ', 100], ['country', 'Mã quốc gia', 2],
    ['city', 'Tỉnh / Thành phố', 255], ['address', 'Địa chỉ', 255], ['email', 'Email liên hệ', 254], ['phone', 'Điện thoại', 32],
  ].map(([field, label, maximum]) => {
    const raw = draft[field] || '';
    if (raw.trim().length > maximum) throw new Error(`${label} chỉ được tối đa ${maximum} ký tự.`);
    if ([...raw].some(char => { const code = char.charCodeAt(0); return code < 32 || (code >= 127 && code <= 159); })) throw new Error(`${label} có ký tự điều khiển không hợp lệ. Vui lòng nhập lại.`);
    return [field, raw.trim()];
  }));
  if (!values.name) throw new Error('Nhập tên khách sạn trên Channex.');
  if (!isHotelCurrency(values.currency)) throw new Error('Tiền tệ không được hỗ trợ.');
  try {
    if (!values.timezone || /^[+-]/.test(values.timezone)) throw new Error();
    new Intl.DateTimeFormat('en', { timeZone: values.timezone });
  } catch { throw new Error('Nhập múi giờ hợp lệ, ví dụ Asia/Ho_Chi_Minh.'); }
  if (values.country && !/^[A-Z]{2}$/.test(values.country)) throw new Error('Mã quốc gia cần 2 chữ cái in hoa, ví dụ VN.');
  if (values.email) values.email = emailInput(values.email);
  values.phone = phoneInput(values.phone);
  return { accountId, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '')) };
}

export function propertyChoices(properties, created) {
  return created && !properties.some(property => property.id === created.id) ? [created, ...properties] : properties;
}
