import test from 'node:test'
import assert from 'node:assert/strict'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

// Synthetic data only. "Today" follows the page's own calendar day for settings.timezone = UTC.
const STATUS = '/id/housekeeping/status'
const PLAN = '/id/housekeeping/plan'
const shift = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const todayUtc = () => new Date().toLocaleDateString('en-CA', { timeZone: 'UTC' })
const monday = (date) => shift(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7))
const display = (date) => date.split('-').reverse().join('/')
const staff = [
  { id: 'staff-a', name: 'Synthetic Staff A', active: true },
  { id: 'staff-b', name: 'Synthetic Staff B', active: true },
]
const task = (id, room, date, extra = {}) => ({
  id,
  room,
  date,
  staffId: null,
  shiftId: null,
  status: 'pending',
  source: 'auto',
  kind: 'dirty',
  note: '',
  revision: 1,
  ...extra,
})

const settle = (act) =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  })

function spies() {
  const calls = []
  const spy =
    (name) =>
    (...args) => {
      calls.push([name, ...args])
    }
  return {
    calls,
    handlers: {
      cleanRoom: spy('cleanRoom'),
      dirtyRoom: spy('dirtyRoom'),
      setCondition: spy('setCondition'),
      runAction: spy('runAction'),
    },
  }
}

async function mountStatus(dom, context, entry = STATUS) {
  const { React, load, mount, act } = dom
  const { default: Page } = await load('/src/apps/pms/housekeeping/pages/Housekeeping.jsx')
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const h = React.createElement
  const control = {}
  function Harness() {
    const [value, setValue] = React.useState(context)
    React.useEffect(() => {
      control.set = setValue
    }, [])
    return h(PmsContext.Provider, { value }, h(Page))
  }
  const router = createMemoryRouter(
    [
      { path: STATUS, element: h(Harness) },
      { path: '/id/housekeeping/:tab', element: h(Harness) },
    ],
    { initialEntries: [entry] },
  )
  const { container } = await mount(h(RouterProvider, { router }))
  const all = (selector) => [...container.querySelectorAll(selector)]
  const rowFor = (id) =>
    all('tbody tr').find((row) => row.querySelector('.hk-room-number')?.textContent === `R-${id}`)
  return {
    router,
    container,
    all,
    rowFor,
    find: (selector) => container.querySelector(selector),
    rooms: () => all('tbody tr .hk-room-number').map((node) => node.textContent),
    preset: (id) => container.querySelector(`.hk-queue-presets button[data-queue="${id}"]`),
    count: (id) =>
      container.querySelector(`.hk-queue-presets button[data-queue="${id}"] .hk-queue-count`)
        .textContent,
    tab: (label) =>
      all('.hk-page-header button').find((button) => button.textContent.includes(label)),
    headers: () => all('thead th').length,
    search: () => router.state.location.search,
    go: async (to) => {
      await act(async () => {
        await router.navigate(to)
      })
    },
    update: async (patch) => {
      await act(async () => {
        control.set((value) => ({ ...value, ...patch }))
      })
    },
    linkParams: (row, selector) => {
      const link = row.querySelector(selector)
      return link ? new URL(link.getAttribute('href'), 'http://localhost').searchParams : null
    },
  }
}

