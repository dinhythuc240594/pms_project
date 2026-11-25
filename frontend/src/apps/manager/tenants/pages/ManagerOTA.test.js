import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter } from 'react-router-dom'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

test('Manager OTA loads configuration for both system roles without hotel membership', async () => {
  await withDraftDom(async ({ React, load, mount, click }) => {
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { default: ManagerOTA } = await load('/src/apps/manager/tenants/pages/ManagerOTA.jsx')
    for (const globalRole of ['SUPER_ADMIN', 'SYSTEM_MANAGER', 'USER']) {
      const requests = []
      const context = {
        authGeneration: 1,
        user: { globalRole, memberships: [] },
        getChannexAccounts: async () => ({ accounts: [] }),
        requestManagedTenant: async (id, path) => {
          requests.push({ id, path })
          if (path === '/workspace')
            return {
              tenant: { id, name: 'Hotel Support', status: 'active' },
              settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
              features: { OTA_SYNC: true },
            }
          if (path === '/channels')
            return {
              connection: null,
              roomTypes: [],
              jobs: [],
              mappings: [],
              credentialStorageAvailable: true,
            }
          throw new Error('Unexpected request: ' + path)
        },
      }
      const view = await mount(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(
            PmsContext.Provider,
            { value: context },
            React.createElement(ManagerOTA, { tenantId: 'hotel-a', embedded: true }),
          ),
        ),
      )
      if (globalRole === 'USER') {
        assert.match(view.container.textContent, /403/)
        assert.deepEqual(requests, [])
      } else {
        assert.ok(requests.some(({ id, path }) => id === 'hotel-a' && path === '/workspace'))
        assert.ok(requests.some(({ id, path }) => id === 'hotel-a' && path === '/channels'))
        await click(
          [...view.container.querySelectorAll('button')].find((button) =>
            button.textContent.includes('Kết nối & ghép phòng'),
          ),
        )
        await click(
          [...view.container.querySelectorAll('button')].find((button) =>
            button.textContent.includes('Nhập mã & khóa API'),
          ),
        )
        assert.ok(view.container.querySelector('#ota-api-key'))
      }
      await view.unmount()
    }
  })
})
