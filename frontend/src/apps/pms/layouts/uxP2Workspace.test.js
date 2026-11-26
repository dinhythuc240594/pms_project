import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

async function withWorkspace(initialSync, callback) {
  await withDraftDom(async ({ React, load, mount, click, act }) => {
    const { default: PmsLayout } = await load('/src/apps/pms/layouts/PmsLayout.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { setLocale } = await load('/src/shared/i18n/store.js')
    setLocale('vi')
    const tenant = { id: 'hotel', name: 'Example hotel', status: 'ACTIVE' }
    const requests = []
    const response = Promise.withResolvers()
    const layoutContext = {
      tenant,
      tenantId: tenant.id,
      hotels: [tenant],
      user: { name: 'Owner' },
      role: 'HOTEL_OWNER',
      settings: { timezone: 'Asia/Ho_Chi_Minh' },
      settingsPath: '/id/settings',
      pendingRequests: { reads: 0, writes: 0 },
      authGeneration: 1,
      workspaceRevision: 0,
      routeAccess: () => ({ allowed: true }),
      access: () => ({ allowed: true }),
      requestTenant: async () => ({ items: [], unreadCount: 0 }),
    }
    function Layout() {
      const [sync, setSync] = React.useState(initialSync)
      const refreshWorkspace = React.useCallback(async ({ quiet, canApply }) => {
        requests.push({ quiet })
        await response.promise
        if (canApply()) setSync({})
      }, [])
      return React.createElement(
        PmsContext.Provider,
        { value: { ...layoutContext, ...sync, refreshWorkspace } },
        React.createElement(PmsLayout),
      )
    }
    const router = createMemoryRouter(
      [
        {
          element: React.createElement(Layout),
          children: [
            {
              path: '/id/*',
              element: React.createElement('input', { 'aria-label': 'Room search' }),
            },
          ],
        },
      ],
      { initialEntries: ['/id/ari'] },
    )
    const view = await mount(React.createElement(RouterProvider, { router }))
    try {
      await callback({
        view,
        click,
        act,
        navigate: (path) => router.navigate(path),
        requests,
        finish: response.resolve,
      })
    } finally {
      await view.unmount()
      router.dispose()
    }
  })
}

test('switching PMS menus does not show a reload row or issue a workspace refresh', async () => {
  await withWorkspace({}, async ({ view, act, navigate, requests }) => {
    for (const path of ['/id/ari', '/id/dashboard', '/id/reservations', '/id/gia/ari']) {
      await act(async () => navigate(path))
      assert.equal(
        view.container.querySelector('.pms-content').firstElementChild?.tagName,
        'INPUT',
        path,
      )
    }
    assert.deepEqual(requests, [])
  })
})

test('a workspace sync error offers a guarded retry and sends one request while it is pending', async () => {
  await withWorkspace(
    {
      workspaceSyncError: 'Offline',
      writeReceipt: { id: 'booking-42', tenantId: 'hotel', synchronized: false },
    },
    async ({ view, click, act, requests, finish }) => {
      const notice = view.container.querySelector('.pms-sync-notice')
      const button = notice.querySelector('button')
      const search = view.container.querySelector('[aria-label="Room search"]')
      assert.match(notice.textContent, /Đã ghi dữ liệu \(mã: booking-42\)/)
      assert.equal(button.textContent, 'Thử lại')
      assert.deepEqual(requests, [])
      await act(async () => search.focus())
      await click(button)
      assert.deepEqual(requests, [])
      assert.ok(notice.querySelector('.pms-sync-blocked'))
      await act(async () => {
        search.blur()
        button.click()
        button.click()
      })
      assert.deepEqual(requests, [{ quiet: true }])
      assert.equal(button.disabled, true)
      assert.equal(notice.querySelector('.pms-sync-blocked'), null)
      await act(async () => finish())
      assert.equal(view.container.querySelector('.pms-sync-notice'), null)
    },
  )
})
