import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

// Synthetic data only. The PMS context is mocked; MemoryRouter, draft guard, ARI and the booking panel are real.
// Dates are derived from today(settings.timezone) so the fixture never depends on a hard-coded current day.
const TZ = 'Asia/Ho_Chi_Minh'

const stay = (id, extra = {}) => {
  const row = {
    id,
    guest: 'Khách ' + id,
    phone: '',
    status: 'CONFIRMED',
    source: 'Direct',
    version: 1,
    currency: 'VND',
    total: 1000000,
    balance: 0,
    paid: 0,
    nightlyRates: [],
    payments: [],
    charges: [],
    notes: [],
    history: [],
    ...extra,
  }
  return {
    guests: [{ id: 'guest-' + id, name: row.guest, phone: row.phone, email: '', version: 1 }],
    ...row,
  }
}

function createHotel(bookings) {
  const calls = { payment: [], status: [], update: [], create: [] }
  const rooms = [
    ...['101', '102', '103'].map((id) => ({
      id,
      typeId: 'std',
      area: 'A',
      floor: 1,
      condition: 'clean',
      active: true,
    })),
    ...['201', '202'].map((id) => ({
      id,
      typeId: 'dlx',
      area: 'B',
      floor: 2,
      condition: 'clean',
      active: true,
    })),
  ]
  const noop = async () => {}
  const api = {
    settings: { timezone: TZ, currency: 'VND', checkInTime: '14:00', checkOutTime: '12:00' },
    tenant: { id: 'hotel-test', name: 'Hotel Test' },
    rooms,
    roomTypes: [
      { id: 'std', name: 'Standard', capacity: 2, price: 500000 },
      { id: 'dlx', name: 'Deluxe', capacity: 2, price: 900000 },
    ],
    bookingSources: [{ id: 'direct', name: 'Direct' }],
    roomBlocks: [],
    housekeepingTasks: [],
    services: [],
    workspaceRevision: 0,
    paymentMethods: [{ id: 'cash', name: 'Cash' }],
    funds: [{ id: 'fund', name: 'Cash fund', currency: 'VND' }],
    access: () => ({ allowed: true }),
    routeAccess: () => ({ allowed: true }),
    allowAction: () => true,
    runAction: async (_permission, _feature, action) => action(),
    cleanRoom: noop,
    dirtyRoom: noop,
    setCondition: noop,
    refreshWorkspace: noop,
    addCharge: noop,
    refundPayment: noop,
    adjustBooking: noop,
    addNote: noop,
    available: (_checkIn, _checkOut, typeId) =>
      rooms.filter((room) => !typeId || room.typeId === typeId),
    getAvailability: async () => ({ availability: [] }),
    quote: async () => ({ currency: 'VND', total: 0, nightlyRates: [] }),
    createBooking: async (payload) => {
      calls.create.push(payload)
      throw new Error('not used')
    },
    addPayment: async (...args) => {
      calls.payment.push(args)
    },
    changeStatus: async (...args) => {
      calls.status.push(args)
    },
    updateBooking: async (...args) => {
      calls.update.push(args)
    },
    bookings,
  }
  return { api, calls }
}

