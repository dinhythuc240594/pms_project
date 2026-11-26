import { formatDate } from '../../../../shared/lib/date.js'
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useRef, useState, useSyncExternalStore } from 'react'
import { AccessLink } from '../../../../shared/components/AccessControl.jsx'
import { usePms } from '../../data/usePms'
import {
  bookingRoomStays,
  today,
  addDays,
  nights,
  money,
  overlaps,
  roomIsBlocked,
  statusLabels,
} from '../../data/model'
import BookingDetailPanel from '../../reservations/components/BookingDetailPanel'
import { reservationTaskMatches } from '../../reservations/reservationTasks.js'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Filter,
  LogIn,
  LogOut,
  Search,
  X,
} from 'lucide-react'
import './ARI.css'

const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
// Require at least five digits for phone fragments so room numbers stay room searches.
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const bookingSearchText = (booking) =>
  fold(
    [booking.id, booking.guest, ...(booking.guests || []).map((guest) => guest?.name)]
      .filter(Boolean)
      .join(' '),
  )
const bookingPhones = (booking) =>
  [booking.phone, ...(booking.guests || []).map((guest) => guest?.phone)]
    .map(digits)
    .filter(Boolean)

const desktopRanges = [7, 14]
const mobileRanges = [1, 3]
const todayShortcuts = [
  { task: 'arrivals', label: 'tapeChart.arrivals', Icon: LogIn },
  { task: 'departures', label: 'tapeChart.departures', Icon: LogOut },
]
const subscribeViewport = (notify) => {
  window.addEventListener('resize', notify)
  return () => window.removeEventListener('resize', notify)
}
function defaultRange() {
  if (window.innerWidth <= 360) return 1
  if (window.innerWidth <= 768) return 3
  return 7
}
const serverRange = () => 7

