import DateInput from '../../../../shared/components/DateInput.jsx'
import { formatDate, parseIsoDate } from '../../../../shared/lib/date.js'
import { phonePattern } from '../../../../shared/lib/phone.js'
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import React, { useEffect, useId, useRef, useState } from 'react'
import { useDraftGuard } from '../../../../shared/drafts/DraftGuardProvider'
import { usePms } from '../../data/usePms'
import { today, addDays, nights, money as formatMoney } from '../../data/model'
import LegacyOverlay from '../../components/LegacyOverlay'
import { Search, X, Calendar, User, CheckCircle2 } from 'lucide-react'
import './BookingModal.css'
import { bookingGuestInput } from '../bookingDraft.js'
import { summarizeQuote } from './bookingQuoteSummary.js'

const QUOTE_WARNINGS = {
  room: 'Thiếu mã phòng trong báo giá',
  date: 'Có ngày không hợp lệ',
  duplicate: 'Trùng ngày cho cùng phòng',
  price: 'Có giá không hợp lệ',
  currency: 'Tiền tệ khác với báo giá',
}

function QuoteSummary({ summary }) {
  const roomName = (room) => (room === null ? 'Không rõ phòng' : `${tUi('common.room')} ${room}`)
  return (
    <div className="booking-quote-summary" aria-label="Tóm tắt báo giá">
      <ul className="booking-quote-rooms">
        {summary.rooms.map((group, i) => (
          <li
            key={i}
            className={'booking-quote-room' + (group.warnings.length ? ' is-unsafe' : '')}
          >
            <span className="booking-quote-room-name">{roomName(group.room)}</span>
            <span className="booking-quote-nights">{group.nights} đêm</span>
            {group.subtotal !== null ? (
              <strong className="booking-quote-subtotal">
                {formatMoney(group.subtotal, summary.currency)}
              </strong>
            ) : (
              <strong className="booking-quote-subtotal">Không tạm tính</strong>
            )}
            {group.varies && (
              <span className="booking-quote-variation">
                {group.min !== null
                  ? `Giá thay đổi theo đêm: ${formatMoney(group.min, summary.currency)} – ${formatMoney(group.max, summary.currency)}`
                  : 'Giá thay đổi theo đêm'}
              </span>
            )}
            {group.warnings.map((code) => (
              <span key={code} className="booking-quote-warning">
                ⚠ {QUOTE_WARNINGS[code]}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {summary.unsafe && (
        <p className="booking-quote-warning">
          ⚠ Báo giá có dữ liệu bất thường; tạm tính của phòng liên quan đã được ẩn. Kiểm tra chi
          tiết từng đêm.
        </p>
      )}
      <p className="booking-quote-note">
        Tạm tính từng phòng chỉ để tham khảo; Tổng cộng ở cuối là tổng báo giá chính thức.
      </p>
      <details className="booking-quote-details">
        <summary>Xem giá từng đêm ({summary.rows.length} dòng)</summary>
        <ol className="booking-quote-nightly">
          {summary.rows.map((row) => (
            <li key={row.index} className="booking-quote-night">
              {roomName(row.room)} · {row.date ? formatDate(row.date) : 'Ngày không hợp lệ'} ·{' '}
              {row.price !== null
                ? formatMoney(row.price, row.currency || summary.currency)
                : 'Giá không hợp lệ'}
              {row.currency !== summary.currency
                ? ` (${row.currency ?? 'tiền tệ không hợp lệ'})`
                : ''}
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}

function isValidISODate(value) {
  return Number.isFinite(parseIsoDate(value))
}
const INVALID_DATE = '.date-input-control [aria-invalid="true"]'

// intent="walk-in" (diagram empty-room Check-in) only creates a CONFIRMED
// booking; check-in stays a separate explicit action in the booking details.
export default function BookingModal({
  onClose,
  onCreated,
  initialRooms = [],
  initialCheckIn,
  initialCheckOut,
  intent = 'reservation',
}) {
  useI18n()
  const {
    available,
    createBooking,
    roomTypes,
    settings,
    bookingSources,
    allowAction,
    quote,
    getAvailability,
  } = usePms()
  const currency = settings.currency
  const initCheckIn = isValidISODate(initialCheckIn) ? initialCheckIn : today(settings.timezone)
  const initCheckOut =
    isValidISODate(initialCheckOut) && nights(initCheckIn, initialCheckOut) > 0
      ? initialCheckOut
      : addDays(initCheckIn, 1)
  const initRooms = Array.isArray(initialRooms) ? initialRooms.map(String) : []
  const [form, setForm] = useState({
    guest: '',
    phone: '',
    source: bookingSources.find((s) => s.active !== false)?.name || '',
    checkIn: initCheckIn,
    checkOut: initCheckOut,
    checkInTime: settings.checkInTime,
    checkOutTime: settings.checkOutTime,
    room: '',
    rooms: initRooms,
    guests: [],
    typeId: '',
  })
  const bodyRef = useRef(null)
  const initialForm = useRef(form)
  const formRef = useRef(form)
  const baseline = useRef(JSON.stringify(form))
  const writeInFlight = useRef(false)
  const mounted = useRef(true)
  const availabilityRequest = useRef(0)
  const draftGroup = useId()
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  // Quote errors are tracked separately so a later successful quote can never
  // hide a blocking availability/create error that resolved earlier.
  const [quoteError, setQuoteError] = useState('')
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [quoted, setQuoted] = useState(null)
  const [quoting, setQuoting] = useState(false)
  const [inventory, setInventory] = useState([])
  const busy = checking || saving
  const walkIn = intent === 'walk-in'
  const autoCheck = walkIn && initRooms.length > 0
  const { requestLeave } = useDraftGuard({
    dirty: () =>
      JSON.stringify(formRef.current) !== baseline.current ||
      Boolean(bodyRef.current?.querySelector('[aria-invalid="true"]')),
    pending: () => writeInFlight.current,
    group: draftGroup,
    onDiscard: () => {
      formRef.current = initialForm.current
      setForm(initialForm.current)
      availabilityRequest.current += 1
      setChecking(false)
      setInventory([])
      setSearched(false)
      setQuoted(null)
      setError('')
      setQuoteError('')
    },
  })
  const close = () => requestLeave(onClose)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      availabilityRequest.current += 1
    }
  }, [])
  const selectedKey = form.rooms.join(',')
  useEffect(() => {
    let live = true
    setQuoted(null)
    setQuoteError('')
    if (!form.rooms.length) {
      setQuoting(false)
      return
    }
    setQuoting(true)
    quote({ checkIn: form.checkIn, checkOut: form.checkOut, rooms: form.rooms, currency })
      .then((result) => {
        if (live) setQuoted(result)
      })
      .catch((err) => {
        if (live) setQuoteError(err.message)
      })
      .finally(() => {
        if (live) setQuoting(false)
      })
    return () => {
      live = false
    }
  }, [selectedKey, form.checkIn, form.checkOut, currency])
  function changeForm(change) {
    if (writeInFlight.current) return
    const next = change(formRef.current)
    formRef.current = next
    setForm(next)
  }
  function update(key, value) {
    const resetsAvailability = ['checkIn', 'checkOut', 'typeId'].includes(key)
    // Keep selected rooms across date/type change — prune happens after re-check
    changeForm((f) => ({ ...f, [key]: value }))
    if (resetsAvailability) {
      availabilityRequest.current += 1
      setChecking(false)
      setInventory([])
      setSearched(false)
      // The quote depends on rooms/dates/currency only. A type-filter change keeps
      // the quote; availability is still rechecked (and rooms pruned) before create.
      if (key !== 'typeId') setQuoted(null)
    }
    setError('')
  }
  const choices = available(form.checkIn, form.checkOut, form.typeId).filter(
    (r) =>
      !inventory.some((row) => row.roomTypeId === r.typeId && (row.stopSell || row.available <= 0)),
  )
  const selected = choices.find((r) => form.rooms.includes(String(r.id)))
  const total = quoted?.total || 0
  const money = (value) => formatMoney(value, quoted?.currency || currency)
  // Display-only grouping of the latest quote; the footer total stays quoted.total.
  const quoteSummary = quoted ? summarizeQuote(quoted, currency) : null
  function toggleRoom(number) {
    setQuoted(null)
    changeForm((f) => ({
      ...f,
      rooms: f.rooms.includes(number) ? f.rooms.filter((n) => n !== number) : [...f.rooms, number],
    }))
  }
  async function check() {
    if (writeInFlight.current) return
    const invalidDate = bodyRef.current?.querySelector(INVALID_DATE)
    if (invalidDate) {
      invalidDate.reportValidity()
      return
    }
    const current = formRef.current
    if (!current.checkIn || !current.checkOut || nights(current.checkIn, current.checkOut) <= 0) {
      setError('Ngày trả phòng phải sau ngày nhận phòng.')
      return
    }
    const request = ++availabilityRequest.current
    // A new read supersedes the previous result: if it fails, nothing can be
    // created from the earlier successful check.
    setSearched(false)
    setInventory([])
    setChecking(true)
    try {
      const result = await getAvailability(current.checkIn, current.checkOut, current.typeId)
      if (!mounted.current || availabilityRequest.current !== request) return
      const newInventory = result.availability || []
      setInventory(newInventory)
      setSearched(true)
      // Prune selected rooms no longer available (physical or inventory stopSell/available<=0)
      const newChoices = available(current.checkIn, current.checkOut, current.typeId).filter(
        (r) =>
          !newInventory.some(
            (row) => row.roomTypeId === r.typeId && (row.stopSell || row.available <= 0),
          ),
      )
      const currentRooms = formRef.current.rooms
      const prunedRooms = currentRooms.filter(
        (id) => !newChoices.some((r) => String(r.id) === String(id)),
      )
      if (prunedRooms.length > 0) {
        changeForm((f) => ({
          ...f,
          rooms: f.rooms.filter((id) => !prunedRooms.some((p) => String(p) === String(id))),
        }))
        setError(
          `Phòng ${prunedRooms.join(', ')} không còn trống trong khoảng ngày này và đã được xóa khỏi danh sách đã chọn.`,
        )
      } else {
        setError('')
      }
    } catch (err) {
      if (mounted.current && availabilityRequest.current === request) setError(err.message)
    } finally {
      if (mounted.current && availabilityRequest.current === request) setChecking(false)
    }
  }
  // Walk-in only: run the same availability READ once per valid criteria
  // (preselected room + valid dates/type). Retries stay manual; a failed read
  // is not repeated automatically because these dependencies do not change.
  // The latest check() is read through a ref (updated after every render, before
  // the auto-check effect) so the effect only re-runs when its criteria change.
  const checkRef = useRef(check)
  useEffect(() => {
    checkRef.current = check
  })
  useEffect(() => {
    if (!autoCheck || writeInFlight.current) return
    if (
      !isValidISODate(form.checkIn) ||
      !isValidISODate(form.checkOut) ||
      !(nights(form.checkIn, form.checkOut) > 0)
    )
      return
    if (bodyRef.current?.querySelector(INVALID_DATE)) return
    checkRef.current()
  }, [autoCheck, form.checkIn, form.checkOut, form.typeId])
  async function submit(targetTab = 'details') {
    if (
      writeInFlight.current ||
      checking ||
      quoting ||
      !quoted ||
      !searched ||
      !selected ||
      !allowAction('reservations.write', 'RESERVATION_CREATE')
    )
      return
    const invalidDate = bodyRef.current?.querySelector(INVALID_DATE)
    if (invalidDate) {
      invalidDate.reportValidity()
      return
    }
    if (
      [...bodyRef.current.querySelectorAll('input,select,textarea')].some(
        (field) => !field.reportValidity(),
      )
    )
      return
    const current = formRef.current
    // Every selected room must still be offered by the latest availability check.
    if (
      !current.rooms.length ||
      current.rooms.some((id) => !choices.some((r) => String(r.id) === String(id)))
    ) {
      setSearched(false)
      setError('Phòng đã chọn không còn hợp lệ. Vui lòng kiểm tra lại phòng trống.')
      return
    }
    writeInFlight.current = true
    setSaving(true)
    setError('')
    try {
      const created = await createBooking({
        ...current,
        currency,
        rooms: current.rooms,
        guests: [{ name: current.guest, phone: current.phone }, ...current.guests].map(
          bookingGuestInput,
        ),
      })
      // Clear dirty+pending BEFORE invoking callback so guard sees no blockers
      baseline.current = JSON.stringify(current)
      writeInFlight.current = false
      if (mounted.current) {
        if (onCreated) onCreated(created, targetTab)
        else onClose()
      }
    } catch (err) {
      if (mounted.current) setError(err.message)
    } finally {
      writeInFlight.current = false
      if (mounted.current) setSaving(false)
    }
  }
  return (
    <LegacyOverlay
      modal
      title={walkIn ? 'Khách vãng lai · Tạo đặt phòng' : labelUi('Tạo đặt phòng mới')}
      onClose={close}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'flex-end',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Slide-over Panel (Originality Strategy: Instead of Center Modal) */}
      <div
        className="booking-create-panel"
        style={{
          backgroundColor: '#fff',
          width: '600px',
          maxWidth: '100vw',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 15px rgba(0,0,0,0.1)',
          animation: 'slideIn 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div
          className="booking-create-header"
          style={{ borderBottom: '1px solid #dee2e6', backgroundColor: '#f8f9fa' }}
        >
          {walkIn ? (
            <div className="booking-create-walk-in">
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: '#212529',
                  margin: '0 0 6px 0',
                }}
              >
                Khách vãng lai · Tạo đặt phòng
              </h2>
              <ol
                className="booking-create-steps"
                aria-label="Các bước nhận khách vãng lai"
                style={{
                  listStyle: 'none',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '6px',
                  margin: '0 0 4px 0',
                  padding: 0,
                  fontSize: '13px',
                }}
              >
                <li aria-current="step" style={{ fontWeight: 'bold', color: '#0c7cd5' }}>
                  1. Tạo đặt phòng
                </li>
                <li aria-hidden="true" style={{ color: '#6c757d' }}>
                  →
                </li>
                <li style={{ color: '#495057' }}>2. Nhận phòng (Check-in) riêng</li>
              </ol>
              <p style={{ margin: 0, fontSize: '13px', color: '#6c757d' }}>
                Phòng chưa được nhận khi tạo đặt phòng. Sau khi tạo, bấm Nhận phòng trong chi tiết
                đặt phòng.
              </p>
            </div>
          ) : (
            <div>
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: '#212529',
                  margin: '0 0 4px 0',
                }}
              >
                {labelUi('Tạo Đặt phòng mới')}
              </h2>
              <p style={{ margin: 0, fontSize: '13px', color: '#6c757d' }}>
                {labelUi('Nhập thông tin để tìm và giữ phòng cho khách.')}
              </p>
            </div>
          )}
          <button
            className="booking-create-close"
            aria-label={tUi('common.close')}
            onClick={close}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#6c757d',
              padding: '4px',
            }}
          >
            <X size={24} />
          </button>
        </div>

        {/* Scrollable Body (Originality Strategy: Seamless form instead of wizard steps) */}
        <div
          ref={bodyRef}
          className="booking-create-body"
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '32px',
          }}
        >
          <fieldset
            disabled={busy}
            style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}
          >
            {/* Section 1: Search Criteria */}
            <section>
              <h3
                style={{
                  fontSize: '15px',
                  fontWeight: 'bold',
                  color: '#0c7cd5',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  textTransform: 'uppercase',
                }}
              >
                <Search size={18} /> 1. Điều kiện tìm kiếm
              </h3>

              <div className="booking-create-grid" style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: '#495057', fontWeight: 'bold' }}>
                    {labelUi('Nguồn đặt phòng')} <span style={{ color: '#dc3545' }}>*</span>
                  </label>
                  <select
                    aria-label={labelUi('Nguồn đặt phòng')}
                    value={form.source}
                    onChange={(e) => update('source', e.target.value)}
                    style={inputStyle}
                  >
                    {bookingSources
                      .filter((s) => s.active !== false)
                      .map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: '#495057', fontWeight: 'bold' }}>
                    {labelUi('Loại phòng mong muốn')}
                  </label>
                  <select
                    aria-label={labelUi('Loại phòng mong muốn')}
                    value={form.typeId}
                    onChange={(e) => update('typeId', e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">{tUi('common.allRoomTypes')}</option>
                    {roomTypes
                      .filter((t) => t.active !== false)
                      .map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="booking-create-grid" style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: '#495057', fontWeight: 'bold' }}>
                    {labelUi('Ngày & Giờ Nhận (Check-in)')}
                  </label>
                  <div className="booking-create-date-pair">
                    <DateInput
                      aria-label={labelUi('Ngày nhận phòng')}
                      required
                      value={form.checkIn}
                      onChange={(value) => update('checkIn', value)}
                      style={inputStyle}
                    />
                    <input
                      disabled
                      title={labelUi('Giờ theo cấu hình khách sạn')}
                      aria-label={labelUi('Giờ nhận phòng')}
                      type="text"
                      value={form.checkInTime}
                      onChange={(e) => update('checkInTime', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', color: '#495057', fontWeight: 'bold' }}>
                    {labelUi('Ngày & Giờ Trả (Check-out)')}
                  </label>
                  <div className="booking-create-date-pair">
                    <DateInput
                      aria-label={labelUi('Ngày trả phòng')}
                      required
                      min={form.checkIn}
                      value={form.checkOut}
                      onChange={(value) => update('checkOut', value)}
                      style={inputStyle}
                    />
                    <input
                      disabled
                      title={labelUi('Giờ theo cấu hình khách sạn')}
                      aria-label={labelUi('Giờ trả phòng')}
                      type="text"
                      value={form.checkOutTime}
                      onChange={(e) => update('checkOutTime', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>
              </div>

              <button
                disabled={busy}
                onClick={check}
                style={{
                  width: '100%',
                  backgroundColor: '#f8f9fa',
                  color: '#0c7cd5',
                  border: '1px solid #0c7cd5',
                  borderRadius: '6px',
                  padding: '10px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                Kiểm tra phòng trống
              </button>
            </section>

            <hr style={{ border: 'none', borderTop: '1px dashed #dee2e6' }} />

            {/* Section 2: Available Rooms */}
            <section>
              <h3
                style={{
                  fontSize: '15px',
                  fontWeight: 'bold',
                  color: '#0c7cd5',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  textTransform: 'uppercase',
                }}
              >
                <Calendar size={18} /> 2. Danh sách phòng trống
              </h3>

              {checking && (
                <p
                  role="status"
                  className="booking-create-checking"
                  style={{ color: '#6c757d', fontSize: '14px' }}
                >
                  Đang kiểm tra phòng trống…
                </p>
              )}
              {!searched && !checking && (
                <p style={{ color: '#6c757d', fontSize: '14px' }}>
                  {labelUi('Chọn ngày và bấm Kiểm tra phòng trống.')}
                </p>
              )}
              {searched && !choices.length && (
                <p role="status" style={{ color: '#dc3545' }}>
                  {labelUi('Không còn phòng phù hợp. Vui lòng chọn ngày hoặc loại phòng khác.')}
                </p>
              )}
              {searched &&
                roomTypes
                  .filter((t) => t.active !== false && choices.some((r) => r.typeId === t.id))
                  .map((t) => (
                    <div
                      key={t.id}
                      className="booking-create-room-card"
                      style={{
                        border: '1px solid #dee2e6',
                        borderRadius: '8px',
                        padding: '16px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '12px',
                        transition: 'border-color 0.2s',
                      }}
                    >
                      <div>
                        <h4
                          style={{
                            fontSize: '15px',
                            fontWeight: 'bold',
                            color: '#212529',
                            margin: '0 0 4px 0',
                          }}
                        >
                          {t.name}
                        </h4>
                        <p style={{ margin: 0, fontSize: '13px', color: '#6c757d' }}>
                          Sức chứa: {t.capacity} khách • {nights(form.checkIn, form.checkOut)} đêm
                        </p>
                      </div>
                      <div
                        className="booking-create-room-choices"
                        style={{ display: 'flex', alignItems: 'center', gap: '16px' }}
                      >
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#dc3545' }}>
                            {formatMoney(t.price, settings.currency)}
                          </div>
                          <div style={{ fontSize: '12px', color: '#6c757d' }}>
                            Giá niêm yết · Còn {choices.filter((r) => r.typeId === t.id).length}{' '}
                            {tUi('common.roomsLower')}
                          </div>
                        </div>
                        <div
                          className="booking-create-room-options"
                          style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
                        >
                          {choices
                            .filter((r) => r.typeId === t.id)
                            .map((r) => (
                              <label
                                key={r.id}
                                style={{
                                  color: '#28a745',
                                  border: '1px solid #28a745',
                                  borderRadius: 6,
                                  padding: 8,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={form.rooms.includes(String(r.id))}
                                  onChange={() => toggleRoom(String(r.id))}
                                />{' '}
                                {tUi('common.room')} {r.id}
                              </label>
                            ))}
                        </div>
                      </div>
                    </div>
                  ))}
              <div className="booking-create-grid">
                <label style={{ fontSize: 13 }}>
                  {labelUi('Tiền đặt phòng')}
                  <input
                    aria-label={labelUi('Tiền đặt phòng')}
                    readOnly
                    style={{ ...inputStyle, width: '100%', marginTop: 6, boxSizing: 'border-box' }}
                    value={currency}
                  />
                </label>
              </div>
              {quoting && <p role="status">{labelUi('Đang lấy báo giá từng đêm…')}</p>}
              {quoteSummary && <QuoteSummary summary={quoteSummary} />}
            </section>

            <hr style={{ border: 'none', borderTop: '1px dashed #dee2e6' }} />

            {/* Section 3: Guest Info */}
            <section style={{ opacity: selected ? 1 : 0.5 }}>
              <h3
                style={{
                  fontSize: '15px',
                  fontWeight: 'bold',
                  color: '#6c757d',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  textTransform: 'uppercase',
                }}
              >
                <User size={18} /> 3. Thông tin Khách hàng (Vui lòng chọn phòng trước)
              </h3>
              <div className="booking-create-grid">
                <input
                  aria-label={labelUi('Họ và tên khách')}
                  type="text"
                  required
                  pattern=".*\S.*"
                  maxLength={160}
                  placeholder={labelUi('Họ và tên khách')}
                  style={inputStyle}
                  disabled={!selected}
                  value={form.guest}
                  onChange={(e) => update('guest', e.target.value)}
                />
                <input
                  aria-label={tUi('common.phone')}
                  type="tel"
                  pattern={phonePattern}
                  maxLength={40}
                  placeholder={tUi('common.phone')}
                  style={inputStyle}
                  disabled={!selected}
                  value={form.phone}
                  onChange={(e) => {
                    if (!/[^0-9+ .()-]/.test(e.target.value)) update('phone', e.target.value)
                  }}
                />
              </div>
              {form.guests.map((guest, index) => (
                <div key={index} className="booking-create-guest">
                  <input
                    required
                    pattern=".*\S.*"
                    maxLength={160}
                    aria-label={'Khách bổ sung ' + (index + 1)}
                    placeholder={labelUi('Tên khách bổ sung')}
                    style={inputStyle}
                    value={guest.name}
                    onChange={(e) =>
                      changeForm((f) => ({
                        ...f,
                        guests: f.guests.map((g, i) =>
                          i === index ? { ...g, name: e.target.value } : g,
                        ),
                      }))
                    }
                  />
                  <input
                    aria-label={'Điện thoại khách ' + (index + 1)}
                    type="tel"
                    pattern={phonePattern}
                    maxLength={40}
                    style={inputStyle}
                    placeholder={labelUi('Điện thoại')}
                    value={guest.phone}
                    onChange={(e) => {
                      if (!/[^0-9+ .()-]/.test(e.target.value))
                        changeForm((f) => ({
                          ...f,
                          guests: f.guests.map((g, i) =>
                            i === index ? { ...g, phone: e.target.value } : g,
                          ),
                        }))
                    }}
                  />
                  <button
                    onClick={() =>
                      changeForm((f) => ({ ...f, guests: f.guests.filter((_, i) => i !== index) }))
                    }
                  >
                    {labelUi('Xóa')}
                  </button>
                </div>
              ))}
              <button
                disabled={!selected}
                style={{ ...inputStyle, marginTop: 12 }}
                onClick={() =>
                  changeForm((f) => ({ ...f, guests: [...f.guests, { name: '', phone: '' }] }))
                }
              >
                {labelUi('+ Thêm khách lưu trú')}
              </button>
            </section>
          </fieldset>
        </div>

        {(error || quoteError) && (
          <p
            className="booking-create-error"
            role="alert"
            style={{ padding: '12px 24px', color: '#dc3545' }}
          >
            {[error, quoteError].filter(Boolean).join(' ')}
          </p>
        )}
        {/* Footer (Fixed at bottom) */}
        <div
          className="booking-create-footer"
          style={{
            borderTop: '1px solid #dee2e6',
            backgroundColor: '#f8f9fa',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '14px', color: '#495057' }}>
            Tổng cộng:{' '}
            <strong style={{ fontSize: '18px', color: '#212529' }}>{money(total)}</strong>
          </div>
          <div className="booking-create-footer-actions">
            <button
              onClick={close}
              style={{
                backgroundColor: '#fff',
                color: '#495057',
                border: '1px solid #dee2e6',
                borderRadius: '6px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              {tUi('common.cancel')}
            </button>
            <button
              disabled={busy || quoting || !quoted || !selected || !searched}
              onClick={() => submit('payments')}
              style={{
                backgroundColor: '#6c757d',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <CheckCircle2 size={18} /> Tạo và thu cọc
            </button>
            <button
              disabled={busy || quoting || !quoted || !selected || !searched}
              onClick={() => submit()}
              style={{
                backgroundColor: '#0c7cd5',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 24px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <CheckCircle2 size={18} /> {walkIn ? 'Bước 1: Tạo đặt phòng' : 'Tạo Đặt phòng'}
            </button>
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `,
        }}
      />
    </LegacyOverlay>
  )
}

const inputStyle = {
  padding: '10px 12px',
  border: '1px solid #ced4da',
  borderRadius: '6px',
  backgroundColor: '#fff',
  color: '#212529',
}
