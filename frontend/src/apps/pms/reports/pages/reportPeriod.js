import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parseIsoDate } from '../../../../shared/lib/date.js'
import { addDays, nights, today } from '../../data/model'

export const isReportPath = (path) =>
  /^\/id\/reports(?:\/(?:revenue|occupancy|source|room|roomType|cancellations|nationality|discounts))?\/?$/.test(
    path,
  )
export const isReportDate = (value) =>
  Number.isFinite(parseIsoDate(value)) && !value.startsWith('0000-')

export function readReportPeriod(search, timezone) {
  const params = new URLSearchParams(search)
  const specified = params.has('start') || params.has('end')
  const start = specified ? params.get('start') || '' : today(timezone)
  const end = specified ? params.get('end') || '' : addDays(start, 7)
  const valid =
    isReportDate(start) &&
    isReportDate(end) &&
    nights(start, end) > 0 &&
    nights(start, end) <= 366 &&
    params.get('period_invalid') !== '1'
  return { start, end, valid }
}

export function useReportPeriod(timezone) {
  const [params, setParams] = useSearchParams()
  const { start, end, valid: periodValid } = readReportPeriod(params, timezone)
  const [startValid, setStartValid] = useState(true),
    [endValid, setEndValid] = useState(true)
  const editedPeriod = useRef('')
  useEffect(() => {
    if (params.get('period_invalid') !== '1') {
      editedPeriod.current = ''
      return
    }
    // A min constraint can recover the other field; only a local date edit may clear its marker.
    if (!startValid || !endValid || editedPeriod.current !== JSON.stringify([start, end])) return
    const next = new URLSearchParams(params)
    next.delete('period_invalid')
    if (readReportPeriod(next, timezone).valid) {
      editedPeriod.current = ''
      setParams(next, { replace: true })
    }
  }, [params, setParams, start, end, startValid, endValid, timezone])
  function change(field, value) {
    editedPeriod.current = JSON.stringify([
      field === 'start' ? value : start,
      field === 'end' ? value : end,
    ])
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('start', field === 'start' ? value : start)
        next.set('end', field === 'end' ? value : end)
        if (field === 'start' ? endValid : startValid) next.delete('period_invalid')
        return next
      },
      { replace: true },
    )
  }
  function validity(setValid, value) {
    setValid(value)
    // DateInput keeps invalid text locally; the marker also protects Sidebar navigation.
    if (!value && params.get('period_invalid') !== '1')
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.set('period_invalid', '1')
          return next
        },
        { replace: true },
      )
  }
  const valid = periodValid && startValid && endValid
  const target = (path) => {
    const next = new URLSearchParams(params)
    next.set('start', start)
    next.set('end', end)
    return path + '?' + next
  }
  const min = isReportDate(start) ? addDays(start, 1) : ''
  return {
    start,
    end,
    valid,
    minEnd: isReportDate(min) ? min : undefined,
    target,
    setStart: (value) => change('start', value),
    setEnd: (value) => change('end', value),
    setStartValid: (value) => validity(setStartValid, value),
    setEndValid: (value) => validity(setEndValid, value),
    preventInvalid: (event) => {
      if (!valid) event.preventDefault()
    },
  }
}
