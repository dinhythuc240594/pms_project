const day10 = (value) => String(value ?? '').slice(0, 10)

export const reservationTaskMatches = {
  arrivals: (booking, day) => booking.status === 'CONFIRMED' && day10(booking.checkIn) === day,
  departures: (booking, day) => booking.status === 'IN_HOUSE' && day10(booking.checkOut) === day,
  overdue: (booking, day) => booking.status === 'IN_HOUSE' && day10(booking.checkOut) < day,
  inhouse: (booking) => booking.status === 'IN_HOUSE',
}
