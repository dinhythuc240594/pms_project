import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'
import { parseFixed4, formatFixed4, summarizeQuote } from './components/bookingQuoteSummary.js'

const dates = (n, start = Date.UTC(2026, 9, 1)) =>
  Array.from({ length: n }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

test('quote summary helper: exact fixed-4 BigInt grouping', async (t) => {
  await t.test('max precision x30 and tiny fractions stay exact', () => {
    const max = '999999999999999.9999'
    const summary = summarizeQuote({
      currency: 'VND',
      total: '1',
      nightlyRates: dates(30).map((date) => ({ room: '101', date, price: max })),
    })
    assert.equal(summary.rooms.length, 1)
    assert.equal(summary.rooms[0].nights, 30)
    assert.equal(summary.rooms[0].subtotal, '29999999999999999.9970')
    assert.equal(summary.rooms[0].varies, false)
    const tiny = summarizeQuote({
      currency: 'USD',
      nightlyRates: dates(3).map((date) => ({ room: 'A', date, price: '0.0001' })),
    })
    assert.equal(tiny.rooms[0].subtotal, '0.0003')
  })

  await t.test(
    'ordinary numeric mock prices parse via String; malformed prices are rejected',
    () => {
      assert.equal(formatFixed4(parseFixed4(1000000)), '1000000.0000')
      assert.equal(formatFixed4(parseFixed4(0.5)), '0.5000')
      assert.equal(formatFixed4(parseFixed4('12.34')), '12.3400')
      for (const bad of [
        '1e5',
        1e21,
        'Infinity',
        Infinity,
        NaN,
        -1,
        '-1',
        '1.23456',
        '1234567890123456',
        '',
        ' 1',
        '1.',
        '.5',
        null,
        undefined,
        {},
        [],
        true,
        10n,
      ]) {
        assert.equal(parseFixed4(bad), null, `rejects ${String(bad)}`)
      }
    },
  )

  await t.test(
    'variation, duplicate, invalid date, missing room, malformed price and currency are flagged per room',
    () => {
      const [d1, d2] = dates(2)
      const quoted = Object.freeze({
        currency: 'VND',
        total: '9',
        nightlyRates: Object.freeze([
          Object.freeze({ room: 'VAR', date: d1, price: '100' }),
          Object.freeze({ room: 'VAR', date: d2, price: '250.5' }),
          Object.freeze({ room: 'DUP', date: d1, price: '100' }),
          Object.freeze({ room: 'DUP', date: d1, price: '100' }),
          Object.freeze({ room: 'BADDATE', date: '2026-02-31', price: '100' }),
          Object.freeze({ date: d1, price: '100' }),
          Object.freeze({ room: 'BADPRICE', date: d1, price: '1e3' }),
          Object.freeze({ room: 'FX', date: d1, price: '100', currency: 'USD' }),
          Object.freeze({ room: 'FX', date: d2, price: '100' }),
          Object.freeze({ room: 'SAME', date: d1, price: '100', currency: 'VND' }),
        ]),
      })
      const before = JSON.stringify(quoted)
      const summary = summarizeQuote(quoted, 'EUR')
      assert.equal(JSON.stringify(quoted), before, 'source quote is not mutated')
      const by = (room) => summary.rooms.find((group) => group.room === room)
      assert.deepEqual(
        [by('VAR').subtotal, by('VAR').varies, by('VAR').min, by('VAR').max],
        ['350.5000', true, '100.0000', '250.5000'],
      )
      assert.deepEqual(by('DUP').warnings, ['duplicate'])
      assert.equal(by('DUP').subtotal, null)
      assert.equal(by('DUP').nights, 1)
      assert.deepEqual(by('BADDATE').warnings, ['date'])
      assert.deepEqual(by(null).warnings, ['room'])
      assert.deepEqual(by('BADPRICE').warnings, ['price'])
      assert.deepEqual(by('FX').warnings, ['currency'])
      assert.equal(by('FX').subtotal, null)
      assert.equal(by('SAME').subtotal, '100.0000')
      assert.equal(summary.unsafe, true)
      assert.equal(summary.rows.length, quoted.nightlyRates.length)
      assert.equal(summary.rows.find((row) => row.room === 'BADPRICE').price, null)
      assert.equal(
        summary.rows.find((row) => row.room === 'FX' && row.currency === 'USD').price,
        '100.0000',
      )
    },
  )

  await t.test('row currency falls back to quote currency, then supplied settings currency', () => {
    const [d1] = dates(1)
    assert.equal(
      summarizeQuote({ nightlyRates: [{ room: '1', date: d1, price: '5' }] }, 'JPY').rooms[0]
        .subtotal,
      '5.0000',
    )
    assert.equal(
      summarizeQuote({ nightlyRates: [{ room: '1', date: d1, price: '5' }] }, 'JPY').currency,
      'JPY',
    )
    assert.deepEqual(
      summarizeQuote(
        { nightlyRates: [{ room: '1', date: d1, price: '5', currency: 'USD' }] },
        'JPY',
      ).rooms[0].warnings,
      ['currency'],
    )
    assert.deepEqual(summarizeQuote(null, 'VND').rooms, [])
    assert.deepEqual(summarizeQuote({ currency: 'VND', nightlyRates: 'oops' }).rows, [])
  })
})

test('UX06 booking detail room editing and removed placeholder fields', async (t) => {
  await withDraftDom(async ({ React, act, document, load, mount, click, input }) => {
    const { default: BookingDetailPanel } = await load(
      '/src/apps/pms/reservations/components/BookingDetailPanel.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { DraftGuardProvider, useDraftNavigation } = await load(
      '/src/shared/drafts/DraftGuardProvider.jsx',
    )
    const h = React.createElement
    const pad = (i) => 'R' + String(i).padStart(3, '0')
    const base = {
      id: 'BK-UX',
      guest: 'Synthetic guest',
      phone: '0900000000',
      status: 'CONFIRMED',
      checkIn: '2026-10-21',
      checkOut: '2026-10-23',
      source: 'Direct',
      version: 7,
      currency: 'VND',
      balance: 0,
      paid: 0,
      nightlyRates: [],
      guests: [{ id: 'g1', name: 'Synthetic guest', phone: '0900000000', email: '', version: 1 }],
    }
    const roomTypes = [
      { id: 'standard', name: 'Standard' },
      { id: 'deluxe', name: 'Deluxe' },
    ]
    const button = (text) =>
      [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
    const selectedBoxes = () => [
      ...document.querySelectorAll('[aria-label="Phòng đã chọn"] input[type="checkbox"]'),
    ]
    const selectedIds = () =>
      [...document.querySelectorAll('[aria-label="Phòng đã chọn"] label')].map(
        (node) => node.textContent.split(' ')[0],
      )
    const candidateLabels = () => [
      ...document.querySelectorAll('[aria-label="Phòng có thể thêm"] label'),
    ]
    const candidate = (id) =>
      candidateLabels()
        .find((node) => node.textContent.split(' ')[0] === id)
        ?.querySelector('input')
    const search = () => document.querySelector('input[aria-label="Tìm phòng để thêm"]')
    const count = () => document.querySelector('.booking-detail-room-count').textContent

    async function setup(booking, rooms, overrides = {}) {
      const context = {
        bookings: [booking],
        rooms,
        roomTypes,
        bookingSources: [{ id: 'direct', name: 'Direct' }],
        settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
        tenant: { id: 'hotel', name: 'Hotel' },
        services: [],
        paymentMethods: [],
        funds: [],
        access: () => ({ allowed: true }),
        updateBooking: async () => {},
        changeStatus: async () => {},
        refreshWorkspace: async () => {},
        addNote: async () => {},
        addPayment: async () => {},
        ...overrides,
      }
      let navigation
      function Probe() {
        const value = useDraftNavigation()
        React.useLayoutEffect(() => {
          navigation = value
        }, [value])
        return null
      }
      const mounted = await mount(
        h(
          React.StrictMode,
          null,
          h(
            DraftGuardProvider,
            null,
            h(Probe),
            h(
              PmsContext.Provider,
              { value: context },
              h(BookingDetailPanel, { bookingId: booking.id, onClose() {} }),
            ),
          ),
        ),
      )
      return {
        ...mounted,
        get navigation() {
          return navigation
        },
      }
    }

    await t.test(
      'IN_HOUSE with 300 rooms lists only assigned rooms, marking inactive and missing ones',
      async () => {
        const rooms = [
          ...Array.from({ length: 300 }, (_, i) => ({ id: pad(i + 1), typeId: 'standard' })),
          { id: 'R999', typeId: 'standard', active: false },
        ]
        const view = await setup(
          { ...base, status: 'IN_HOUSE', rooms: ['R001', 'R999', 'GONE'], room: 'R001' },
          rooms,
        )
        assert.equal(
          document.querySelectorAll('.booking-detail-panel input[type="checkbox"]').length,
          0,
        )
        assert.equal(search(), null)
        const chips = [...document.querySelectorAll('.booking-detail-room-chips li')].map(
          (node) => node.textContent,
        )
        assert.equal(chips.length, 3)
        assert.equal(chips[0], 'R001')
        assert.match(chips[1], /^R999 .*ngừng hoạt động/)
        assert.match(chips[2], /^GONE .*không còn/)
        await view.unmount()
      },
    )

    await t.test(
      'CONFIRMED without reservations.write shows read-only rooms and cannot mutate',
      async () => {
        let writes = 0
        const rooms = [
          { id: 'R001', typeId: 'standard' },
          { id: 'R002', typeId: 'standard' },
        ]
        const view = await setup({ ...base, rooms: ['R001'], room: 'R001' }, rooms, {
          access: (permission) => ({ allowed: permission !== 'reservations.write' }),
          updateBooking: async () => {
            writes++
          },
        })
        assert.equal(
          document.querySelectorAll('.booking-detail-panel input[type="checkbox"]').length,
          0,
        )
        assert.equal(search(), null)
        assert.deepEqual(
          [...document.querySelectorAll('.booking-detail-room-chips li')].map(
            (node) => node.textContent,
          ),
          ['R001'],
        )
        assert.equal(button('Lưu thay đổi').disabled, true)
        await click(button('Lưu thay đổi'))
        assert.equal(writes, 0)
        assert.equal(view.navigation.hasBlockers(), false)
        await view.unmount()
      },
    )

    const confirmedRooms = [
      ...Array.from({ length: 120 }, (_, i) => ({
        id: pad(i + 1),
        typeId: (i + 1) % 2 === 0 ? 'deluxe' : 'standard',
      })),
      { id: 'R200', typeId: 'standard', active: false },
    ]
    const confirmedBooking = { ...base, rooms: ['R001', 'R200'], room: 'R001' }

    await t.test(
      'CONFIRMED search caps candidates, keeps the selection visible, never dirties, and saves with expectedVersion',
      async () => {
        const saves = []
        const view = await setup(confirmedBooking, confirmedRooms, {
          updateBooking: async (id, payload) => {
            saves.push([id, payload])
          },
        })
        assert.deepEqual(selectedIds(), ['R001', 'R200'])
        assert.ok(selectedBoxes().every((box) => box.checked))
        assert.match(
          document.querySelector('[aria-label="Phòng đã chọn"]').textContent,
          /R200 .*ngừng hoạt động/,
        )
        assert.equal(candidateLabels().length, 50)
        assert.match(count(), /50\/119/)
        assert.equal(document.querySelector('[aria-label="Phòng có thể thêm"]').tabIndex, 0)

        await input(search(), 'deluxe')
        assert.equal(candidateLabels().length, 50)
        assert.match(count(), /50\/60/)
        assert.ok(candidateLabels().every((node) => /Deluxe/.test(node.textContent)))
        await input(search(), 'R11')
        assert.deepEqual(
          candidateLabels().map((node) => node.textContent.split(' ')[0]),
          ['R110', 'R111', 'R112', 'R113', 'R114', 'R115', 'R116', 'R117', 'R118', 'R119'],
        )
        await input(search(), 'no-such-room')
        assert.equal(candidateLabels().length, 0)
        assert.deepEqual(
          selectedIds(),
          ['R001', 'R200'],
          'selected group stays visible regardless of search',
        )
        assert.equal(
          view.navigation.hasBlockers(),
          false,
          'search alone does not dirty the booking',
        )

        await input(search(), 'R115')
        await click(candidate('R115'))
        assert.deepEqual(selectedIds(), ['R001', 'R200', 'R115'])
        assert.equal(candidate('R115'), undefined)
        assert.equal(view.navigation.hasBlockers(), true)
        await click(selectedBoxes()[1])
        assert.deepEqual(selectedIds(), ['R001', 'R115'])
        await input(search(), 'R200')
        assert.ok(
          candidate('R200'),
          'an unselected originally-assigned inactive room can be re-added',
        )
        await click(button('Lưu thay đổi'))
        assert.equal(saves.length, 1)
        assert.equal(saves[0][0], 'BK-UX')
        assert.equal(saves[0][1].expectedVersion, 7)
        assert.deepEqual(saves[0][1].rooms, ['R001', 'R115'])
        await view.unmount()
      },
    )

    await t.test(
      'pending save blocks a second write and room changes; stale conflict keeps the room draft',
      async () => {
        const pending = deferred()
        let calls = 0
        const view = await setup(confirmedBooking, confirmedRooms, {
          updateBooking: () => {
            calls++
            return pending.promise
          },
        })
        await input(search(), 'R050')
        await click(candidate('R050'))
        const save = button('Lưu thay đổi')
        await act(async () => {
          save.click()
          save.click()
        })
        assert.equal(calls, 1)
        await input(search(), 'R060')
        assert.equal(candidate('R060').disabled, true)
        assert.ok(selectedBoxes().every((box) => box.disabled))
        await click(candidate('R060'))
        assert.deepEqual(selectedIds(), ['R001', 'R200', 'R050'])
        await act(async () =>
          pending.reject(Object.assign(new Error('Stale booking'), { code: 'stale_booking' })),
        )
        assert.match(document.querySelector('[role="alert"]').textContent, /Stale booking/)
        assert.ok(button('Tải bản mới và bỏ thay đổi chưa lưu'))
        assert.deepEqual(selectedIds(), ['R001', 'R200', 'R050'])
        assert.equal(view.navigation.hasBlockers(), true)
        await view.unmount()
      },
    )

    await t.test('six placeholder controls are gone while real booking fields remain', async () => {
      const view = await setup(
        {
          ...confirmedBooking,
          nightlyRates: [{ room: 'R001', date: '2026-10-21', price: '100000' }],
        },
        confirmedRooms,
      )
      const text = view.container.textContent
      assert.doesNotMatch(
        text,
        /Chưa triển khai|Đặt phòng theo giờ|FOC|Bữa sáng|Người lớn|Trẻ em|Em bé/,
      )
      assert.equal(document.querySelector('[title="Chưa triển khai"]'), null)
      for (const label of [
        'Họ tên khách (*)',
        'CCCD/CMND/Hộ chiếu',
        'Điện thoại',
        'Email',
        'Kênh / Mã kênh',
        'Ngày nhận (*)',
        'Ngày trả (*)',
        'Ngày đặt',
      ])
        assert.ok(document.querySelector(`input[aria-label="${label}"]`), label)
      for (const label of [
        'Quốc tịch',
        'Trạng thái (*)',
        'Nguồn đặt (*)',
        'Loại phòng (*)',
        'Phòng RTC (*)',
      ])
        assert.ok(document.querySelector(`select[aria-label="${label}"]`), label)
      assert.ok(document.querySelector('.booking-detail-money-input input'))
      assert.ok(document.querySelector('.booking-detail-balance strong'))
      await view.unmount()
    })
  })
})

test('UX08 booking modal compact quote summary', async (t) => {
  await withDraftDom(async ({ React, act, document, load, mount, click, input }) => {
    const { default: BookingModal } = await load(
      '/src/apps/pms/reservations/components/BookingModal.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { DraftGuardProvider } = await load('/src/shared/drafts/DraftGuardProvider.jsx')
    const h = React.createElement
    const thirty = dates(30)
    const roomsAvailable = [
      { id: '101', typeId: 'standard' },
      { id: '102', typeId: 'standard' },
      { id: '103', typeId: 'standard' },
    ]
    const priceFor = (room, i) =>
      room === '102' ? (i % 2 ? '1200000.5000' : '1000000') : room === '103' ? 500000 : '1000000'

    async function mountModal(overrides = {}) {
      const pms = {
        settings: {
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
          checkInTime: '14:00',
          checkOutTime: '12:00',
        },
        bookingSources: [{ id: 'direct', name: 'Direct' }],
        roomTypes: [{ id: 'standard', name: 'Standard', capacity: 2, price: 1000000 }],
        available: () => roomsAvailable,
        allowAction: () => true,
        getAvailability: async () => ({ availability: [] }),
        quote: async ({ rooms }) => ({
          currency: 'VND',
          total: '123.0000',
          nightlyRates: rooms.flatMap((room) =>
            thirty.map((date, i) => ({ room, date, price: priceFor(room, i) })),
          ),
        }),
        createBooking: async () => ({ id: 'new' }),
        ...overrides,
      }
      return mount(
        h(
          DraftGuardProvider,
          null,
          h(PmsContext.Provider, { value: pms }, h(BookingModal, { onClose() {} })),
        ),
      )
    }
    const roomBoxes = () => [
      ...document.querySelectorAll('.booking-create-room-options input[type="checkbox"]'),
    ]
    const checkAvailability = () =>
      click(
        [...document.querySelectorAll('button')].find((node) =>
          node.textContent.includes('Kiểm tra phòng trống'),
        ),
      )
    const footerTotal = () => document.querySelector('.booking-create-footer strong').textContent
    const summaryRooms = () => [...document.querySelectorAll('.booking-quote-room')]

    await t.test(
      '3 rooms x 30 nights: 3 summary rows, 90 nightly rows inside a closed details, authoritative total',
      async () => {
        const created = []
        const view = await mountModal({
          createBooking: async (payload) => {
            created.push(payload)
            return { id: 'new' }
          },
        })
        await checkAvailability()
        for (const box of roomBoxes()) await click(box)
        assert.equal(summaryRooms().length, 3)
        const details = document.querySelector('.booking-quote-details')
        assert.equal(details.open, false)
        const nightly = [...document.querySelectorAll('.booking-quote-night')]
        assert.equal(nightly.length, 90)
        assert.ok(nightly.every((node) => node.closest('details') === details))
        assert.match(details.querySelector('summary').textContent, /90/)
        const [r101, r102, r103] = summaryRooms()
        assert.match(r101.textContent, /30 đêm/)
        assert.match(r101.querySelector('.booking-quote-subtotal').textContent, /^30\.000\.000 ₫$/)
        assert.equal(r101.querySelector('.booking-quote-variation'), null)
        assert.match(
          r102.querySelector('.booking-quote-variation').textContent,
          /Giá thay đổi theo đêm: 1\.000\.000 ₫ – 1\.200\.000,5 ₫/,
        )
        assert.match(
          r102.querySelector('.booking-quote-subtotal').textContent,
          /^33\.000\.007,5 ₫$/,
        )
        assert.match(r103.querySelector('.booking-quote-subtotal').textContent, /^15\.000\.000 ₫$/)
        assert.equal(
          footerTotal(),
          '123 ₫',
          'footer keeps quoted.total even when it differs from the subtotals',
        )
        const guest = document.querySelector('[aria-label="Họ và tên khách"]')
        assert.ok(
          details.compareDocumentPosition(guest) & 4,
          'guest inputs follow the compact summary',
        )
        await input(guest, 'Synthetic Guest')
        await click(document.querySelector('.booking-create-footer-actions button:last-child'))
        assert.equal(created.length, 1)
        assert.deepEqual(created[0].rooms, ['101', '102', '103'])
        assert.equal(Object.hasOwn(created[0], 'status'), false)
        await view.unmount()
      },
    )

    await t.test(
      'mixed currency, malformed price, duplicate date and missing room warn without NaN or merged subtotals',
      async () => {
        const [d1, d2] = dates(2)
        const view = await mountModal({
          quote: async () => ({
            currency: 'VND',
            total: '777.0000',
            nightlyRates: [
              { room: '101', date: d1, price: '100', currency: 'USD' },
              { room: '101', date: d2, price: '100' },
              { room: '102', date: d1, price: '1e5' },
              { room: '102', date: d2, price: NaN },
              { room: '103', date: d1, price: '100' },
              { room: '103', date: d1, price: '100' },
              { date: 'not-a-date', price: '100' },
            ],
          }),
        })
        await checkAvailability()
        await click(roomBoxes()[0])
        const text = view.container.textContent
        assert.doesNotMatch(text, /NaN/)
        assert.equal(summaryRooms().length, 4)
        assert.ok(
          summaryRooms().every(
            (node) =>
              node.querySelector('.booking-quote-subtotal').textContent === 'Không tạm tính',
          ),
        )
        assert.match(summaryRooms()[0].textContent, /Tiền tệ khác với báo giá/)
        assert.match(summaryRooms()[1].textContent, /Có giá không hợp lệ/)
        assert.match(summaryRooms()[2].textContent, /Trùng ngày cho cùng phòng/)
        assert.match(summaryRooms()[3].textContent, /Thiếu mã phòng trong báo giá/)
        assert.match(summaryRooms()[3].textContent, /Có ngày không hợp lệ/)
        assert.equal(document.querySelectorAll('.booking-quote-night').length, 7)
        assert.match(document.querySelectorAll('.booking-quote-night')[0].textContent, /USD/)
        assert.match(
          document.querySelectorAll('.booking-quote-night')[2].textContent,
          /Giá không hợp lệ/,
        )
        assert.equal(footerTotal(), '777 ₫')
        await view.unmount()
      },
    )

    await t.test('quote race renders only the latest quote summary', async () => {
      const calls = []
      const view = await mountModal({
        quote: ({ rooms }) => {
          const d = deferred()
          calls.push({ rooms, d })
          return d.promise
        },
      })
      await checkAvailability()
      await click(roomBoxes()[0])
      await click(roomBoxes()[1])
      assert.equal(calls.length, 2)
      await act(async () =>
        calls[0].d.resolve({
          currency: 'VND',
          total: '1.0000',
          nightlyRates: [{ room: 'STALE', date: thirty[0], price: '1' }],
        }),
      )
      assert.equal(document.querySelector('.booking-quote-summary'), null)
      assert.doesNotMatch(view.container.textContent, /STALE/)
      await act(async () =>
        calls[1].d.resolve({
          currency: 'VND',
          total: '2000.0000',
          nightlyRates: [
            { room: '101', date: thirty[0], price: '1000' },
            { room: '102', date: thirty[0], price: '1000' },
          ],
        }),
      )
      assert.equal(summaryRooms().length, 2)
      assert.doesNotMatch(view.container.textContent, /STALE/)
      assert.equal(footerTotal(), '2.000 ₫')
      await view.unmount()
    })
  })
})