test('P1 ARI: calendar ranges, search, room filters and exact booking panels', async (t) => {
  await withDraftDom(async ({ React, act, document, window, load, mount, click, input }) => {
    const { MemoryRouter } = await import('react-router-dom')
    const { default: ARI } = await load('/src/apps/pms/rates-inventory/pages/ARI.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { today, addDays } = await load('/src/apps/pms/data/model.js')
    const { formatDate } = await load('/src/shared/lib/date.js')
    const { DraftGuardProvider } = await load('/src/shared/drafts/DraftGuardProvider.jsx')
    const h = React.createElement
    const flush = () =>
      act(async () => {
        await Promise.resolve()
      })

    const T = today(TZ)
    const fixture = () => [
      // Same guest name twice, different rooms and IDs.
      stay('BK-A1', {
        guest: 'Nguyễn An',
        phone: '0901 234 567',
        checkIn: T,
        checkOut: addDays(T, 2),
        rooms: ['101'],
        room: '101',
      }),
      stay('BK-A2', {
        guest: 'Nguyễn An',
        phone: '0911000222',
        balance: 500000,
        checkIn: addDays(T, 1),
        checkOut: addDays(T, 3),
        rooms: ['102'],
        room: '102',
      }),
      // Phone contains "101": a short room query must not match it; a secondary guest is searchable by name and phone.
      stay('BK-L', {
        guest: 'Lê Bình',
        phone: '0987101555',
        status: 'IN_HOUSE',
        checkIn: T,
        checkOut: addDays(T, 4),
        rooms: ['201'],
        room: '201',
        guests: [
          { id: 'g-l1', name: 'Lê Bình', phone: '0987101555', email: '', version: 1 },
          { id: 'g-l2', name: 'Đặng Thu', phone: '0933 444 555', email: '', version: 1 },
        ],
      }),
      // Crosses the 14-day boundary.
      stay('BK-LONG', {
        guest: 'Võ Long',
        checkIn: addDays(T, 12),
        checkOut: addDays(T, 16),
        rooms: ['102'],
        room: '102',
      }),
      // Only in the next window.
      stay('BK-NEXT', {
        guest: 'Phạm Dũng',
        checkIn: addDays(T, 15),
        checkOut: addDays(T, 17),
        rooms: ['202'],
        room: '202',
      }),
      // Cancelled booking never occupies the chart, so room 103 is an empty room.
      stay('BK-CX', {
        guest: 'Hủy Bỏ',
        status: 'CANCELLED',
        checkIn: T,
        checkOut: addDays(T, 1),
        rooms: ['103'],
        room: '103',
      }),
    ]

    async function mountAri({ days = 14, width = 1366 } = {}) {
      window.innerWidth = width
      const hotel = createHotel(fixture())
      const view = await mount(
        h(
          MemoryRouter,
          { initialEntries: ['/id/ari'] },
          h(DraftGuardProvider, null, h(PmsContext.Provider, { value: hotel.api }, h(ARI))),
        ),
      )
      await flush()
      if (days) await click(button(days + ' ngày'))
      return { ...view, calls: hotel.calls }
    }

    const all = (selector) => [...document.querySelectorAll(selector)]
    const button = (text) => all('button').find((node) => node.textContent.trim() === text)
    const search = () =>
      document.querySelector(
        'input[aria-label="Tìm khách, mã đặt phòng, số điện thoại hoặc số phòng"]',
      )
    const type = async (value) => {
      await input(search(), value)
      await flush()
    }
    const rowRooms = () => all('.ari-room-label').map((node) => node.getAttribute('data-room-id'))
    const trackRooms = () => all('.ari-room-track').map((node) => node.getAttribute('data-room-id'))
    const matchedRows = () =>
      all('.ari-room-label[data-match="true"]').map((node) => node.getAttribute('data-room-id'))
    const pill = (id) => document.querySelector(`.ari-booking[data-booking-id="${id}"]`)
    const pillIds = () =>
      [...new Set(all('.ari-booking').map((node) => node.getAttribute('data-booking-id')))].sort()
    const matchedPills = () =>
      all('.ari-booking.is-match')
        .map((node) => node.getAttribute('data-booking-id'))
        .sort()
    const pillRoom = (id) => pill(id)?.closest('.ari-room-track').getAttribute('data-room-id')
    const status = () =>
      document.querySelector('.ari-search-results [role="status"]')?.textContent ?? null
    const allRoomsMode = () => button('Tất cả phòng')
    const onlyMode = () => button('Chỉ phòng khớp')
    const rangeLabel = () => document.querySelector('.ari-date-label').textContent
    const range = (start, days = 14) =>
      days === 1
        ? formatDate(start)
        : `${formatDate(start)} – ${formatDate(addDays(start, days - 1))}`
    const typeHeaders = () =>
      all('.ari-room-type > span:first-child').map((node) => node.textContent)
    const filterToggle = () => document.querySelector('.ari-toolbar-actions button[aria-expanded]')
    const typeSelect = () => document.querySelector('select[aria-label="Lọc loại phòng"]')
    const todayButton = () => document.querySelector('.ari-today-button')
    const chart = () => document.querySelector('.ari-chart')
    const position = (id) =>
      ['--ari-start', '--ari-span'].map((property) =>
        Number(pill(id).style.getPropertyValue(property)),
      )
    const openId = () =>
      document.querySelector('.booking-detail-eyebrow')?.textContent.split(' · ').pop()
    const ALL_ROOMS = ['101', '102', '103', '201', '202']

    await t.test(
      'desktop defaults to seven days, with a fourteen-day view and clipped booking spans',
      async () => {
        const view = await mountAri({ days: null })
        assert.equal(rangeLabel(), range(T, 7))
        assert.equal(all('.ari-date-cell').length, 7)
        assert.equal(document.querySelector('.ari-date-cell[aria-current="date"]').dateTime, T)
        assert.deepEqual(pillIds(), ['BK-A1', 'BK-A2', 'BK-L'])
        await click(button('14 ngày'))
        assert.equal(rangeLabel(), range(T))
        assert.equal(all('.ari-date-cell').length, 14)
        assert.deepEqual(rowRooms(), ALL_ROOMS)
        assert.deepEqual(trackRooms(), ALL_ROOMS, 'label column and booking grid stay aligned')
        assert.deepEqual(
          pillIds(),
          ['BK-A1', 'BK-A2', 'BK-L', 'BK-LONG'],
          'cancelled and out-of-window stays are not drawn',
        )
        assert.equal(status(), null, 'no search summary without a query')
        assert.deepEqual(matchedPills(), [])
        assert.deepEqual(position('BK-A1'), [0, 2], 'stay from today spans two night columns')
        assert.equal(position('BK-A2')[0], 1, 'stay from tomorrow starts in the second column')
        assert.deepEqual(
          position('BK-LONG'),
          [12, 2],
          'boundary stay is clipped to the visible window',
        )
        assert.deepEqual(
          [pillRoom('BK-A1'), pillRoom('BK-A2'), pillRoom('BK-L')],
          ['101', '102', '201'],
        )
        assert.equal(pill('BK-A1').querySelector('.ari-balance-icon'), null)
        assert.ok(pill('BK-A2').querySelector('.ari-balance-icon'))
        assert.match(pill('BK-A2').getAttribute('aria-label'), /Còn phải thu/)
        await view.unmount()
      },
    )

    await t.test('phone ranges default to three or one day and allow switching', async () => {
      const view = await mountAri({ days: null, width: 390 })
      assert.equal(rangeLabel(), range(T, 3))
      assert.equal(all('.ari-date-cell').length, 3)
      await click(button('1 ngày'))
      assert.equal(rangeLabel(), range(T, 1))
      assert.equal(all('.ari-date-cell').length, 1)
      assert.deepEqual(position('BK-A1'), [0, 1])
      await click(document.querySelector('button[aria-label="1 ngày sau"]'))
      assert.equal(rangeLabel(), range(addDays(T, 1), 1))
      await view.unmount()
      const narrow = await mountAri({ days: null, width: 320 })
      assert.equal(all('.ari-date-cell').length, 1)
      await narrow.unmount()
    })

    await t.test(
      'today shortcuts count pending arrivals and departures using hotel dates',
      async () => {
        const view = await mountAri()
        const shortcuts = all('.ari-shortcuts a')
        assert.deepEqual(
          shortcuts.map((link) => link.getAttribute('href')),
          [
            `/id/reservations?task=arrivals&date=${T}`,
            `/id/reservations?task=departures&date=${T}`,
          ],
        )
        assert.deepEqual(
          shortcuts.map((link) => link.querySelector('strong').textContent),
          ['1', '0'],
        )
        await view.unmount()
      },
    )

    await t.test(
      'accent-insensitive duplicate guest names highlight both bookings without hiding other occupancy',
      async () => {
        const view = await mountAri()
        await type('nguyen an')
        assert.match(status(), /^2 phòng khớp · 2 đặt phòng khớp “nguyen an”/)
        assert.ok(status().includes(range(T)), 'summary states the date window it searched')
        assert.deepEqual(
          matchedPills(),
          ['BK-A1', 'BK-A2'],
          'both same-name bookings match by their own IDs',
        )
        assert.deepEqual(rowRooms(), ALL_ROOMS, 'full view keeps every room row')
        assert.deepEqual(
          pillIds(),
          ['BK-A1', 'BK-A2', 'BK-L', 'BK-LONG'],
          'full view keeps unrelated occupancy visible',
        )
        assert.equal(all('.ari-booking.is-dimmed').length, 0)
        assert.deepEqual(matchedRows(), ['101', '102'])
        assert.match(
          pill('BK-A1').getAttribute('aria-label'),
          /khớp tìm kiếm$/,
          'match is announced on the pill',
        )
        assert.doesNotMatch(pill('BK-L').getAttribute('aria-label'), /khớp tìm kiếm/)
        assert.equal(allRoomsMode().getAttribute('aria-pressed'), 'true')
        assert.equal(onlyMode().getAttribute('aria-pressed'), 'false')

        await click(onlyMode())
        assert.equal(onlyMode().getAttribute('aria-pressed'), 'true')
        assert.deepEqual(rowRooms(), ['101', '102'], 'only matching room rows remain')
        assert.deepEqual(trackRooms(), ['101', '102'])
        assert.deepEqual(typeHeaders(), ['Standard'], 'room types without matches collapse')
        assert.deepEqual(
          pillIds(),
          ['BK-A1', 'BK-A2', 'BK-LONG'],
          'a matched room still shows its other stays',
        )
        assert.equal(pill('BK-L'), null)

        await click(allRoomsMode())
        assert.deepEqual(rowRooms(), ALL_ROOMS)
        assert.equal(search().value, 'nguyen an', 'switching mode keeps the query')
        await view.unmount()
      },
    )

    await t.test(
      'reference and secondary guest names match, including uppercase Vietnamese accents',
      async () => {
        const view = await mountAri()
        await type('bk-l')
        assert.deepEqual(
          matchedPills(),
          ['BK-L', 'BK-LONG'],
          'reference substring matches both refs starting with BK-L',
        )
        await type('BK-LONG')
        assert.deepEqual(matchedPills(), ['BK-LONG'])
        assert.match(status(), /^1 phòng khớp · 1 đặt phòng khớp/)
        assert.deepEqual(matchedRows(), ['102'])
        await type('ĐẶNG THU')
        assert.deepEqual(matchedPills(), ['BK-L'], 'secondary guest name finds the booking')
        assert.deepEqual(matchedRows(), ['201'])
        await view.unmount()
      },
    )

    await t.test(
      'phone search ignores punctuation, needs five digits, and a room number does not match phone fragments',
      async () => {
        const view = await mountAri()
        await type('(0901) 234.567')
        assert.deepEqual(
          matchedPills(),
          ['BK-A1'],
          'punctuated phone matches the stored spaced phone',
        )
        assert.match(status(), /^1 phòng khớp · 1 đặt phòng khớp/)
        await type('0933-444')
        assert.deepEqual(matchedPills(), ['BK-L'], 'secondary guest phone is searchable')
        await type('71015')
        assert.deepEqual(matchedPills(), ['BK-L'], 'five-digit fragment matches inside the phone')

        await type('101')
        assert.deepEqual(matchedRows(), ['101'], 'short number is a room search')
        assert.deepEqual(matchedPills(), [], 'phone 0987101555 is not matched by room 101')
        assert.match(status(), /^1 phòng khớp · 0 đặt phòng khớp “101”/)
        assert.ok(pill('BK-L'))
        await view.unmount()
      },
    )

    await t.test('an empty room can match and be isolated', async () => {
      const view = await mountAri()
      await type('103')
      assert.match(status(), /^1 phòng khớp · 0 đặt phòng khớp/)
      assert.deepEqual(matchedRows(), ['103'])
      assert.deepEqual(
        pillIds(),
        ['BK-A1', 'BK-A2', 'BK-L', 'BK-LONG'],
        'full view still shows all occupancy',
      )
      await click(onlyMode())
      assert.deepEqual(rowRooms(), ['103'])
      assert.deepEqual(
        pillIds(),
        [],
        'the isolated room is visibly free; the cancelled stay is not drawn',
      )
      await view.unmount()
    })

    await t.test(
      'zero results are explicit, only-match recovers, and clear resets query and mode',
      async () => {
        const view = await mountAri()
        await type('khong ton tai')
        assert.match(status(), /^Không có phòng hoặc đặt phòng khớp “khong ton tai”/)
        assert.equal(onlyMode().disabled, true, 'cannot switch to an empty only-match view')
        assert.deepEqual(rowRooms(), ALL_ROOMS)
        assert.deepEqual(matchedPills(), [])
        assert.deepEqual(pillIds(), ['BK-A1', 'BK-A2', 'BK-L', 'BK-LONG'])

        await type('nguyen an')
        await click(onlyMode())
        await type('khong ton tai')
        assert.deepEqual(rowRooms(), [], 'only-match mode with no matches shows no rows')
        assert.ok(document.querySelector('.ari-no-match'), 'and explains why')
        assert.equal(onlyMode().disabled, false, 'the active mode stays operable')
        await click(button('Xem tất cả phòng'))
        assert.equal(document.querySelector('.ari-no-match'), null)
        assert.deepEqual(rowRooms(), ALL_ROOMS)
        assert.equal(allRoomsMode().getAttribute('aria-pressed'), 'true')

        await type('nguyen an')
        await click(onlyMode())
        await click(button('Xóa tìm kiếm'))
        assert.equal(search().value, '')
        assert.equal(status(), null)
        assert.deepEqual(rowRooms(), ALL_ROOMS)
        assert.deepEqual(matchedPills(), [], 'clear removes highlight')
        await type('nguyen an')
        assert.equal(
          allRoomsMode().getAttribute('aria-pressed'),
          'true',
          'clear also reset the only-match mode',
        )
        await view.unmount()
      },
    )

    await t.test(
      'room-type filter limits rows and the match counts, and is stated in the summary',
      async () => {
        const view = await mountAri()
        assert.equal(typeSelect(), null)
        await click(filterToggle())
        assert.equal(filterToggle().getAttribute('aria-expanded'), 'true')
        await input(typeSelect(), 'dlx')
        await flush()
        assert.deepEqual(rowRooms(), ['201', '202'])
        assert.deepEqual(typeHeaders(), ['Deluxe'])
        assert.deepEqual(pillIds(), ['BK-L'])

        await type('nguyen an')
        assert.match(
          status(),
          /^Không có phòng hoặc đặt phòng khớp/,
          'matches outside the filtered type are not counted',
        )
        assert.ok(status().endsWith(' · Deluxe'), 'summary names the active room type')
        await type('le binh')
        assert.match(status(), /^1 phòng khớp · 1 đặt phòng khớp/)
        assert.deepEqual(matchedRows(), ['201'])

        await input(typeSelect(), '')
        await flush()
        assert.deepEqual(rowRooms(), ALL_ROOMS)
        assert.ok(!status().includes('Deluxe'))
        await view.unmount()
      },
    )

    await t.test(
      '14-day navigation moves the window, re-runs the search in that context, and Today returns',
      async () => {
        const view = await mountAri()
        await type('pham dung')
        assert.match(
          status(),
          /^Không có phòng hoặc đặt phòng khớp/,
          'future stay is outside the first window',
        )
        assert.ok(status().includes(range(T)))

        await click(document.querySelector('button[aria-label="14 ngày sau"]'))
        assert.equal(rangeLabel(), range(addDays(T, 14)))
        assert.match(status(), /^1 phòng khớp · 1 đặt phòng khớp “pham dung”/)
        assert.ok(status().includes(range(addDays(T, 14))), 'summary follows the new window')
        assert.deepEqual(matchedPills(), ['BK-NEXT'])
        assert.deepEqual(pillIds(), ['BK-LONG', 'BK-NEXT'])
        assert.equal(position('BK-NEXT')[0], 1, 'positions are relative to the new window start')
        assert.deepEqual(
          position('BK-LONG'),
          [0, 2],
          'boundary stay continues from the first column',
        )
        assert.equal(pill('BK-A1'), null)

        await click(document.querySelector('button[aria-label="14 ngày trước"]'))
        assert.equal(rangeLabel(), range(T))
        await click(document.querySelector('button[aria-label="14 ngày sau"]'))
        await click(document.querySelector('button[aria-label="14 ngày sau"]'))
        assert.equal(rangeLabel(), range(addDays(T, 28)))
        chart().scrollLeft = 500
        chart().scrollTop = 240
        await click(todayButton())
        assert.equal(rangeLabel(), range(T), 'Today returns to the hotel day')
        assert.deepEqual([chart().scrollLeft, chart().scrollTop], [0, 0])
        chart().scrollLeft = 300
        await click(todayButton())
        assert.equal(chart().scrollLeft, 0, 'Today also resets scroll when the range is unchanged')
        assert.equal(search().value, 'pham dung', 'navigation keeps the query')
        await view.unmount()
      },
    )

    await t.test(
      'clicking a pill opens that exact booking and closing keeps the search context',
      async () => {
        const view = await mountAri()
        await type('nguyen an')
        assert.equal(document.querySelector('.booking-detail-panel'), null)
        await click(pill('BK-A2'))
        await flush()
        assert.equal(openId(), 'BK-A2', 'duplicate name opens the clicked booking ID')
        await click(document.querySelector('.booking-detail-header-actions button'))
        await flush()
        assert.equal(document.querySelector('.booking-detail-eyebrow'), null, 'panel closes')
        assert.equal(search().value, 'nguyen an')
        assert.deepEqual(matchedPills(), ['BK-A1', 'BK-A2'], 'highlight survives closing the panel')

        await click(pill('BK-A1'))
        await flush()
        assert.equal(openId(), 'BK-A1')
        await click(document.querySelector('.booking-detail-header-actions button'))
        await flush()
        assert.equal(document.querySelector('.booking-detail-eyebrow'), null)

        await click(pill('BK-L'))
        await flush()
        assert.equal(openId(), 'BK-L', 'unrelated stays remain clickable')
        await click(document.querySelector('.booking-detail-header-actions button'))
        await flush()
        assert.deepEqual(
          [
            view.calls.payment.length,
            view.calls.status.length,
            view.calls.update.length,
            view.calls.create.length,
          ],
          [0, 0, 0, 0],
          'viewing never writes',
        )
        await view.unmount()
      },
    )
  })
})