function statusFixture() {
  const T = todayUtc()
  const room = (id, condition, typeId = 'std', extra = {}) => ({
    id,
    typeId,
    condition,
    active: true,
    ...extra,
  })
  const rooms = [
    room('101', 'dirty'),
    room('102', 'dirty'),
    room('103', 'dirty'),
    room('104', 'clean'),
    room('105', 'dirty'),
    room('106', 'inspection'),
    room('107', 'clean'),
    room('108', 'dirty', 'dlx'),
    room('109', 'clean'),
    room('110', 'dirty'),
    room('111', 'clean'),
    room('112', 'dirty'),
    room('113', 'dirty'),
    room('114', 'dirty'),
    room('115', 'clean'),
    room('116', 'maintenance', 'dlx'),
    room('117', 'dirty', 'std', { active: false }),
  ]
  const tasks = [
    task('t101', '101', T),
    task('t102', '102', shift(T, -2), { staffId: 'staff-a' }),
    task('t102f', '102', shift(T, 5)),
    task('t104', '104', shift(T, 3)),
    task('t105', '105', T, { staffId: 'staff-a', status: 'in_progress' }),
    task('t105f', '105', shift(T, 1)),
    task('t107', '107', shift(T, -1), { staffId: 'staff-b', status: 'inspection' }),
    task('t109', '109', T, { staffId: 'staff-a', kind: 'arrival' }),
    task('t111done', '111', T, { status: 'completed' }),
  ]
  const booking = (id, status, checkIn, roomId, extra = {}) => ({
    id,
    status,
    guest: `Synthetic ${id}`,
    checkIn,
    checkOut: shift(checkIn, 2),
    room: roomId,
    ...extra,
  })
  const bookings = [
    booking('b108', 'CONFIRMED', T, '108', {
      roomStays: [{ room: '108', start: T, end: shift(T, 2) }],
    }),
    // Moved from legacy room 110 to 111 (clean, no task): neither row is an arrival need.
    booking('b110', 'CONFIRMED', T, '110', {
      roomStays: [{ room: '111', start: T, end: shift(T, 2) }],
    }),
    booking('b112', 'CONFIRMED', shift(T, 1), '112'),
    booking('b113', 'CANCELLED', T, '113'),
    // In-house room move into 114 today is not a new arrival.
    booking('b114', 'IN_HOUSE', shift(T, -1), '114', {
      roomStays: [
        { room: '118', start: shift(T, -1), end: T },
        { room: '114', start: T, end: shift(T, 2) },
      ],
    }),
    booking('b115', 'CONFIRMED', T, '115'),
    booking('b116', 'CONFIRMED', T, '116'),
  ]
  return { T, rooms, tasks, bookings }
}

