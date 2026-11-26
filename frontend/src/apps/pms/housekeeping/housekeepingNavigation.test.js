import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

// Synthetic data only. Dates are far from "today" so the target week always differs from the initial week.
const PLAN = '/id/housekeeping/plan'
const manager = ['housekeeping.manage', 'housekeeping.complete']
const monday = (date) => {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7))
  return value.toISOString().slice(0, 10)
}
const task = (id, room, date, staffId = null) => ({
  id,
  room,
  date,
  staffId,
  shiftId: null,
  status: 'pending',
  source: 'manual',
  kind: 'dirty',
  note: '',
  revision: 1,
})
const rooms = [
  { id: '101', active: true, condition: 'dirty' },
  { id: '102', active: true, condition: 'maintenance' },
  { id: '202', active: true, condition: 'clean' },
]
const staff = [{ id: 'staff-a', name: 'Synthetic Staff', active: true }]

const settle = (act, ms = 0) =>
  act(async () => {
    if (ms) await new Promise((resolve) => setTimeout(resolve, ms))
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  })

async function setup(
  dom,
  {
    entries,
    index,
    known = [],
    response = known,
    allow = manager,
    slowExcept = '',
    fail = false,
    wait = 0,
  },
) {
  const { React, load, mount, act } = dom
  const { default: Page } = await load('/src/apps/pms/housekeeping/pages/HousekeepingPlan.jsx')
  const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
  const { DraftGuardProvider, DraftRouteGuard } = await load(
    '/src/shared/drafts/DraftGuardProvider.jsx',
  )
  const state = { fail, response, slowExcept },
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
    rooms,
    housekeepingStaff: staff,
    housekeepingTasks: known,
    housekeepingShifts: [],
    access: (permission) => ({ allowed: allow.includes(permission) }),
    requestTenant: async (path) => {
      reads.push(path)
      if (state.slowExcept && !path.includes(state.slowExcept))
        await new Promise((resolve) => setTimeout(resolve, 15))
      if (path.startsWith('/housekeeping/shifts')) return { shifts: [] }
      if (state.fail) throw new Error('synthetic load failure')
      return { tasks: state.response.filter((row) => path.includes(monday(row.date))) }
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
      { path: '*', element: h('p', { className: 'other-route' }, 'other') },
    ],
    { initialEntries: entries, initialIndex: index ?? entries.length - 1 },
  )
  const { container } = await mount(h(DraftGuardProvider, null, h(RouterProvider, { router })))
  await settle(act, wait)
  const go = async (to) => {
    await act(async () => {
      await router.navigate(to)
    })
    await settle(act)
  }
  const find = (selector) => container.querySelector(selector)
  return {
    state,
    reads,
    writes,
    router,
    container,
    go,
    find,
    dialog: () => find('dialog.hk-plan-dialog'),
    detail: () => find('dialog.hk-plan-dialog .hk-task-detail'),
    manualRoom: () => find('dialog.hk-plan-dialog form select[required]'),
    message: () => find('.hk-intent-message'),
    confirmation: () => find('dialog.draft-confirmation'),
    loadedWeek: (date) =>
      reads.some((path) => path.startsWith('/housekeeping/tasks?') && path.includes(monday(date))),
    search: () => router.state.location.search,
  }
}

test('task link opens the exact unassigned task on its actual date and week', async () => {
  await withDraftDom(async (dom) => {
    const known = [task('t1', '101', '2026-03-12')]
    const response = [...known, task('t2', '202', '2026-04-22')]
    // The link carries a stale date; the first (current week) response is slow and must not produce a false miss.
    const page = await setup(dom, {
      entries: [`${PLAN}?task=t1&date=2026-06-03&room=101`],
      known,
      response,
      slowExcept: monday('2026-03-12'),
      wait: 60,
    })
    assert.ok(page.detail(), 'task detail opens')
    assert.equal(page.manualRoom(), null)
    assert.equal(page.message(), null)
    assert.ok(page.loadedWeek('2026-03-12'))
    assert.equal(page.loadedWeek('2026-06-03'), false)

    // Unknown to the workspace list: the valid date in the link selects the week, the response supplies the task.
    page.state.slowExcept = ''
    await page.go(`${PLAN}?task=t2&date=2026-04-22&room=202`)
    assert.ok(page.detail())
    assert.ok(page.loadedWeek('2026-04-22'))
    assert.equal(page.message(), null)
    assert.equal(page.writes.length, 0)
  })
})

