import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

const HEADER = '/src/apps/pms/components/Header.jsx'
const SIDEBAR = '/src/apps/pms/components/Sidebar.jsx'
const USE_PMS = '/src/apps/pms/data/usePms.js'
const DRAFT = '/src/shared/drafts/DraftGuardProvider.jsx'

const HOTELS = [
  { id: 'h1', name: 'Hotel Alpha' },
  { id: 'h2', name: 'Hotel Beta' },
]

function makePms(overrides = {}) {
  return {
    user: { id: 'u1', name: 'Test User', email: 'test@example.com' },
    role: 'manager',
    tenant: overrides.tenant !== undefined ? overrides.tenant : HOTELS[0],
    tenantId: overrides.tenant !== undefined ? overrides.tenant?.id : HOTELS[0].id,
    hotels: overrides.hotels !== undefined ? overrides.hotels : HOTELS,
    selectTenant: overrides.selectTenant ?? (() => {}),
    isManager: false,
    subscription: { planName: 'Pro' },
    settingsPath: '/id/settings',
    logout: async () => {},
    requestTenant: async () => ({ items: [], unreadCount: 0, nextBefore: null }),
    routeAccess: () => ({ allowed: true }),
    access: () => ({ allowed: true }),
    showAccess: () => {},
    loading: false,
    workspaceLoading: false,
    loadError: null,
  }
}

test('hotel select is in .pms-topbar-context with label; none in sidebar; selector removed', async () => {
  await withDraftDom(async ({ React, mount, load }) => {
    const { default: Header } = await load(HEADER)
    const { default: Sidebar } = await load(SIDEBAR)
    const { PmsContext } = await load(USE_PMS)
    const { MemoryRouter } = await import('react-router-dom')
    const { DraftGuardProvider } = await load(DRAFT)

    const pms = makePms()
    const wrap = (el) =>
      React.createElement(
        PmsContext.Provider,
        { value: pms },
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/id/reservations'] },
          React.createElement(DraftGuardProvider, null, el),
        ),
      )

    const { container: hc } = await mount(
      wrap(React.createElement(Header, { onOpenNavigation: () => {} })),
    )
    const { container: sc } = await mount(
      wrap(React.createElement(Sidebar, { isCollapsed: false, setIsCollapsed: () => {} })),
    )

    const topbar = hc.querySelector('.pms-topbar-context')
    assert.ok(topbar, '.pms-topbar-context must exist in Header')

    const selects = topbar.querySelectorAll('select')
    assert.equal(selects.length, 1, 'exactly one <select> must be in .pms-topbar-context')

    const sel = selects[0]
    const lbl = hc.querySelector(`label[for="${sel.id}"]`)
    assert.ok(lbl, '<select> in topbar must have an associated <label>')

    assert.equal(sel.value, 'h1', 'current tenant must be pre-selected')

    assert.equal(
      sc.querySelectorAll('select').length,
      0,
      'Sidebar must contain no <select> after move',
    )
    assert.ok(
      !sc.querySelector('.pms-hotel-selector'),
      '.pms-hotel-selector block must be absent from Sidebar',
    )

    const brand = sc.querySelector('.pms-sidebar-brand')
    const nav = sc.querySelector('.pms-sidebar-nav')
    assert.ok(brand && nav, 'brand and nav must both be present in Sidebar')
    assert.strictEqual(
      brand.nextElementSibling,
      nav,
      'brand.nextElementSibling must be nav (no element between them)',
    )
  })
})

