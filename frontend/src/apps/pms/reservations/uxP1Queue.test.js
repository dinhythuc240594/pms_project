import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

// Synthetic data only. The PMS context is mocked; router, draft guard, Dashboard, Reservations and the booking panel are real.
const stay = (id, extra = {}) => {
  const row = {
    id,
    guest: 'Khách ' + id,
    phone: '',
    status: 'CONFIRMED',
    checkIn: '2026-03-10',
    checkOut: '2026-03-12',
    source: 'Direct',
    version: 1,
    rooms: ['101'],
    room: '101',
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

function createHotel(bookings, { timezone = 'Asia/Ho_Chi_Minh', report } = {}) {
  const calls = { payment: [], status: [], update: [], create: [], report: 0 }
  const state = { bookings }
  const listeners = new Set()
  const rooms = ['101', '102', '201', '301'].map((id) => ({
    id,
    typeId: 'std',
    area: 'A',
    floor: 1,
    condition: 'clean',
    active: true,
  }))
  const noop = async () => {}
  const hotel = {
    calls,
    state,
    subscribe(notify) {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
  }
  hotel.api = {
    settings: { timezone, currency: 'VND', checkInTime: '14:00', checkOutTime: '12:00' },
    tenant: { id: 'hotel-test', name: 'Hotel Test' },
    rooms,
    roomTypes: [{ id: 'std', name: 'Standard', capacity: 2, price: 500000 }],
    bookingSources: [
      { id: 'direct', name: 'Direct' },
      { id: 'ota', name: 'OTA' },
    ],
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
    addNote: noop,
    available: () => rooms,
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
    getDashboardReport: async (date) => {
      calls.report += 1
      return report(date, calls.report)
    },
  }
  return hotel
}

test('P1 queues: dashboard context, reservations task/date URL contract and booking return state', async (t) => {
  await withDraftDom(async ({ React, act, window, document, load, mount, click, input }) => {
    const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router-dom')
    const { default: Reservations } = await load(
      '/src/apps/pms/reservations/pages/Reservations.jsx',
    )
    const { default: Dashboard } = await load('/src/apps/pms/dashboard/pages/Dashboard.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { today, addDays } = await load('/src/apps/pms/data/model.js')
    const { DraftGuardProvider, DraftRouteGuard } = await load(
      '/src/shared/drafts/DraftGuardProvider.jsx',
    )
    const h = React.createElement
    const settle = () =>
      act(async () => {
        await new Promise((done) => setTimeout(done, 0))
      })

    async function mountApp(entries, bookings, options = {}) {
      const hotel = createHotel(bookings, options)
      function Shell() {
        return h(
          DraftGuardProvider,
          null,
          h(DraftRouteGuard),
          h(
            PmsContext.Provider,
            { value: { ...hotel.api, bookings: hotel.state.bookings } },
            h(Outlet),
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
              { path: 'housekeeping/*', element: h('p', null, 'Housekeeping') },
              { path: 'reports/*', element: h('p', null, 'Reports') },
            ],
          },
        ],
        { initialEntries: [].concat(entries), initialIndex: options.initialIndex },
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
        router,
        go,
        params: () => new URLSearchParams(router.state.location.search),
        search: () => router.state.location.search,
        state: () => router.state.location.state,
      }
    }

    const all = (selector) => [...document.querySelectorAll(selector)]
    const button = (text) => all('button').find((node) => node.textContent.trim() === text)
    const codes = () =>
      all('.loha-reservations-code')
        .map((node) => node.textContent)
        .sort()
    const taskButton = (code) =>
      document.querySelector(`.loha-reservations-task-presets [data-task="${code}"]`)
    const taskCount = (code) =>
      Number(taskButton(code).querySelector('.loha-reservations-task-count').textContent)
    const dateField = () => document.querySelector('input[aria-label="Ngày công việc"]')
    const searchField = () => document.querySelector('input[aria-label="Tìm đặt phòng"]')
    const alertBox = () => document.querySelector('.loha-reservations-filter-error[role="alert"]')
    const exportButton = () => document.querySelector('.loha-reservations-actions button')
    const scope = () => document.querySelector('.loha-reservations-scope').textContent
    const openId = () =>
      document.querySelector('.booking-detail-eyebrow')?.textContent.split(' · ').pop()
    const closePanel = async () => {
      await click(document.querySelector('.booking-detail-header-actions button'))
      await settle()
    }
    const openRow = async (id) => {
      await click(all('.loha-reservations-code').find((node) => node.textContent === id))
      await settle()
    }

    const D = '2026-03-10'
    const queueBookings = () => [
      stay('A1', { guest: 'Trần Văn A', checkIn: D, checkOut: '2026-03-12' }),
      stay('A2', {
        guest: 'Trần Văn A',
        checkIn: D,
        checkOut: '2026-03-11',
        rooms: ['102'],
        room: '102',
      }),
      stay('AF', { checkIn: '2026-03-11', checkOut: '2026-03-13' }),
      stay('AH', { checkIn: '2026-03-09', checkOut: '2026-03-10' }),
      stay('IA', {
        status: 'IN_HOUSE',
        checkIn: D,
        checkOut: '2026-03-13',
        rooms: ['201'],
        room: '201',
      }),
      stay('D1', {
        status: 'IN_HOUSE',
        checkIn: '2026-03-08',
        checkOut: D,
        rooms: ['301'],
        room: '301',
      }),
      stay('O1', {
        status: 'IN_HOUSE',
        checkIn: '2026-03-05',
        checkOut: '2026-03-09',
        rooms: ['102'],
        room: '102',
      }),
      stay('CO', { status: 'CHECKED_OUT', checkIn: '2026-03-08', checkOut: D }),
      stay('CX', { status: 'CANCELLED', checkIn: D, checkOut: '2026-03-11' }),
    ]

    await t.test(
      'dashboard puts searchable queues before charts and links each queue with task + date',
      async () => {
        const bookings = queueBookings()
        const report = (date, call) => {
          if (call === 1) throw new Error('Mất kết nối giả lập')
          return {
            arriving: 3,
            departing: 1,
            occupied: 2,
            activeRooms: 4,
            occupancy: 66.7,
            currency: 'VND',
            financial: { realizedRevenue: '1500000' },
            chart: [
              {
                date: addDays(date, -1),
                occupancy: 50,
                occupied: 2,
                capacity: 4,
                realizedRevenue: '1500000',
              },
            ],
            alerts: {
              dirtyRooms: [{ number: '105' }],
              inspectionRooms: [],
              overdueDepartures: [{ id: 'O1', guest: 'Khách O1' }],
              pendingArrivals: [{ id: 'A1', guest: 'Trần Văn A' }],
            },
            arrivalBookings: [
              {
                id: 'BK-A1',
                guest: 'Nguyễn An',
                rooms: ['101'],
                balance: '200000',
                currency: 'VND',
                checkIn: date,
                checkOut: addDays(date, 2),
              },
              {
                id: 'BK/A2&dup',
                guest: 'Nguyễn An',
                rooms: ['102'],
                balance: '0',
                currency: 'VND',
              },
              {
                id: 'BK-B',
                guest: 'Lê Bình',
                rooms: ['201'],
                phone: '0905000111',
                balance: '50',
                currency: 'USD',
              },
            ],
            departureBookings: [
              { id: 'BK-D', guest: 'Phạm Dũng', rooms: ['301'], balance: '0', currency: 'VND' },
            ],
          }
        }
        const view = await mountApp('/id/dashboard', bookings, { report })
        const day = today('Asia/Ho_Chi_Minh')
        assert.ok(
          document.querySelector('.pms-dashboard-error[role="alert"]'),
          'a failed load is explicit',
        )
        assert.equal(document.querySelector('.pms-dashboard-queues'), null)
        await click(document.querySelector('.pms-dashboard-error button'))
        await settle()
        assert.equal(document.querySelector('.pms-dashboard-error'), null, 'retry recovers')

        const queues = document.querySelector('.pms-dashboard-queues')
        const chart = document.querySelector('.pms-dashboard-chart-panel')
        assert.ok(queues && chart)
        assert.ok(
          queues.compareDocumentPosition(chart) & window.Node.DOCUMENT_POSITION_FOLLOWING,
          'queues come before historical charts',
        )
        assert.ok(
          all('.pms-dashboard-metric-value strong').some((node) => node.textContent === '66.7%'),
          'occupancy metric is kept',
        )
        assert.equal(
          all('.pms-dashboard-chart-table-wrap thead th').length,
          4,
          'owner revenue column is kept',
        )
        assert.equal(
          chart.querySelector('.pms-dashboard-text-link').getAttribute('href'),
          '/id/reports/revenue',
        )

        const queue = (id) => document.querySelector(`[data-queue="${id}"]`)
        const ids = (id) =>
          [...queue(id).querySelectorAll('.pms-dashboard-booking-id')].map(
            (node) => node.textContent,
          )
        assert.equal(
          queue('arrivals').querySelector('.pms-dashboard-text-link').getAttribute('href'),
          `/id/reservations?task=arrivals&date=${day}`,
        )
        assert.equal(
          queue('departures').querySelector('.pms-dashboard-text-link').getAttribute('href'),
          `/id/reservations?task=departures&date=${day}`,
        )
        const taskHrefs = all('.pms-dashboard-task').map((node) => node.getAttribute('href'))
        assert.deepEqual(taskHrefs, [
          '/id/housekeeping/status',
          `/id/reservations?task=overdue&date=${day}`,
          `/id/reservations?task=arrivals&date=${day}`,
        ])
        const linkFor = (id) =>
          [...document.querySelectorAll('.pms-dashboard-booking')]
            .find((row) => row.querySelector('.pms-dashboard-booking-id').textContent === '#' + id)
            .querySelector('.pms-dashboard-booking-action a')
        assert.equal(
          linkFor('BK/A2&dup').getAttribute('href'),
          '/id/reservations?booking=BK%2FA2%26dup',
        )
        assert.equal(
          linkFor('BK-D').getAttribute('href'),
          '/id/reservations?booking=BK-D&tab=payments',
        )
        assert.match(
          linkFor('BK-B').closest('.pms-dashboard-booking').textContent,
          /USD/,
          'balance keeps its own currency',
        )
        assert.match(
          linkFor('BK-A1').closest('.pms-dashboard-booking').textContent,
          new RegExp(day.split('-').reverse().join('/')),
          'stay dates are shown when supplied',
        )
        assert.ok(
          queue('arrivals').querySelector(
            '.pms-dashboard-booking-list[role="region"][tabindex="0"]',
          ),
          'long queue scrolls inside a keyboard-reachable region',
        )

        const search = document.querySelector(
          'input[aria-label="Tìm khách đến và khách đi hôm nay"]',
        )
        await input(search, 'nguyen an')
        assert.deepEqual(
          ids('arrivals'),
          ['#BK-A1', '#BK/A2&dup'],
          'accent-insensitive name search keeps both same-name bookings by exact ID',
        )
        assert.deepEqual(ids('departures'), [])
        assert.equal(queue('arrivals').querySelector('.pms-dashboard-count').textContent, '2/3')
        assert.equal(queue('departures').querySelector('.pms-dashboard-count').textContent, '0/1')
        assert.match(
          queue('departures').querySelector('.pms-dashboard-list-empty').textContent,
          /nguyen an/,
          'zero-match state is honest, not "no bookings"',
        )
        await input(search, '201')
        assert.deepEqual(ids('arrivals'), ['#BK-B'], 'room number search')
        await input(search, '0905000111')
        assert.deepEqual(ids('arrivals'), ['#BK-B'], 'phone search uses supplied phone')
        await input(search, 'bk-d')
        assert.deepEqual([ids('arrivals'), ids('departures')], [[], ['#BK-D']], 'reference search')
        await click(document.querySelector('.pms-dashboard-search button'))
        assert.equal(
          ids('arrivals').length + ids('departures').length,
          4,
          'clear restores both queues',
        )

        await click(queue('arrivals').querySelector('.pms-dashboard-text-link'))
        await settle()
        assert.equal(view.search(), `?task=arrivals&date=${day}`)
        assert.equal(taskButton('arrivals').getAttribute('aria-pressed'), 'true')
        assert.deepEqual([view.hotel.calls.payment.length, view.hotel.calls.status.length], [0, 0])
        await view.unmount()
      },
    )

    await t.test(
      'task filters use exact hotel days for arrivals, departures, overdue; in-house is current state',
      async () => {
        const view = await mountApp('/id/reservations', queueBookings())
        assert.equal(codes().length, 9, 'no task means all bookings, not today only')
        assert.equal(view.search(), '', 'mount does not rewrite the URL')
        assert.match(scope(), /Tất cả đặt phòng, mọi ngày/)
        assert.equal(taskCount('all'), 9)
        assert.equal(document.querySelector('.loha-reservations-status-strip'), null)
        assert.ok(
          taskButton('all').closest('.loha-reservations-task-toolbar').contains(exportButton()),
        )

        await view.go(`/id/reservations?task=arrivals&date=${D}`)
        assert.deepEqual(
          ['arrivals', 'departures', 'inhouse', 'overdue'].map(taskCount),
          [2, 1, 3, 1],
          'badges count each queue for the selected day',
        )
        assert.deepEqual(
          codes(),
          ['A1', 'A2'],
          'confirmed and checking in that day; same-name duplicates both listed',
        )
        assert.match(scope(), /10\/03\/2026/)
        assert.equal(dateField().value, '10/03/2026')
        await view.go('/id/reservations?task=arrivals&date=2026-03-09')
        assert.deepEqual(codes(), ['AH'], 'historical day')
        await view.go('/id/reservations?task=arrivals&date=2026-03-11')
        assert.deepEqual(codes(), ['AF'], 'future day')
        await view.go(`/id/reservations?task=departures&date=${D}`)
        assert.deepEqual(
          codes(),
          ['D1'],
          'in-house checking out that day; checked-out stays excluded',
        )
        await view.go(`/id/reservations?task=overdue&date=${D}`)
        assert.deepEqual(codes(), ['O1'], 'checkout before the day; due today is not overdue')
        await view.go('/id/reservations?task=overdue&date=2026-03-11')
        assert.deepEqual(codes(), ['D1', 'O1'])
        assert.equal(taskCount('overdue'), 2)
        await view.go('/id/reservations?task=inhouse&date=2020-01-01')
        assert.deepEqual(
          codes(),
          ['D1', 'IA', 'O1'],
          'in-house ignores the date instead of pretending to be a snapshot',
        )
        assert.equal(dateField(), null)
        assert.match(
          document.querySelector('.loha-reservations-task-note').textContent,
          /trạng thái hiện tại/,
        )
        await view.go(`/id/reservations?task=arrivals&date=${D}&res_q=tran%20van`)
        assert.deepEqual(codes(), ['A1', 'A2'])
        assert.deepEqual(['all', 'arrivals', 'departures'].map(taskCount), [2, 2, 0])
        assert.equal(searchField().value, 'tran van')
        await view.unmount()
      },
    )

    await t.test(
      'task day defaults to the hotel timezone today without changing the URL',
      async () => {
        const zone = 'Pacific/Kiritimati'
        const hotelDay = today(zone),
          otherDay = today('Pacific/Pago_Pago')
        assert.notEqual(hotelDay, otherDay)
        const view = await mountApp(
          '/id/reservations?task=arrivals',
          [
            stay('K', { checkIn: hotelDay, checkOut: addDays(hotelDay, 1) }),
            stay('P', { checkIn: otherDay, checkOut: addDays(otherDay, 1) }),
          ],
          { timezone: zone },
        )
        assert.deepEqual(codes(), ['K'])
        assert.equal(view.search(), '?task=arrivals')
        assert.equal(dateField().value, hotelDay.split('-').reverse().join('/'))
        assert.match(scope(), /hôm nay/)
        await view.unmount()
      },
    )

    await t.test(
      'default P1 URL is untouched and filter/booking changes keep booking, tab and nested return state',
      async () => {
        const plain = await mountApp('/id/reservations?view=compact&page=2', queueBookings())
        assert.equal(plain.search(), '?view=compact&page=2')
        assert.equal(codes().length, 9)
        await click(taskButton('arrivals'))
        await settle()
        assert.deepEqual(
          [
            plain.params().get('task'),
            plain.params().get('date'),
            plain.params().get('page'),
            plain.params().get('view'),
          ],
          ['arrivals', null, '2', 'compact'],
          'generic page survives; date stays implicit',
        )
        await plain.unmount()

        const workflowState = {
          marker: 'kept',
          workflowReturn: {
            scope: 'synthetic',
            target: 'OTHER',
            path: '/id/reports/reconciliation?date=2026-03-10',
            parent: {
              scope: 'synthetic',
              target: 'R1',
              path: '/id/settings?section=channels&tab=history',
            },
          },
        }
        const search = `?view=compact&page=2&task=arrivals&date=${D}&res_q=tran`
        const view = await mountApp(
          { pathname: '/id/reservations', search, state: workflowState },
          queueBookings(),
        )
        assert.equal(view.search(), search)
        await openRow('A2')
        assert.equal(view.search(), search + '&booking=A2')
        assert.deepEqual(view.state(), workflowState, 'opening a booking keeps router state')
        assert.equal(openId(), 'A2')
        await closePanel()
        assert.equal(view.search(), search)
        assert.deepEqual(view.state(), workflowState, 'closing keeps router state and filters')

        await view.go({ pathname: '/id/reservations', search: search + '&booking=A1&tab=payments' })
        await act(async () => {
          await view.router.navigate(
            { pathname: '/id/reservations', search: search + '&booking=A1&tab=payments' },
            { state: workflowState, replace: true },
          )
        })
        await settle()
        await click(taskButton('departures'))
        await settle()
        assert.deepEqual(
          ['booking', 'tab', 'task', 'date', 'res_q', 'page'].map((key) => view.params().get(key)),
          ['A1', 'payments', 'departures', D, 'tran', '2'],
          'task switch keeps booking/tab/date/search',
        )
        assert.deepEqual(view.state(), workflowState)
        await input(searchField(), 'khach')
        assert.deepEqual(
          ['booking', 'tab', 'res_q'].map((key) => view.params().get(key)),
          ['A1', 'payments', 'khach'],
        )
        assert.deepEqual(view.state(), workflowState, 'search keeps router state')
        assert.equal(openId(), 'A1')
        await view.unmount()
      },
    )

    await t.test(
      'search, source, page and status live in the URL and survive Back and reload',
      async () => {
        const many = Array.from({ length: 12 }, (_, index) =>
          stay('BK-' + String(index + 1).padStart(2, '0'), {
            checkIn: D,
            source: index === 9 ? 'OTA' : 'Direct',
          }),
        )
        const view = await mountApp('/id/reservations?view=compact', [
          ...many,
          stay('LATER', { checkIn: '2026-03-20', checkOut: '2026-03-21' }),
        ])
        await click(taskButton('arrivals'))
        await settle()
        await input(dateField(), '10/03/2026')
        await settle()
        assert.equal(view.params().get('date'), D)
        assert.equal(codes().length, 10)
        await click(
          all('.loha-reservations-pagination nav button').find((node) => node.textContent === '2'),
        )
        await settle()
        assert.equal(view.params().get('res_page'), '2')
        assert.deepEqual(codes(), ['BK-11', 'BK-12'])
        await click(all('.loha-reservations-filters button')[2])
        await input(all('.loha-reservations-advanced select')[1], 'OTA')
        await settle()
        assert.deepEqual(
          [view.params().get('res_source'), view.params().get('res_page')],
          ['OTA', null],
          'source resets the list page',
        )
        assert.deepEqual(codes(), ['BK-10'])
        await view.go(-1)
        assert.deepEqual(
          [view.params().get('res_source'), view.params().get('res_page')],
          [null, '2'],
          'Back restores the previous page',
        )
        assert.deepEqual(codes(), ['BK-11', 'BK-12'])
        assert.equal(
          document.querySelector('.loha-reservations-pagination [aria-current="page"]').textContent,
          '2',
        )
        await view.go(1)
        await input(searchField(), 'bk-1')
        await settle()
        assert.deepEqual(codes(), ['BK-10'])
        const url = view.search()
        assert.deepEqual(
          ['view', 'task', 'date', 'res_source', 'res_q'].map((key) =>
            new URLSearchParams(url).get(key),
          ),
          ['compact', 'arrivals', D, 'OTA', 'bk-1'],
        )
        await view.unmount()

        const reloaded = await mountApp('/id/reservations' + url, many)
        assert.equal(reloaded.search(), url, 'reload does not rewrite the URL')
        assert.deepEqual(codes(), ['BK-10'])
        assert.equal(searchField().value, 'bk-1')
        assert.equal(dateField().value, '10/03/2026')
        assert.equal(taskButton('arrivals').getAttribute('aria-pressed'), 'true')
        await click(all('.loha-reservations-filters button')[0])
        const statusSelect = document.querySelector('.loha-reservations-advanced select')
        assert.equal(
          statusSelect.querySelector('[value="CONFIRMED"]').textContent.trim(),
          'Đã xác nhận (1)',
        )
        await input(statusSelect, 'CONFIRMED')
        await settle()
        assert.deepEqual(
          ['task', 'date', 'res_status', 'res_q', 'view'].map((key) => reloaded.params().get(key)),
          [null, null, 'CONFIRMED', 'bk-1', 'compact'],
          'status filter returns to all-task scope',
        )
        assert.equal(taskButton('all').getAttribute('aria-pressed'), 'true')
        await click(taskButton('departures'))
        await settle()
        assert.equal(
          reloaded.params().get('res_status'),
          null,
          'task switch clears incompatible status',
        )
        await reloaded.unmount()
      },
    )

    await t.test(
      'invalid or duplicate URL filters and typed-invalid dates are explicit and recoverable',
      async () => {
        const day = today('Asia/Ho_Chi_Minh')
        const bookings = [
          stay('NOW', { checkIn: day, checkOut: addDays(day, 1) }),
          stay('MAR', { checkIn: D, checkOut: '2026-03-11' }),
        ]
        const view = await mountApp('/id/reservations', bookings)
        for (const bad of [
          '?task=arrivals&date=2026-02-30',
          '?task=arrivals&date=0000-01-01',
          '?task=arrivals&date=2026-13-01',
          '?task=arrivals&date=10-03-2026',
          '?task=arrivals&task=departures',
          '?task=tomorrow',
          '?res_status=NOPE',
          '?res_page=0',
          '?res_q=a&res_q=b',
        ]) {
          await view.go('/id/reservations' + bad + '&view=compact')
          assert.ok(alertBox(), bad)
          assert.deepEqual(codes(), [], bad + ' shows no stale or all-data rows')
          assert.equal(exportButton().disabled, true, bad + ' cannot export an invalid scope')
          assert.match(scope(), /không hợp lệ/)
        }
        await view.go('/id/reservations?task=arrivals&date=2026-02-30&view=compact')
        await click(button('Bỏ tham số không hợp lệ'))
        await settle()
        assert.equal(view.search(), '?task=arrivals&view=compact')
        assert.equal(alertBox(), null)
        assert.deepEqual(codes(), ['NOW'])

        await view.go(`/id/reservations?task=arrivals&date=${D}`)
        assert.deepEqual(codes(), ['MAR'])
        await input(dateField(), '31/02/2026')
        await settle()
        assert.ok(alertBox(), 'a typed invalid date does not keep showing the old day')
        assert.deepEqual(codes(), [])
        assert.equal(view.params().get('date'), D, 'invalid draft never reaches the URL')
        assert.equal(exportButton().disabled, true)
        await input(dateField(), '11/03/2026')
        await settle()
        assert.equal(alertBox(), null)
        assert.equal(view.params().get('date'), '2026-03-11')
        assert.deepEqual(codes(), [])
        assert.match(scope(), /11\/03\/2026/)
        await input(dateField(), '00/00/0000')
        await settle()
        await click(button('Dùng ngày hôm nay'))
        await settle()
        assert.equal(alertBox(), null)
        assert.equal(view.params().get('date'), null)
        assert.equal(dateField().value, day.split('-').reverse().join('/'))
        assert.deepEqual(codes(), ['NOW'])

        await view.go('/id/reservations?task=nope&res_status=BAD&booking=MAR&view=compact')
        await click(button('Xem tất cả đặt phòng'))
        await settle()
        assert.equal(
          view.search(),
          '?booking=MAR&view=compact',
          'All bookings keeps the open booking and unrelated params',
        )
        assert.deepEqual(codes(), ['MAR', 'NOW'])
        assert.equal(exportButton().disabled, false)
        await view.unmount()
      },
    )
  })
})
