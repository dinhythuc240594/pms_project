import { isHotelCurrency } from '../../../../shared/lib/currencies.js'
import { parseIsoDate } from '../../../../shared/lib/date.js'
import { today } from '../../data/model.js'

const fields = {
  startDate: 'cf_start',
  endDate: 'cf_end',
  fundId: 'cf_fund',
  actorId: 'cf_actor',
  categoryId: 'cf_category',
  currency: 'cf_currency',
  page: 'cf_page',
  q: 'cf_q',
}
const owned = [...Object.values(fields), 'cf_scope', 'cf_invalid']
export const cashflowScope = (pms, params) =>
  JSON.stringify([
    pms.tenantId || '',
    pms.user?.id || '',
    pms.authGeneration ?? 0,
    params.get('documentId') || '',
    params.get('currency') || '',
  ])
const calendar = (value) =>
  !value || (Number.isFinite(parseIsoDate(value)) && !value.startsWith('0000-'))
export const cashflowDatesValid = (filters) =>
  calendar(filters.startDate) &&
  calendar(filters.endDate) &&
  (!filters.startDate || !filters.endDate || filters.startDate <= filters.endDate)
export const cashflowQueryValid = (value) =>
  typeof value === 'string' &&
  [...value.trim().normalize('NFC')].length <= 160 &&
  ![...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || (code >= 127 && code <= 159)
  })
export const cashflowSearchValid = (params, pms) =>
  params.get('cf_scope') !== cashflowScope(pms, params) ||
  (params.getAll('cf_q').length <= 1 && cashflowQueryValid(params.get('cf_q') || ''))

export function clearCashflowFilters(search) {
  const next = new URLSearchParams(search)
  owned.forEach((key) => next.delete(key))
  return next
}

export function readCashflowFilters(params, pms, type) {
  const currency = isHotelCurrency(params.get('currency'))
    ? params.get('currency')
    : pms.settings.currency
  const defaults = {
    startDate: '',
    endDate: params.get('documentId') ? '' : today(pms.settings.timezone),
    fundId: '',
    actorId: '',
    categoryId: '',
    currency,
    page: 1,
  }
  if (params.get('cf_scope') !== cashflowScope(pms, params)) return defaults
  const result = { ...defaults }
  for (const [field, key] of Object.entries(fields))
    if (params.has(key)) result[field] = params.get(key)
  if (!isHotelCurrency(result.currency)) result.currency = currency
  if (!(pms.cashbookActors || pms.users || []).some((row) => row.id === result.actorId))
    result.actorId = ''
  if (
    result.categoryId !== 'uncategorized' &&
    !(pms.cashbookCategories || []).some((row) => row.id === result.categoryId)
  )
    result.categoryId = ''
  const fund = (pms.funds || []).find((row) => row.id === result.fundId)
  if (
    !fund ||
    (fund.type?.toUpperCase() === 'BANK' ? 'bank' : 'cash') !== type ||
    (fund.currency || pms.settings.currency) !== result.currency
  )
    result.fundId = ''
  result.page =
    /^\d+$/.test(String(result.page)) &&
    Number.isSafeInteger(Number(result.page)) &&
    Number(result.page) > 0
      ? Number(result.page)
      : 1
  return result
}

export function writeCashflowFilters(search, filters, pms) {
  const next = new URLSearchParams(search)
  for (const [field, key] of Object.entries(fields)) {
    if (field === 'q' && !filters[field]) next.delete(key)
    else next.set(key, String(filters[field] ?? ''))
  }
  next.set('cf_scope', cashflowScope(pms, next))
  return next
}

export function cashflowTarget(path, search, pms) {
  const current = new URLSearchParams(search)
  const type = path.endsWith('/bank') ? 'bank' : 'cash'
  const filters = { ...readCashflowFilters(current, pms, type), page: 1 }
  const next = new URLSearchParams(current)
  for (const key of ['booking', 'tab', 'date', 'start', 'end', 'period_invalid']) next.delete(key)
  if (current.get('cf_scope') !== cashflowScope(pms, current)) next.delete('cf_invalid')
  return path + '?' + writeCashflowFilters(next, filters, pms)
}

export function cashflowInvalid(search, pms, type) {
  const params = new URLSearchParams(search)
  return (
    params.get('cf_scope') === cashflowScope(pms, params) &&
    (params.get('cf_invalid') === '1' ||
      !cashflowDatesValid(readCashflowFilters(params, pms, type)))
  )
}