export default function ARI() {
  const { intlLocale } = useI18n()
  const { rooms, bookings: reservations, available, roomTypes, settings, roomBlocks } = usePms()
  const hotelDay = today(settings.timezone)
  const [currentDate, setCurrentDate] = useState(hotelDay)
  const [rangeChoice, setRangeChoice] = useState(null)
  const [query, setQuery] = useState('')
  const [onlyMatches, setOnlyMatches] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [showFilter, setShowFilter] = useState(false)
  const [selectedBookingId, setSelectedBookingId] = useState(null)
  const chartRef = useRef(null)
  const defaultDays = useSyncExternalStore(subscribeViewport, defaultRange, serverRange)
  const rangeOptions = defaultDays <= 3 ? mobileRanges : desktopRanges
  const dayCount = rangeOptions.includes(rangeChoice) ? rangeChoice : defaultDays
  const endDate = addDays(currentDate, dayCount)
  const rangeLabel =
    dayCount === 1
      ? formatDate(currentDate)
      : formatDate(currentDate) + ' – ' + formatDate(addDays(endDate, -1))
  const weekdayFormat = new Intl.DateTimeFormat(intlLocale, { weekday: 'short', timeZone: 'UTC' })
  const dates = Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(currentDate, index)
    const day = new Date(date + 'T00:00:00Z')
    const weekday = day.getUTCDay()
    return {
      date,
      nextDate: addDays(date, 1),
      weekday: weekdayFormat.format(day),
      number: day.getUTCDate(),
      isToday: date === hotelDay,
      isWeekend: weekday === 0 || weekday === 6,
    }
  })
  const typedGroups = roomTypes
    .filter((type) => !typeFilter || type.id === typeFilter)
    .map((type) => ({
      ...type,
      price: money(type.price, settings.currency),
      rooms: rooms
        .filter((room) => room.active !== false && room.typeId === type.id)
        .map((room) => ({
          ...room,
          name: 'R - ' + room.id,
          blocked: roomIsBlocked(room, roomBlocks, currentDate, endDate),
        })),
      available: dates.map(({ date, nextDate }) => available(date, nextDate, type.id).length),
    }))
  const queryText = query.trim()
  const needle = fold(queryText)
  const phoneDigits = digits(queryText)
  const phoneNeedle = /^[\d\s.+()-]+$/.test(queryText) && phoneDigits.length >= 5 ? phoneDigits : ''
  const bookingMatches = (booking) =>
    Boolean(needle) &&
    (bookingSearchText(booking).includes(needle) ||
      (Boolean(phoneNeedle) && bookingPhones(booking).some((phone) => phone.includes(phoneNeedle))))
  const roomMatches = (room) =>
    Boolean(needle) &&
    [room.id, room.number].some((value) => value != null && fold(value).includes(needle))

  const bookings = reservations
    .filter((booking) => overlaps(booking, currentDate, endDate))
    .flatMap((booking) => {
      const match = bookingMatches(booking)
      return bookingRoomStays(booking)
        .filter((stay) => stay.start < endDate && stay.end > currentDate)
        .map((stay) => {
          const colStart = Math.max(0, nights(currentDate, stay.start))
          return {
            ...booking,
            match,
            room: String(stay.room),
            colStart,
            colSpan: Math.min(dayCount, nights(currentDate, stay.end)) - colStart,
            balanceDue: Number(booking.balance) > 0,
          }
        })
    })
  const bookingsByRoom = new Map()
  const roomsWithMatchingStay = new Set()
  for (const booking of bookings) {
    const roomBookings = bookingsByRoom.get(booking.room) ?? []
    roomBookings.push(booking)
    bookingsByRoom.set(booking.room, roomBookings)
    if (booking.match) roomsWithMatchingStay.add(booking.room)
  }
  const visibleRooms = typedGroups.flatMap((group) => group.rooms)
  const matchedRoomIds = new Set(
    needle
      ? visibleRooms
          .filter((room) => roomMatches(room) || roomsWithMatchingStay.has(String(room.id)))
          .map((room) => String(room.id))
      : [],
  )
  const matchedBookingCount = new Set(
    bookings
      .filter((booking) => booking.match && matchedRoomIds.has(booking.room))
      .map((booking) => booking.id),
  ).size
  const onlyMatching = onlyMatches && Boolean(needle)
  const groups = onlyMatching
    ? typedGroups
        .map((group) => ({
          ...group,
          rooms: group.rooms.filter((room) => matchedRoomIds.has(String(room.id))),
        }))
        .filter((group) => group.rooms.length)
    : typedGroups
  const typeName = roomTypes.find((type) => type.id === typeFilter)?.name

  function changeStart(date, resetRows = false) {
    setCurrentDate(date)
    chartRef.current.scrollLeft = 0
    if (resetRows) chartRef.current.scrollTop = 0
  }

  return (
    <div className="ari-page">
      <div className="ari-toolbar">
        <h1>{labelUi('Lịch đặt phòng')}</h1>
        <div className="ari-toolbar-actions">
          <div className="ari-date-navigation">
            <button
              type="button"
              aria-label={tUi('tapeChart.previous', { count: dayCount })}
              onClick={() => changeStart(addDays(currentDate, -dayCount))}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <span className="ari-date-label" aria-live="polite">
              {rangeLabel}
            </span>
            <button
              type="button"
              aria-label={tUi('tapeChart.next', { count: dayCount })}
              onClick={() => changeStart(endDate)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="ari-range-switch" role="group" aria-label={tUi('tapeChart.range')}>
            {rangeOptions.map((days) => (
              <button
                type="button"
                key={days}
                aria-pressed={days === dayCount}
                onClick={() => {
                  setRangeChoice(days)
                  chartRef.current.scrollLeft = 0
                }}
              >
                {tUi('tapeChart.days', { count: days })}
              </button>
            ))}
          </div>
          <label className="ari-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label={labelUi('Tìm khách, mã đặt phòng, số điện thoại hoặc số phòng')}
              placeholder={labelUi('Khách, mã, SĐT, phòng...')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            aria-expanded={showFilter}
            aria-controls={showFilter ? 'ari-room-type-filter' : undefined}
            onClick={() => setShowFilter(!showFilter)}
          >
            <Filter size={16} aria-hidden="true" /> {tUi('common.filter')}
          </button>
          <button
            type="button"
            className="ari-today-button"
            onClick={() => changeStart(hotelDay, true)}
          >
            <CalendarDays size={16} aria-hidden="true" /> {tUi('common.today')}
          </button>
        </div>
      </div>

      <div className="ari-context">
        <div className="ari-shortcuts">
          {todayShortcuts.map(({ task, label, Icon }) => (
            <AccessLink key={task} to={'/id/reservations?task=' + task + '&date=' + hotelDay}>
              <Icon size={15} aria-hidden="true" />
              {tUi(label)}{' '}
              <strong>
                {
                  reservations.filter((booking) => reservationTaskMatches[task](booking, hotelDay))
                    .length
                }
              </strong>
            </AccessLink>
          ))}
        </div>
        <ul className="ari-legend" aria-label={tUi('tapeChart.legend')}>
          <li>
            <span className="ari-tone-confirmed" aria-hidden="true" />
            {statusLabels.CONFIRMED}
          </li>
          <li>
            <span className="ari-tone-in-house" aria-hidden="true" />
            {statusLabels.IN_HOUSE}
          </li>
          <li>
            <span className="ari-cell-blocked" aria-hidden="true" />
            {tUi('rooms.blocked')}
          </li>
          <li>
            <CircleAlert size={14} className="ari-balance-icon" aria-hidden="true" />
            {tUi('rooms.balance')}
          </li>
        </ul>
      </div>

      {showFilter && (
        <select
          id="ari-room-type-filter"
          className="ari-room-type-filter"
          aria-label={labelUi('Lọc loại phòng')}
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="">{tUi('common.allRoomTypes')}</option>
          {roomTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      )}
      {needle && (
        <div className="ari-search-results">
          <p role="status">
            {matchedRoomIds.size ? (
              <>
                <strong>{matchedRoomIds.size}</strong> {labelUi('phòng khớp')}
                {' · '}
                <strong>{matchedBookingCount}</strong> {labelUi('đặt phòng khớp')}
              </>
            ) : (
              labelUi('Không có phòng hoặc đặt phòng khớp')
            )}{' '}
            “{queryText}” · {rangeLabel}
            {typeName && ' · ' + typeName}
          </p>
          <div
            className="ari-search-modes"
            role="group"
            aria-label={labelUi('Chế độ hiển thị phòng')}
          >
            <button
              type="button"
              aria-pressed={!onlyMatching}
              onClick={() => setOnlyMatches(false)}
            >
              {labelUi('Tất cả phòng')}
            </button>
            <button
              type="button"
              aria-pressed={onlyMatching}
              disabled={!matchedRoomIds.size && !onlyMatching}
              onClick={() => setOnlyMatches(true)}
            >
              {labelUi('Chỉ phòng khớp')}
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setOnlyMatches(false)
              }}
            >
              <X size={14} aria-hidden="true" />
              {labelUi('Xóa tìm kiếm')}
            </button>
          </div>
        </div>
      )}

      <div
        ref={chartRef}
        className="ari-chart"
        role="region"
        aria-label={labelUi('Lịch đặt phòng, có thể cuộn ngang và dọc')}
        tabIndex={0}
        style={{ '--ari-days': dayCount }}
      >
        <div className="ari-chart-row ari-chart-header">
          <div className="ari-room-column ari-room-heading">{labelUi('Loại phòng / Phòng')}</div>
          <div className="ari-day-grid">
            {dates.map((day) => (
              <time
                key={day.date}
                dateTime={day.date}
                title={formatDate(day.date)}
                aria-current={day.isToday ? 'date' : undefined}
                className={'ari-date-cell ' + dayClass(day)}
              >
                <span>{day.weekday}</span>
                <strong>{day.number}</strong>
              </time>
            ))}
          </div>
        </div>

        {onlyMatching && !groups.length && (
          <p className="ari-no-match">
            {labelUi('Không có phòng khớp trong khoảng ngày và loại phòng đang xem.')}{' '}
            <button type="button" onClick={() => setOnlyMatches(false)}>
              {labelUi('Xem tất cả phòng')}
            </button>
          </p>
        )}
        {groups.map((group) => (
          <div key={group.id}>
            <div className="ari-chart-row ari-type-row">
              <div className="ari-room-column ari-room-type">
                <span title={group.name}>{group.name}</span>
                <span title={group.price}>{group.price}</span>
              </div>
              <div className="ari-day-grid">
                {dates.map((day, index) => (
                  <div key={day.date} className={'ari-availability ' + dayClass(day)}>
                    {group.available[index] || labelUi('Hết')}
                  </div>
                ))}
              </div>
            </div>
            {group.rooms.map((room) => {
              const roomMatchesQuery = matchedRoomIds.has(String(room.id))
              return (
                <div key={room.id} className="ari-chart-row ari-room-row">
                  <div
                    data-room-id={room.id}
                    data-match={roomMatchesQuery || undefined}
                    title={room.name}
                    className={
                      'ari-room-column ari-room-label' +
                      (room.blocked ? ' ari-room-blocked' : '') +
                      (roomMatchesQuery ? ' ari-room-match' : '')
                    }
                  >
                    <span className="ari-room-dot" aria-hidden="true" />
                    <div className="ari-room-caption">
                      <strong>{room.name}</strong>
                      {room.blocked && <small>{tUi('rooms.blocked')}</small>}
                      {roomMatchesQuery && <small>{labelUi('Khớp tìm kiếm')}</small>}
                    </div>
                  </div>
                  <div className="ari-day-grid ari-room-track" data-room-id={room.id}>
                    {dates.map((day) => {
                      const blocked = roomIsBlocked(room, roomBlocks, day.date, day.nextDate)
                      return (
                        <div
                          key={day.date}
                          data-date={day.date}
                          className={
                            'ari-day ' + dayClass(day) + (blocked ? ' ari-cell-blocked' : '')
                          }
                          title={
                            blocked
                              ? room.name +
                                ' · ' +
                                formatDate(day.date) +
                                ' · ' +
                                tUi('rooms.blocked')
                              : undefined
                          }
                        >
                          {blocked && (
                            <span className="ari-blocked-caption">
                              {room.condition === 'maintenance'
                                ? tUi('hk.maintenance')
                                : tUi('rooms.blocked')}
                            </span>
                          )}
                        </div>
                      )
                    })}
                    {(bookingsByRoom.get(String(room.id)) || []).map((booking) => {
                      const label = [
                        booking.guest,
                        room.name,
                        formatDate(booking.checkIn) + ' – ' + formatDate(booking.checkOut),
                        statusLabels[booking.status],
                        booking.balanceDue && tUi('rooms.balance'),
                        booking.match && labelUi('khớp tìm kiếm'),
                      ]
                        .filter(Boolean)
                        .join(' · ')
                      return (
                        <button
                          key={booking.id + ':' + booking.colStart}
                          type="button"
                          className={
                            'ari-booking ' +
                            (booking.status === 'IN_HOUSE'
                              ? 'ari-tone-in-house'
                              : 'ari-tone-confirmed') +
                            (booking.match ? ' is-match' : '')
                          }
                          data-booking-id={booking.id}
                          aria-label={label}
                          title={label}
                          onClick={() => setSelectedBookingId(booking.id)}
                          style={{ '--ari-start': booking.colStart, '--ari-span': booking.colSpan }}
                        >
                          <span className="ari-booking-name">{booking.guest}</span>
                          {booking.balanceDue && (
                            <CircleAlert
                              size={14}
                              className="ari-balance-icon"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {selectedBookingId && (
        <BookingDetailPanel
          bookingId={selectedBookingId}
          onClose={() => setSelectedBookingId(null)}
        />
      )}
    </div>
  )
}

function dayClass(day) {
  if (day.isToday) return 'ari-day-today'
  return day.isWeekend ? 'ari-day-weekend' : ''
}
