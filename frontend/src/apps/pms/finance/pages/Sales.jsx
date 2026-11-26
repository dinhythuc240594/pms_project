import { decimalInput } from '../../../../shared/lib/number.js'
import { formatDateTime } from '../../../../shared/lib/date.js'
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDraftGuard } from '../../../../shared/drafts/DraftGuardProvider.jsx'
import { usePms } from '../../data/usePms'
import { bookingRooms, money, statusLabels } from '../../data/model'
import { timestamp } from '../../data/presentation'
import '../../components/DomainForms.css'
import './Sales.css'

const labels = { DRAFT: 'Bản nháp', POSTED: 'Đã ghi nhận', CANCELLED: 'Đã hủy' }
const SERVICE_PAGE_SIZE = 24
const BOOKING_OPTION_LIMIT = 50
// Full identity so duplicate guest names stay distinguishable; dates are the API's ISO values.
const bookingLabel = (row) =>
  [
    row.guest,
    bookingRooms(row).join(', '),
    row.checkIn || row.checkOut ? `${row.checkIn || '?'}→${row.checkOut || '?'}` : '',
    statusLabels[row.status] || row.status,
    row.currency,
    row.id,
  ]
    .filter(Boolean)
    .join(' · ')
// Accent-insensitive matching: "ca phe" finds "Cà phê", "do" finds "Đồ".
const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()
// Only the persisted draft fields; descriptions and React keys are presentation.
const draftKey = (form) =>
  JSON.stringify([
    form.customerName,
    form.note,
    form.items.map(({ serviceId, quantity, unitPrice }) => [
      serviceId,
      String(quantity ?? ''),
      String(unitPrice ?? ''),
    ]),
  ])
