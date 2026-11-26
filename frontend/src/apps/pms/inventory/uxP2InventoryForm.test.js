import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../shared/drafts/testDom.js'

test('ten inventory lines use whole-catalog search, retain exact data when collapsed and focus validation before posting', async () => {
  await withDraftDom(async ({ React, load, mount, input, click, act, window, document }) => {
    const { MemoryRouter } = await import('react-router-dom')
    const { default: InventoryDocuments } = await load(
      '/src/apps/pms/inventory/InventoryDocuments.jsx',
    )
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { DraftGuardProvider } = await load('/src/shared/drafts/DraftGuardProvider.jsx')
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: 'item-' + i,
      name: 'Mặt hàng ' + i,
      sku: 'SKU-' + String(i).padStart(4, '0'),
      unit: 'chai',
      costPrice: '1.2500',
    }))
    const writes = []
    const pms = {
      tenantId: 'qa',
      user: { id: 'owner' },
      settings: { timezone: 'UTC', currency: 'VND' },
      access: () => ({ allowed: true }),
      requestTenant: async (path) =>
        path.startsWith('/inventory/masters')
          ? {
              items,
              warehouses: [{ id: 'warehouse', name: 'Kho QA', active: true, isDefault: true }],
              suppliers: [],
            }
          : { documents: [], pagination: { totalItems: 0 } },
      createInventoryDocument: async (body, intent) => {
        writes.push({ body, intent })
        throw Error('Synthetic save failure')
      },
    }
    const h = React.createElement
    const view = await mount(
      h(
        MemoryRouter,
        null,
        h(PmsContext.Provider, { value: pms }, h(DraftGuardProvider, null, h(InventoryDocuments))),
      ),
    )
    const button = (label) =>
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
    const field = (prefix) =>
      [...document.querySelectorAll('.inventory-dialog label')]
        .find((l) => l.textContent.startsWith(prefix))
        ?.querySelector('input,select')
    try {
      await click(button('Tạo phiếu'))
      const choose = async (line, index) => {
        const search = field('Tìm mặt hàng dòng ' + line)
        await input(search, 'SKU-' + String(index).padStart(4, '0'))
        await act(async () =>
          search.dispatchEvent(
            new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
          ),
        )
        assert.equal(field('Mặt hàng dòng ' + line).value, 'item-' + index)
        assert.equal(document.activeElement, field('Số lượng dòng ' + line))
        await input(field('Số lượng dòng ' + line), '2.0001')
      }
      assert.ok(field('Mặt hàng dòng 1').options.length <= 52, 'large catalog is bounded')
      await choose(1, 999)
      for (let line = 2; line <= 10; line++) {
        await click(button('Thêm mặt hàng'))
        assert.equal(document.activeElement, field('Tìm mặt hàng dòng ' + line))
        await choose(line, line)
      }
      assert.equal(document.querySelectorAll('.inventory-line-summary').length, 9)
      assert.match(document.querySelector('.inventory-form-footer').textContent, /10 dòng/)
      await click(button('Sửa dòng 1'))
      assert.equal(field('Số lượng dòng 1').value, '2.0001')
      await input(field('Đơn giá vốn dòng 1'), '7.1234')
      const repeatedSearch = field('Tìm mặt hàng dòng 1')
      await act(async () =>
        repeatedSearch.dispatchEvent(
          new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        ),
      )
      assert.equal(
        field('Số lượng dòng 1').value,
        '2.0001',
        'selecting the same item keeps quantity',
      )
      assert.equal(
        field('Đơn giá vốn dòng 1').value,
        '7.1234',
        'selecting the same item keeps custom cost',
      )
      await input(field('Số lượng dòng 1'), '0')
      await click(button('Ghi sổ phiếu kho'))
      assert.equal(writes.length, 0, 'receipt zero is rejected before any write')
      assert.equal(document.activeElement, field('Số lượng dòng 1'))
      assert.match(document.querySelector('.inventory-dialog [role="alert"]').textContent, /Dòng 1/)
      await input(field('Số lượng dòng 1'), '2.0001')
      await click(button('Ghi sổ phiếu kho'))
      assert.equal(writes.length, 1)
      assert.equal(writes[0].body.lines.length, 10)
      assert.equal(writes[0].body.lines[0].itemId, 'item-999')
      assert.equal(writes[0].body.lines[0].quantity, '2.0001')
      assert.equal(writes[0].body.lines[0].unitCost, '7.1234')
      assert.match(
        document.querySelector('.inventory-dialog [role="alert"]').textContent,
        /Synthetic save failure/,
      )
      await click(button('Ghi sổ phiếu kho'))
      assert.equal(
        writes[1].intent,
        writes[0].intent,
        'retry preserves idempotency and collapsed data',
      )
    } finally {
      await view.unmount()
    }
  })
})