test('status presets are honest read-only queues that AND with the existing filters', async () => {
  await withDraftDom(async (dom) => {
    const { T, rooms, tasks, bookings } = statusFixture()
    const { calls, handlers } = spies()
    const page = await mountStatus(dom, {
      settings: { timezone: 'UTC' },
      rooms,
      bookings,
      housekeepingTasks: tasks,
      housekeepingStaff: staff,
      housekeepingLog: [],
      housekeepingWorkLogs: [],
      roomTypes: [
        { id: 'std', name: 'Standard' },
        { id: 'dlx', name: 'Deluxe' },
      ],
      access: () => ({ allowed: true }),
      ...handlers,
    })
    const allRooms = [
      '101',
      '102',
      '103',
      '104',
      '105',
      '106',
      '107',
      '108',
      '109',
      '110',
      '111',
      '112',
      '113',
      '114',
      '115',
      '116',
    ].map((id) => `R-${id}`)
    assert.deepEqual(page.rooms(), allRooms, 'inactive room excluded')
    assert.equal(page.preset('all').getAttribute('aria-pressed'), 'true')
    const expected = {
      unassigned: ['R-101', 'R-103', 'R-108', 'R-110', 'R-112', 'R-113', 'R-114'],
      working: ['R-105'],
      inspection: ['R-106', 'R-107'],
      arrival: ['R-108', 'R-109', 'R-116'],
    }
    assert.equal(page.count('all'), '16')
    for (const [id, list] of Object.entries(expected)) {
      assert.equal(page.count(id), String(list.length), `${id} count`)
      await dom.click(page.preset(id))
      assert.equal(page.preset(id).getAttribute('aria-pressed'), 'true')
      assert.equal(page.preset('all').getAttribute('aria-pressed'), 'false')
      assert.deepEqual(page.rooms(), list, `${id} rows`)
      assert.match(page.find('.hk-queue-summary').textContent, new RegExp(`${list.length} / 16`))
      for (const row of page.all('tbody tr')) assert.equal(row.children.length, 6)
    }

    // Arrival reasons come only from existing data.
    assert.match(page.rowFor('108').querySelector('.hk-cell-room').textContent, /Khách đến hôm nay/)
    assert.match(
      page.rowFor('109').querySelector('.hk-cell-room').textContent,
      /Việc dọn: Khách đến/,
    )
    assert.match(page.rowFor('116').querySelector('.hk-cell-room').textContent, /Khách đến hôm nay/)
    assert.equal(
      page.rowFor('116').querySelector('.hk-quick-toggle').disabled,
      true,
      'maintenance has no clean action',
    )
    await dom.click(page.find('.hk-queue-clear'))
    assert.equal(page.preset('all').getAttribute('aria-pressed'), 'true')
    for (const id of ['110', '111', '112', '113', '114', '115'])
      assert.equal(
        page.rowFor(id).querySelector('.hk-room-reason'),
        null,
        `${id} has no arrival reason`,
      )

    // Task identity: today first, then earliest past, then earliest future with its scheduled date.
    const when = (id) => page.rowFor(id).querySelector('.hk-task-when')?.textContent || ''
    assert.equal(page.linkParams(page.rowFor('101'), 'a.hk-room-task-link').get('task'), 't101')
    assert.equal(page.linkParams(page.rowFor('102'), 'a.hk-room-task-link').get('task'), 't102')
    assert.equal(when('102'), `Việc ngày ${display(shift(T, -2))}`)
    assert.doesNotMatch(page.rowFor('102').textContent, /quá hạn/i)
    assert.equal(page.linkParams(page.rowFor('105'), 'a.hk-room-task-link').get('task'), 't105')
    const future = page.linkParams(page.rowFor('104'), 'a.hk-room-action')
    assert.equal(future.get('task'), 't104')
    assert.equal(future.get('date'), shift(T, 3))
    assert.equal(when('104'), `Đã lên lịch ${display(shift(T, 3))}`)
    assert.equal(
      page.rowFor('104').querySelector('.hk-quick-toggle').disabled,
      true,
      'future-only task still guards quick clean',
    )
    assert.equal(page.rowFor('103').querySelector('.hk-quick-toggle').disabled, false)
    assert.equal(
      page.rowFor('111').querySelector('.hk-quick-toggle').disabled,
      false,
      'completed task is not an open task',
    )

    // Type filter AND preset.
    const typeSelect = page
      .all('select')
      .find((select) => [...select.options].some((option) => option.value === 'dlx'))
    const staffSelect = page
      .all('select')
      .find((select) => [...select.options].some((option) => option.value === 'staff-a'))
    await dom.input(typeSelect, 'dlx')
    assert.equal(page.count('all'), '2')
    assert.equal(page.count('unassigned'), '1')
    assert.equal(page.count('arrival'), '2')
    await dom.click(page.preset('unassigned'))
    assert.deepEqual(page.rooms(), ['R-108'])
    assert.equal(typeSelect.value, 'dlx')
    await dom.input(typeSelect, '')

    // Staff filter AND preset, with an honest empty combination.
    await dom.input(staffSelect, 'staff-a')
    assert.equal(page.count('all'), '3')
    assert.equal(page.count('unassigned'), '0')
    assert.equal(page.count('working'), '1')
    assert.equal(page.count('arrival'), '1')
    assert.deepEqual(page.rooms(), [])
    assert.ok(page.find('.hk-empty'), 'empty combination is explained')
    assert.match(page.find('.hk-queue-summary').textContent, /0 \/ 16/)
    await dom.click(page.preset('working'))
    assert.deepEqual(page.rooms(), ['R-105'])
    assert.equal(staffSelect.value, 'staff-a')
    await dom.click(page.find('.hk-queue-clear'))
    assert.deepEqual(page.rooms(), ['R-102', 'R-105', 'R-109'])
    assert.equal(staffSelect.value, 'staff-a')
    assert.equal(calls.length, 0, 'presets and filters never write')
  })
})

