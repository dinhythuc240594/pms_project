import test from 'node:test'
import assert from 'node:assert/strict'
import { permitted } from '../../../pms/data/api.js'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

test('advanced Channex catalog writes require the hotel role for both system roles', async () => {
  await withDraftDom(async ({ React, load, mount, click }) => {
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { default: LinkedChannexTools } = await load(
      '/src/apps/manager/channex/components/LinkedChannexTools.jsx',
    )
    const tenant = { id: 'hotel-a', name: 'Hotel A', status: 'active' }
    const catalog = {
      roomTypes: [{ id: 'room', name: 'Deluxe', countOfRooms: 2 }],
      ratePlans: [
        { id: 'rate', name: 'Standard', roomTypeId: 'room', editable: true, supported: true },
      ],
    }
    for (const globalRole of ['SUPER_ADMIN', 'SYSTEM_MANAGER']) {
      for (const role of ['FRONT_DESK', 'HOTEL_OWNER']) {
        const user = { globalRole, memberships: [{ tenantId: tenant.id, role, active: true }] }
        const pms = {
          tenantId: tenant.id,
          tenant,
          settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' },
          access: (action) => permitted(user, tenant, action, true),
        }
        const operations = { getChannexCatalog: async () => catalog }
        const view = await mount(
          React.createElement(
            PmsContext.Provider,
            { value: operations },
            React.createElement(LinkedChannexTools, {
              pms,
              connection: { propertyId: 'property', environment: 'staging' },
            }),
          ),
        )
        assert.match(view.container.textContent, /Deluxe/)
        const editRoom = view.container.querySelector('[aria-label="Sửa loại phòng Deluxe"]')
        const addRoom = [...view.container.querySelectorAll('button')].find((button) =>
          button.textContent.includes('Thêm loại phòng'),
        )
        if (role === 'HOTEL_OWNER') {
          assert.ok(editRoom)
          assert.ok(addRoom)
          await click(editRoom)
          assert.ok(view.container.querySelector('[role="dialog"], dialog'))
        } else {
          assert.equal(editRoom, null)
          assert.equal(addRoom, undefined)
          assert.equal(view.container.querySelector('[aria-label="Sửa gói giá Standard"]'), null)
        }
        await view.unmount()
      }
    }
  })
})
