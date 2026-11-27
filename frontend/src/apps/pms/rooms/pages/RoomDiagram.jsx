import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePms } from '../../data/usePms'
import { today, addDays, money } from '../../data/model'
import BookingModal from '../../reservations/components/BookingModal'
import BookingDetailPanel from '../../reservations/components/BookingDetailPanel'
import LegacyOverlay from '../../components/LegacyOverlay'
import RoomLocationFilters from '../components/RoomLocationFilters'
import { groupRoomsByLocation } from '../roomLocations.js'
import {
  createRoomDiagram,
  diagramFilters,
  filterRoomDiagram,
  otherDiagramFilters,
  roomCardStatus,
} from '../roomDiagramState.js'
import {
  ChevronDown,
  DollarSign,
  Sparkles,
  Grid,
  List,
  X,
  Key,
  LogOut,
  Brush,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import './RoomDiagram.css'

const taskLabels = new Map(diagramFilters)
const isDeparture = (task) => task === 'departures' || task === 'overdue'

function RoomCard({ room, entry, onOpen }) {
  const booking = entry?.booking
  const task = entry?.task
  const [kind, statusLabel] = roomCardStatus(room ?? {}, booking)
  const roomName = room
    ? tUi('rooms.roomName', { room: room.number })
    : tUi('rooms.unassignedDiagram')
  const debt =
    booking && Number(booking.balance) > 0 ? money(booking.balance, booking.currency) : null
  const cleaning =
    room?.dirty && kind !== 'dirty'
      ? tUi(room.condition === 'inspection' ? 'hk.inspecting' : 'rooms.cleanShort')
      : null
  const hasNextArrival = isDeparture(task) && room?.tasks.some((item) => item.task === 'arrivals')
  const turnsOverToday = task === 'departures' && hasNextArrival
  const labels = [
    roomName,
    booking?.guest,
    tUi(statusLabel),
    task && tUi(taskLabels.get(task)),
    hasNextArrival && tUi('rooms.arrivalTodayShort'),
    cleaning,
    debt && tUi('rooms.balance') + ' ' + debt,
  ].filter(Boolean)
  return (
    <button
      type="button"
      className={'loha-room-card room-' + kind}
      data-booking-id={room ? undefined : booking?.id}
      aria-label={labels.join(', ')}
      onClick={onOpen}
    >
      <span className="loha-room-card-top">
        <span className="loha-room-card-title">
          <strong>{room?.number ?? roomName}</strong>
          {room?.type && (
            <span className="loha-room-type" title={room.type}>
              {room.type}
            </span>
          )}
        </span>
        <span className="loha-room-card-status">{tUi(statusLabel)}</span>
      </span>
      {booking && (
        <strong className="loha-room-guest" title={booking.guest}>
          {booking.guest}
        </strong>
      )}
      {(task || hasNextArrival || cleaning || debt) && (
        <span className="loha-room-card-tags">
          {task && (
            <span className={'room-tag tag-' + task}>
              {tUi(turnsOverToday ? 'rooms.turnoverToday' : taskLabels.get(task))}
            </span>
          )}
          {hasNextArrival && !turnsOverToday && (
            <span className="room-tag tag-arrivals">{tUi('rooms.arrivalTodayShort')}</span>
          )}
          {cleaning && <span className="room-tag tag-dirty">{cleaning}</span>}
          {debt && (
            <span className="room-tag tag-debt">
              {tUi('rooms.balance')} <strong>{debt}</strong>
            </span>
          )}
        </span>
      )}
    </button>
  )
}

export default function RoomDiagram() {
  useI18n()
  const {
    rooms,
    bookings,
    available,
    cleanRoom,
    dirtyRoom,
    changeStatus,
    roomTypes,
    settings,
    roomBlocks,
    setCondition,
    allowAction,
    runAction,
    access,
    housekeepingTasks,
  } = usePms()
  const [selectedRoomNumber, setSelectedRoomNumber] = useState(null)
  const [bookingId, setBookingId] = useState(null)
  const [bookingTab, setBookingTab] = useState(null)
  const [collectBeforeCheckout, setCollectBeforeCheckout] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createInitialRooms, setCreateInitialRooms] = useState([])
  const [createIntent, setCreateIntent] = useState('reservation')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [areaFilter, setAreaFilter] = useState('')
  const [floorFilter, setFloorFilter] = useState('')
  const [listView, setListView] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const filtersRef = useRef(null)
  const returnPosition = useRef(null)
  const setSelectedRoom = (room) => {
    setSelectedRoomNumber(room?.number ?? null)
    setError('')
  }

  const day = today(settings.timezone)
  const nextDay = addDays(day, 1)
  const diagram = createRoomDiagram({
    rooms,
    bookings,
    roomTypes,
    roomBlocks,
    sellable: available(day, nextDay),
    day,
    nextDay,
  })
  const filters = {
    status: statusFilter,
    search,
    typeId: typeFilter,
    area: areaFilter,
    floor: floorFilter,
  }
  const result = filterRoomDiagram(diagram, filters)
  const locationGroups = groupRoomsByLocation(result.rooms)
  const filtersActive = Boolean(
    search.trim() || typeFilter || areaFilter || floorFilter || statusFilter !== 'all',
  )
  const extraFiltersActive = Boolean(
    typeFilter ||
    areaFilter ||
    floorFilter ||
    otherDiagramFilters.some(([key]) => key === statusFilter),
  )
  const countFor = (status) => {
    // Each number counts the cards that its button will show, including unassigned bookings.
    if (status === 'all') return diagram.cards.length + diagram.unassigned.length
    const selection = filterRoomDiagram(diagram, { ...filters, status })
    return selection.rooms.length + selection.unassigned.length
  }

  const dialogRoom = diagram.cards.find((room) => room.number === selectedRoomNumber)
  const dialogBooking = dialogRoom?.current?.booking
  const selectedRoom = dialogRoom && {
    ...dialogRoom,
    name: tUi('rooms.roomName', { room: dialogRoom.number }),
    state: dialogBooking ? 'occupied' : 'empty',
    status: dialogBooking?.status === 'CONFIRMED' ? 'confirmed' : 'in-house',
    id: dialogBooking?.id,
    guest: dialogBooking?.guest,
    checkIn: dialogBooking?.checkIn,
    checkOut: dialogBooking?.checkOut,
    paid: Number(dialogBooking?.balance) === 0,
  }
  const hasOverlay = Boolean(selectedRoom || bookingId || createOpen)

  useLayoutEffect(() => {
    if (hasOverlay || !returnPosition.current) return
    const { element, scroller, scrollTop } = returnPosition.current
    returnPosition.current = null
    if (scroller) scroller.scrollTop = scrollTop
    const target = element.isConnected
      ? element
      : (filtersRef.current?.querySelector('button[aria-pressed="true"]') ?? filtersRef.current)
    target?.focus({ preventScroll: true })
  }, [hasOverlay])

  function rememberPosition(event) {
    const element = event.currentTarget
    const scroller = element.closest('.pms-main') ?? document.scrollingElement
    returnPosition.current = { element, scroller, scrollTop: scroller?.scrollTop ?? 0 }
  }

  function openBooking(booking, tab = 'details', collect = false) {
    setCollectBeforeCheckout(collect)
    setBookingId(booking.id)
    setBookingTab(tab)
    setSelectedRoom(null)
  }

  function openEntry(entry) {
    const collect =
      isDeparture(entry.task) &&
      Number(entry.booking.balance) > 0 &&
      access('payments.write').allowed
    openBooking(entry.booking, collect ? 'payments' : 'details', collect)
  }

  function openRoom(event, room) {
    rememberPosition(event)
    if (room.entry?.task && !['dirty', 'blocked'].includes(statusFilter)) openEntry(room.entry)
    else setSelectedRoom(room)
  }

  async function checkout() {
    if (!allowAction('reservations.write', 'RESERVATION_VIEW')) return
    try {
      await changeStatus(selectedRoom.id, 'CHECKED_OUT', dialogBooking.version)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  function openCreate(room, intent = 'reservation') {
    if (!allowAction('reservations.write', 'RESERVATION_CREATE')) return
    setCreateInitialRooms([String(room.number)])
    setCreateIntent(intent)
    setCreateOpen(true)
    setSelectedRoom(null)
  }

  function changeFilter(setter, value) {
    setter(value)
    setCollapsedGroups(new Set())
  }

  function clearFilters() {
    setSearch('')
    setTypeFilter('')
    setAreaFilter('')
    setFloorFilter('')
    changeFilter(setStatusFilter, 'all')
  }

  const locationGroupName = (group) =>
    (group.area ?? tUi('rooms.unassignedArea')) +
    ' · ' +
    (group.floor === null
      ? tUi('rooms.unassignedFloor')
      : tUi('rooms.floorName', { floor: group.floor }))
  const openTaskItem = selectedRoom
    ? housekeepingTasks.find(
        (task) =>
          task.room === selectedRoom.number && !['completed', 'cancelled'].includes(task.status),
      )
    : null
  const hasOpenTask = Boolean(openTaskItem)
  const hkTaskUrl = openTaskItem
    ? '/id/housekeeping/plan?' +
      new URLSearchParams({
        task: openTaskItem.id,
        date: openTaskItem.date,
        room: selectedRoom.number,
      })
    : '/id/housekeeping/plan?' +
      new URLSearchParams({ date: day, room: selectedRoom?.number ?? '' })
  const emptyRoom = selectedRoom?.state === 'empty'
  const needsCleaning = emptyRoom && selectedRoom.dirty
  const housekeepingAction =
    emptyRoom &&
    (selectedRoom.condition === 'inspection' ||
    !access('housekeeping.manage').allowed ||
    hasOpenTask ? (
      <Link
        className={needsCleaning ? 'loha-rooms-primary' : 'loha-room-action-wide'}
        to={hkTaskUrl}
      >
        {tUi('rooms.housekeepingTask')}
      </Link>
    ) : (
      <button
        type="button"
        className={needsCleaning ? 'loha-rooms-primary' : 'loha-room-action-wide'}
        onClick={() =>
          runAction('housekeeping.write', 'HOUSEKEEPING', () =>
            (needsCleaning ? cleanRoom : dirtyRoom)(selectedRoom.number),
          )
        }
      >
        {needsCleaning ? (
          <Sparkles size={16} aria-hidden="true" />
        ) : (
          <Brush size={16} aria-hidden="true" />
        )}
        {tUi(needsCleaning ? 'rooms.markClean' : 'rooms.markDirty')}
      </button>
    ))

  return (
    <div className="loha-rooms loha-room-diagram">
      <h1 className="loha-rooms-visually-hidden">{tUi('nav.roomDiagram')}</h1>
      <section className="loha-rooms-panel" aria-label={tUi('rooms.byArea')}>
        <div className="loha-rooms-controls">
          <div className="loha-rooms-toolbar">
            <div
              className="loha-rooms-legend"
              ref={filtersRef}
              tabIndex={-1}
              role="group"
              aria-label={tUi('rooms.filter')}
            >
              {diagramFilters.map(([key, label]) => {
                const count = countFor(key)
                if (key === 'overdue' && !count && statusFilter !== key) return null
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={statusFilter === key}
                    className={'legend-' + key}
                    onClick={() =>
                      key === 'all' ? clearFilters() : changeFilter(setStatusFilter, key)
                    }
                  >
                    <span>{tUi(label)}</span>
                    <strong>{count}</strong>
                  </button>
                )
              })}
            </div>
            <div className="loha-rooms-tools">
              <label className="loha-rooms-search">
                <Search size={15} aria-hidden="true" />
                <input
                  id="diagram-search"
                  type="search"
                  autoComplete="off"
                  maxLength={80}
                  aria-label={tUi('rooms.searchDiagram')}
                  placeholder={tUi('rooms.searchDiagram')}
                  value={search}
                  onChange={(event) => changeFilter(setSearch, event.target.value)}
                />
              </label>
              <button
                type="button"
                className="loha-rooms-filter-trigger"
                aria-expanded={showFilters}
                aria-controls="diagram-filters"
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                {tUi('common.filter')}
                {extraFiltersActive ? ' •' : ''}
              </button>
              <div className="loha-rooms-view" role="group" aria-label={tUi('rooms.view')}>
                <button
                  type="button"
                  aria-label={tUi('rooms.grid')}
                  aria-pressed={!listView}
                  onClick={() => setListView(false)}
                >
                  <Grid size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={tUi('rooms.listView')}
                  aria-pressed={listView}
                  onClick={() => setListView(true)}
                >
                  <List size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <div id="diagram-filters" className="loha-rooms-filters" hidden={!showFilters}>
            <RoomLocationFilters
              rooms={diagram.cards}
              area={areaFilter}
              floor={floorFilter}
              onAreaChange={(value) => changeFilter(setAreaFilter, value)}
              onFloorChange={(value) => changeFilter(setFloorFilter, value)}
              idPrefix="diagram"
            />
            <label className="loha-rooms-visually-hidden" htmlFor="diagram-type">
              {tUi('common.roomType')}
            </label>
            <select
              id="diagram-type"
              value={typeFilter}
              onChange={(event) => changeFilter(setTypeFilter, event.target.value)}
            >
              <option value="">{tUi('common.allRoomTypes')}</option>
              {roomTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <label className="loha-rooms-visually-hidden" htmlFor="diagram-status">
              {tUi('rooms.filter')}
            </label>
            <select
              id="diagram-status"
              value={otherDiagramFilters.some(([key]) => key === statusFilter) ? statusFilter : ''}
              onChange={(event) => changeFilter(setStatusFilter, event.target.value || 'all')}
            >
              <option value="">{tUi('rooms.otherStatuses')}</option>
              {otherDiagramFilters.map(([key, label]) => (
                <option value={key} key={key}>
                  {tUi(label)} · {countFor(key)}
                </option>
              ))}
            </select>
          </div>
          {filtersActive && (
            <div className="loha-rooms-results" role="status">
              <span className="loha-rooms-result-count">
                {tUi('rooms.resultCount', {
                  count: result.rooms.length,
                  total: diagram.cards.length,
                })}
                {!!result.unassigned.length &&
                  ' · ' + tUi('rooms.unassignedCount', { count: result.unassigned.length })}
              </span>
            </div>
          )}
        </div>
        <div className="loha-rooms-body">
          {locationGroups.map((group, index) => {
            const collapsed = collapsedGroups.has(group.key)
            const id = 'diagram-floor-' + index
            return (
              <section className="loha-rooms-floor" key={group.key}>
                <h2 className="loha-rooms-floor-heading">
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    aria-controls={id}
                    onClick={() =>
                      setCollapsedGroups((previous) => {
                        const next = new Set(previous)
                        if (next.has(group.key)) next.delete(group.key)
                        else next.add(group.key)
                        return next
                      })
                    }
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                    <span data-i18n-ignore>{locationGroupName(group)}</span>
                    <small>
                      {group.rooms.length} {tUi('common.roomsLower')}
                    </small>
                  </button>
                </h2>
                <div
                  id={id}
                  hidden={collapsed}
                  className={'loha-rooms-grid' + (listView ? ' is-list' : '')}
                >
                  {group.rooms.map((room) => (
                    <RoomCard
                      key={room.number}
                      room={room}
                      entry={room.entry}
                      onOpen={(event) => openRoom(event, room)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
          {!!result.unassigned.length && (
            <section className="loha-rooms-unassigned">
              <h2 className="loha-rooms-floor-heading">{tUi('rooms.unassignedDiagram')}</h2>
              <div className={'loha-rooms-grid' + (listView ? ' is-list' : '')}>
                {result.unassigned.map((entry) => (
                  <RoomCard
                    key={entry.booking.id}
                    entry={entry}
                    onOpen={(event) => {
                      rememberPosition(event)
                      openEntry(entry)
                    }}
                  />
                ))}
              </div>
            </section>
          )}
          {!locationGroups.length && !result.unassigned.length && (
            <div className="loha-rooms-empty" role="status">
              <strong>{diagram.cards.length ? tUi('rooms.noMatch') : tUi('rooms.none')}</strong>
              <span>{diagram.cards.length ? tUi('rooms.filterHint') : tUi('rooms.emptyHint')}</span>
            </div>
          )}
        </div>
      </section>
      {selectedRoom && (
        <LegacyOverlay
          modal
          title={selectedRoom.name}
          onClose={() => setSelectedRoom(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(18,43,68,.4)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
        >
          <div className="loha-room-dialog">
            <header className="loha-room-dialog-heading">
              <div>
                <h2>{selectedRoom.name}</h2>
                <span className={'loha-room-status room-' + roomCardStatus(selectedRoom)[0]}>
                  {tUi(roomCardStatus(selectedRoom)[1])}
                </span>
                {selectedRoom.dirty && (
                  <span className="loha-room-dirty">
                    {selectedRoom.condition === 'inspection'
                      ? tUi('hk.inspecting')
                      : tUi('rooms.cleanShort')}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label={tUi('common.close')}
                className="loha-room-close"
                onClick={() => setSelectedRoom(null)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="loha-room-dialog-info">
              {selectedRoom.state === 'occupied' ? (
                <>
                  <div>
                    <span>{tUi('hk.stayover')}</span>
                    <strong>{selectedRoom.guest}</strong>
                  </div>
                  <div>
                    <span>{tUi('rooms.bookingCode')}</span>
                    <strong>{selectedRoom.id}</strong>
                  </div>
                  <div>
                    <span>{tUi('rooms.stayDates')}</span>
                    <strong>
                      {selectedRoom.checkIn} → {selectedRoom.checkOut}
                    </strong>
                  </div>
                  <div>
                    <span>{tUi('common.roomType')}</span>
                    <strong>{selectedRoom.type}</strong>
                  </div>
                  <div>
                    <span>{tUi('rooms.payment')}</span>
                    <strong>
                      {selectedRoom.paid ? tUi('rooms.paidFull') : tUi('rooms.notPaidFull')}
                    </strong>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span>{tUi('common.roomType')}</span>
                    <strong>{selectedRoom.type}</strong>
                  </div>
                  <div>
                    <span>{tUi('rooms.cleaning')}</span>
                    <strong>
                      {selectedRoom.condition === 'inspection'
                        ? tUi('hk.inspecting')
                        : selectedRoom.condition === 'maintenance'
                          ? tUi('hk.maintenanceAction')
                          : selectedRoom.dirty
                            ? tUi('rooms.needsCleaningShort')
                            : tUi('rooms.cleaned')}
                    </strong>
                  </div>
                </>
              )}
            </div>
            {error && (
              <p role="alert" className="loha-room-error">
                {error}
              </p>
            )}
            <div className="loha-room-dialog-actions">
              {needsCleaning && housekeepingAction}
              <button
                type="button"
                className={needsCleaning ? undefined : 'loha-rooms-primary'}
                onClick={() => {
                  if (dialogBooking) openBooking(dialogBooking)
                  else openCreate(selectedRoom)
                }}
              >
                <Grid size={17} aria-hidden="true" />
                {selectedRoom.state === 'empty' ? labelUi('Đặt phòng này') : tUi('rooms.details')}
              </button>
              <div className="loha-room-action-grid">
                {selectedRoom.state === 'empty' ? (
                  <>
                    <button
                      type="button"
                      className="loha-room-walk-in"
                      disabled={selectedRoom.blocked}
                      title={
                        selectedRoom.blocked
                          ? tUi('rooms.lockedHint')
                          : 'Khách vãng lai: tạo đặt phòng, sau đó nhận phòng riêng'
                      }
                      onClick={() => openCreate(selectedRoom, 'walk-in')}
                    >
                      <Key size={16} aria-hidden="true" />
                      {tUi('rooms.checkIn')}
                    </button>
                    {!needsCleaning && housekeepingAction}
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => openBooking(dialogBooking, 'services')}>
                      <DollarSign size={16} aria-hidden="true" />
                      {tUi('rooms.services')}
                    </button>
                    {selectedRoom.status !== 'confirmed' && (
                      <button
                        type="button"
                        className="loha-room-action-wide"
                        disabled={!selectedRoom.paid}
                        title={!selectedRoom.paid ? tUi('rooms.checkoutHint') : ''}
                        onClick={checkout}
                      >
                        <LogOut size={16} aria-hidden="true" />
                        {tUi('rooms.checkOut')}
                      </button>
                    )}
                  </>
                )}
              </div>
              {access('housekeeping.manage').allowed &&
                !hasOpenTask &&
                selectedRoom.condition !== 'inspection' && (
                  <button
                    type="button"
                    onClick={() =>
                      runAction('housekeeping.write', '', () =>
                        setCondition(
                          selectedRoom.number,
                          selectedRoom.condition === 'maintenance' ? 'dirty' : 'maintenance',
                        ),
                      )
                    }
                  >
                    {selectedRoom.condition === 'maintenance'
                      ? tUi('rooms.endMaintenance')
                      : tUi('rooms.markMaintenance')}
                  </button>
                )}
            </div>
          </div>
        </LegacyOverlay>
      )}
      {bookingId && (
        <BookingDetailPanel
          key={bookingId + '|' + (bookingTab || '')}
          bookingId={bookingId}
          initialTab={bookingTab || undefined}
          collectBeforeCheckout={collectBeforeCheckout}
          onClose={() => {
            setBookingId(null)
            setBookingTab(null)
          }}
        />
      )}
      {createOpen && (
        <BookingModal
          initialRooms={createInitialRooms}
          intent={createIntent}
          onClose={() => setCreateOpen(false)}
          onCreated={(created, tab) => {
            openBooking(created, tab)
            setCreateOpen(false)
          }}
        />
      )}
    </div>
  )
}
