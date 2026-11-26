import { useLocation, useSearchParams } from 'react-router-dom'
import { addDays, today } from '../data/model.js'
import { parseIsoDate } from '../../../shared/lib/date.js'

// URL keys are prefixed so rate view context never collides with booking/tab/return params.
export const RATE_PARAM = Object.freeze({ start: 'rateStart', end: 'rateEnd', type: 'rateType' })

// The four existing modes; no new routes. Labels are Vietnamese source strings for tr().
export const RATE_MODES = Object.freeze([
  Object.freeze({
    id: 'base',
    path: '/id/gia',
    label: 'Giá cơ bản',
    hint: 'Giá mặc định mỗi đêm theo loại phòng',
  }),
  Object.freeze({
    id: 'advanced',
    path: '/id/gia/advanced',
    label: 'Quy tắc nâng cao',
    hint: 'Điều chỉnh theo điều kiện khi báo giá',
  }),
  Object.freeze({
    id: 'matrix',
    path: '/id/matrix-rate',
    label: 'Lịch giá theo ngày',
    hint: 'Chọn nhiều ô: giá ghi đè, mở/dừng bán',
  }),
  Object.freeze({
    id: 'form',
    path: '/id/gia/ari',
    label: 'Giá theo khoảng ngày',
    hint: 'Một loại phòng · trạng thái bán hôm nay',
  }),
])

export const isIsoDate = (value) =>
  typeof value === 'string' && !value.startsWith('0000-') && Number.isFinite(parseIsoDate(value))
export const safeAddDays = (date, days) => {
  const target = isIsoDate(date) ? addDays(date, days) : undefined
  return isIsoDate(target) ? target : undefined
}

// Missing keys fall back to defaults; present-but-empty or malformed values are reported, never clamped.
export function readRateParams(params, { todayDate, defaultNights }) {
  const raw = (key) => (params.has(key) ? params.get(key) : null)
  const rawStart = raw(RATE_PARAM.start),
    rawEnd = raw(RATE_PARAM.end),
    rawType = raw(RATE_PARAM.type)
  const start = rawStart ?? todayDate
  const end = rawEnd ?? addDays(isIsoDate(start) ? start : todayDate, defaultNights)
  const issues = []
  for (const key of Object.values(RATE_PARAM))
    if (params.getAll(key).length > 1)
      issues.push(`Tham số ${key} bị lặp; chọn lại phạm vi hợp lệ.`)
  for (const [value, name] of [
    [rawStart, 'ngày bắt đầu'],
    [rawEnd, 'ngày kết thúc'],
  ]) {
    if (value === null) continue
    if (value === '') issues.push(`Liên kết có ${name} trống. Vui lòng chọn ngày hợp lệ.`)
    else if (!isIsoDate(value))
      issues.push(`Giá trị ${name} trong liên kết không hợp lệ: "${value}".`)
  }
  const typeId = rawType ?? ''
  return {
    range: { start, end },
    typeId,
    urlError: issues.join(' '),
    key: `${start}|${end}|${typeId}`,
  }
}

// Copy every existing param, then set only the prefixed rate keys present in the patch.
export function writeRateParams(params, patch = {}) {
  const next = new URLSearchParams(params)
  if (patch.start !== undefined) next.set(RATE_PARAM.start, patch.start ?? '')
  if (patch.end !== undefined) next.set(RATE_PARAM.end, patch.end ?? '')
  if (patch.typeId !== undefined) {
    if (patch.typeId) next.set(RATE_PARAM.type, patch.typeId)
    else next.delete(RATE_PARAM.type)
  }
  return next
}

export function rateTypeStatus(roomTypes, typeId) {
  if (!typeId) return 'all'
  const type = (roomTypes || []).find((row) => row.id === typeId)
  if (!type) return 'unknown'
  return type.active === false ? 'inactive' : 'active'
}

export function rateTypeIssue(status) {
  if (status === 'unknown')
    return 'Loại phòng trong liên kết không tồn tại. Chọn một loại phòng hợp lệ trước khi áp dụng thay đổi.'
  if (status === 'inactive')
    return 'Loại phòng trong liên kết đã ngừng hoạt động. Chọn một loại phòng đang hoạt động trước khi áp dụng thay đổi.'
  return ''
}

export function datesInRange(start, end) {
  const dates = []
  if (!isIsoDate(start) || !isIsoDate(end)) return dates
  for (let date = start; date < end; date = addDays(date, 1)) dates.push(date)
  return dates
}

export const targetCellKeys = (target) =>
  datesInRange(target.start, target.end).map((date) => `${target.roomTypeId}:${date}`)

export function useRateView({ timezone, defaultNights }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const view = readRateParams(searchParams, { todayDate: today(timezone), defaultNights })
  // Push (not replace) so Back/Forward walk through range/type changes.
  const update = (patch) =>
    setSearchParams(writeRateParams(searchParams, patch), { state: location.state })
  return { ...view, update }
}