test('history paginates the complete loaded filtered list and exports every filtered row', async () => {
  await withDraftDom(async (dom) => {
    const T = todayUtc()
    const at = (i) => new Date(Date.parse(`${T}T00:00:00Z`) + i * 60000).toISOString()
    const logs = Array.from({ length: 120 }, (_, i) => ({
      id: `h${i}`,
      room: i < 100 ? '101' : '102',
      condition: i % 2 ? 'clean' : 'dirty',
      createdAt: at(i),
      actor: `Synthetic Actor ${i % 3}`,
    }))
    const { calls, handlers } = spies()
    const page = await mountStatus(dom, {
      settings: { timezone: 'UTC' },
      rooms: [
        { id: '101', typeId: 'std', condition: 'dirty' },
        { id: '102', typeId: 'std', condition: 'clean' },
      ],
      bookings: [],
      housekeepingTasks: [],
      housekeepingStaff: [],
      housekeepingLog: logs,
      housekeepingWorkLogs: [],
      roomTypes: [{ id: 'std', name: 'Standard' }],
      access: () => ({ allowed: true }),
      ...handlers,
    })
    const { window } = dom
    const restore = []
    const patch = (target, key, value) => {
      const previous = Object.getOwnPropertyDescriptor(target, key)
      restore.push(() => {
        if (previous) Object.defineProperty(target, key, previous)
        else delete target[key]
      })
      Object.defineProperty(target, key, { configurable: true, writable: true, value })
    }
    const blobs = [],
      hrefs = []
    try {
      const OriginalBlob = globalThis.Blob
      class SpyBlob extends OriginalBlob {
        constructor(parts = [], options) {
          super(parts, options)
          blobs.push(parts.map((part) => (typeof part === 'string' ? part : '')).join(''))
        }
      }
      patch(globalThis, 'Blob', SpyBlob)
      patch(window, 'Blob', SpyBlob)
      for (const url of new Set([globalThis.URL, window.URL])) {
        patch(url, 'createObjectURL', () => 'blob:synthetic')
        patch(url, 'revokeObjectURL', () => {})
      }
      patch(window.HTMLAnchorElement.prototype, 'click', function () {
        hrefs.push(this.getAttribute('href') || '')
      })
      const exported = () => {
        const text = blobs.length
          ? blobs.at(-1)
          : decodeURIComponent((hrefs.at(-1) || '').replace(/^data:[^,]*,/, ''))
        return text.split(/\r?\n/).filter((line) => line.trim())
      }
      const range = () => page.find('.hk-history-range')?.textContent || ''
      const next = () => dom.click(page.find('.hk-history-next'))
      const prev = () => dom.click(page.find('.hk-history-prev'))
      const exportButton = page.find('.hk-page-header > div:last-child button')

      await dom.click(page.tab('Lịch sử'))
      assert.equal(page.headers(), 5)
      assert.equal(page.all('tbody tr').length, 50)
      for (const row of page.all('tbody tr')) assert.equal(row.children.length, 5)
      assert.match(range(), /^1–50 \/ 120 mục trong dữ liệu đã tải/)
      assert.equal(page.find('.hk-history-prev').disabled, true)
      assert.equal(page.all('tbody tr')[0].children[2].textContent, 'R-102', 'newest first')
      await next()
      assert.match(range(), /^51–100 \/ 120/)
      await next()
      assert.match(range(), /^101–120 \/ 120/)
      assert.equal(page.all('tbody tr').length, 20)
      assert.equal(page.find('.hk-history-next').disabled, true)
      await prev()
      assert.match(range(), /^51–100 \/ 120/)

      // Export writes every filtered row, not the current page.
      await dom.click(exportButton)
      const all = exported()
      assert.equal(all.length, 121, 'header + 120 rows')
      assert.equal(all.filter((line) => /R-10[12]/.test(line)).length, 120)

      // Every filter handler resets to page 1.
      await next()
      assert.match(range(), /^101–120/)
      const roomSelect = page
        .all('select')
        .find((select) => [...select.options].some((option) => option.value === 'R-101'))
      await dom.input(roomSelect, 'R-101')
      assert.match(range(), /^1–50 \/ 100/)
      await next()
      assert.match(range(), /^51–100 \/ 100/)
      const actorSelect = page
        .all('select')
        .find((select) =>
          [...select.options].some((option) => option.value === 'Synthetic Actor 0'),
        )
      await dom.input(actorSelect, 'Synthetic Actor 0')
      assert.match(range(), /^1–34 \/ 34/)
      await dom.input(actorSelect, '')
      await next()
      assert.match(range(), /^51–100 \/ 100/)

      // A shrinking loaded dataset clamps the page on render.
      await page.update({ housekeepingLog: logs.slice(0, 60) })
      assert.match(range(), /^51–60 \/ 60/)
      assert.equal(page.all('tbody tr').length, 10)
      await page.update({ housekeepingLog: logs.slice(0, 30) })
      assert.match(range(), /^1–30 \/ 30/)
      assert.equal(page.find('.hk-history-prev').disabled, true)
      await dom.click(exportButton)
      assert.equal(exported().length, 31, 'export follows the visible filters')

      // Invalid dates still block rows and export.
      const exportsBefore = blobs.length + hrefs.length
      const start = page.find('.hk-history-dates input')
      await dom.input(start, '31/02/2026')
      await dom.act(async () => {
        start.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
        start.dispatchEvent(new window.FocusEvent('blur'))
      })
      assert.ok(page.find('.domain-error[role="alert"]'), 'invalid date alert')
      assert.equal(page.all('tbody tr').length, 0)
      assert.equal(page.find('.hk-history-pager'), null)
      await dom.click(exportButton)
      assert.equal(blobs.length + hrefs.length, exportsBefore, 'no export with invalid dates')
      assert.equal(calls.length, 0)
    } finally {
      for (const undo of restore.reverse()) undo()
    }
  })
})

