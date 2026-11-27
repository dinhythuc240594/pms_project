import { formatDate } from '../../../../shared/lib/date.js'
import { decimalInput } from '../../../../shared/lib/number.js'
import DateInput from '../../../../shared/components/DateInput.jsx'
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Save } from 'lucide-react'
import { usePms } from '../../data/usePms'
import { today, addDays } from '../../data/model'
import { useInventoryQuery } from '../../inventory/useInventoryQuery'
import { rateRangeError, selectedRateRanges } from '../rateRange'
import { dateRangeParams } from '../../../../shared/lib/dateRangeQuery.js'
import DailyRateMatrix from '../components/DailyRateMatrix'
import '../../components/DomainForms.css'
import '../RatesInventory.css'
import './MatrixRate.css'
import RateModeNav from '../components/RateModeNav.jsx'
import {
  rateTypeIssue,
  rateTypeStatus,
  safeAddDays,
  targetCellKeys,
  useRateView,
} from '../rateModes.js'

export default function MatrixRate() {
  const pms = usePms()
  return (
    <MatrixEditor
      key={JSON.stringify([pms.tenantId, pms.user?.id, pms.authGeneration])}
      pms={pms}
    />
  )
}

function MatrixEditor({ pms }) {
  useI18n()
  const { roomTypes, settings, access, saveRate } = pms
  const view = useRateView({ timezone: settings.timezone, defaultNights: 14 })
  const range = view.range,
    typeId = view.typeId
  const [selection, updateSelection] = useState({ key: view.key, values: new Set() })
  const selected = selection.key === view.key ? selection.values : new Set()
  function setSelected(change) {
    updateSelection((previous) => ({
      key: view.key,
      values:
        typeof change === 'function'
          ? change(previous.key === view.key ? previous.values : new Set())
          : change,
    }))
  }
  const [price, setPrice] = useState('')
  const [preview, setPreview] = useState(null),
    inFlight = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [version, setVersion] = useState(0)
  const [startValid, setStartValid] = useState(true),
    [endValid, setEndValid] = useState(true)
  // Unknown/inactive types get a disabled placeholder option so choosing "All" is a real change.
  const typeIssue = rateTypeIssue(rateTypeStatus(roomTypes, typeId))
  const rangeError =
    view.urlError ||
    (!startValid || !endValid ? labelUi('Ngày không hợp lệ.') : rateRangeError(range, 31)) ||
    typeIssue
  const query = rangeError ? null : dateRangeParams(range).toString()
  const rateQuery = useInventoryQuery(query ? '/rates?' + query : null, version)
  const availabilityQuery = useInventoryQuery(query ? '/availability?' + query : null, version)
  const loading = rateQuery.loading || availabilityQuery.loading
  const loadError = rateQuery.error || availabilityQuery.error
  const writable = access('settings.write', 'ARI_MANAGEMENT', true).allowed
  const types = roomTypes.filter((type) => type.active !== false && (!typeId || type.id === typeId))
  const days = []
  if (!rangeError)
    for (let date = range.start; date < range.end; date = addDays(date, 1)) days.push(date)
  const rates = rateQuery.data?.rates || [],
    availability = availabilityQuery.data?.availability || []
  function changeRange(next) {
    view.update(next)
    setSelected(new Set())
    setError('')
    setNotice('')
  }
  const fingerprint = JSON.stringify([
    range,
    typeId,
    [...selected].sort(),
    price,
    settings.currency,
    types.map((type) => type.id).sort(),
  ])
  const latest = useRef({ fingerprint, writable })
  useEffect(() => {
    latest.current = { fingerprint, writable }
  }, [fingerprint, writable])
  const shownPreview = preview?.key === fingerprint && writable && !rangeError ? preview : null
  function toggle(key) {
    setSelected((old) => {
      const next = new Set(old)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function selectRow(type) {
    const keys = days.map((date) => `${type.id}:${date}`)
    setSelected((old) => {
      const next = new Set(old)
      const all = keys.every((key) => next.has(key))
      keys.forEach((key) => (all ? next.delete(key) : next.add(key)))
      return next
    })
  }
  function prepare(event, action = 'price') {
    event?.preventDefault()
    if (inFlight.current || !writable || !selected.size || loading || loadError || rangeError)
      return
    let amount
    if (action === 'price') {
      try {
        amount = decimalInput(price)
      } catch (err) {
        setError(err.message)
        return
      }
    }
    const targets = selectedRateRanges(types, days, selected).map((target) => ({
      ...target,
      ...(action === 'price' ? { price: amount } : { stopSell: action === 'close' }),
    }))
    if (targets.length) {
      setPreview({
        key: fingerprint,
        viewKey: view.key,
        targets,
        action,
        currency: settings.currency,
      })
      setError('')
    }
  }
  async function confirm() {
    const snapshot = shownPreview
    if (inFlight.current || !snapshot || !writable || loading || loadError || rangeError) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const completedKeys = new Set()
    let completedRanges = 0
    try {
      for (const target of snapshot.targets) {
        if (!latest.current.writable || latest.current.fingerprint !== snapshot.key)
          throw Error('Phạm vi hoặc quyền đã đổi; phần còn lại chưa được áp dụng.')
        await saveRate(target)
        targetCellKeys(target).forEach((key) => completedKeys.add(key))
        completedRanges++
      }
      setPreview(null)
      setPrice('')
      setNotice(
        tUi(
          snapshot.action === 'price'
            ? 'rates.priceSuccess'
            : snapshot.action === 'close'
              ? 'rates.closeSuccess'
              : 'rates.openSuccess',
          { count: completedKeys.size },
        ),
      )
    } catch (err) {
      const failed = snapshot.targets[completedRanges]
      setError(
        err.message +
          ' · Đã áp dụng ' +
          completedKeys.size +
          ' ô. Khoảng chưa xác nhận: ' +
          (failed
            ? failed.roomTypeId + ' ' + formatDate(failed.start) + '–' + formatDate(failed.end)
            : '—') +
          '. Chưa thực hiện ' +
          Math.max(0, snapshot.targets.length - completedRanges - 1) +
          ' khoảng tiếp theo.',
      )
    } finally {
      updateSelection((previous) =>
        previous.key === snapshot.viewKey
          ? {
              ...previous,
              values: new Set([...previous.values].filter((key) => !completedKeys.has(key))),
            }
          : previous,
      )
      inFlight.current = false
      setBusy(false)
      setVersion((value) => value + 1)
    }
  }
  return (
    <div className="pms-domain-page pms-rates-page pms-matrix-page">
      <RateModeNav
        current="matrix"
        busy={busy || !startValid || !endValid}
        context={{ ...range, typeId }}
      />
      <section className="domain-panel rates-filters">
        <div className="domain-fields">
          <label>
            {tUi('common.fromDate')}
            <DateInput
              required
              disabled={busy}
              value={range.start}
              onChange={(start) => changeRange({ ...range, start })}
              onValidityChange={setStartValid}
            />
          </label>
          <label>
            {tUi('rates.endExclusive')}
            <DateInput
              required
              min={safeAddDays(range.start, 1)}
              disabled={busy}
              value={range.end}
              onChange={(end) => changeRange({ ...range, end })}
              onValidityChange={setEndValid}
            />
          </label>
          <label>
            {tUi('common.roomType')}
            <select
              value={typeId}
              disabled={busy}
              onChange={(event) => {
                view.update({ typeId: event.target.value })
                setSelected(new Set())
              }}
            >
              <option value="">{tUi('common.allRoomTypes')}</option>
              {typeIssue && (
                <option value={typeId} disabled>
                  {'Loại phòng không hợp lệ: ' + typeId}
                </option>
              )}
              {roomTypes
                .filter((type) => type.active !== false)
                .map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="rates-period-actions">
            <button
              aria-label={tUi('rates.previousSeven')}
              disabled={busy || Boolean(rangeError)}
              onClick={() =>
                changeRange({ start: addDays(range.start, -7), end: addDays(range.end, -7) })
              }
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              disabled={busy}
              onClick={() =>
                changeRange({
                  start: today(settings.timezone),
                  end: addDays(today(settings.timezone), 14),
                })
              }
            >
              {tUi('common.today')}
            </button>
            <button
              aria-label={tUi('rates.nextSeven')}
              disabled={busy || Boolean(rangeError)}
              onClick={() =>
                changeRange({ start: addDays(range.start, 7), end: addDays(range.end, 7) })
              }
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button
              aria-label={tUi('rates.reload')}
              disabled={busy || loading || Boolean(rangeError)}
              onClick={() => setVersion((value) => value + 1)}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="rates-muted">{tUi('rates.rangeHint')}</p>
      </section>
      {(rangeError || error) && (
        <p className="domain-error" role="alert">
          {rangeError || error}
        </p>
      )}
      {notice && (
        <p className="rates-notice is-success" role="status">
          {notice}
        </p>
      )}
      {loadError && (
        <div className="domain-error" role="alert">
          {loadError}{' '}
          <button onClick={() => setVersion((value) => value + 1)}>{tUi('common.retry')}</button>
        </div>
      )}
      {!writable && (
        <p className="rates-notice" role="status">
          {tUi('rates.readOnly')}
        </p>
      )}
      {writable && selected.size > 0 && (
        <section className="domain-panel rates-bulk-panel" aria-label={tUi('rates.updateSelected')}>
          <div className="rates-section-heading">
            <div>
              <h2>{tUi('rates.selectedTitle', { count: selected.size })}</h2>
              <p>{tUi('rates.selectedHint')}</p>
            </div>
            <button disabled={busy} onClick={() => setSelected(new Set())}>
              {tUi('rates.deselect')}
            </button>
          </div>
          <form className="domain-fields" onSubmit={(event) => prepare(event)}>
            <label>
              {tUi('rates.newPrice', { currency: settings.currency })}
              <input
                required
                type="text"
                inputMode="decimal"
                pattern="[0-9]{1,15}([.][0-9]{1,4})?"
                maxLength={20}
                value={price}
                disabled={busy}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="primary rates-icon-button"
              disabled={busy || loading || Boolean(loadError)}
            >
              <Save size={16} aria-hidden="true" />{' '}
              {busy ? tUi('common.saving') : tUi('rates.updatePrice')}
            </button>
            <button
              type="button"
              disabled={busy || loading || Boolean(loadError)}
              onClick={() => prepare(null, 'open')}
            >
              {tUi('rates.openSell')}
            </button>
            <button
              type="button"
              className="rates-danger-button"
              disabled={busy || loading || Boolean(loadError)}
              onClick={() => prepare(null, 'close')}
            >
              {tUi('rates.stopSell')}
            </button>
          </form>
        </section>
      )}
      {shownPreview && (
        <section className="domain-panel" aria-label="Xem trước thay đổi ma trận">
          <h2>Xem trước thay đổi ma trận</h2>
          <p>
            {shownPreview.action === 'price'
              ? 'Cập nhật giá'
              : shownPreview.action === 'close'
                ? 'Dừng bán'
                : 'Mở bán'}{' '}
            · {shownPreview.currency} · {shownPreview.targets.length} khoảng ·{' '}
            {shownPreview.targets.reduce(
              (count, target) => count + targetCellKeys(target).length,
              0,
            )}{' '}
            ô
          </p>
          <p>
            Chỉ áp dụng các ô đã chọn trong phạm vi đang xem; không tự mở rộng sang các ngày còn
            lại.
          </p>
          <details>
            <summary>Chi tiết từng khoảng</summary>
            <ul>
              {shownPreview.targets.map((target) => (
                <li key={target.roomTypeId + target.start}>
                  {types.find((type) => type.id === target.roomTypeId)?.name} ·{' '}
                  {formatDate(target.start)}–{formatDate(target.end)} (không gồm ngày cuối)
                  {target.price !== undefined
                    ? ' · ' + target.price + ' ' + shownPreview.currency + '/đêm'
                    : ''}
                </li>
              ))}
            </ul>
          </details>
          <button
            type="button"
            className="primary"
            disabled={busy || loading || Boolean(loadError)}
            onClick={confirm}
          >
            Xác nhận áp dụng ma trận
          </button>
          <button type="button" disabled={busy} onClick={() => setPreview(null)}>
            Hủy xem trước
          </button>
        </section>
      )}
      {!rangeError && (
        <section className="domain-panel rates-table-panel">
          <div className="rates-section-heading">
            <div>
              <h2>{tUi('rates.calendar')}</h2>
              <p>
                {tUi('rates.summary', {
                  days: days.length,
                  types: types.length,
                  currency: settings.currency,
                })}
              </p>
            </div>
            <div className="rates-legend">
              <span>
                <i className="is-active" /> {tUi('rates.available')}
              </span>
              <span>
                <i className="is-low" /> {tUi('rates.lowStock')}
              </span>
              <span>
                <i className="is-paused" /> {tUi('rates.soldOut')}
              </span>
            </div>
          </div>
          {loading ? (
            <p className="rates-empty" role="status">
              {tUi('rates.loading')}
            </p>
          ) : (
            !loadError && (
              <DailyRateMatrix
                types={types}
                days={days}
                rates={rates}
                availability={availability}
                settings={settings}
                selected={selected}
                writable={writable}
                busy={busy}
                onToggle={toggle}
                onSelectRow={selectRow}
              />
            )
          )}
          <p className="rates-table-note">{tUi('rates.note')}</p>
        </section>
      )}
    </div>
  )
}
