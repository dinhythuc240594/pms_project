import { formatDate, parseIsoDate } from '../../../../shared/lib/date.js'
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  workflowReturnState,
  workflowReturnTarget,
} from '../../reconciliation/workflowNavigation.js'
import {
  Search,
  Plus,
  Download,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  ClipboardList,
  AlertCircle,
} from 'lucide-react'
import { usePms } from '../../data/usePms'
import { hiddenByRole } from '../../data/roleProfiles'
import { today, nights, statusLabels, money, bookingRooms } from '../../data/model'
import BookingModal from '../components/BookingModal'
import BookingDetailPanel from '../components/BookingDetailPanel'
import DateInput from '../../../../shared/components/DateInput.jsx'
import './Reservations.css'
import { downloadCsv } from '../../../../shared/lib/csv'
import { reservationCsvHeaders, reservationCsvRows } from '../reservationsCsv.js'
import { reservationTaskMatches as TASK_MATCH } from '../reservationTasks.js'

// URL contract (all optional; absent = all bookings):
//   task=arrivals|departures|inhouse|overdue, date=YYYY-MM-DD (task day, default hotel today),
//   res_q, res_status, res_source, res_page. Generic params (booking, tab, view, page, …) are left untouched.
const TASKS = ['arrivals', 'departures', 'inhouse', 'overdue']
const DATE_TASKS = ['arrivals', 'departures', 'overdue']
const TASK_OPTIONS = [
  ['', 'Tất cả đặt phòng'],
  ['arrivals', 'Khách đến'],
  ['departures', 'Khách đi'],
  ['inhouse', 'Đang ở (hiện tại)'],
  ['overdue', 'Quá hạn trả phòng'],
]
const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
const setParam = (params, key, value) => {
  if (value) params.set(key, value)
  else params.delete(key)
}
const validDay = (value) => !value.startsWith('0000') && Number.isFinite(parseIsoDate(value))

function readFilters(params) {
  const problems = []
  const single = (key, label) => {
    const values = params.getAll(key)
    if (values.length > 1) {
      problems.push({ key, text: `${labelUi(label)}: ${labelUi('tham số bị lặp')}` })
      return ''
    }
    return values[0] ?? ''
  }
  let task = single('task', 'Danh sách công việc')
  if (task === 'all') task = ''
  if (task && !TASKS.includes(task)) {
    problems.push({
      key: 'task',
      text: `${labelUi('Danh sách công việc không hợp lệ')}: “${task}”`,
    })
    task = ''
  }
  let date = single('date', 'Ngày')
  if (date && !validDay(date)) {
    problems.push({ key: 'date', text: `${labelUi('Ngày không hợp lệ')}: “${date}” (YYYY-MM-DD)` })
    date = ''
  }
  const query = single('res_q', 'Từ khóa')
  let status = single('res_status', 'Trạng thái')
  if (status && !Object.keys(statusLabels).includes(status)) {
    problems.push({ key: 'res_status', text: `${labelUi('Trạng thái không hợp lệ')}: “${status}”` })
    status = ''
  }
  const source = single('res_source', 'Nguồn đặt')
  const pageText = single('res_page', 'Trang')
  let page = 1
  if (pageText) {
    if (/^[1-9]\d{0,5}$/.test(pageText)) page = Number(pageText)
    else problems.push({ key: 'res_page', text: `${labelUi('Trang không hợp lệ')}: “${pageText}”` })
  }
  return { task, date, query, status, source, page, problems }
}

function scopeText(task, day, isToday) {
  const when = formatDate(day) + (isToday ? ` (${labelUi('hôm nay')})` : '')
  if (task === 'arrivals')
    return `${labelUi('Khách đến')}: ${labelUi('đã xác nhận, nhận phòng ngày')} ${when}`
  if (task === 'departures')
    return `${labelUi('Khách đi')}: ${labelUi('đang ở, trả phòng ngày')} ${when}`
  if (task === 'overdue')
    return `${labelUi('Quá hạn trả phòng')}: ${labelUi('đang ở, ngày trả phòng trước')} ${when}`
  if (task === 'inhouse') return labelUi('Đang ở: trạng thái hiện tại, không lọc theo ngày')
  return labelUi('Tất cả đặt phòng, mọi ngày')
}