const copyForm = (form) => ({
  customerName: form.customerName,
  note: form.note,
  items: form.items.map((item) => ({ ...item })),
})
const blankForm = () => ({ customerName: '', note: '', items: [] })
const moneyLimit = 9999999999999999999n
const units = (text) => {
  const [whole, fraction = ''] = text.split('.')
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))
}
const decimal = (value) => `${value / 10000n}.${String(value % 10000n).padStart(4, '0')}`
function previewAmounts(items) {
  let total = 0n
  const lines = items.map((row) => {
    try {
      const quantity = units(decimalInput(row.quantity, { min: '0.0001', max: '99999999.9999' }))
      const price = units(decimalInput(row.unitPrice))
      const product = quantity * price
      // The server rejects overprecise products rather than rounding them.
      if (product % 10000n) throw new Error('Thành tiền cần tối đa 4 chữ số thập phân.')
      const amount = product / 10000n
      if (amount > moneyLimit) throw new Error('Thành tiền vượt giới hạn cho phép.')
      total += amount
      return { amount: decimal(amount) }
    } catch (error) {
      return { error: error.message }
    }
  })
  const error =
    lines.find((line) => line.error)?.error ||
    (total > moneyLimit ? 'Tổng hóa đơn vượt giới hạn cho phép.' : '')
  return { lines, total: error ? null : decimal(total), error }
}
export default function Sales() {
  useI18n()
  const p = usePms(),
    [selected, setSelected] = useState(null),
    [editing, setEditing] = useState(false)
  const [form, setForm] = useState(blankForm),
    [query, setQuery] = useState('')
  // Last loaded or successfully saved values. bookingId is tracked separately
  // because saving a draft does not persist the booking choice.
  const [baseline, setBaseline] = useState(() => ({ form: blankForm(), bookingId: '' }))
  const [serviceQuery, setServiceQuery] = useState(''),
    [servicePage, setServicePage] = useState(1)
  const [category, setCategory] = useState(''),
    [bookingId, setBookingId] = useState('')
  // Presentation only: narrows the booking options, never part of the draft.
  const [bookingQuery, setBookingQuery] = useState('')
  const [payment, setPayment] = useState({ amount: '', methodId: '', fundId: '' })
  const [refund, setRefund] = useState({ paymentId: '', amount: '', reason: '' }),
    [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [posting, setPosting] = useState(null),
    inFlight = useRef(false),
    summaryRef = useRef(null)
  // Jump from anywhere in the catalog to the cart total, booking choice and actions.
  // Focus/scroll only: no navigation, no save or post.
  function showSummary() {
    const node = summaryRef.current
    if (!node) return
    node.focus({ preventScroll: true })
    node.scrollIntoView?.({ block: 'center' })
  }
  const [invoice, setInvoice] = useState(null),
    [listing, setListing] = useState({ posInvoices: [], pagination: { totalItems: 0 } })
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [listVersion, setListVersion] = useState(0)
  // List read state is separate from action errors: a failed read never looks like an empty result.
  const [listState, setListState] = useState('loading'),
    [listError, setListError] = useState('')
  const listLoading = listState === 'loading'
  const draft = !invoice || invoice.status === 'DRAFT'
  const preview = previewAmounts(form.items)
  const draftDirty =
    editing &&
    draft &&
    (draftKey(form) !== draftKey(baseline.form) || bookingId !== baseline.bookingId)
  // An unconfirmed post keeps its retry context until it succeeds or is discarded.
  const dirty = Boolean(
    draftDirty ||
    (editing && posting) ||
    (invoice?.status === 'POSTED' && invoice.bookingId && reason),
  )
  const { requestLeave } = useDraftGuard({
    dirty,
    pending: () => inFlight.current,
    onDiscard: () => {
      setReason('')
      setPosting(null)
      setForm(copyForm(baseline.form))
      setBookingId(baseline.bookingId)
    },
  })
  const activeServices = p.services.filter(
    (row) => row.active !== false && (!category || row.category === category),
  )
  const serviceNeedle = fold(serviceQuery)
  const matchedServices = serviceNeedle
    ? activeServices.filter((row) =>
        [row.name, row.code, row.sku].some((value) => fold(value).includes(serviceNeedle)),
      )
    : activeServices
  const servicePages = Math.max(1, Math.ceil(matchedServices.length / SERVICE_PAGE_SIZE))
  const currentServicePage = Math.min(Math.max(1, servicePage), servicePages)
  const visibleServices = matchedServices.slice(
    (currentServicePage - 1) * SERVICE_PAGE_SIZE,
    currentServicePage * SERVICE_PAGE_SIZE,
  )
  // Search covers every eligible booking; only the rendered options are capped.
  const bookingCurrency = invoice?.currency || p.settings.currency
  const eligibleBookings = p.bookings.filter(
    (row) => ['CONFIRMED', 'IN_HOUSE'].includes(row.status) && row.currency === bookingCurrency,
  )
  const bookingNeedle = fold(bookingQuery)
  const bookingMatches = bookingNeedle
    ? eligibleBookings.filter((row) =>
        [row.guest, row.id, ...bookingRooms(row)].some((value) =>
          fold(value).includes(bookingNeedle),
        ),
      )
    : eligibleBookings
  const bookingStale = Boolean(bookingId) && !eligibleBookings.some((row) => row.id === bookingId)
  // A stale choice keeps its option (and value) so it is never cleared silently.
  const chosenBooking = bookingId
    ? eligibleBookings.find((row) => row.id === bookingId) ||
      p.bookings.find((row) => row.id === bookingId) || { id: bookingId }
    : null
  const shownBookings = bookingMatches.slice(0, BOOKING_OPTION_LIMIT)
  if (chosenBooking && !shownBookings.some((row) => row.id === bookingId))
    shownBookings.push(chosenBooking)
  const bookingStatus = !bookingNeedle
    ? eligibleBookings.length > BOOKING_OPTION_LIMIT
      ? `Hiển thị ${BOOKING_OPTION_LIMIT}/${eligibleBookings.length} booking, nhập để tìm thêm.`
      : ''
    : !bookingMatches.length
      ? labelUi('Không có booking phù hợp.')
      : bookingMatches.length > BOOKING_OPTION_LIMIT
        ? `${bookingMatches.length} booking phù hợp, hiển thị ${BOOKING_OPTION_LIMIT} đầu tiên.`
        : `${bookingMatches.length} booking phù hợp.`
  useEffect(() => {
    if (editing) return
    let current = true
    setListState('loading')
    setListError('')
    setError('')
    p.getPosInvoices({ q: search, page, pageSize: 25 })
      .then((result) => {
        if (current) {
          setListing(result)
          setListState('ready')
        }
      })
      .catch((e) => {
        if (current) {
          setListError(e.message)
          setListState('error')
        }
      })
    return () => {
      current = false
    }
  }, [editing, search, page, listVersion, p.tenantId, p.workspaceRevision])
  const fmt = (value) => money(value, invoice?.currency || p.settings.currency)
  async function run(fn) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  function open(row) {
    setInvoice(row || null)
    setSelected(row?.id || null)
    setEditing(true)
    setReason('')
    setError('')
    setPosting(null)
    setBookingId(row?.bookingId || '')
    const loaded = {
      customerName: row?.customerName || '',
      note: row?.note || '',
      items: (row?.items || []).map((item) => ({ ...item })),
    }
    setForm(loaded)
    setBaseline({ form: copyForm(loaded), bookingId: row?.bookingId || '' })
    setServiceQuery('')
    setServicePage(1)
    setBookingQuery('')
    setPayment({ amount: row?.balance || '', methodId: '', fundId: '' })
    setRefund({ paymentId: '', amount: '', reason: '' })
  }
  const change = (i, key, value) =>
    setForm((old) => ({
      ...old,
      items: old.items.map((row, index) => (i === index ? { ...row, [key]: value } : row)),
    }))
  async function save() {
    if (preview.error) throw new Error(preview.error)
    const sent = copyForm(form)
    const result = await p.savePosInvoice({
      ...(selected ? { id: selected } : {}),
      customerName: form.customerName,
      note: form.note,
      items: form.items.map(({ serviceId, quantity, unitPrice }) => ({
        serviceId,
        quantity: decimalInput(quantity, { min: '0.0001', max: '99999999.9999' }),
        unitPrice: decimalInput(unitPrice),
      })),
    })
    // Only the persisted fields become clean; an unposted booking choice stays dirty.
    setSelected(result.id)
    setInvoice(result)
    setBaseline((old) => ({ ...old, form: sent }))
    return result
  }
  // A new post refuses a booking that is no longer eligible; an uncertain post keeps retrying its original target/body.
  async function post() {
    let target = posting
    if (!target) {
      if (bookingStale)
        throw new Error(
          'Booking đã chọn không còn hợp lệ để ghi chi phí. Chọn booking khác hoặc khách lẻ rồi ghi nhận lại.',
        )
      const saved = await save()
      target = { id: saved.id, body: bookingId ? { bookingId } : {} }
      setPosting(target)
    }
    const result = await p.postPosInvoice(target.id, target.body)
    setInvoice(result)
    setPosting(null)
    setBaseline({ form: copyForm(form), bookingId: target.body.bookingId || '' })
    setBookingId(target.body.bookingId || '')
    setPayment((old) => ({ ...old, amount: result.balance }))
  }
  return (
    <div className="pms-domain-page">
      <div className="domain-toolbar domain-toolbar--actions">
        {editing ? (
          <button
            disabled={busy}
            onClick={() =>
              requestLeave(() => {
                setReason('')
                setEditing(false)
              })
            }
          >
            {labelUi('← Danh sách hóa đơn')}
          </button>
        ) : (
          <button
            className="primary"
            disabled={busy || !p.access('pos.write').allowed}
            onClick={() => open(null)}
          >
            {labelUi('+ Thêm mới')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="domain-error">
          {error}
        </p>
      )}
      {!editing ? (
        <div className="domain-panel">
          <form
            className="domain-toolbar"
            onSubmit={(e) => {
              e.preventDefault()
              setSearch(query.trim())
              setPage(1)
              setListVersion((v) => v + 1)
            }}
          >
            <label>
              {labelUi('Tìm hóa đơn')}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Mã, tên khách, ghi chú"
              />
            </label>
            <button disabled={listLoading}>{labelUi('Tìm / tải lại')}</button>
          </form>
          {listState === 'error' ? (
            <div className="pos-list-error">
              <p role="alert" className="domain-error">
                {labelUi('Không tải được danh sách hóa đơn.')} {listError}
              </p>
              <button type="button" onClick={() => setListVersion((v) => v + 1)}>
                {labelUi('Thử lại')}
              </button>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{tUi('common.date')}</th>
                  <th>{tUi('common.code')}</th>
                  <th>{labelUi('Tên khách')}</th>
                  <th>{tUi('common.status')}</th>
                  <th>{labelUi('Tổng tiền')}</th>
                  <th>{labelUi('Đã thu')}</th>
                  <th>{labelUi('Còn lại')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listState === 'ready' &&
                  listing.posInvoices.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.createdAt, p.settings.timezone).slice(0, 10)}</td>
                      <td>{row.id.slice(0, 12)}</td>
                      <td>{row.customerName || labelUi('Khách lẻ')}</td>
                      <td>{labels[row.status]}</td>
                      <td>{money(row.total, row.currency)}</td>
                      <td>{money(row.paid, row.currency)}</td>
                      <td>
                        {row.bookingId
                          ? labelUi('Ghi vào booking')
                          : money(row.balance, row.currency)}
                      </td>
                      <td>
                        <button
                          disabled={busy}
                          onClick={() => run(async () => open(await p.getPosInvoice(row.id)))}
                        >
                          {tUi('common.details')}
                        </button>
                      </td>
                    </tr>
                  ))}
                {listLoading ? (
                  <tr>
                    <td colSpan={8}>
                      <span role="status">{labelUi('Đang tải hóa đơn…')}</span>
                    </td>
                  </tr>
                ) : (
                  !listing.posInvoices.length && (
                    <tr>
                      <td colSpan={8}>{labelUi('Không có hóa đơn phù hợp.')}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
          <div className="domain-toolbar" style={{ marginTop: 16 }}>
            <span>
              {labelUi('Trang')} {page}
              {listState === 'ready' && <> · {listing.pagination.totalItems} hóa đơn</>}
            </span>
            <div>
              <button disabled={listLoading || page === 1} onClick={() => setPage((v) => v - 1)}>
                {labelUi('Trang trước')}
              </button>
              <button
                disabled={listState !== 'ready' || page * 25 >= listing.pagination.totalItems}
                onClick={() => setPage((v) => v + 1)}
              >
                {labelUi('Trang sau')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={'domain-grid pos-workspace' + (draft ? ' pos-has-catalog' : '')}>
          <div className="domain-panel pos-invoice">
            <h2>Hóa đơn dịch vụ · {labels[invoice?.status] || labelUi('Bản nháp mới')}</h2>
            <fieldset
              disabled={busy || Boolean(posting) || !draft || !p.access('pos.write').allowed}
              style={{ border: 0, padding: 0, minWidth: 0 }}
            >
              <div className="domain-fields">
                <label>
                  {labelUi('Tên khách')}
                  <input
                    maxLength={160}
                    value={form.customerName}
                    onChange={(e) => setForm((old) => ({ ...old, customerName: e.target.value }))}
                  />
                </label>
                <label>
                  {tUi('common.notes')}
                  <input
                    maxLength={500}
                    value={form.note}
                    onChange={(e) => setForm((old) => ({ ...old, note: e.target.value }))}
                  />
                </label>
              </div>
              <div
                role="region"
                aria-label="Dòng hóa đơn dịch vụ"
                tabIndex={0}
                style={{ overflowX: 'auto' }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>{tUi('rooms.services')}</th>
                      <th>{labelUi('Số lượng')}</th>
                      <th>{labelUi('Đơn giá')}</th>
                      <th>{labelUi('Thành tiền')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((row, i) => (
                      <tr key={i}>
                        <td>{row.description}</td>
                        <td>
                          <input
                            aria-label={'Số lượng ' + row.description}
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9]{1,15}([.][0-9]{1,4})?"
                            maxLength={20}
                            min="0.0001"
                            step="0.0001"
                            value={row.quantity}
                            onChange={(e) => change(i, 'quantity', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={'Đơn giá ' + row.description}
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9]{1,15}([.][0-9]{1,4})?"
                            maxLength={20}
                            min="0"
                            step="0.0001"
                            value={row.unitPrice}
                            onChange={(e) => change(i, 'unitPrice', e.target.value)}
                          />
                        </td>
                        <td className="pos-line-amount">
                          {preview.lines[i]?.amount == null ? '—' : fmt(preview.lines[i].amount)}
                        </td>
                        <td>
                          <button
                            onClick={() =>
                              setForm((old) => ({
                                ...old,
                                items: old.items.filter((_, index) => index !== i),
                              }))
                            }
                          >
                            {labelUi('Bỏ')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {draft && (
                <div
                  ref={summaryRef}
                  tabIndex={-1}
                  role="group"
                  aria-label={labelUi('Tổng và thao tác hóa đơn')}
                  className="pos-draft-summary"
                >
                  <p className="pos-draft-total">
                    {labelUi('Tổng dự kiến:')}{' '}
                    <strong>{preview.total == null ? '—' : fmt(preview.total)}</strong>
                  </p>
                  {preview.error && (
                    <p role="alert" className="domain-error">
                      {preview.error}
                    </p>
                  )}
                  <label className="pos-booking-field" style={{ marginTop: 16 }}>
                    {labelUi('Tìm booking')}
                    <input
                      type="search"
                      maxLength={160}
                      value={bookingQuery}
                      placeholder="Tên khách, phòng hoặc mã booking"
                      onChange={(e) => setBookingQuery(e.target.value)}
                    />
                  </label>
                  {bookingStatus && (
                    <p role="status" className="pos-booking-status">
                      {bookingStatus}
                    </p>
                  )}
                  <label className="pos-booking-field">
                    {labelUi('Ghi vào booking')}
                    <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
                      <option value="">{labelUi('Khách lẻ · thu tại POS')}</option>
                      {shownBookings.map((row) => (
                        <option key={row.id} value={row.id}>
                          {bookingLabel(row)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {chosenBooking && (
                    <dl className="pos-booking-preview" aria-label={labelUi('Booking đã chọn')}>
                      <dt>{labelUi('Khách')}</dt>
                      <dd>{chosenBooking.guest || '—'}</dd>
                      <dt>{labelUi('Phòng')}</dt>
                      <dd>{bookingRooms(chosenBooking).join(', ') || '—'}</dd>
                      <dt>{labelUi('Lưu trú')}</dt>
                      <dd>
                        {chosenBooking.checkIn || '?'} → {chosenBooking.checkOut || '?'}
                      </dd>
                      <dt>{labelUi('Trạng thái')}</dt>
                      <dd>{statusLabels[chosenBooking.status] || chosenBooking.status || '—'}</dd>
                      <dt>{labelUi('Tiền tệ')}</dt>
                      <dd>{chosenBooking.currency || '—'}</dd>
                      <dt>{labelUi('Mã booking')}</dt>
                      <dd>{chosenBooking.id}</dd>
                    </dl>
                  )}
                  {bookingStale && !posting && (
                    <p role="status" className="pos-booking-warning domain-error">
                      {labelUi(
                        'Booking đã chọn không còn hợp lệ (cần đã xác nhận hoặc đang ở, cùng tiền tệ hóa đơn). Chọn booking khác hoặc khách lẻ trước khi ghi nhận.',
                      )}
                    </p>
                  )}
                  <div className="domain-fields" style={{ marginTop: 16 }}>
                    <button
                      disabled={!form.items.length || Boolean(preview.error)}
                      onClick={() => run(save)}
                    >
                      {labelUi('Lưu nháp')}
                    </button>
                    <button
                      className="primary"
                      disabled={!form.items.length || Boolean(preview.error)}
                      onClick={() => run(post)}
                    >
                      {labelUi('Ghi nhận hóa đơn')}
                    </button>
                  </div>
                </div>
              )}
            </fieldset>
            {posting && (
              <p role="status">
                {labelUi('Đang chờ xác nhận ghi nhận hóa đơn.')}{' '}
                <button disabled={busy} onClick={() => run(post)}>
                  {labelUi('Kiểm tra và thử lại')}
                </button>
              </p>
            )}
            {invoice && (
              <p>
                {labelUi('Tổng đã lưu:')} <strong>{fmt(invoice.total)}</strong> · Đã thu:{' '}
                {fmt(invoice.paid)} · Còn lại: {fmt(invoice.balance)}
              </p>
            )}
            {invoice?.status === 'POSTED' && invoice.bookingId && (
              <p>
                Đã ghi chi phí vào booking {invoice.bookingId}.{' '}
                <Link
                  to={
                    '/id/reservations?' +
                    new URLSearchParams({ booking: invoice.bookingId, tab: 'payments' })
                  }
                  aria-disabled={busy || undefined}
                  tabIndex={busy ? -1 : undefined}
                  onClick={(event) => {
                    if (inFlight.current) event.preventDefault()
                  }}
                >
                  Mở thanh toán booking
                </Link>
              </p>
            )}
            {invoice?.status === 'POSTED' && !invoice.bookingId && (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    run(async () => {
                      const updated = await p.payPosInvoice(invoice.id, {
                        ...payment,
                        amount: decimalInput(payment.amount, {
                          min: '0.0001',
                          max: invoice.balance,
                        }),
                      })
                      setInvoice(updated)
                      setPayment((old) => ({ ...old, amount: updated.balance }))
                    })
                  }}
                >
                  <h2>{tUi('rooms.payment')}</h2>
                  <fieldset
                    disabled={busy || !p.access('payments.write').allowed}
                    style={{ border: 0, padding: 0 }}
                  >
                    <div className="domain-fields">
                      <label>
                        {labelUi('Số tiền')}
                        <input
                          required
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9]{1,15}([.][0-9]{1,4})?"
                          maxLength={20}
                          min="0.0001"
                          step="0.0001"
                          value={payment.amount}
                          onChange={(e) =>
                            setPayment((old) => ({ ...old, amount: e.target.value }))
                          }
                        />
                      </label>
                      <label>
                        {labelUi('Phương thức')}
                        <select
                          required
                          value={payment.methodId}
                          onChange={(e) =>
                            setPayment((old) => ({ ...old, methodId: e.target.value }))
                          }
                        >
                          <option value="">{labelUi('Chọn phương thức')}</option>
                          {p.paymentMethods
                            .filter((row) => row.active !== false)
                            .map((row) => (
                              <option key={row.id} value={row.id}>
                                {row.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        {labelUi('Quỹ thu')}
                        <select
                          required
                          value={payment.fundId}
                          onChange={(e) =>
                            setPayment((old) => ({ ...old, fundId: e.target.value }))
                          }
                        >
                          <option value="">{labelUi('Chọn quỹ')}</option>
                          {p.funds
                            .filter(
                              (row) =>
                                row.active !== false &&
                                (row.currency || p.settings.currency) === invoice.currency,
                            )
                            .map((row) => (
                              <option key={row.id} value={row.id}>
                                {row.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <button className="success">{labelUi('Thu tiền')}</button>
                  </fieldset>
                </form>
                {!!invoice.payments.length && (
                  <>
                    <h2 style={{ marginTop: 24 }}>{labelUi('Các khoản thanh toán')}</h2>
                    <table>
                      <thead>
                        <tr>
                          <th>{tUi('common.date')}</th>
                          <th>{labelUi('Quỹ')}</th>
                          <th>{labelUi('Đã thu')}</th>
                          <th>{labelUi('Đã hoàn')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoice.payments.map((row) => (
                          <tr key={row.id}>
                            <td>{timestamp(row.createdAt, p.settings.timezone)}</td>
                            <td>{row.fund}</td>
                            <td>{fmt(row.amount)}</td>
                            <td>{fmt(row.refunded)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        run(async () => {
                          const updated = await p.refundPosInvoice(invoice.id, refund.paymentId, {
                            amount: decimalInput(refund.amount, { min: '0.0001' }),
                            reason: refund.reason,
                          })
                          setInvoice(updated)
                          setPayment((old) => ({ ...old, amount: updated.balance }))
                          setRefund({ paymentId: '', amount: '', reason: '' })
                        })
                      }}
                    >
                      <fieldset
                        disabled={busy || !p.access('payments.write').allowed}
                        style={{ border: 0, padding: 0 }}
                      >
                        <div className="domain-fields">
                          <label>
                            {labelUi('Khoản hoàn')}
                            <select
                              required
                              value={refund.paymentId}
                              onChange={(e) =>
                                setRefund((old) => ({ ...old, paymentId: e.target.value }))
                              }
                            >
                              <option value="">{labelUi('Chọn khoản đã thu')}</option>
                              {invoice.payments.map((row) => (
                                <option key={row.id} value={row.id}>
                                  {row.fund} · {fmt(row.amount)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            {labelUi('Số tiền hoàn')}
                            <input
                              required
                              type="text"
                              inputMode="decimal"
                              pattern="[0-9]{1,15}([.][0-9]{1,4})?"
                              maxLength={20}
                              min="0.0001"
                              step="0.0001"
                              value={refund.amount}
                              onChange={(e) =>
                                setRefund((old) => ({ ...old, amount: e.target.value }))
                              }
                            />
                          </label>
                          <label>
                            {labelUi('Lý do hoàn')}
                            <input
                              required
                              maxLength={500}
                              pattern=".*\S.*"
                              value={refund.reason}
                              onChange={(e) =>
                                setRefund((old) => ({ ...old, reason: e.target.value }))
                              }
                            />
                          </label>
                        </div>
                        <button>{labelUi('Hoàn tiền')}</button>
                      </fieldset>
                    </form>
                  </>
                )}
              </>
            )}
            {invoice && invoice.status !== 'CANCELLED' && p.access('pos.cancel').allowed && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  run(async () => setInvoice(await p.cancelPosInvoice(invoice.id, { reason })))
                }}
                style={{ marginTop: 24 }}
              >
                <div className="domain-fields">
                  <label>
                    {labelUi('Lý do hủy hóa đơn')}
                    <input
                      required
                      maxLength={500}
                      pattern=".*\S.*"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button disabled={busy}>{labelUi('Hủy và ghi giao dịch đối ứng')}</button>
                </div>
              </form>
            )}
            {invoice?.status === 'CANCELLED' && <p>Lý do hủy: {invoice.cancellationReason}</p>}
          </div>
          {draft && (
            <section className="domain-panel pos-catalog" aria-label={labelUi('Chọn dịch vụ')}>
              <div className="pos-catalog-head">
                <h2>{labelUi('Chọn dịch vụ')}</h2>
                <button type="button" onClick={showSummary}>
                  {labelUi('Xem hóa đơn')}
                </button>
              </div>
              <div className="domain-fields">
                <label>
                  {labelUi('Nhóm dịch vụ')}
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value)
                      setServicePage(1)
                    }}
                  >
                    <option value="">{tUi('rooms.all')}</option>
                    {p.serviceCategories
                      .filter((row) => row.active !== false)
                      .map((row) => (
                        <option key={row.id}>{row.name}</option>
                      ))}
                  </select>
                </label>
                <label>
                  {labelUi('Tìm dịch vụ')}
                  <input
                    type="search"
                    maxLength={160}
                    value={serviceQuery}
                    placeholder="Tên, mã hoặc SKU"
                    onChange={(e) => {
                      setServiceQuery(e.target.value)
                      setServicePage(1)
                    }}
                  />
                </label>
              </div>
              {visibleServices.length ? (
                <div className="pos-service-grid" role="group" aria-label="Danh sách dịch vụ">
                  {visibleServices.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      disabled={busy || Boolean(posting) || !p.access('pos.write').allowed}
                      onClick={() =>
                        setForm((old) => ({
                          ...old,
                          items: old.items.some((item) => item.serviceId === row.id)
                            ? old.items
                            : [
                                ...old.items,
                                {
                                  serviceId: row.id,
                                  description: row.name,
                                  quantity: '1',
                                  unitPrice: String(row.price),
                                },
                              ],
                        }))
                      }
                    >
                      {row.name}
                      <br />
                      {fmt(row.price)}
                    </button>
                  ))}
                </div>
              ) : (
                <p role="status">
                  {activeServices.length
                    ? labelUi('Không có dịch vụ phù hợp.')
                    : labelUi('Chưa có dịch vụ đang hoạt động.')}
                </p>
              )}
              {matchedServices.length > SERVICE_PAGE_SIZE && (
                <div className="domain-toolbar pos-service-pager">
                  <span>
                    Trang {currentServicePage}/{servicePages} · {matchedServices.length} dịch vụ
                  </span>
                  <div>
                    <button
                      type="button"
                      disabled={currentServicePage <= 1}
                      onClick={() => setServicePage(currentServicePage - 1)}
                    >
                      {labelUi('Trang dịch vụ trước')}
                    </button>
                    <button
                      type="button"
                      disabled={currentServicePage >= servicePages}
                      onClick={() => setServicePage(currentServicePage + 1)}
                    >
                      {labelUi('Trang dịch vụ sau')}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