test('selectTenant is called with correct id when option changes in topbar', async () => {
  await withDraftDom(async ({ React, mount, load, input }) => {
    const { default: Header } = await load(HEADER)
    const { PmsContext } = await load(USE_PMS)
    const { MemoryRouter } = await import('react-router-dom')
    const { DraftGuardProvider } = await load(DRAFT)
    const { useState } = React

    // selectTenantSpy is a pure observer (mock.fn with no callback).
    // Fixture wires its own local selectTenant that calls the spy then updates
    // local state — no outer variable or object is mutated during render.
    const selectTenantSpy = mock.fn()

    function Fixture() {
      const [tenant, setTenant] = useState(HOTELS[0])

      function selectTenant(id) {
        selectTenantSpy(id)
        setTenant(HOTELS.find((h) => h.id === id) ?? tenant)
      }

      const pms = makePms({ tenant, selectTenant })
      return React.createElement(
        PmsContext.Provider,
        { value: pms },
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/id/dashboard'] },
          React.createElement(
            DraftGuardProvider,
            null,
            React.createElement(Header, { onOpenNavigation: () => {} }),
          ),
        ),
      )
    }

    const { container } = await mount(React.createElement(Fixture))

    const sel = container.querySelector('.pms-topbar-context select')
    assert.ok(sel, '<select> must exist in .pms-topbar-context')
    await input(sel, 'h2')
    assert.equal(
      selectTenantSpy.mock.calls[0]?.arguments[0],
      'h2',
      'selectTenant must be invoked with the chosen hotel id',
    )
    assert.equal(
      container.querySelector('.pms-topbar-context select').value,
      'h2',
      'select.value must update to h2 after selectTenant updates tenant state',
    )
  })
})

test('accountant sidebar pins cashflow and shows reconciliation once as the active item', async () => {
  await withDraftDom(async ({ React, mount, load }) => {
    const { default: Sidebar } = await load(SIDEBAR)
    const { PmsContext } = await load(USE_PMS)
    const { MemoryRouter } = await import('react-router-dom')
    const h = React.createElement
    const reconciliation = '/id/reports/reconciliation'
    for (const role of ['ACCOUNTANT', 'HOTEL_OWNER']) {
      const view = await mount(
        h(
          PmsContext.Provider,
          { value: { ...makePms(), role } },
          h(MemoryRouter, { initialEntries: [reconciliation] }, h(Sidebar)),
        ),
      )
      const { container } = view
      const groups = [...container.querySelectorAll('.pms-nav-group')]
      assert.equal(container.querySelectorAll(`a[href="${reconciliation}"]`).length, 1)
      const active = [
        ...container.querySelectorAll('.pms-nav-link.is-active, a[aria-current="page"]'),
      ]
      if (role === 'ACCOUNTANT') {
        assert.deepEqual(
          groups.slice(0, 2).map((group) => group.querySelector('a')?.getAttribute('href')),
          ['/id/cashflow', reconciliation],
        )
        assert.deepEqual(
          active.map((item) => item.getAttribute('href')),
          [reconciliation],
        )
      } else {
        assert.equal(container.querySelector('a[href="/id/cashflow"]'), null)
        assert.ok(
          groups.some((group) => group.querySelector(`.pms-submenu a[href="${reconciliation}"]`)),
        )
      }
      await view.unmount()
    }
  })
})

