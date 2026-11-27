import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

// Synthetic data only. The PMS context is mocked; router, draft guard, pages and panels are real.
const stay = (id, extra = {}) => ({
  id,
  guest: 'Nguyễn An',
  phone: '0901234567',
  status: 'IN_HOUSE',
  checkIn: '2026-01-10',
  checkOut: '2026-01-12',
  source: 'Direct',
  version: 1,
  rooms: ['201'],
  room: '201',
  currency: 'VND',
  total: 1000000,
  balance: 0,
  paid: 1000000,
  nightlyRates: [
    { room: '201', date: '2026-01-10', price: 500000 },
    { room: '201', date: '2026-01-11', price: 500000 },
  ],
  guests: [{ id: 'guest-' + id, name: 'Nguyễn An', phone: '0901234567', email: '', version: 1 }],
  payments: [],
  charges: [],
  notes: [],
  history: [],
  ...extra,
})

const hotelToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const shift = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const person = (id, guest, phone, extra = {}) =>
  stay(id, {
    guest,
    phone,
    guests: [{ id: 'guest-' + id, name: guest, phone, email: '', version: 1 }],
    ...extra,
  })

function createHotel(bookings, options = {}) {
  const calls = {
    quote: [],
    availability: [],
    create: [],
    payment: [],
    status: [],
    note: [],
    update: [],
  }
  const state = {
    bookings,
    lost: new Set(),
    inventory: [],
    gates: {},
    availabilityError: null,
    createError: null,
    statusError: null,
  }
  const listeners = new Set()
  const hotel = {
    calls,
    state,
    publish() {
      for (const notify of [...listeners]) notify()
    },
    subscribe(notify) {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
  }
  const gate = (name) => {
    const held = state.gates[name]
    delete state.gates[name]
    return held?.promise
  }
  const patch = (id, change) => {
    state.bookings = state.bookings.map((row) => (row.id === id ? { ...row, ...change(row) } : row))
    hotel.publish()
  }
  const rooms =
    options.rooms ||
    ['101', '102', '201'].map((id) => ({
      id,
      typeId: 'std',
      area: 'Khu A',
      floor: 1,
      condition: 'clean',
      active: true,
    }))
  const noop = async () => {}
  hotel.api = {
    settings: {
      timezone: 'Asia/Ho_Chi_Minh',
      currency: 'VND',
      checkInTime: '14:00',
      checkOutTime: '12:00',
    },
    tenant: { id: 'hotel-test', name: 'Hotel Test' },
    rooms,
    roomTypes: [{ id: 'std', name: 'Standard', capacity: 2, price: 500000 }],
    bookingSources: [{ id: 'direct', name: 'Direct' }],
    roomBlocks: [],
    housekeepingTasks: [],
    services: [],
    workspaceRevision: 0,
    paymentMethods: [{ id: 'cash', name: 'Cash' }],
    funds: [{ id: 'fund', name: 'Cash fund', currency: 'VND' }],
    access: () => ({ allowed: true }),
    allowAction: () => true,
    runAction: async (_permission, _feature, action) => action(),
    cleanRoom: noop,
    dirtyRoom: noop,
    setCondition: noop,
    refreshWorkspace: noop,
    addCharge: noop,
    refundPayment: noop,
    adjustBooking: noop,
    available: (_checkIn, _checkOut, typeId) =>
      rooms.filter(
        (room) =>
          !state.lost.has(room.id) && room.id !== '201' && (!typeId || room.typeId === typeId),
      ),
    getAvailability: async (checkIn, checkOut, typeId) => {
      calls.availability.push([checkIn, checkOut, typeId])
      await gate('availability')
      if (state.availabilityError) throw state.availabilityError
      return { availability: state.inventory }
    },
    quote: async (payload) => {
      calls.quote.push(payload)
      await gate('quote')
      return {
        currency: 'VND',
        total: 500000 * payload.rooms.length,
        nightlyRates: payload.rooms.map((room) => ({ room, date: payload.checkIn, price: 500000 })),
      }
    },
    createBooking: async (payload) => {
      calls.create.push(payload)
      if (state.createError) throw state.createError
      const created = stay('BK-NEW-7', {
        guest: payload.guests[0].name,
        status: 'CONFIRMED',
        rooms: payload.rooms,
        room: payload.rooms[0],
        checkIn: payload.checkIn,
        checkOut: payload.checkOut,
        balance: 500000,
        paid: 0,
      })
      state.bookings = [...state.bookings, created]
      hotel.publish()
      return created
    },
    addPayment: async (id, payload) => {
      calls.payment.push([id, payload])
      await gate('payment')
      patch(id, (row) => ({ balance: 0, paid: row.total, version: row.version + 1 }))
    },
    changeStatus: async (id, status, version) => {
      calls.status.push([id, status, version])
      await gate('status')
      if (state.statusError) throw state.statusError
      patch(id, (row) => ({ status, version: row.version + 1 }))
    },
    addNote: async (id, payload) => {
      calls.note.push([id, payload])
    },
    updateBooking: async (id, payload) => {
      calls.update.push([id, payload])
      await gate('update')
      patch(id, (row) => ({ version: row.version + 1 }))
    },
    getDashboardReport: async () => ({
      arriving: 0,
      departing: state.bookings.length,
      occupied: state.bookings.length,
      activeRooms: 3,
      occupancy: 66.7,
      chart: [],
      currency: 'VND',
      arrivalBookings: [],
      alerts: { dirtyRooms: [], inspectionRooms: [], overdueDepartures: [], pendingArrivals: [] },
      departureBookings: state.bookings.map((row) => ({
        id: row.id,
        guest: row.guest,
        rooms: row.rooms,
        balance: row.balance,
        currency: row.currency,
      })),
    }),
  }
  return hotel
}

test('front desk flows keep the right booking, tab, drafts and writes together', async (t) => {
  await withDraftDom(async ({ React, act, window, document, load, mount, click, input }) => {
    const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router-dom')
    const { default: Reservations } = await load(
      '/src/apps/pms/reservations/pages/Reservations.jsx',
    )
    const { default: RoomDiagram } = await load('/src/apps/pms/rooms/pages/RoomDiagram.jsx')
    const { default: Dashboard } = await load('/src/apps/pms/dashboard/pages/Dashboard.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { DraftGuardProvider, DraftRouteGuard } = await load(
      '/src/shared/drafts/DraftGuardProvider.jsx',
    )
    const h = React.createElement
    const settle = () =>
      act(async () => {
        await new Promise((done) => setTimeout(done, 0))
      })

    async function mountApp(entries, bookings, initialIndex, options) {
      const hotel = createHotel(bookings, options)
      function Shell() {
        const [, bump] = React.useReducer((count) => count + 1, 0)
        React.useEffect(() => hotel.subscribe(bump), [bump])
        return h(
          DraftGuardProvider,
          null,
          h(DraftRouteGuard),
          h(
            PmsContext.Provider,
            { value: { ...hotel.api, bookings: hotel.state.bookings } },
            h('main', { className: 'pms-main' }, h(Outlet)),
          ),
        )
      }
      const router = createMemoryRouter(
        [
          {
            path: '/id',
            element: h(Shell),
            children: [
              { path: 'dashboard', element: h(Dashboard) },
              { path: 'reservations', element: h(Reservations) },
              { path: 'room-diagram', element: h(RoomDiagram) },
              { path: 'housekeeping/*', element: h('p', null, 'Housekeeping') },
            ],
          },
        ],
        { initialEntries: [].concat(entries), initialIndex },
      )
      const view = await mount(h(RouterProvider, { router }))
      await settle()
      const go = async (to) => {
        await act(async () => {
          await router.navigate(to)
        })
        await settle()
      }
      return {
        ...view,
        hotel,
        calls: hotel.calls,
        go,
        params: () => new URLSearchParams(router.state.location.search),
        search: () => router.state.location.search,
      }
    }

    const all = (selector) => [...document.querySelectorAll(selector)]
    const button = (text) => all('button').find((node) => node.textContent.trim() === text)
    const field = (label) => document.querySelector(`input[aria-label="${label}"]`)
    const choose = (label) => document.querySelector(`select[aria-label="${label}"]`)
    const tab = async (label) => {
      await click(
        all('.booking-detail-tabs button').find((node) => node.textContent.trim() === label),
      )
    }
    const panel = () => document.querySelector('.booking-detail-panel')
    const openId = () =>
      document.querySelector('.booking-detail-eyebrow')?.textContent.split(' · ').pop()
    const openTab = () => document.querySelector('.booking-detail-tab-picker select')?.value
    const confirmation = () => document.querySelector('.draft-confirmation')
    const checkout = () => button('Trả phòng (Check-out)')
    const saveDetails = () =>
      document.querySelector('.booking-detail-footer-actions .booking-detail-button--primary')
    const submitForm = (control) =>
      act(async () => {
        control
          .closest('form')
          .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      })
    const hold = (view, name) => (view.hotel.state.gates[name] = Promise.withResolvers())
    const checkRooms = async () => {
      await click(all('button').find((node) => node.textContent.includes('Kiểm tra phòng trống')))
      await settle()
    }
    const footer = () => all('.booking-create-footer-actions button')
    const roomBox = (id) =>
      all('.booking-create-room-options label')
        .find((node) => node.textContent.trim().endsWith(id))
        ?.querySelector('input')
    const roomCard = (id) =>
      all('button.loha-room-card').find((node) =>
        node.querySelector('.loha-room-card-title strong')?.textContent.includes(id),
      )
    const iso = (text) => text.split('/').reverse().join('-')
    const laterDate = (text, days) => {
      const [day, month, year] = text.split('/').map(Number)
      return new Date(Date.UTC(year, month - 1, day + days))
        .toISOString()
        .slice(0, 10)
        .split('-')
        .reverse()
        .join('/')
    }
    async function openDiagramCreate(view, room) {
      await click(roomCard(room))
      await click(document.querySelector('.loha-rooms-primary'))
      await settle()
      assert.ok(
        document.querySelector('.booking-create-panel'),
        'the create form opens from the diagram',
      )
      assert.deepEqual(
        view.calls.quote.at(-1).rooms,
        [room],
        'the diagram room is preselected as a string id',
      )
      assert.equal(
        document.querySelector('.booking-create-steps'),
        null,
        'an ordinary booking is not presented as a walk-in',
      )
      assert.equal(
        view.calls.availability.length,
        0,
        'an ordinary booking keeps the manual availability check',
      )
    }
    async function openWalkIn(room) {
      await click(roomCard(room))
      await click(document.querySelector('.loha-room-walk-in'))
      await settle()
      assert.ok(document.querySelector('.booking-create-panel'), 'the walk-in create form opens')
    }
    const createError = () => document.querySelector('.booking-create-error')?.textContent ?? ''
    async function moveCheckOut() {
      const checkOut = field('Ngày trả phòng')
      const next = laterDate(checkOut.value, 2)
      await input(checkOut, next)
      await settle()
      return iso(next)
    }

    await t.test(
      'a diagram room survives a date change and a same-type filter after fresh availability checks',
      async () => {
        const view = await mountApp('/id/room-diagram', [stay('BK-S')])
        await openDiagramCreate(view, '101')
        assert.equal(footer()[2].disabled, true, 'availability must be checked before creating')
        const checkOut = await moveCheckOut()
        assert.equal(view.calls.quote.at(-1).checkOut, checkOut)
        assert.deepEqual(view.calls.quote.at(-1).rooms, ['101'])
        assert.equal(footer()[2].disabled, true)
        await checkRooms()
        assert.equal(view.calls.availability.length, 1)
        assert.deepEqual(view.calls.availability[0].slice(1), [checkOut, ''])
        assert.equal(roomBox('101').checked, true)
        assert.equal(footer()[2].disabled, false)

        await input(choose('Loại phòng mong muốn'), 'std')
        await settle()
        assert.equal(footer()[2].disabled, true, 'a filter change forces a new availability check')
        await checkRooms()
        assert.deepEqual(view.calls.availability.at(-1), [
          view.calls.availability[0][0],
          checkOut,
          'std',
        ])
        assert.equal(roomBox('101').checked, true)
        assert.equal(
          footer()[2].disabled,
          false,
          'the quote is still valid for the same room and dates',
        )
        await input(field('Họ và tên khách'), 'Trần Bình')
        await click(footer()[2])
        await settle()
        assert.equal(view.calls.create.length, 1)
        assert.deepEqual(view.calls.create[0].rooms, ['101'])
        assert.equal(view.calls.create[0].checkOut, checkOut)
        assert.equal(document.querySelector('.booking-create-panel'), null)
        assert.equal(openId(), 'BK-NEW-7')
        assert.equal(openTab(), 'details')
        await view.unmount()
      },
    )

    for (const [reason, lose] of [
      [
        'stop-sell',
        (hotel) => {
          hotel.state.inventory = [{ roomTypeId: 'std', stopSell: true, available: 3 }]
        },
      ],
      [
        'sold out',
        (hotel) => {
          hotel.state.inventory = [{ roomTypeId: 'std', stopSell: false, available: 0 }]
        },
      ],
      [
        'physically taken',
        (hotel) => {
          hotel.state.lost.add('102')
        },
      ],
    ]) {
      await t.test(
        `a preselected room that became ${reason} is pruned and cannot be created`,
        async () => {
          const view = await mountApp('/id/room-diagram', [stay('BK-S')])
          await openDiagramCreate(view, '102')
          lose(view.hotel)
          await moveCheckOut()
          await checkRooms()
          assert.match(document.querySelector('.booking-create-error').textContent, /102/)
          assert.equal(roomBox('102'), undefined)
          assert.equal(
            all('.booking-create-room-options input').some((node) => node.checked),
            false,
          )
          assert.equal(field('Họ và tên khách').disabled, true)
          for (const submit of footer().slice(1)) {
            assert.equal(submit.disabled, true)
            await click(submit)
          }
          assert.equal(view.calls.create.length, 0)
          await view.unmount()
        },
      )
    }

    const diagramRooms = [
      ['101', 'Khu A', 1],
      ['102', 'Khu A', 1],
      ['201', 'Khu A', 2],
      ['301', 'Khu B', 3],
    ].map(([id, area, floor]) => ({
      id,
      typeId: 'std',
      area,
      floor,
      condition: 'clean',
      active: true,
    }))
    function diagramBookings() {
      const day = hotelToday()
      const dates = { checkIn: shift(day, -1), checkOut: shift(day, 1) }
      return [
        person('BK-DUP-1', 'Phạm Hoa', '0911000111', { rooms: ['101'], room: '101', ...dates }),
        person('BK-DUP-2', 'Phạm Hoa', '0922000222', { rooms: ['201'], room: '201', ...dates }),
        // Moved today from 301 to 102: rooms[] still lists the old room.
        person('BK-MOVE', 'Đỗ Minh', '0933000333', {
          rooms: ['301', '102'],
          room: '301',
          checkIn: shift(day, -2),
          checkOut: shift(day, 2),
          roomStays: [
            { room: '301', start: shift(day, -2), end: day },
            { room: '102', start: day, end: shift(day, 2) },
          ],
        }),
        // Assigned only through rooms[] (no legacy room field): not unassigned.
        person('BK-ROOMS', 'Vũ Lan', '0944000444', {
          status: 'CONFIRMED',
          rooms: ['301'],
          room: '',
          checkIn: day,
          checkOut: shift(day, 1),
        }),
        person('BK-UN', 'Hồ Nam', '0955000555', {
          status: 'CONFIRMED',
          rooms: [],
          room: '',
          checkIn: day,
          checkOut: shift(day, 1),
        }),
      ]
    }
    const visibleRooms = () => diagramRooms.map((room) => room.id).filter((id) => roomCard(id))
    const unassignedIds = () =>
      all('.loha-rooms-unassigned [data-booking-id]').map((node) => node.dataset.bookingId)
    const guestIn = (id) =>
      roomCard(id)?.querySelector('.loha-room-guest')?.textContent.trim() ?? null
    const searchFor = async (text) => {
      await input(document.querySelector('#diagram-search'), text)
      await settle()
    }
    const resultCount = () => document.querySelector('.loha-rooms-result-count').textContent

    await t.test(
      'diagram search matches room, booking ref and phone; duplicate names stay separate; moved and rooms[]-only stays sit in their current room',
      async () => {
        const view = await mountApp('/id/room-diagram', diagramBookings(), 0, {
          rooms: diagramRooms,
        })
        assert.equal(
          guestIn('102'),
          'Đỗ Minh',
          'the moved guest is shown in the current roomStays room',
        )
        assert.equal(
          guestIn('301'),
          'Vũ Lan',
          'the vacated room is not attached to the moved guest',
        )
        assert.deepEqual(
          unassignedIds(),
          ['BK-UN'],
          'a rooms[]-only assignment is not listed as unassigned',
        )

        await searchFor('102')
        assert.deepEqual(visibleRooms(), ['102'])
        assert.match(resultCount(), /1\/4/)
        await searchFor('bk-dup-2')
        assert.deepEqual(visibleRooms(), ['201'], 'booking ref search is case-insensitive')
        await searchFor('0922 000 222')
        assert.deepEqual(visibleRooms(), ['201'], 'a formatted phone matches by digits')
        await searchFor('Đỗ Minh')
        assert.deepEqual(
          visibleRooms(),
          ['102'],
          'the old room of a moved stay does not match its guest',
        )
        await searchFor('0955000555')
        assert.deepEqual(
          [visibleRooms(), unassignedIds()],
          [[], ['BK-UN']],
          'an unassigned booking is found by phone',
        )
        assert.match(resultCount(), /1 đặt phòng chưa xếp phòng/)
        assert.equal(
          document.querySelector('.loha-rooms-empty'),
          null,
          'a matching unassigned booking is not reported as no result',
        )

        await searchFor('Phạm Hoa')
        assert.deepEqual(
          visibleRooms(),
          ['101', '201'],
          'both guests with the same name are listed',
        )
        assert.deepEqual(unassignedIds(), [])
        await click(roomCard('201'))
        const info = document.querySelector('.loha-room-dialog-info').textContent
        assert.ok(
          info.includes('BK-DUP-2') && !info.includes('BK-DUP-1'),
          'the selected card opens its own booking',
        )
        await click(document.querySelector('.loha-room-close'))

        // Location + search combine; clearing restores everything.
        await click(document.querySelector('.loha-rooms-filter-trigger'))
        const area = all('.loha-rooms-filters select').find((node) =>
          [...node.options].some((option) => option.textContent.includes('Khu B')),
        )
        assert.ok(area, 'an area filter is offered')
        const khuB = [...area.options].find((option) => option.textContent.includes('Khu B')).value
        await input(area, khuB)
        await settle()
        assert.deepEqual(visibleRooms(), [], 'search and location filters are combined')
        assert.ok(document.querySelector('.loha-rooms-empty'))
        await searchFor('')
        assert.deepEqual(
          [visibleRooms(), unassignedIds()],
          [['301'], []],
          'a location filter hides unassigned bookings',
        )
        await searchFor('vũ')
        assert.deepEqual(visibleRooms(), ['301'])
        await click(document.querySelector('.legend-all'))
        await settle()
        assert.equal(document.querySelector('#diagram-search').value, '')
        assert.equal(area.value, '')
        assert.deepEqual(
          [visibleRooms(), unassignedIds()],
          [['101', '102', '201', '301'], ['BK-UN']],
        )
        assert.equal(document.querySelector('.loha-rooms-results'), null)
        assert.deepEqual([view.calls.status.length, view.calls.create.length], [0, 0])
        await view.unmount()
      },
    )

    const checkInButton = () =>
      all('.booking-detail-panel button').find((node) =>
        /Nhận phòng|Check-in/i.test(node.textContent),
      )
    const bookingStatus = (view, id) =>
      view.hotel.state.bookings.find((row) => row.id === id)?.status

    await t.test(
      'diagram queues open the correct same-day stay directly and preserve the map after returning',
      async () => {
        const day = hotelToday()
        const view = await mountApp(
          '/id/room-diagram',
          [
            stay('BK-OUT', {
              checkIn: shift(day, -1),
              checkOut: day,
              balance: 200000,
              paid: 800000,
              version: 3,
            }),
            person('BK-IN', 'Đỗ Mai', '0911000000', {
              status: 'CONFIRMED',
              checkIn: day,
              checkOut: shift(day, 1),
            }),
            stay('BK-NO-ROOM', {
              status: 'CONFIRMED',
              rooms: [],
              room: '',
              checkIn: day,
              checkOut: shift(day, 1),
            }),
          ],
          0,
          { rooms: diagramRooms },
        )
        try {
          const chip = (key) => document.querySelector('.legend-' + key)
          const chipCount = (key) => chip(key).querySelector('strong').textContent
          assert.equal(chipCount('arrivals'), '2')
          assert.equal(chipCount('departures'), '1')
          assert.equal(chipCount('ready'), '3')
          assert.equal(chipCount('unassigned'), '1')
          assert.equal(chip('overdue'), null)
          assert.match(roomCard('201').textContent, /Đến và trả hôm nay/)
          assert.match(roomCard('201').textContent, /Còn phải thu 200\.000/)

          await click(chip('unassigned'))
          assert.deepEqual([visibleRooms(), unassignedIds()], [[], ['BK-NO-ROOM']])
          await click(chip('arrivals'))
          assert.deepEqual([visibleRooms(), unassignedIds()], [['201'], ['BK-NO-ROOM']])
          await searchFor('do mai')
          assert.equal(chipCount('arrivals'), '1')
          assert.equal(guestIn('201'), 'Đỗ Mai')
          await click(roomCard('201'))
          assert.equal(openId(), 'BK-IN')
          assert.equal(openTab(), 'details')
          assert.ok(checkInButton())
          assert.equal(document.querySelector('.loha-room-dialog'), null)
          assert.deepEqual(view.calls.status, [])
          await click(document.querySelector('.booking-detail-header-actions button'))

          await click(chip('all'))
          await click(chip('departures'))
          const scroller = document.querySelector('.pms-main')
          scroller.scrollTop = 75
          await click(roomCard('201'))
          assert.equal(openId(), 'BK-OUT')
          assert.equal(openTab(), 'thanhtoán')
          assert.equal(document.querySelector('.loha-room-dialog'), null)
          assert.ok(
            field('Số tiền thanh toán').compareDocumentPosition(checkout()) &
              window.Node.DOCUMENT_POSITION_FOLLOWING,
          )
          assert.equal(checkout().disabled, true)
          assert.deepEqual(view.calls.payment, [])
          await click(button('Thu đủ còn lại'))
          await click(button('Ghi nhận thanh toán'))
          assert.equal(view.calls.payment.length, 1)
          assert.equal(checkout().disabled, false)
          await click(checkout())
          assert.deepEqual(view.calls.status, [['BK-OUT', 'CHECKED_OUT', 4]])
          scroller.scrollTop = 0
          await click(document.querySelector('.booking-detail-header-actions button'))
          assert.equal(document.activeElement, chip('departures'))
          assert.equal(scroller.scrollTop, 75)
          assert.equal(chip('departures').getAttribute('aria-pressed'), 'true')
          assert.equal(chipCount('departures'), '0')
          assert.equal(roomCard('201'), undefined)
          assert.deepEqual([view.calls.availability, view.calls.quote], [[], []])
        } finally {
          await view.unmount()
        }
      },
    )

    await t.test(
      'walk-in reads availability automatically, creates one CONFIRMED booking, and check-in stays one explicit retryable mutation',
      async () => {
        const view = await mountApp('/id/room-diagram', [stay('BK-S')])
        await openDiagramCreate(view, '101')
        await click(document.querySelector('.booking-create-close'))
        await settle()
        assert.equal(document.querySelector('.booking-create-panel'), null)

        const day = hotelToday()
        await openWalkIn('101')
        assert.ok(document.querySelector('.booking-create-steps'), 'the walk-in steps are shown')
        assert.deepEqual(
          view.calls.availability,
          [[day, shift(day, 1), '']],
          'exactly one automatic availability read',
        )
        assert.deepEqual(view.calls.quote.at(-1).rooms, ['101'])
        assert.equal(roomBox('101').checked, true)
        assert.equal(footer()[2].disabled, false)
        assert.match(footer()[2].textContent, /Bước 1/)
        assert.deepEqual(
          [view.calls.create.length, view.calls.status.length],
          [0, 0],
          'opening a walk-in never writes',
        )

        await input(field('Họ và tên khách'), 'Trần Bình')
        await click(footer()[2])
        await settle()
        assert.equal(view.calls.create.length, 1)
        assert.deepEqual(
          [view.calls.create[0].rooms, view.calls.create[0].checkIn, view.calls.create[0].checkOut],
          [['101'], day, shift(day, 1)],
        )
        assert.equal(
          bookingStatus(view, 'BK-NEW-7'),
          'CONFIRMED',
          'creation does not check the guest in',
        )
        assert.equal(view.calls.status.length, 0)
        assert.equal(document.querySelector('.booking-create-panel'), null)
        assert.equal(openId(), 'BK-NEW-7')

        assert.ok(checkInButton(), 'check-in is offered as a separate action')
        view.hotel.state.statusError = new Error('Không thể nhận phòng lúc này.')
        await click(checkInButton())
        await settle()
        assert.deepEqual(view.calls.status, [['BK-NEW-7', 'IN_HOUSE', 1]])
        assert.equal(bookingStatus(view, 'BK-NEW-7'), 'CONFIRMED')
        assert.equal(view.calls.create.length, 1, 'a failed check-in never recreates the booking')
        assert.equal(openId(), 'BK-NEW-7')
        assert.equal(document.querySelector('.booking-create-panel'), null)

        view.hotel.state.statusError = null
        await click(checkInButton())
        await settle()
        assert.equal(view.calls.status.length, 2)
        assert.deepEqual(view.calls.status[1], ['BK-NEW-7', 'IN_HOUSE', 1])
        assert.equal(bookingStatus(view, 'BK-NEW-7'), 'IN_HOUSE')
        assert.equal(view.calls.create.length, 1)
        assert.equal(view.hotel.state.bookings.filter((row) => row.id === 'BK-NEW-7').length, 1)
        await view.unmount()
      },
    )

    await t.test(
      'walk-in availability failures block create: a later quote cannot hide them, retries are manual, stale reads are ignored, typed invalid dates never read',
      async () => {
        const view = await mountApp('/id/room-diagram', [stay('BK-S')])
        const quoteGate = hold(view, 'quote')
        view.hotel.state.availabilityError = new Error('Mất kết nối kiểm tra phòng.')
        await openWalkIn('101')
        assert.equal(view.calls.availability.length, 1)
        assert.match(createError(), /Mất kết nối/)
        await act(async () => quoteGate.resolve())
        await settle()
        assert.ok(view.calls.quote.length >= 1)
        assert.match(
          createError(),
          /Mất kết nối/,
          'a quote that succeeds after the failed read keeps the error',
        )
        assert.equal(footer()[2].disabled, true, 'the failed read still blocks create')
        await click(footer()[2])
        assert.equal(
          view.calls.availability.length,
          1,
          'a failed read is not retried automatically',
        )

        view.hotel.state.availabilityError = null
        await checkRooms()
        assert.equal(createError(), '')
        assert.equal(footer()[2].disabled, false)
        view.hotel.state.availabilityError = new Error('Mất kết nối kiểm tra phòng.')
        await checkRooms()
        assert.match(createError(), /Mất kết nối/)
        assert.equal(roomBox('101'), undefined, 'the earlier successful result is withdrawn')
        for (const submit of footer().slice(1)) {
          assert.equal(submit.disabled, true)
          await click(submit)
        }
        assert.equal(view.calls.create.length, 0, 'a failed retry blocks create')
        view.hotel.state.availabilityError = null
        await checkRooms()
        assert.equal(footer()[2].disabled, false)

        // Reordered reads: the older read resolves last with stop-sell and is ignored.
        const before = view.calls.availability.length
        const stale = hold(view, 'availability')
        await moveCheckOut()
        const latest = await moveCheckOut()
        assert.equal(
          view.calls.availability.length,
          before + 2,
          'each valid date change reads once',
        )
        assert.equal(view.calls.availability.at(-1)[1], latest)
        view.hotel.state.inventory = [{ roomTypeId: 'std', stopSell: true, available: 0 }]
        await act(async () => stale.resolve())
        await settle()
        view.hotel.state.inventory = []
        assert.equal(createError(), '', 'the superseded result is ignored')
        assert.equal(roomBox('101').checked, true)
        assert.equal(view.calls.quote.at(-1).checkOut, latest)
        assert.equal(footer()[2].disabled, false)

        // A typed invalid date neither reads nor creates.
        const reads = view.calls.availability.length
        const checkOut = field('Ngày trả phòng')
        await input(checkOut, '32/13/2026')
        await act(async () => {
          checkOut.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
        })
        await settle()
        await checkRooms()
        await input(field('Họ và tên khách'), 'Trần Bình')
        for (const submit of footer().slice(1)) await click(submit)
        await settle()
        assert.equal(view.calls.availability.length, reads, 'an invalid typed date never reads')
        assert.equal(view.calls.create.length, 0)
        await view.unmount()
      },
    )

    await t.test(
      'create-and-collect opens the returned booking on payments without charging or changing status',
      async () => {
        const view = await mountApp('/id/reservations?view=compact', [stay('BK-OLD')])
        await click(document.querySelector('.loha-reservations-actions .is-primary'))
        await checkRooms()
        await click(roomBox('101'))
        await settle()
        await input(field('Họ và tên khách'), 'Lê Chi')
        await click(footer()[1])
        await settle()
        assert.equal(view.calls.create.length, 1)
        assert.deepEqual(
          [view.params().get('booking'), view.params().get('tab'), view.params().get('view')],
          ['BK-NEW-7', 'payments', 'compact'],
        )
        assert.equal(document.querySelector('.booking-create-panel'), null)
        assert.equal(openId(), 'BK-NEW-7')
        assert.equal(openTab(), 'thanhtoán')
        assert.equal(confirmation(), null)
        assert.deepEqual([view.calls.payment.length, view.calls.status.length], [0, 0])
        await view.unmount()
      },
    )

    await t.test(
      'dashboard rows with the same guest name open their own booking on payments',
      async () => {
        const view = await mountApp('/id/dashboard', [
          stay('BK-A1'),
          stay('BK/A2&dup', { rooms: ['102'], room: '102', balance: 150000 }),
        ])
        const rows = all('.pms-dashboard-booking')
        assert.equal(rows.length, 2)
        assert.equal(
          new Set(rows.map((row) => row.querySelector('.pms-dashboard-guest strong').textContent))
            .size,
          1,
          'both rows show the same name',
        )
        await click(
          rows
            .find(
              (row) => row.querySelector('.pms-dashboard-booking-id').textContent === '#BK/A2&dup',
            )
            .querySelector('a'),
        )
        await settle()
        assert.deepEqual(
          [view.params().get('booking'), view.params().get('tab')],
          ['BK/A2&dup', 'payments'],
        )
        assert.equal(openId(), 'BK/A2&dup')
        assert.equal(openTab(), 'thanhtoán')
        assert.equal(view.calls.payment.length, 0)
        await view.unmount()
      },
    )

    await t.test(
      'diagram Services opens the occupied room booking directly on the services tab',
      async () => {
        const day = hotelToday()
        const view = await mountApp('/id/room-diagram', [
          stay('BK-OTHER', { rooms: ['301'], room: '301' }),
          stay('BK-S', { checkIn: shift(day, -1), checkOut: shift(day, 1) }),
        ])
        await click(roomCard('201'))
        await click(button('Dịch vụ'))
        assert.equal(openId(), 'BK-S')
        assert.equal(openTab(), 'dịchvụ')
        const chargeForm = document.querySelector('.booking-detail-section form')
        assert.ok(
          chargeForm && !chargeForm.closest('[hidden]'),
          'the charge form is visible immediately',
        )
        await view.unmount()
      },
    )

    await t.test(
      'a balance blocks checkout; a pending payment blocks every other writer; then one checkout uses the new version',
      async () => {
        const view = await mountApp('/id/reservations?booking=BK-P&tab=payments', [
          stay('BK-P', { version: 3, balance: 200000, paid: 800000 }),
        ])
        assert.equal(openTab(), 'thanhtoán')
        assert.equal(checkout().disabled, true)
        await click(checkout())
        assert.equal(view.calls.status.length, 0)

        await input(field('Số tiền thanh toán'), '200000')
        await input(choose('Phương thức thanh toán'), 'cash')
        await input(choose('Quỹ nhận tiền'), 'fund')
        const payment = hold(view, 'payment')
        await click(button('Ghi nhận thanh toán'))
        assert.equal(view.calls.payment.length, 1)
        await submitForm(field('Số tiền thanh toán'))
        assert.equal(view.calls.payment.length, 1, 'the same form cannot submit twice')
        await tab('Ghi chú')
        assert.equal(field('Ghi chú mới').disabled, true)
        await input(field('Ghi chú mới'), 'Blocked note')
        assert.equal(field('Ghi chú mới').value, '')
        await submitForm(field('Ghi chú mới'))
        assert.equal(view.calls.note.length, 0, 'a sibling tab cannot write during the payment')
        await tab('Chi tiết')
        assert.equal(saveDetails().disabled, true)
        assert.equal(field('Họ tên khách (*)').disabled, true)
        await click(document.querySelector('.booking-detail-header-actions button'))
        assert.equal(
          confirmation().querySelector('.draft-confirmation-discard').disabled,
          true,
          'a pending write cannot be discarded',
        )
        await click(button('Tiếp tục sửa'))
        assert.ok(panel())

        await act(async () => payment.resolve())
        await settle()
        assert.equal(confirmation(), null)
        await tab('Ghi chú')
        assert.equal(field('Ghi chú mới').disabled, false)
        await tab('Thanh toán')
        assert.equal(checkout().disabled, false)
        const leaving = hold(view, 'status')
        const leave = checkout()
        await act(async () => {
          leave.click()
          leave.click()
        })
        assert.deepEqual(view.calls.status, [['BK-P', 'CHECKED_OUT', 4]])
        assert.equal(
          confirmation(),
          null,
          'a repeated click is not queued behind the pending checkout',
        )
        await act(async () => leaving.resolve())
        await settle()
        assert.equal(view.calls.status.length, 1)
        assert.equal(checkout(), undefined)
        await view.unmount()
      },
    )

    await t.test(
      'a pending parent save blocks tab writes; a dirty sibling draft must be continued or discarded before checkout',
      async () => {
        const view = await mountApp(
          [
            '/id/reservations?view=compact',
            '/id/reservations?view=compact&booking=BK-Z&tab=payments',
          ],
          [stay('BK-Z')],
          1,
        )
        await tab('Chi tiết')
        await input(field('Họ tên khách (*)'), 'Nguyễn An Bình')
        const saving = hold(view, 'update')
        await click(saveDetails())
        assert.equal(view.calls.update.length, 1)
        await tab('Ghi chú')
        assert.equal(field('Ghi chú mới').disabled, true)
        await submitForm(field('Ghi chú mới'))
        await tab('Thanh toán')
        assert.equal(checkout().disabled, true)
        assert.deepEqual([view.calls.note.length, view.calls.status.length], [0, 0])
        await act(async () => saving.resolve())
        await settle()

        await tab('Ghi chú')
        await input(field('Ghi chú mới'), 'Unsaved note')
        await tab('Thanh toán')
        await click(checkout())
        assert.ok(confirmation(), 'checkout asks about the sibling draft first')
        await click(button('Tiếp tục sửa'))
        assert.equal(view.calls.status.length, 0)
        assert.equal(field('Ghi chú mới').value, 'Unsaved note')
        await view.go(-1)
        assert.ok(confirmation(), 'Back is guarded by the same draft')
        await click(button('Tiếp tục sửa'))
        await settle()
        assert.equal(view.params().get('booking'), 'BK-Z')
        assert.equal(view.calls.status.length, 0)
        await click(checkout())
        await click(button('Bỏ bản nháp'))
        await settle()
        assert.deepEqual(view.calls.status, [['BK-Z', 'CHECKED_OUT', 2]])
        assert.equal(view.calls.note.length, 0)
        await click(document.querySelector('.booking-detail-header-actions button'))
        await settle()
        assert.equal(panel(), null)
        assert.equal(view.search(), '?view=compact')
        await view.unmount()
      },
    )

    await t.test(
      'unrelated URL params survive open, Back and close; unsafe booking or tab values fall back safely',
      async () => {
        const view = await mountApp('/id/reservations?view=compact&page=2', [stay('BK-P')])
        const openRow = async () => {
          await click(all('.loha-reservations-code').find((node) => node.textContent === 'BK-P'))
          await settle()
        }
        await openRow()
        assert.equal(view.search(), '?view=compact&page=2&booking=BK-P')
        assert.equal(openTab(), 'details')
        await view.go(-1)
        assert.equal(view.search(), '?view=compact&page=2')
        assert.equal(panel(), null)
        await openRow()
        await click(document.querySelector('.booking-detail-header-actions button'))
        await settle()
        assert.equal(view.search(), '?view=compact&page=2')
        assert.equal(panel(), null)

        for (const unsafe of [
          '__proto__',
          'constructor',
          'hasOwnProperty',
          'toString',
          '%E0%A4%A',
          '%',
          '%ZZ',
        ]) {
          await view.go('/id/reservations?view=compact&booking=BK-P&tab=' + unsafe)
          assert.equal(openId(), 'BK-P', unsafe)
          assert.equal(openTab(), 'details', unsafe)
        }
        await view.go('/id/reservations?view=compact&booking=BK-P&tab=services')
        assert.equal(openTab(), 'dịchvụ')
        for (const unknown of ['%E0%A4%A', '%', '__proto__']) {
          await view.go('/id/reservations?view=compact&booking=' + unknown + '&tab=payments')
          assert.equal(panel(), null, unknown)
          assert.ok(document.querySelector('.loha-reservations'), 'the page still renders')
        }
        assert.deepEqual([view.calls.payment.length, view.calls.status.length], [0, 0])
        await view.unmount()
      },
    )
  })
})