test('room link without a task opens the manual form with the exact room and date', async () => {
  await withDraftDom(async (dom) => {
    const page = await setup(dom, { entries: [`${PLAN}?room=101&date=2026-04-22`] })
    assert.equal(page.manualRoom()?.value, '101')
    assert.equal(
      page.dialog().querySelector('form input[placeholder="dd/MM/yyyy"]').value,
      '22/04/2026',
    )
    assert.equal(page.detail(), null)
    assert.ok(page.loadedWeek('2026-04-22'))
    assert.equal(page.writes.length, 0)
  })
})

test('invalid, deleted and unusable targets show a safe message with a usable list', async () => {
  await withDraftDom(async (dom) => {
    const known = [task('t1', '101', '2026-03-12')]
    const page = await setup(dom, { entries: [`${PLAN}?task=t1&date=2026-02-31`], known })
    const safe = (label) => {
      assert.ok(page.message(), `${label}: message`)
      assert.equal(page.dialog(), null, `${label}: no dialog`)
      assert.ok(page.find('.hk-calendar-scroll'), `${label}: calendar usable`)
    }
    safe('rollover date')
    assert.equal(page.loadedWeek('2026-03-12'), false)
    await page.go(`${PLAN}?task=deleted&date=2026-03-12&room=101`)
    safe('deleted task')
    await page.go(`${PLAN}?room=102&date=2026-04-22`)
    safe('maintenance room')
    await page.go(`${PLAN}?room=999&date=2026-04-22`)
    safe('unknown room')
    await page.go(`${PLAN}?room=101&date=22-04-2026`)
    safe('malformed date')
    // A new valid intent still works after errors.
    await page.go(`${PLAN}?task=t1&date=2026-03-12&room=101`)
    assert.ok(page.detail())
    assert.equal(page.message(), null)
    assert.equal(page.writes.length, 0)
  })
})

test('a failed week load is not reported as a missing task and retry opens it', async () => {
  await withDraftDom(async (dom) => {
    const known = [task('t1', '101', '2026-03-12')]
    const page = await setup(dom, {
      entries: [`${PLAN}?task=t1&date=2026-03-12&room=101`],
      known,
      fail: true,
    })
    assert.equal(page.message(), null)
    assert.equal(page.dialog(), null)
    const retry = page.find('.domain-error:not(.hk-intent-message) button')
    assert.ok(retry, 'load error offers retry')
    page.state.fail = false
    await dom.click(retry)
    await settle(dom.act)
    assert.ok(page.detail())
    assert.equal(page.message(), null)
    assert.equal(page.writes.length, 0)
  })
})

test('read-only housekeeping never gets the manual form or a task outside its response scope', async () => {
  await withDraftDom(async (dom) => {
    const mine = task('mine', '101', '2026-03-12', 'staff-a'),
      other = task('other', '202', '2026-03-12', 'staff-b')
    const page = await setup(dom, {
      entries: [`${PLAN}?room=202&date=2026-04-22`],
      known: [mine, other],
      response: [mine],
      allow: [],
    })
    assert.ok(page.message())
    assert.equal(page.dialog(), null)
    await page.go(`${PLAN}?task=other&date=2026-03-12&room=202`)
    assert.ok(page.message())
    assert.equal(page.dialog(), null)
    await page.go(`${PLAN}?task=mine&date=2026-03-12&room=101`)
    assert.ok(page.detail())
    assert.equal(page.detail().querySelector('form'), null)
    assert.equal(page.detail().querySelector('textarea'), null)
    assert.equal(page.writes.length, 0)
  })
})

test('closing removes only the owned intent, reloads do not reopen it and a new intent works', async () => {
  await withDraftDom(async (dom) => {
    const known = [task('t1', '101', '2026-03-12')]
    const url = `${PLAN}?task=t1&date=2026-03-12&room=101&keep=1`
    const page = await setup(dom, { entries: [url], known })
    assert.ok(page.detail())
    await dom.click(page.find('.hk-dialog-heading button'))
    await settle(dom.act)
    assert.equal(page.dialog(), null)
    assert.equal(page.confirmation(), null)
    assert.equal(page.search(), '?keep=1')
    for (let i = 0; i < 2; i += 1) {
      await dom.click(page.find('.hk-plan-filters > button'))
      await settle(dom.act)
      assert.equal(page.dialog(), null, 'reload does not reopen')
    }
    await page.go(url)
    assert.ok(page.detail(), 'same link opens again as a new intent')
    assert.equal(page.writes.length, 0)
  })
})

