import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

test('POS validates quantities and prices even when saving through buttons outside a form', async () => {
  await withDraftDom(async ({ React, load, mount, click, input }) => {
    const { default: Sales } = await load('/src/apps/pms/finance/pages/Sales.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const writes = [];
    const context = {
      tenantId: 'hotel-a', settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' }, workspaceRevision: 1,
      access: () => ({ allowed: true }), services: [{ id: 'service-a', name: 'Test service', price: '1' }],
      serviceCategories: [], bookings: [], funds: [], paymentMethods: [],
      getPosInvoices: async () => ({ posInvoices: [], pagination: { totalItems: 0 } }),
      savePosInvoice: async value => { writes.push(value); return { ...value, id: 'invoice-a', status: 'DRAFT', currency: 'VND', total: '1', paid: '0', balance: '1', payments: [] }; },
    };
    const { container } = await mount(React.createElement(PmsContext.Provider, { value: context }, React.createElement(Sales)));
    const button = name => [...container.querySelectorAll('button')].find(item => item.textContent === name);
    await click(button('+ Thêm mới'));
    await click([...container.querySelectorAll('button')].find(item => item.textContent.startsWith('Test service')));
    const quantity = container.querySelector('[aria-label="Số lượng Test service"]');
    const price = container.querySelector('[aria-label="Đơn giá Test service"]');
    for (const value of ['1e3', '', '0', '1.00001', '100000000']) {
      await input(quantity, value);
      await click(button('Lưu nháp'));
      assert.equal(writes.length, 0, value);
    }
    await input(quantity, '2.5000');
    for (const value of ['1e3', '-1', '1,5', '1.00001']) {
      await input(price, value);
      await click(button('Lưu nháp'));
      assert.equal(writes.length, 0, value);
    }
    await input(price, '99999999999999.9999');
    await click(button('Lưu nháp'));
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].items, [{ serviceId: 'service-a', quantity: '2.5000', unitPrice: '99999999999999.9999' }]);
  });
});