test('exact room target is read only, strict and derived from the URL', async () => {
  await withDraftDom(async (dom) => {
    const T = todayUtc()
    const { calls, handlers } = spies()
    const rooms = [
      { id: '101', name: 'Ocean View', typeId: 'std', condition: 'dirty', active: true },
      { id: '202', typeId: 'std', condition: 'clean', active: true },
      { id: 'A1', typeId: 'std', condition: 'clean', active: true },
      { id: '117', typeId: 'std', condition: 'dirty', active: false },
    ]
    const page = await mountStatus(
      dom,
      {
        settings: { timezone: 'UTC' },
        rooms,
        bookings: [],
        housekeepingTasks: [task('t1', '101', T)],
        housekeepingStaff: staff,
        housekeepingLog: [
          {
            id: 'l1',
            room: '101',
            condition: 'dirty',
            createdAt: `${T}T01:00:00Z`,
            actor: 'Synthetic Actor',
          },
        ],
        housekeepingWorkLogs: [],
        roomTypes: [{ id: 'std', name: 'Standard' }],
        access: () => ({ allowed: true }),
        ...handlers,
      },
      `${STATUS}?room=101&keep=1`,
    )
    const banner = () => page.find('.hk-target-banner')
    const normal = () =>
      Boolean(page.find('.hk-queue-presets')) && Boolean(page.find('.pms-housekeeping-filters'))

    assert.deepEqual(page.rooms(), ['R-101'])
    assert.ok(banner().classList.contains('is-found'))
    assert.match(banner().textContent, /Đang xem phòng 101/)
    assert.equal(normal(), false, 'normal filters and presets hidden while targeted')
    assert.equal(page.headers(), 6)
    assert.equal(page.rowFor('101').children.length, 6)
    const link = page.linkParams(page.rowFor('101'), 'a.hk-room-task-link')
    assert.equal(link.get('task'), 't1')
    assert.equal(link.get('date'), T)

    // Route changes derive the new exact row immediately; a room-only target never invents a task id.
    await page.go(`${STATUS}?room=202&keep=1`)
    assert.deepEqual(page.rooms(), ['R-202'])
    const fresh = page.linkParams(page.rowFor('202'), 'a.hk-room-action')
    assert.equal(fresh.get('task'), null)
    assert.equal(fresh.get('room'), '202')
    assert.equal(page.rowFor('202').querySelector('a.hk-room-task-link'), null)
    await page.go(`${STATUS}?room=A1`)
    assert.deepEqual(page.rooms(), ['R-A1'])
    await page.go(`${STATUS}?room=${'y'.repeat(64)}`)
    assert.ok(banner().classList.contains('is-missing'), '64 chars is a valid length')

    const cases = [
      ['room=', 'empty'],
      ['room=101&room=202', 'invalid'],
      [`room=${'x'.repeat(65)}`, 'invalid'],
      ['room=%01101', 'invalid'],
      ['room=101%0A', 'invalid'],
      ['room=R-101', 'missing'],
      ['room=%20101', 'missing'],
      ['room=101%20', 'missing'],
      ['room=Ocean%20View', 'missing'],
      ['room=a1', 'missing'],
      ['room=117', 'missing'],
      ['room=999', 'missing'],
    ]
    for (const [query, state] of cases) {
      await page.go(`${STATUS}?${query}&keep=1`)
      assert.ok(banner()?.classList.contains(`is-${state}`), `${query}: ${state}`)
      assert.equal(banner().getAttribute('role'), 'alert', `${query}: alert`)
      assert.deepEqual(page.rooms(), [], `${query}: no fallback row`)
      assert.equal(normal(), false, `${query}: normal controls hidden`)
      assert.ok(page.find('.hk-target-clear'), `${query}: clear action`)
    }

    // Clear removes only room, with replace, and shows the normal status page.
    await page.go(`${STATUS}?room=101&keep=1&x=2`)
    await dom.click(page.find('.hk-target-clear'))
    assert.equal(page.search(), '?keep=1&x=2')
    assert.equal(page.router.state.historyAction, 'REPLACE')
    assert.equal(banner(), null)
    assert.equal(normal(), true)
    assert.deepEqual(page.rooms(), ['R-101', 'R-202', 'R-A1'])

    // A target forces status over a chosen History tab; clearing returns to status.
    await dom.click(page.tab('Lịch sử'))
    assert.equal(page.headers(), 5)
    await page.go(`${STATUS}?room=202&keep=1`)
    assert.equal(page.headers(), 6)
    assert.deepEqual(page.rooms(), ['R-202'])
    await dom.click(page.find('.hk-target-clear'))
    assert.equal(page.search(), '?keep=1')
    assert.equal(page.headers(), 6, 'explicit clear shows normal status')

    // Choosing History explicitly removes the target and shows history.
    await page.go(`${STATUS}?room=202&keep=1`)
    await dom.click(page.tab('Lịch sử'))
    assert.equal(page.search(), '?keep=1')
    assert.equal(page.headers(), 5)
    assert.equal(banner(), null)
    await dom.click(page.tab('Trạng thái phòng'))
    assert.equal(page.headers(), 6)
    assert.equal(calls.length, 0, 'no clean, dirty, setCondition or runAction calls')
  })
})

