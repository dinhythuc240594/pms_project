import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../shared/drafts/testDom.js';

test('inventory decimal controls reject exponent, comma and excess precision while preserving exact strings', async () => {
  await withDraftDom(async ({ React, load, mount, input }) => {
    const { InventoryLines } = await load('/src/apps/pms/inventory/InventoryDocuments.jsx');
    function Form() {
      const [lines, setLines] = React.useState([{ key: 'line-a', itemId: 'item-a', quantity: '1', unitCost: '0' }]);
      return React.createElement(InventoryLines, { kind: 'receipt', lines, onChange: setLines, items: [{ id: 'item-a', name: 'Item A' }], warehouses: [] });
    }
    const { container } = await mount(React.createElement(Form));
    const [quantity, cost] = container.querySelectorAll('input');
    for (const field of [quantity, cost]) {
      for (const value of ['1e3', '1,5', '1.00001', '1000000000000000']) {
        await input(field, value);
        assert.equal(field.checkValidity(), false, value);
      }
      await input(field, '999999999999999.9999');
      assert.equal(field.checkValidity(), true);
      assert.equal(field.value, '999999999999999.9999');
    }
  });
});

test('inventory suppliers validate contact fields and category order remains an integer', async () => {
  await withDraftDom(async ({ React, load, mount, input, click, act, window }) => {
    const { default: Settings } = await load('/src/apps/pms/inventory/pages/InventorySettings.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    for (const catalog of ['suppliers', 'itemCategories']) {
      const writes = [];
      const value = { tenantId: 'hotel-a', user: { id: 'owner-a' }, workspaceRevision: 1, access: () => ({ allowed: true }), requestTenant: async () => ({ suppliers: [], itemCategories: [] }), saveInventoryMaster: async (...args) => { writes.push(args); } };
      const view = await mount(React.createElement(PmsContext.Provider, { value }, React.createElement(Settings, { catalog })));
      await click(view.container.querySelector('.inventory-settings-panel-header button'));
      const form = view.container.querySelector('form');
      const field = text => [...form.querySelectorAll('label')].find(label => label.textContent.startsWith(text))?.querySelector('input');
      await input(field(catalog === 'suppliers' ? 'Tên nhà cung cấp' : 'Tên danh mục'), ' Test ');
      if (catalog === 'suppliers') {
        const phone = field('Điện thoại'), email = field('Email'), tax = field('Mã số thuế');
        await input(phone, '0901234567');
        await input(phone, '0901234567A');
        assert.equal(phone.value, '0901234567');
        await input(email, 'bad@');
        await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(writes.length, 0);
        await input(email, ' OWNER@Example.Test ');
        await input(tax, 'ABC123');
        await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(writes.length, 0);
        await input(tax, '0101234567-001');
      } else {
        for (const value of ['1e3', '1.5', '-1', '100001']) {
          await input(field('Thứ tự'), value);
          await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
          assert.equal(writes.length, 0);
        }
        await input(field('Thứ tự'), '10');
      }
      await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(writes.length, 1);
      assert.equal(writes[0][1].name, 'Test');
      if (catalog === 'suppliers') assert.equal(writes[0][1].email, 'owner@example.test');
      else assert.equal(writes[0][1].sortOrder, 10);
      await view.unmount();
    }
  });
});
