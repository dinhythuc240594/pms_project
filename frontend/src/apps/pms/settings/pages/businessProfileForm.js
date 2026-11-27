import { phoneInput } from '../../../../shared/lib/phone.js'
import { emailInput, taxIdPattern } from '../../../../shared/lib/validation.js'

export function businessProfileInput(draft) {
  const name = draft.name.trim()
  if (!name || name.length > 160) throw new Error('Tên cần từ 1 đến 160 ký tự.')
  const result = {
    ...draft,
    name,
    phone: phoneInput(draft.phone),
    contactEmail: draft.contactEmail.trim() ? emailInput(draft.contactEmail) : '',
    taxCode: draft.taxCode.trim(),
  }
  if (
    result.taxCode &&
    (result.taxCode.length > 80 || !new RegExp(`^(?:${taxIdPattern})$`, 'u').test(result.taxCode))
  )
    throw new Error('Mã số thuế chỉ gồm chữ số và có thể có hậu tố -xxx.')
  for (const field of ['website', 'logoUrl']) {
    const value = draft[field].trim()
    if (value) {
      let url
      try {
        url = new URL(value)
      } catch {
        throw new Error('URL không hợp lệ.')
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        (field === 'logoUrl' && url.protocol !== 'https:') ||
        url.username ||
        url.password ||
        /[\s\\\x00-\x1f\x7f]/u.test(value)
      )
        throw new Error(
          'Website cần HTTP/HTTPS; URL logo cần HTTPS và không chứa thông tin đăng nhập.',
        )
    }
    result[field] = value
  }
  result.timezone = draft.timezone.trim()
  try {
    if (!result.timezone || /^[+-]/.test(result.timezone)) throw new Error()
    new Intl.DateTimeFormat('en', { timeZone: result.timezone })
  } catch {
    throw new Error('Múi giờ không hợp lệ.')
  }
  return result
}
