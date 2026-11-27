import { active, bookingRooms, bookingRoomStays, overlaps, roomIsBlocked } from '../data/model'
import { reservationTaskMatches } from '../reservations/reservationTasks'
import { matchesRoomLocationFilters } from './roomLocations'

export const diagramFilters = [
  ['all', 'rooms.all'],
  ['arrivals', 'rooms.arrivalTodayShort'],
  ['departures', 'rooms.departureTodayShort'],
  ['ready', 'rooms.ready'],
  ['dirty', 'rooms.cleanShort'],
  ['unassigned', 'rooms.unassignedDiagram'],
  ['overdue', 'rooms.overdueDeparture'],
]

export const otherDiagramFilters = [
  ['empty', 'rooms.vacant'],
  ['confirmed', 'rooms.confirmed'],
  ['occupied', 'rooms.occupied'],
  ['blocked', 'rooms.blocked'],
]

function roomsOnDay(booking, day) {
  if (!booking.roomStays?.length) return bookingRooms(booking)
  const stays = bookingRoomStays(booking)
  const current = stays.filter((stay) => stay.start <= day && day < stay.end)
  if (current.length) return current.map((stay) => String(stay.room))
  const ended = stays.filter((stay) => stay.end <= day)
  const edge =
    ended.length === stays.length
      ? ended.reduce((last, stay) => (stay.end > last ? stay.end : last), '')
      : stays.reduce(
          (first, stay) =>
            stay.start > day && (!first || stay.start < first) ? stay.start : first,
          '',
        )
  return stays
    .filter((stay) => (ended.length === stays.length ? stay.end : stay.start) === edge)
    .map((stay) => String(stay.room))
}

function searchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
}

function matchesSearch(search, room, booking) {
  if (!search) return true
  if (
    [
      room,
      booking?.guest,
      booking?.id,
      ...(booking?.guests || []).map((guest) => guest?.name),
    ].some((value) => searchText(value).includes(search))
  )
    return true
  const digits = search.replace(/\D/g, '')
  const phones = [booking?.phone, ...(booking?.guests || []).map((guest) => guest?.phone)].filter(
    Boolean,
  )
  return phones.some(
    (phone) =>
      searchText(phone).includes(search) ||
      (digits.length >= 3 &&
        /^[\d\s.()+-]+$/.test(search) &&
        String(phone).replace(/\D/g, '').includes(digits)),
  )
}

const dailyTasks = ['arrivals', 'departures', 'overdue']
const taskFor = (booking, day) =>
  dailyTasks.find((task) => reservationTaskMatches[task](booking, day))

export function createRoomDiagram({
  rooms,
  bookings,
  roomTypes,
  roomBlocks,
  sellable,
  day,
  nextDay,
}) {
  const readyIds = new Set(
    sellable.filter((room) => room.condition === 'clean').map((room) => String(room.id)),
  )
  const typeNames = new Map(roomTypes.map((type) => [type.id, type.name]))
  const assigned = new Map()
  const unassigned = []
  for (const booking of bookings) {
    if (!active(booking)) continue
    const ids = new Set(roomsOnDay(booking, day))
    const entry = { booking, task: taskFor(booking, day) }
    if (!ids.size) unassigned.push(entry)
    for (const id of ids) {
      const entries = assigned.get(id) ?? []
      entries.push(entry)
      assigned.set(id, entries)
    }
  }
  const cards = rooms
    .filter((room) => room.active !== false)
    .map((room) => {
      const entries = assigned.get(String(room.id)) ?? []
      const blocked = roomIsBlocked(room, roomBlocks, day, nextDay)
      const current =
        entries.find(({ booking }) => booking.status === 'IN_HOUSE') ??
        entries.find(({ booking }) => overlaps(booking, day, nextDay))
      const dirty = ['dirty', 'inspection'].includes(room.condition)
      return {
        ...room,
        number: room.id,
        type: typeNames.get(room.typeId),
        current,
        tasks: entries.filter(({ task }) => task),
        blocked,
        dirty,
        ready: !current && !blocked && !dirty && readyIds.has(String(room.id)),
      }
    })
  return { cards, unassigned }
}

export function filterRoomDiagram({ cards, unassigned }, { status, search, typeId, area, floor }) {
  const needle = searchText(search.trim())
  const selectedRooms = []
  for (const room of cards) {
    if (
      status === 'unassigned' ||
      (typeId && room.typeId !== typeId) ||
      !matchesRoomLocationFilters(room, { area, floor })
    )
      continue
    const filters = {
      empty: !room.current && !room.blocked,
      confirmed: room.current?.booking.status === 'CONFIRMED',
      occupied: room.current?.booking.status === 'IN_HOUSE',
      ready: room.ready,
      dirty: room.dirty,
      blocked: room.blocked,
    }
    if (filters[status] === false) continue
    const candidates = dailyTasks.includes(status)
      ? room.tasks.filter(({ task }) => task === status)
      : status === 'all'
        ? [room.current, ...room.tasks]
        : [room.current]
    const entry = candidates.find(
      (item) => item && matchesSearch(needle, room.number, item.booking),
    )
    if (!entry && (dailyTasks.includes(status) || !matchesSearch(needle, room.number))) continue
    selectedRooms.push({ ...room, entry: entry ?? room.current })
  }
  const selectedUnassigned =
    !area && !floor && !typeId
      ? unassigned.filter(
          ({ booking, task }) =>
            matchesSearch(needle, null, booking) &&
            (status === 'all' ||
              status === 'unassigned' ||
              task === status ||
              (status === 'confirmed' && booking.status === 'CONFIRMED') ||
              (status === 'occupied' && booking.status === 'IN_HOUSE')),
        )
      : []
  return { rooms: selectedRooms, unassigned: selectedUnassigned }
}

export function roomCardStatus(room, booking = room.current?.booking) {
  if (room.blocked) return ['blocked', 'rooms.blocked']
  if (booking?.status === 'CONFIRMED') return ['confirmed', 'rooms.confirmed']
  if (booking?.status === 'IN_HOUSE') return ['occupied', 'rooms.occupied']
  if (room.dirty)
    return ['dirty', room.condition === 'inspection' ? 'hk.inspecting' : 'rooms.cleanShort']
  if (room.ready) return ['ready', 'rooms.ready']
  return ['empty', 'rooms.vacant']
}