async function setupPlan(dom, { entries, response, known = [], fail = false, gate = null }) {
  const { React, load, mount, act } = dom
  const { default: Page } = await load('/src/apps/pms/housekeeping/pages/HousekeepingPlan.jsx')
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const { DraftGuardProvider, DraftRouteGuard } = await load(
    '/src/shared/drafts/DraftGuardProvider.jsx',
  )
  const state = { fail, gate },
    reads = [],
    writes = []
  const write =
    (name) =>
    async (...args) => {
      writes.push([name, ...args])
      return {}
    }
  const context = {
    tenantId: 'hotel-synthetic',
    settings: { timezone: 'UTC' },
    housekeepingStaff: staff,
    housekeepingTasks: known,
    housekeepingShifts: [],
    rooms: ['101', '102', '103', '104', '105', '106', '107'].map((id) => ({
      id,
      active: true,
      condition: 'dirty',
    })),
    access: (permission) => ({
      allowed: ['housekeeping.manage', 'housekeeping.complete'].includes(permission),
    }),
    requestTenant: async (path) => {
      reads.push(path)
      if (path.startsWith('/housekeeping/shifts')) return { shifts: [] }
      if (state.gate) await state.gate
      if (state.fail) throw new Error('synthetic load failure')
      return { tasks: response.filter((row) => path.includes(monday(row.date))) }
    },
    generateHousekeepingPlan: write('generate'),
    createHousekeepingTask: write('create'),
    assignHousekeepingTask: write('assign'),
    updateHousekeepingTask: write('update'),
  }
  const h = React.createElement
  const Screen = () =>
    h(React.Fragment, null, h(DraftRouteGuard), h(PmsContext.Provider, { value: context }, h(Page)))
  const router = createMemoryRouter(
    [
      { path: PLAN, element: h(Screen) },
      { path: '*', element: h('p', null, 'other') },
    ],
    { initialEntries: entries },
  )
  const { container } = await mount(h(DraftGuardProvider, null, h(RouterProvider, { router })))
  await settle(act)
  const all = (selector) => [...container.querySelectorAll(selector)]
  return {
    state,
    reads,
    writes,
    router,
    container,
    all,
    find: (selector) => container.querySelector(selector),
    preset: (id) => container.querySelector(`.hk-plan-queues button[data-queue="${id}"]`),
    count: (id) =>
      container.querySelector(`.hk-plan-queues button[data-queue="${id}"] .hk-queue-count`)
        .textContent,
    listRooms: () =>
      all('.hk-plan-task-list button.hk-calendar-task').map((button) =>
        button.querySelector('.hk-calendar-task-top strong').textContent.trim().split(' ').pop(),
      ),
    view: () => all('.hk-view-toggle button').map((button) => button.getAttribute('aria-pressed')),
    select: (value) =>
      all('.hk-plan-filters select').find((select) =>
        [...select.options].some((option) => option.value === value),
      ),
    dialog: () => container.querySelector('dialog.hk-plan-dialog'),
    detail: () => container.querySelector('dialog.hk-plan-dialog .hk-task-detail'),
    search: () => router.state.location.search,
    go: async (to) => {
      await act(async () => {
        await router.navigate(to)
      })
      await settle(act)
    },
  }
}