export default function Reservations() {
  useI18n()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const bookingParam = searchParams.get('booking')
  const tabParam = searchParams.get('tab')
  const selectedBookingId = bookingParam
  const pms = usePms(),
    location = useLocation(),
    navigate = useNavigate()
  const { bookings, rooms, roomTypes, settings, allowAction, bookingSources = [] } = pms
  // Role chỉ xem (Kế toán) không thấy nút tạo; khóa do gói vẫn hiện để mời nâng cấp.
  const canOfferCreate = !hiddenByRole(
    pms.access?.('reservations.write', 'RESERVATION_CREATE', true),
  )
  const returnTo = workflowReturnTarget(location, selectedBookingId, pms)
  const { task, date, query, status, source, page, problems } = readFilters(searchParams)
  const [filterMenu, setFilterMenu] = useState('')
  const [dateDraftValid, setDateDraftValid] = useState(true)
  const [dateKey, setDateKey] = useState(0)
  const [queryDraft, setQueryDraft] = useState(query)
  const pushedQuery = useRef(query)
  useEffect(() => {
    if (query !== pushedQuery.current) {
      pushedQuery.current = query
      setQueryDraft(query)
    }
  }, [query])

  // Every list/booking URL change keeps unrelated params and the router state (e.g. nested workflowReturn).
  const update = (mutate, options) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        mutate(next)
        return next
      },
      { state: location.state, ...options },
    )
  const todayDay = today(settings.timezone)
  const usesDate = DATE_TASKS.includes(task)
  const day = date || todayDay
  const draftInvalid = usesDate && !dateDraftValid
  const invalid = problems.length > 0 || draftInvalid
  const needle = fold(query.trim())
  const matchingBookings =
    needle || source
      ? bookings.filter(
          (booking) =>
            (!source || booking.source === source) &&
            (!needle ||
              fold(
                `${booking.id} ${booking.guest} ${bookingRooms(booking).join(' ')} ${booking.phone || ''}`,
              ).includes(needle)),
        )
      : bookings
  const filtered = invalid
    ? []
    : matchingBookings.filter(
        (booking) =>
          (!task || TASK_MATCH[task](booking, day)) && (!status || booking.status === status),
      )
  const taskCounts = invalid
    ? null
    : Object.fromEntries(
        TASK_OPTIONS.map(([code]) => [
          code,
          code
            ? matchingBookings.filter((booking) => TASK_MATCH[code](booking, day)).length
            : matchingBookings.length,
        ]),
      )
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10))
  const currentPage = Math.min(page, pageCount)
  const rows = filtered.slice((currentPage - 1) * 10, currentPage * 10).map((b) => ({
    ...b,
    room: bookingRooms(b).join(', '),
    roomType: roomTypes.find(
      (t) => t.id === rooms.find((r) => r.id === (b.room || bookingRooms(b)[0]))?.typeId,
    )?.name,
    nights: nights(b.checkIn, b.checkOut),
    total: money(b.total, b.currency),
  }))
  const refined = Boolean(needle || status || source)
  const openCreate = () => {
    if (allowAction('reservations.write', 'RESERVATION_CREATE')) setIsModalOpen(true)
  }

  const resetQuery = () => {
    pushedQuery.current = ''
    setQueryDraft('')
  }
  const changeQuery = (value) => {
    setQueryDraft(value)
    pushedQuery.current = value
    update(
      (next) => {
        setParam(next, 'res_q', value)
        next.delete('res_page')
      },
      { replace: true },
    )
  }
  const chooseTask = (code) => {
    setDateDraftValid(true)
    update((next) => {
      setParam(next, 'task', code)
      if (!DATE_TASKS.includes(code)) next.delete('date')
      next.delete('res_status')
      next.delete('res_page')
    })
  }
  // Choosing a status leaves the task scope so the filters do not conflict.
  const chooseStatus = (code) => {
    setDateDraftValid(true)
    update((next) => {
      setParam(next, 'res_status', code)
      next.delete('task')
      next.delete('date')
      next.delete('res_page')
    })
  }
  const chooseSource = (value) =>
    update((next) => {
      setParam(next, 'res_source', value)
      next.delete('res_page')
    })
  const changeDate = (value) =>
    update((next) => {
      setParam(next, 'date', value)
      next.delete('res_page')
    })
  const resetToToday = () => {
    setDateKey((key) => key + 1)
    setDateDraftValid(true)
    update((next) => {
      next.delete('date')
      next.delete('res_page')
    })
  }
  const setPage = (number) =>
    update((next) => setParam(next, 'res_page', number > 1 ? String(number) : ''))
  const clearFilters = () => {
    resetQuery()
    update((next) => {
      for (const key of ['res_status', 'res_source', 'res_q', 'res_page']) next.delete(key)
    })
  }
  const removeInvalid = () => {
    if (problems.some((problem) => problem.key === 'res_q')) resetQuery()
    update((next) => {
      for (const problem of problems) next.delete(problem.key)
      next.delete('res_page')
    })
  }
  const showAll = () => {
    resetQuery()
    setDateKey((key) => key + 1)
    setDateDraftValid(true)
    update((next) => {
      for (const key of ['task', 'date', 'res_status', 'res_source', 'res_q', 'res_page'])
        next.delete(key)
    })
  }
  const openBooking = (id) =>
    update((next) => {
      next.set('booking', id)
      next.delete('tab')
    })
  const closeBooking = () =>
    update(
      (next) => {
        next.delete('booking')
        next.delete('tab')
      },
      { replace: true },
    )
  const sources = [
    ...new Set([
      ...bookingSources.map((item) => item.name),
      ...bookings.map((booking) => booking.source),
      source,
    ]),
  ].filter(Boolean)

  return (
    <div className="loha-reservations">
      {returnTo && !bookings.some((booking) => booking.id === selectedBookingId) && (
        <p role="status">
          Booking không còn trong danh sách hiện tại.{' '}
          <Link to={returnTo} state={workflowReturnState(location, selectedBookingId, pms)}>
            {labelUi('Quay lại đối soát')}
          </Link>
        </p>
      )}
      <h1 className="loha-reservations-visually-hidden">{tUi('nav.bookings')}</h1>

      <section className="loha-reservations-tasks" aria-label={labelUi('Danh sách công việc')}>
        <div className="loha-reservations-task-toolbar">
          <div
            className="loha-reservations-task-presets"
            role="group"
            aria-label={labelUi('Danh sách công việc')}
          >
            {TASK_OPTIONS.map(([code, label]) => (
              <button
                key={code || 'all'}
                type="button"
                data-task={code || 'all'}
                className={task === code ? 'is-selected' : ''}
                aria-pressed={task === code}
                onClick={() => chooseTask(code)}
              >
                {labelUi(label)}{' '}
                {taskCounts && (
                  <span className="loha-reservations-task-count">{taskCounts[code]}</span>
                )}
              </button>
            ))}
          </div>
          <div className="loha-reservations-actions">
            <button
              type="button"
              disabled={invalid}
              title={
                invalid ? labelUi('Sửa bộ lọc không hợp lệ trước khi xuất dữ liệu') : undefined
              }
              onClick={() => {
                if (!invalid) exportCsv(filtered)
              }}
            >
              <Download size={16} aria-hidden="true" />
              {labelUi('Xuất dữ liệu')}
            </button>
            {canOfferCreate && (
              <button type="button" className="is-primary" onClick={openCreate}>
                <Plus size={17} aria-hidden="true" />
                {labelUi('Tạo đặt phòng')}
              </button>
            )}
          </div>
        </div>
        {usesDate && (
          <div className="loha-reservations-task-date">
            <span className="loha-reservations-task-date-label">{labelUi('Ngày công việc')}</span>
            <DateInput
              key={dateKey}
              aria-label={labelUi('Ngày công việc')}
              value={day}
              onChange={changeDate}
              onValidityChange={setDateDraftValid}
            />
            {date ? (
              <button type="button" onClick={resetToToday}>
                {labelUi('Về hôm nay')}
              </button>
            ) : (
              <small>{labelUi('Mặc định: hôm nay theo múi giờ khách sạn')}</small>
            )}
          </div>
        )}
        {task === 'inhouse' && (
          <p className="loha-reservations-task-note">
            {labelUi(
              'Đang ở là trạng thái hiện tại của khách, không phải số liệu tại một ngày trong quá khứ.',
            )}
            {date ? ` ${labelUi('Ngày')} ${formatDate(date)} ${labelUi('không áp dụng.')}` : ''}
          </p>
        )}
        {!task && date && (
          <p className="loha-reservations-task-note">
            {labelUi('Ngày')} {formatDate(date)}{' '}
            {labelUi(
              'chỉ áp dụng cho Khách đến, Khách đi hoặc Quá hạn; danh sách này không lọc theo ngày.',
            )}
          </p>
        )}
      </section>

      {invalid && (
        <div role="alert" className="loha-reservations-filter-error">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>{labelUi('Bộ lọc không hợp lệ nên danh sách chưa được hiển thị.')}</strong>
            <ul>
              {problems.map((problem) => (
                <li key={problem.key + problem.text}>{problem.text}</li>
              ))}
              {draftInvalid && (
                <li>{labelUi('Ngày công việc đang nhập không hợp lệ (dd/mm/yyyy).')}</li>
              )}
            </ul>
            <div className="loha-reservations-filter-error-actions">
              {problems.length > 0 && (
                <button type="button" onClick={removeInvalid}>
                  {labelUi('Bỏ tham số không hợp lệ')}
                </button>
              )}
              {draftInvalid && (
                <button type="button" onClick={resetToToday}>
                  {labelUi('Dùng ngày hôm nay')}
                </button>
              )}
              <button type="button" onClick={showAll}>
                {labelUi('Xem tất cả đặt phòng')}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="loha-reservations-panel" aria-label={labelUi('Danh sách đặt phòng')}>
        <div className="loha-reservations-toolbar">
          <label className="loha-reservations-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              aria-label={labelUi('Tìm đặt phòng')}
              value={queryDraft}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder={labelUi('Tên khách, mã đặt phòng, số phòng…')}
            />
          </label>
          <div className="loha-reservations-filters">
            <button
              type="button"
              aria-expanded={filterMenu === 'status' || filterMenu === 'all'}
              onClick={() => setFilterMenu(filterMenu === 'status' ? '' : 'status')}
            >
              {statusLabels[status] || tUi('common.status')}
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-expanded={filterMenu === 'source' || filterMenu === 'all'}
              onClick={() => setFilterMenu(filterMenu === 'source' ? '' : 'source')}
            >
              {source || labelUi('Nguồn đặt')}
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-expanded={Boolean(filterMenu)}
              onClick={() => setFilterMenu(filterMenu ? '' : 'all')}
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              {labelUi('Bộ lọc')}
            </button>
          </div>
        </div>
        {filterMenu && (
          <div className="loha-reservations-advanced">
            {filterMenu !== 'source' && (
              <label>
                {tUi('common.status')}
                <select value={status} onChange={(event) => chooseStatus(event.target.value)}>
                  <option value="">{tUi('common.allStatuses')}</option>
                  {Object.entries(statusLabels).map(([code, label]) => (
                    <option key={code} value={code}>
                      {`${labelUi(label)} (${matchingBookings.filter((booking) => booking.status === code).length})`}
                    </option>
                  ))}
                </select>
                {task && <small>{labelUi('Chọn trạng thái sẽ chuyển về Tất cả đặt phòng.')}</small>}
              </label>
            )}
            {filterMenu !== 'status' && (
              <label>
                {labelUi('Nguồn đặt')}
                <select value={source} onChange={(event) => chooseSource(event.target.value)}>
                  <option value="">{labelUi('Tất cả nguồn')}</option>
                  {sources.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" onClick={clearFilters}>
              {labelUi('Xóa bộ lọc')}
            </button>
          </div>
        )}
        <div className="loha-reservations-list-heading">
          <span className="loha-reservations-scope" aria-live="polite">
            {invalid ? (
              <strong>{labelUi('Chưa hiển thị dữ liệu: bộ lọc không hợp lệ')}</strong>
            ) : (
              <>
                <strong>{filtered.length}</strong> {labelUi('đặt phòng')}
                {' · '}
                {scopeText(task, day, day === todayDay)}
                {refined ? ' · ' + labelUi('phù hợp bộ lọc') : ''}
              </>
            )}
          </span>
          <span>
            <CalendarDays size={14} aria-hidden="true" />
            {labelUi('Hôm nay')} · {formatDate(todayDay)}
          </span>
        </div>
        <div
          className="loha-reservations-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={labelUi('Bảng đặt phòng, có thể cuộn ngang')}
        >
          <table>
            <thead>
              <tr>
                {[
                  'Mã đặt phòng',
                  'Khách hàng',
                  'Phòng',
                  'Thời gian lưu trú',
                  'Trạng thái',
                  'Nguồn đặt',
                  'Tổng tiền',
                ].map((title) => (
                  <th key={title} scope="col">
                    {labelUi(title)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button
                      type="button"
                      className="loha-reservations-code"
                      onClick={() => openBooking(row.id)}
                    >
                      {row.id}
                    </button>
                  </td>
                  <td>
                    <div className="loha-reservations-guest">
                      <span className="loha-reservations-avatar" aria-hidden="true">
                        {row.guest.charAt(0)}
                      </span>
                      <span>
                        <strong>{row.guest}</strong>
                        {row.phone && <small>{row.phone}</small>}
                      </span>
                    </div>
                  </td>
                  <td>
                    <strong>
                      {row.room && row.room !== 'Unassigned'
                        ? 'Phòng ' + row.room
                        : tUi('rooms.unassigned')}
                    </strong>
                    <small>{row.roomType || '—'}</small>
                  </td>
                  <td>
                    <strong className="loha-reservations-dates">
                      {formatDate(row.checkIn)}
                      <span aria-hidden="true"> → </span>
                      {formatDate(row.checkOut)}
                    </strong>
                    <small>{row.nights} đêm</small>
                  </td>
                  <td>
                    <span className={'loha-reservations-badge status-' + row.status.toLowerCase()}>
                      {statusLabels[row.status] ||
                        (row.status === 'NO_SHOW' ? labelUi('Không đến') : row.status)}
                    </span>
                  </td>
                  <td>
                    <span className="loha-reservations-source">{row.source}</span>
                  </td>
                  <td className="loha-reservations-total">{row.total}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7}>
                    <div className="loha-reservations-empty" role="status">
                      <ClipboardList size={30} aria-hidden="true" />
                      <strong>
                        {invalid
                          ? labelUi('Bộ lọc không hợp lệ')
                          : bookings.length
                            ? labelUi('Không tìm thấy đặt phòng phù hợp')
                            : labelUi('Chưa có đặt phòng')}
                      </strong>
                      <span>
                        {invalid
                          ? labelUi('Sửa ngày hoặc bộ lọc ở trên để xem dữ liệu.')
                          : bookings.length
                            ? labelUi('Thử thay đổi từ khóa hoặc bộ lọc.')
                            : labelUi('Các đặt phòng mới sẽ xuất hiện tại đây.')}
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="loha-reservations-pagination">
          <span>
            {labelUi('Hiển thị')}{' '}
            <strong>
              {filtered.length ? (currentPage - 1) * 10 + 1 : 0}–
              {Math.min(currentPage * 10, filtered.length)}
            </strong>{' '}
            / {filtered.length} {labelUi('đặt phòng')}
          </span>
          <nav aria-label="Phân trang đặt phòng">
            <button
              type="button"
              aria-label={labelUi('Trang trước')}
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: pageCount }, (_, index) => index + 1)
              .filter((number) => Math.abs(number - currentPage) <= 2)
              .map((number) => (
                <button
                  type="button"
                  key={number}
                  aria-current={number === currentPage ? 'page' : undefined}
                  className={number === currentPage ? 'is-current' : ''}
                  onClick={() => setPage(number)}
                >
                  {number}
                </button>
              ))}
            <button
              type="button"
              aria-label={labelUi('Trang sau')}
              disabled={currentPage === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </nav>
        </footer>
      </section>
      {isModalOpen && (
        <BookingModal
          onClose={() => setIsModalOpen(false)}
          onCreated={(created, tab = 'details') => {
            setIsModalOpen(false)
            update((next) => {
              next.set('booking', created.id)
              if (tab && tab !== 'details') next.set('tab', tab)
              else next.delete('tab')
            })
          }}
        />
      )}
      {selectedBookingId && (
        <BookingDetailPanel
          key={selectedBookingId + '/' + (tabParam || '')}
          bookingId={selectedBookingId}
          initialTab={tabParam || undefined}
          returnLabel={returnTo ? 'Quay lại đối soát' : undefined}
          onClose={() =>
            returnTo
              ? navigate(returnTo, { state: workflowReturnState(location, selectedBookingId, pms) })
              : closeBooking()
          }
        />
      )}
    </div>
  )
}

function exportCsv(rows) {
  downloadCsv(reservationCsvHeaders, reservationCsvRows(rows), 'dat-phong.csv')
}
