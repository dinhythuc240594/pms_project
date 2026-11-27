import { test } from 'node:test'
import assert from 'node:assert/strict'
import { permitted, subscriptionDecision } from './api.js'
import { routePolicy } from './access.js'
import { hiddenByRole, homePath, navForRole } from './roleProfiles.js'

const NAV = [
  { path: '/id/dashboard' },
  { path: '/id/ari' },
  { path: '/id/room-diagram' },
  { path: '/id/reservations' },
  { path: '/id/sales' },
  { path: '/id/gia', subItems: [{ path: '/id/gia/basic' }, { path: '/id/matrix-rate' }] },
  {
    path: '/id/housekeeping',
    subItems: [
      { path: '/id/housekeeping/status' },
      { path: '/id/housekeeping/staff' },
      { path: '/id/housekeeping/plan' },
    ],
  },
  { path: '/id/inventory', subItems: [{ path: '/id/inventory/in' }] },
  {
    path: '/id/reports',
    subItems: [{ path: '/id/reports/revenue' }, { path: '/id/reports/reconciliation' }],
  },
]
const tenant = { id: 't1', status: 'ACTIVE' }

function accessFor(role, lockedFeatures = []) {
  const user = { id: 'u1', memberships: [{ tenantId: 't1', role }] }
  return (path) => {
    const policy = routePolicy(path)
    const result = permitted(user, tenant, policy.action, false)
    if (result.allowed && lockedFeatures.includes(policy.feature))
      return { allowed: false, reason: 'feature' }
    return result
  }
}
const paths = (items) => items.map((item) => item.path)

test('homePath sends each hotel role to its working screen', () => {
  assert.equal(homePath('HOTEL_OWNER'), '/id/dashboard')
  assert.equal(homePath('FRONT_DESK'), '/id/room-diagram')
  assert.equal(homePath('HOUSEKEEPING'), '/id/housekeeping/status')
  assert.equal(homePath('ACCOUNTANT'), '/id/cashflow')
  assert.equal(homePath(undefined), '/id/dashboard')
})

test('every role home is reachable by that role', () => {
  for (const role of ['HOTEL_OWNER', 'FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTANT'])
    assert.equal(accessFor(role)(homePath(role)).allowed, true, role)
})

test('owner keeps the full menu in its original order', () => {
  assert.deepEqual(paths(navForRole(NAV, 'HOTEL_OWNER', accessFor('HOTEL_OWNER'))), paths(NAV))
})

test('housekeeping only sees housekeeping work', () => {
  const items = navForRole(NAV, 'HOUSEKEEPING', accessFor('HOUSEKEEPING'))
  assert.deepEqual(paths(items), ['/id/housekeeping', '/id/room-diagram'])
  assert.deepEqual(paths(items[0].subItems), ['/id/housekeeping/status', '/id/housekeeping/plan'])
})

test('front desk gets operational screens pinned first and no reports or inventory', () => {
  const items = paths(navForRole(NAV, 'FRONT_DESK', accessFor('FRONT_DESK')))
  assert.deepEqual(items.slice(0, 3), ['/id/room-diagram', '/id/ari', '/id/reservations'])
  assert.ok(!items.includes('/id/reports'))
  assert.ok(!items.includes('/id/inventory'))
})

test('accountant sees reports and inventory but no housekeeping', () => {
  const items = paths(navForRole(NAV, 'ACCOUNTANT', accessFor('ACCOUNTANT')))
  assert.ok(items.includes('/id/reports'))
  assert.ok(items.includes('/id/inventory'))
  assert.ok(!items.includes('/id/housekeeping'))
})

test('accountants can review and confirm reconciliation with the same role and plan gates as the API', () => {
  const path = '/id/reports/reconciliation'
  assert.equal(accessFor('ACCOUNTANT')(path).allowed, true)
  assert.equal(accessFor('FRONT_DESK')(path).reason, 'role')
  assert.equal(accessFor('HOUSEKEEPING')(path).reason, 'role')

  const accountant = { id: 'u1', memberships: [{ tenantId: tenant.id, role: 'ACCOUNTANT' }] }
  assert.equal(permitted(accountant, tenant, 'reconciliation.confirm', true).allowed, true)
  assert.equal(
    permitted(accountant, { ...tenant, status: 'SUSPENDED' }, 'reconciliation.confirm', true)
      .reason,
    'suspended',
  )
  for (const action of ['reconciliation.view', 'reconciliation.confirm'])
    assert.equal(subscriptionDecision(null, { REPORTS_BASIC: false }, action).reason, 'feature')
  assert.equal(
    subscriptionDecision({ status: 'expired' }, {}, 'reconciliation.confirm').reason,
    'expired',
  )
})

test('plan-locked items stay visible so owners can upgrade', () => {
  const items = paths(navForRole(NAV, 'HOTEL_OWNER', accessFor('HOTEL_OWNER', ['HOUSEKEEPING'])))
  assert.ok(items.includes('/id/housekeeping'))
  assert.equal(hiddenByRole({ allowed: false, reason: 'feature' }), false)
  assert.equal(hiddenByRole({ allowed: false, reason: 'role' }), true)
})

test('settings is hidden for roles without settings or channel access', () => {
  assert.equal(hiddenByRole(accessFor('HOUSEKEEPING')('/id/settings?section=channels')), true)
  assert.equal(hiddenByRole(accessFor('FRONT_DESK')('/id/settings?section=channels')), false)
  assert.equal(hiddenByRole(accessFor('HOTEL_OWNER')('/id/settings')), false)
})

test('dashboard layouts only reference known widgets', async () => {
  const { DASHBOARD_LAYOUTS, dashboardLayout } = await import('./roleProfiles.js')
  const metrics = [
    'arrivals',
    'departures',
    'occupied',
    'occupancy',
    'overdue',
    'revenue',
    'balanceDue',
  ]
  for (const [role, layout] of Object.entries(DASHBOARD_LAYOUTS)) {
    assert.ok(
      layout.metrics.every((key) => metrics.includes(key)),
      role,
    )
    assert.ok(layout.metrics.includes(layout.highlight), role)
    assert.deepEqual([...layout.order].sort(), ['overview', 'queues'], role)
  }
  assert.equal(dashboardLayout('HOUSEKEEPING'), DASHBOARD_LAYOUTS.HOTEL_OWNER)
})

test('financeSummary sums positive balances in the report currency only', async () => {
  const { financeSummary } = await import('./roleProfiles.js')
  assert.equal(financeSummary({ financial: null }), null)
  const summary = financeSummary({
    date: '2026-03-10',
    currency: 'VND',
    financial: {},
    chart: [
      { date: '2026-03-09', realizedRevenue: '10' },
      { date: '2026-03-10', realizedRevenue: '25' },
    ],
    arrivalBookings: [
      { balance: '100', currency: 'VND' },
      { balance: '-40', currency: 'VND' },
    ],
    departureBookings: [
      { balance: '7', currency: 'USD' },
      { balance: '50', currency: 'VND' },
    ],
  })
  assert.deepEqual(summary, { revenue: 25, balanceDue: 150 })
})

test('visibleShortcuts drops role-blocked screens but keeps plan-locked ones', async () => {
  const { visibleShortcuts } = await import('./roleProfiles.js')
  const items = visibleShortcuts((path) =>
    path === '/id/sales'
      ? { allowed: false, reason: 'role' }
      : path === '/id/reports/revenue'
        ? { allowed: false, reason: 'feature' }
        : { allowed: true },
  )
  const paths = items.map((item) => item.path)
  assert.ok(!paths.includes('/id/sales'))
  assert.ok(paths.includes('/id/reports/revenue'))
})