test('dirty dialog is guarded on close, query change and back with continue and discard', async () => {
  await withDraftDom(async (dom) => {
    const known = [task('t1', '101', '2026-03-12')]
    const roomUrl = `${PLAN}?room=101&date=2026-04-22`,
      taskUrl = `${PLAN}?task=t1&date=2026-03-12&room=101`
    const page = await setup(dom, { entries: ['/id/other', roomUrl], known })
    const keep = async () => {
      await dom.click(page.confirmation().querySelector('button'))
      await settle(dom.act)
    }
    const discard = async () => {
      await dom.click(page.confirmation().querySelector('.draft-confirmation-discard'))
      await settle(dom.act)
    }
    const closeButton = () => page.find('.hk-dialog-heading button')
    const manualStaff = () => page.dialog().querySelectorAll('form select')[1]

    await dom.input(manualStaff(), 'staff-a')
    // Close: continue keeps the draft.
    await dom.click(closeButton())
    assert.ok(page.confirmation())
    await keep()
    assert.equal(page.confirmation(), null)
    assert.equal(manualStaff().value, 'staff-a')
    // Query change: continue keeps the location and the draft.
    await page.go(taskUrl)
    assert.ok(page.confirmation())
    await keep()
    assert.equal(page.search(), '?room=101&date=2026-04-22')
    assert.equal(manualStaff().value, 'staff-a')
    // Query change: discard opens the new target.
    await page.go(taskUrl)
    await discard()
    assert.equal(page.manualRoom(), null)
    assert.ok(page.detail())
    assert.ok(page.search().includes('task=t1'))

    // Back: continue keeps the dirty task dialog.
    await dom.input(page.detail().querySelector('select'), 'staff-a')
    await page.go(-1)
    assert.ok(page.confirmation())
    await keep()
    assert.ok(page.detail())
    assert.ok(page.search().includes('task=t1'))
    // Close: discard closes and strips the intent.
    await dom.click(closeButton())
    assert.ok(page.confirmation())
    await discard()
    assert.equal(page.dialog(), null)
    assert.equal(page.router.state.location.pathname, PLAN)
    assert.equal(page.search(), '')

    // Back: discard leaves the dirty dialog.
    await page.go(roomUrl)
    await dom.input(manualStaff(), 'staff-a')
    await page.go(-1)
    assert.ok(page.confirmation())
    await discard()
    assert.equal(page.confirmation(), null)
    assert.equal(page.dialog(), null)
    assert.equal(page.search(), '')
    assert.equal(page.writes.length, 0)
  })
})

test('room status links carry the existing task and its actual date instead of creating one today', async () => {
  await withDraftDom(async ({ React, load, mount }) => {
    const { default: Page } = await load('/src/apps/pms/housekeeping/pages/Housekeeping.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const noop = async () => {}
    const context = {
      rooms: [
        { id: '101', typeId: 'std', active: true, condition: 'dirty' },
        { id: '202', typeId: 'std', active: true, condition: 'dirty' },
      ],
      bookings: [],
      housekeepingLog: [],
      housekeepingWorkLogs: [],
      housekeepingTasks: [task('t1', '101', '2026-03-12')],
      housekeepingStaff: staff,
      roomTypes: [{ id: 'std', name: 'Standard' }],
      settings: { timezone: 'UTC' },
      access: () => ({ allowed: true }),
      cleanRoom: noop,
      dirtyRoom: noop,
      setCondition: noop,
      runAction: noop,
    }
    const { container } = await mount(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(PmsContext.Provider, { value: context }, React.createElement(Page)),
      ),
    )
    const params = (selector) =>
      [...container.querySelectorAll(selector)].map(
        (link) => new URL(link.getAttribute('href'), 'http://localhost').searchParams,
      )
    const assign = params('a.hk-room-action')
    const existing = assign.find((row) => row.get('room') === '101'),
      fresh = assign.find((row) => row.get('room') === '202')
    assert.equal(existing.get('task'), 't1')
    assert.equal(existing.get('date'), '2026-03-12')
    assert.equal(fresh.get('task'), null)
    assert.match(fresh.get('date'), /^\d{4}-\d{2}-\d{2}$/)
    const view = params('a.hk-room-task-link')[0]
    assert.equal(view.get('task'), 't1')
    assert.equal(view.get('date'), '2026-03-12')
    assert.equal(view.get('room'), '101')
  })
})