test('the bell shows unread counts on login and hotel changes before the inbox opens', async () => {
  await withDraftDom(async ({ React, mount, load, input }) => {
    const { default: Header } = await load(HEADER)
    const { PmsProvider } = await load('/src/apps/pms/data/PmsProvider.jsx')
    const { MemoryRouter } = await import('react-router-dom')
    const { DraftGuardProvider } = await load(DRAFT)
    const hotels = HOTELS.map((hotel) => ({ ...hotel, status: 'ACTIVE' }))
    const counts = { h1: 2, h2: 7 }
    const requests = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (path) => {
      if (path === '/api/auth/session') {
        return Response.json({
          user: {
            id: 'u1',
            name: 'Owner',
            globalRole: 'USER',
            memberships: hotels.map(({ id }) => ({ tenantId: id, role: 'HOTEL_OWNER' })),
          },
          tenants: hotels,
        })
      }
      const [, , , id, resource] = path.split('?')[0].split('/')
      if (resource === 'workspace') {
        return Response.json({ tenant: hotels.find((hotel) => hotel.id === id) })
      }
      assert.equal(resource, 'notifications')
      requests.push(path)
      return Response.json({ items: [], unreadCount: counts[id], nextBefore: null })
    }

    let view
    try {
      const h = React.createElement
      view = await mount(
        h(DraftGuardProvider, null, h(PmsProvider, null, h(MemoryRouter, null, h(Header)))),
      )
      const selector = view.container.querySelector('.pms-topbar-context select')
      const bell = () => view.container.querySelector('.pms-notification-trigger')
      const badge = () => bell().querySelector('span')?.textContent

      assert.equal(badge(), '2')
      await input(selector, 'h2')
      assert.equal(badge(), '7')
      counts.h1 = 0
      await input(selector, 'h1')
      assert.equal(badge(), undefined)
      assert.equal(bell().getAttribute('aria-expanded'), 'false')
      assert.deepEqual(
        requests,
        ['h1', 'h2', 'h1'].map((id) => '/api/tenants/' + id + '/notifications?limit=1&unread=true'),
      )
    } finally {
      await view?.unmount()
      globalThis.fetch = originalFetch
    }
  })
})

test('zero hotels: select in topbar is disabled and shows no-hotel placeholder', async () => {
  await withDraftDom(async ({ React, mount, load }) => {
    const { default: Header } = await load(HEADER)
    const { PmsContext } = await load(USE_PMS)
    const { MemoryRouter } = await import('react-router-dom')
    const { DraftGuardProvider } = await load(DRAFT)

    const pms = makePms({ hotels: [], tenant: null })
    const { container } = await mount(
      React.createElement(
        PmsContext.Provider,
        { value: pms },
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/id/dashboard'] },
          React.createElement(
            DraftGuardProvider,
            null,
            React.createElement(Header, { onOpenNavigation: () => {} }),
          ),
        ),
      ),
    )

    const topbar = container.querySelector('.pms-topbar-context')
    const sel = topbar?.querySelector('select')
    assert.ok(sel, 'select must exist in .pms-topbar-context even with zero hotels')
    assert.ok(sel.disabled, 'select must be disabled when no hotels are available')
    assert.ok(sel.textContent.trim().length > 0, 'no-hotel placeholder text must be present')
  })
})

test('collapsed and mobile sidebars have no hotel select', async () => {
  await withDraftDom(async ({ React, mount, load }) => {
    const { default: Header } = await load(HEADER)
    const { default: Sidebar } = await load(SIDEBAR)
    const { PmsContext } = await load(USE_PMS)
    const { MemoryRouter } = await import('react-router-dom')
    const { DraftGuardProvider } = await load(DRAFT)

    const pms = makePms()
    const wrap = (el) =>
      React.createElement(
        PmsContext.Provider,
        { value: pms },
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/id/reservations'] },
          React.createElement(DraftGuardProvider, null, el),
        ),
      )

    const { container: collapsedCt } = await mount(
      wrap(React.createElement(Sidebar, { isCollapsed: true, setIsCollapsed: () => {} })),
    )
    assert.equal(
      collapsedCt.querySelectorAll('select').length,
      0,
      'collapsed sidebar must not contain a <select>',
    )

    const { container: mobileCt } = await mount(
      wrap(
        React.createElement(Sidebar, {
          isCollapsed: false,
          setIsCollapsed: () => {},
          onClose: () => {},
        }),
      ),
    )
    assert.equal(
      mobileCt.querySelectorAll('select').length,
      0,
      'mobile (onClose) sidebar must not contain a <select>',
    )

    const { container: hc } = await mount(
      wrap(React.createElement(Header, { onOpenNavigation: () => {} })),
    )
    assert.equal(
      hc.querySelector('.pms-topbar-context')?.querySelectorAll('select').length,
      1,
      'Header .pms-topbar-context must still hold exactly one <select>',
    )
  })
})
