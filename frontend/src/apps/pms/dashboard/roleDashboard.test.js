import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

// Synthetic data only: the PMS context is mocked, Dashboard and router are real.
const DATE = '2026-03-10'
const report = (financial) => ({
  date: DATE,
  arriving: 2,
  departing: 1,
  occupied: 3,
  activeRooms: 4,
  occupancy: 75,
  currency: 'VND',
  financial: financial ? { rows: [] } : null,
  chart: [
    {
      date: DATE,
      occupancy: 75,
      occupied: 3,
      capacity: 4,
      ...(financial ? { realizedRevenue: '1500000' } : {}),
    },
  ],
  alerts: {
    dirtyRooms: [{ number: '105' }],
    inspectionRooms: [],
    overdueDepartures: [{ id: 'O1', guest: 'Khách O1', rooms: ['201', '202'] }],
    pendingArrivals: [],
  },
  arrivalBookings: [
    {
      id: 'BK-A1',
      guest: 'Nguyễn An',
      rooms: ['101'],
      currency: 'VND',
      ...(financial ? { balance: '200000' } : {}),
    },
  ],
  departureBookings: [
    {
      id: 'BK-D1',
      guest: 'Lê Bình',
      rooms: ['102'],
      currency: 'VND',
      ...(financial ? { balance: '300000' } : {}),
    },
  ],
})

async function renderDashboard(role, { financial = true, blocked = [] } = {}) {
  let result
  await withDraftDom(async ({ React, act, document, load, mount }) => {
    const { createMemoryRouter, RouterProvider } = await import('react-router-dom')
    const { default: Dashboard } = await load('/src/apps/pms/dashboard/pages/Dashboard.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const h = React.createElement
    const value = {
      role,
      settings: { timezone: 'Asia/Ho_Chi_Minh', checkInTime: '14:00', checkOutTime: '12:00' },
      workspaceRevision: 0,
      getDashboardReport: async () => report(financial),
      routeAccess: (path) =>
        blocked.includes(path) ? { allowed: false, reason: 'role' } : { allowed: true },
    }
    const router = createMemoryRouter(
      [{ path: '/id/dashboard', element: h(PmsContext.Provider, { value }, h(Dashboard)) }],
      { initialEntries: ['/id/dashboard'] },
    )
    await mount(h(RouterProvider, { router }))
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0))
    })
    const text = (selector) =>
      [...document.querySelectorAll(selector)].map((node) => node.textContent.trim())
    const sectionOrder = [
      ...document.querySelectorAll('.pms-dashboard > section, .pms-dashboard > div'),
    ]
      .map((node) => node.className)
      .filter((name) => /queues|overview/.test(name))
    result = {
      title: document.querySelector('h1').textContent,
      metrics: text('.pms-dashboard-metric-top span:first-child'),
      highlighted: text(
        '.pms-dashboard-metric-highlight .pms-dashboard-metric-top span:first-child',
      ),
      values: text('.pms-dashboard-metric-value strong'),
      units: text('.pms-dashboard-metric-value span'),
      details: text('.pms-dashboard-metric-detail'),
      queues: [...document.querySelectorAll('[data-queue]')].map((node) => node.dataset.queue),
      hasChart: Boolean(document.querySelector('#dashboard-chart-title')),
      hasTasks: Boolean(document.querySelector('#dashboard-tasks-title')),
      shortcuts: [...document.querySelectorAll('.pms-dashboard-task')].map((node) =>
        node.getAttribute('href'),
      ),
      sectionOrder,
    }
  })
  return result
}

test('owner dashboard keeps the original overview', async () => {
  const view = await renderDashboard('HOTEL_OWNER')
  assert.equal(view.title, 'Tổng quan hôm nay')
  assert.equal(view.metrics.length, 4)
  assert.deepEqual(view.queues, ['arrivals', 'departures'])
  assert.equal(view.hasChart, true)
  assert.equal(view.hasTasks, true)
  assert.match(view.sectionOrder[0], /queues/)
})

test('a context without role falls back to the owner layout', async () => {
  const view = await renderDashboard(undefined)
  assert.equal(view.title, 'Tổng quan hôm nay')
})

test('front desk dashboard shows the shift queues, overdue count and tasks without the chart', async () => {
  const view = await renderDashboard('FRONT_DESK', { financial: false })
  assert.equal(view.title, 'Ca lễ tân hôm nay')
  assert.ok(view.metrics.includes('Quá hạn trả phòng'))
  assert.ok(!view.metrics.includes('Công suất phòng'))
  assert.deepEqual(view.queues, ['arrivals', 'departures'])
  assert.equal(view.hasChart, false)
  assert.equal(view.hasTasks, true)
  assert.equal(view.values[3], '1')
  assert.equal(view.units[3], 'đặt phòng')
})

test('accountant dashboard leads with money, departures and accounting shortcuts', async () => {
  const view = await renderDashboard('ACCOUNTANT', { blocked: ['/id/commissions'] })
  assert.equal(view.title, 'Tài chính hôm nay')
  assert.deepEqual(view.metrics.slice(0, 2), ['Doanh thu hôm nay', 'Còn phải thu'])
  assert.equal(view.details[1], 'Khách đến và trả phòng hôm nay · VND')
  assert.deepEqual(view.highlighted, ['Doanh thu hôm nay'])
  assert.match(view.values[0], /1[.,]500[.,]000/)
  assert.match(view.values[1], /500[.,]000/)
  assert.deepEqual(view.queues, ['departures'])
  assert.equal(view.hasChart, true)
  assert.equal(view.hasTasks, false)
  assert.ok(view.shortcuts.includes('/id/cashflow'))
  assert.ok(!view.shortcuts.includes('/id/commissions'))
  assert.match(view.sectionOrder[0], /overview/)
})

test('accountant without finance reports sees an explanation instead of numbers', async () => {
  const view = await renderDashboard('ACCOUNTANT', { financial: false })
  assert.equal(view.values[0], '—')
  assert.equal(view.values[1], '—')
})
