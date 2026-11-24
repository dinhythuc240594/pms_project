import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter } from 'react-router-dom'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

test('an unused mapping can promote an inbound plan to primary without retaining a hidden duplicate', async () => {
  await withDraftDom(async ({ React, load, mount, click, input }) => {
    const { ChannelWorkspace } = await load('/src/apps/pms/channel-manager/pages/OTA.jsx')
    const writes = []
    const saved = {
      id: 'mapping',
      roomTypeId: 'local',
      channexRoomTypeId: 'remote',
      channexRatePlanId: 'primary',
      inboundRatePlanIds: ['alternate'],
      active: true,
      targetLocked: false,
    }
    const catalog = {
      roomTypes: [{ id: 'remote', name: 'Deluxe' }],
      ratePlans: ['primary', 'alternate'].map((id) => ({
        id,
        name: id,
        roomTypeId: 'remote',
        currency: 'USD',
        supported: true,
      })),
    }
    const query = {
      loading: false,
      refresh() {},
      data: {
        connection: {
          active: true,
          credentialsConfigured: true,
          environment: 'staging',
          propertyId: 'property',
          inventoryReconciledAt: '2030-01-01T00:00:00Z',
        },
        roomTypes: [{ id: 'local', name: 'Deluxe' }],
        mappings: [saved],
        jobs: [],
      },
    }
    const pms = {
      tenantId: 'hotel',
      tenant: { name: 'Hotel' },
      user: { id: 'owner' },
      settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'USD' },
      access: () => ({ allowed: true }),
      requestTenant: async (path, options) => {
        if (path === '/channels/catalog') return catalog
        assert.equal(path, '/channels/mappings')
        writes.push(options)
        return options.body
      },
    }
    const view = await mount(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(ChannelWorkspace, { pms, query }),
      ),
    )
    await click(view.container.querySelector('[aria-label="Sửa ghép nối Deluxe"]'))
    const primary = view.container.querySelector(
      'select[aria-describedby="ota-rate-catalog-hint ota-mapping-hint"]',
    )
    await input(primary, 'alternate')
    assert.equal(primary.value, 'alternate')
    assert.equal(view.container.querySelectorAll('.ota-inbound-plans input:checked').length, 0)
    const save = [...view.container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Lưu ghép nối'),
    )
    assert.equal(save.disabled, false)
    await click(save)
    assert.equal(writes.length, 1)
    assert.equal(writes[0].body.channexRatePlanId, 'alternate')
    assert.deepEqual(writes[0].body.inboundRatePlanIds, [])
  })
})
