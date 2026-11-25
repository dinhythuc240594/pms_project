import { normalizePricingRules } from '../../../../shared/lib/planPricing.js'

export function registeredRoomCount(value, ceiling) {
  const text = String(value).trim()
  const count = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(count) || count < 1 || count > 1000000)
    throw new Error('Số lượng phải là số nguyên từ 1 đến 1.000.000.')
  if (ceiling != null && count > ceiling)
    throw new Error(`Gói này cho đăng ký tối đa ${ceiling} phòng.`)
  return count
}

export function planFormInput(plan) {
  const code = String(plan.code || '')
      .trim()
      .toUpperCase(),
    name = plan.name.trim(),
    currency = plan.currency.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_]{0,11}$/.test(code))
    throw new Error(
      'Mã gói gồm tối đa 12 ký tự: chữ in hoa, số hoặc dấu gạch dưới; bắt đầu bằng chữ.',
    )
  if (!name || name.length > 100) throw new Error('Tên gói phải có từ 1 đến 100 ký tự.')
  if (!['VND', 'USD'].includes(currency)) throw new Error('Tiền tệ phải là VND hoặc USD.')
  const prices = Object.fromEntries(
    ['price', 'priceYear'].map((key) => {
      const amount = String(plan[key]).trim()
      if (!/^\d{1,15}(?:\.\d{1,4})?$/.test(amount))
        throw new Error('Giá phải từ 0 trở lên, tối đa 15 chữ số nguyên và 4 chữ số thập phân.')
      return [key, amount]
    }),
  )
  const limits = Object.fromEntries(
    ['maxRooms', 'maxUsers'].map((key) => [
      key,
      plan[key] == null || plan[key] === '' ? null : registeredRoomCount(plan[key]),
    ]),
  )
  if (code === 'FREE' && Object.values(prices).some((value) => !/^0+(?:\.0+)?$/.test(value)))
    throw new Error('Gói FREE phải có giá bằng 0.')
  if (
    code === 'FREE' &&
    (limits.maxRooms == null ||
      limits.maxRooms > 30 ||
      limits.maxUsers == null ||
      limits.maxUsers > 5)
  )
    throw new Error('Gói FREE có tối đa 30 phòng và 5 tài khoản; cần nhập đủ hai giới hạn.')
  const pricingRules = normalizePricingRules(plan.pricingRules)
  if (
    code === 'FREE' &&
    [pricingRules.extraRoomPrice, pricingRules.extraRoomPriceYear].some(
      (value) => Number(value) !== 0,
    )
  )
    throw new Error('Gói FREE phải có giá phòng thêm bằng 0.')
  return {
    ...(plan.id ? { id: plan.id } : {}),
    ...(plan.restoring ? { deleted: false } : {}),
    code,
    name,
    currency,
    ...prices,
    ...limits,
    pricingRules,
    features: { ...plan.features },
    active: plan.active === true,
  }
}
