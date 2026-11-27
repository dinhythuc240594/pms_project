import { phoneInput } from '../../../../shared/lib/phone.js'
import { emailInput, taxIdInput } from '../../../../shared/lib/validation.js'
import { isVietnamProvince } from '../../../../shared/lib/vietnamProvinces.js'

export const hotelFields = {
  name: ['Tên khách sạn', 160],
  currency: ['Tiền tệ khách sạn', 3],
  contactName: ['Người liên hệ', 160],
  contactEmail: ['Email liên hệ', 254],
  contactPhone: ['Điện thoại / Zalo', 40],
  address: ['Địa chỉ', 500],
  city: ['Tỉnh / Thành phố', 160],
  taxId: ['Mã số thuế', 40],
}

export const hotelNotesLimit = 4000

export function hotelDraft(customer = {}) {
  return {
    ...Object.fromEntries(Object.keys(hotelFields).map((key) => [key, customer[key] || ''])),
    currency: customer.currency || 'VND',
    customerNotes: customer.customerNotes || '',
  }
}

export function hotelProfileInput({ currency: _currency, ...profile }, savedCity) {
  profile.name = profile.name.trim()
  if (!profile.name) throw new Error('Vui lòng nhập tên khách sạn.')
  profile.contactPhone = phoneInput(profile.contactPhone)
  profile.contactEmail = profile.contactEmail.trim() ? emailInput(profile.contactEmail) : ''
  profile.taxId = taxIdInput(profile.taxId)
  profile.city = profile.city.trim()
  if (profile.city && !isVietnamProvince(profile.city) && profile.city !== savedCity)
    throw new Error('Vui lòng chọn tỉnh / thành phố hợp lệ.')
  return profile
}