function weekTasks() {
  const W = monday(todayUtc())
  return [
    task('p1', '101', W),
    task('p2', '102', shift(W, 1), { staffId: 'staff-a', status: 'in_progress' }),
    task('p3', '103', shift(W, 2), { staffId: 'staff-a', status: 'inspection' }),
    task('p4', '104', shift(W, 3), { kind: 'arrival' }),
    task('p5', '105', shift(W, 4), { status: 'completed' }),
    task('p6', '106', shift(W, 7)),
    task('p7', '107', shift(W, 5), { staffId: 'staff-a', kind: 'arrival' }),
  ]
}

test('room links count Unicode code points and queue actions use the displayed current task', async () => {
  await withDraftDom(async (dom) => {
    const context = statusFixture(),
      date = todayUtc(),
      astralId = '🏨'.repeat(33)
    const page = await mountStatus(dom, {
      settings: { timezone: 'UTC' },
      rooms: [...context.rooms, { id: astralId, active: true, condition: 'clean', typeId: 'std' }],
      bookings: context.bookings,
      housekeepingStaff: staff,
      housekeepingLog: [],
      housekeepingWorkLogs: [],
      roomTypes: [
        { id: 'std', name: 'Standard' },
        { id: 'dlx', name: 'Deluxe' },
      ],
      access: () => ({ allowed: true }),
      ...spies().handlers,
      housekeepingTasks: [
        task('old-working', '101', shift(date, -1), { status: 'in_progress', staffId: 'staff-a' }),
        task('current-pending', '101', date, { status: 'pending', staffId: 'staff-b' }),
      ],
    })
    await dom.click(page.preset('working'))
    assert.equal(
      page.rooms().includes('R-101'),
      false,
      'an old working task must not select a row whose current task is pending',
    )
    await page.go(STATUS + '?' + new URLSearchParams({ room: astralId }))
    assert.deepEqual(
      page.rooms(),
      ['R-' + astralId],
      'the notification and destination agree on 1..64 code points',
    )
    await page.go(STATUS + '?' + new URLSearchParams({ room: '🏨'.repeat(65) }))
    assert.equal(page.rooms().length, 0)
    assert.ok(page.find('[role="alert"], [role="status"]'))
  })
})

