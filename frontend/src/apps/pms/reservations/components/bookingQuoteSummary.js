import { parseIsoDate } from '../../../../shared/lib/date.js'

// Exact fixed-4 decimal money for display-only grouping of a quote's nightly rows.
// Prices: up to 15 whole + 4 fraction digits, non-negative, no exponent. Sums may grow beyond 15 digits.
const PRICE = /^(\d{1,15})(?:\.(\d{1,4}))?$/
const SCALE = 10000n

export function parseFixed4(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
  } else if (typeof value !== 'string') return null
  const match = PRICE.exec(String(value))
  if (!match) return null
  return BigInt(match[1]) * SCALE + BigInt((match[2] || '').padEnd(4, '0'))
}

export function formatFixed4(amount) {
  return `${amount / SCALE}.${String(amount % SCALE).padStart(4, '0')}`
}

const label = (value) =>
  (typeof value === 'string' && value !== '') ||
  (typeof value === 'number' && Number.isFinite(value))
    ? String(value)
    : null

// Never mutates `quoted`. Rooms keep first-seen order; rows keep original order.
export function summarizeQuote(quoted, fallbackCurrency = '') {
  const currency = label(quoted?.currency) || label(fallbackCurrency) || ''
  const source = Array.isArray(quoted?.nightlyRates) ? quoted.nightlyRates : []
  const groups = new Map()
  const rows = source.map((row, index) => {
    const room = label(row?.room)
    const key = room ?? '\u0000missing'
    if (!groups.has(key))
      groups.set(key, { room, dates: new Set(), prices: [], warnings: new Set() })
    const group = groups.get(key)
    const date = row?.date
    const dateValid = Number.isFinite(parseIsoDate(date))
    const price = parseFixed4(row?.price)
    const rawCurrency = row?.currency
    const rowCurrency = rawCurrency == null || rawCurrency === '' ? currency : label(rawCurrency)
    if (room === null) group.warnings.add('room')
    if (!dateValid) group.warnings.add('date')
    else if (group.dates.has(date)) group.warnings.add('duplicate')
    else group.dates.add(date)
    if (price === null) group.warnings.add('price')
    else group.prices.push(price)
    if (rowCurrency !== currency) group.warnings.add('currency')
    return {
      index,
      room,
      date: dateValid ? date : null,
      price: price === null ? null : formatFixed4(price),
      currency: rowCurrency,
    }
  })
  const rooms = [...groups.values()].map((group) => {
    const warnings = [...group.warnings]
    const safe = warnings.length === 0
    let min = null,
      max = null,
      sum = 0n
    for (const price of group.prices) {
      sum += price
      if (min === null || price < min) min = price
      if (max === null || price > max) max = price
    }
    const varies = min !== null && min !== max
    return {
      room: group.room,
      nights: group.dates.size,
      subtotal: safe ? formatFixed4(sum) : null,
      varies,
      min: safe && varies ? formatFixed4(min) : null,
      max: safe && varies ? formatFixed4(max) : null,
      warnings,
    }
  })
  return {
    currency,
    rooms,
    rows,
    unsafe: rooms.some((room) => room.warnings.length > 0),
    varies: rooms.some((room) => room.varies),
  }
}