test('plan presets filter only the loaded week, switch to list and keep filters, URL and data untouched', async () => {
  await withDraftDom(async (dom) => {
    const response = weekTasks()
    const page = await setupPlan(dom, { entries: [PLAN], response })
    assert.deepEqual(page.view(), ['true', 'false'], 'starts in calendar')
    assert.equal(page.preset('all').getAttribute('aria-pressed'), 'true')
    assert.deepEqual(['all', 'unassigned', 'working', 'inspection', 'arrival'].map(page.count), [
      '6',
      '2',
      '1',
      '1',
      '2',
    ])
    const readsBefore = page.reads.length

    await dom.click(page.preset('unassigned'))
    assert.equal(page.preset('unassigned').getAttribute('aria-pressed'), 'true')
    assert.deepEqual(page.view(), ['false', 'true'], 'non-All preset switches to list')
    assert.deepEqual(page.listRooms(), ['101', '104'], 'current week unassigned only')
    const arrivalCard = page.all('.hk-plan-task-list button.hk-calendar-task')[1]
    assert.match(arrivalCard.querySelector('.hk-task-priority').textContent, /Khách đến/)
    assert.ok(arrivalCard.querySelector('.hk-task-status'))

    const statusSelect = page.select('in_progress'),
      staffSelect = page.select('staff-a')
    await dom.input(statusSelect, 'pending')
    assert.deepEqual(['all', 'unassigned', 'working', 'inspection', 'arrival'].map(page.count), [
      '3',
      '2',
      '0',
      '0',
      '2',
    ])
    assert.deepEqual(page.listRooms(), ['101', '104'])
    await dom.click(page.preset('arrival'))
    assert.deepEqual(page.listRooms(), ['104', '107'])
    assert.equal(statusSelect.value, 'pending')
    await dom.input(staffSelect, 'staff-a')
    assert.deepEqual(page.listRooms(), ['107'])
    assert.equal(page.count('unassigned'), '0')
    await dom.click(page.preset('unassigned'))
    assert.deepEqual(page.listRooms(), [])
    assert.ok(page.find('.hk-plan-task-list .hk-plan-empty'))
    assert.equal(statusSelect.value, 'pending')
    assert.equal(staffSelect.value, 'staff-a')

    // All keeps whichever view the user chose.
    await dom.click(page.preset('all'))
    assert.deepEqual(page.view(), ['false', 'true'])
    assert.deepEqual(page.listRooms(), ['107'])
    await dom.click(page.all('.hk-view-toggle button')[0])
    await dom.click(page.preset('all'))
    assert.deepEqual(page.view(), ['true', 'false'], 'All does not force a view')
    await dom.click(page.preset('working'))
    assert.deepEqual(page.view(), ['false', 'true'])

    assert.equal(page.search(), '')
    assert.equal(page.dialog(), null)
    assert.equal(page.reads.length, readsBefore, 'presets do not reload')
    assert.equal(page.writes.length, 0)
  })
})

test('plan presets stay disabled while loading or after a failed load', async () => {
  await withDraftDom(async (dom) => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const page = await setupPlan(dom, { entries: [PLAN], response: weekTasks(), gate })
    assert.equal(page.preset('unassigned').disabled, true, 'disabled while loading')
    assert.equal(page.count('unassigned'), '—', 'loading is not a zero result')
    page.state.gate = null
    release()
    await settle(dom.act)
    assert.equal(page.preset('unassigned').disabled, false)
    assert.equal(page.count('unassigned'), '2')
    assert.equal(page.writes.length, 0)
  })
  await withDraftDom(async (dom) => {
    const page = await setupPlan(dom, { entries: [PLAN], response: weekTasks(), fail: true })
    assert.equal(page.preset('arrival').disabled, true, 'disabled after failure')
    assert.equal(page.count('arrival'), '—')
    page.state.fail = false
    await dom.click(page.find('.domain-error button'))
    await settle(dom.act)
    assert.equal(page.preset('arrival').disabled, false)
    assert.equal(page.count('arrival'), '2')
    assert.equal(page.writes.length, 0)
  })
})

test('plan presets are disabled for an invalid week date', async () => {
  await withDraftDom(async (dom) => {
    const page = await setupPlan(dom, { entries: [PLAN], response: weekTasks() })
    assert.equal(page.preset('working').disabled, false)
    const dateInput = page.find('.hk-plan-filters input')
    await dom.input(dateInput, '31/02/2026')
    await dom.act(async () => {
      dateInput.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }))
      dateInput.dispatchEvent(new dom.window.FocusEvent('blur'))
    })
    assert.equal(page.preset('working').disabled, true)
    assert.equal(page.count('working'), '—')
    assert.equal(page.writes.length, 0)
  })
})

test('a task deep link still opens its dialog while a preset is active and closing keeps the preset', async () => {
  await withDraftDom(async (dom) => {
    const response = weekTasks()
    const page = await setupPlan(dom, { entries: [`${PLAN}?keep=1`], response, known: response })
    await dom.click(page.preset('unassigned'))
    const p2 = response[1]
    await page.go(`${PLAN}?task=p2&date=${p2.date}&room=102&keep=1`)
    assert.ok(page.detail(), 'existing intent dialog opens')
    assert.equal(page.preset('unassigned').getAttribute('aria-pressed'), 'true')
    await dom.click(page.find('.hk-dialog-heading button'))
    await settle(dom.act)
    assert.equal(page.dialog(), null)
    assert.equal(page.search(), '?keep=1')
    assert.equal(page.preset('unassigned').getAttribute('aria-pressed'), 'true')
    assert.deepEqual(page.listRooms(), ['101', '104'])
    assert.equal(page.writes.length, 0)
  })
})
