import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

test('preview loads two nightly prices with a read request and shows the pricing scope', async () => {
  await withDraftDom(async ({ React, load, mount, click }) => {
    const { default: AriPreview } = await load('/src/apps/pms/channel-manager/pages/AriPreview.jsx');
    const calls = [];
    const pms = { tenantId: 'hotel', requestTenant: async (...args) => {
      calls.push(args);
      return { warning: 'Giá OTA dùng giá cơ bản hoặc giá theo ngày.', rows: [
        { date: '2030-01-01', roomTypeName: 'Deluxe', priceSource: 'base', rate: '100.0000', currency: 'USD', availability: 2, stopSell: false, channexRoomTypeId: 'remote-room', channexRatePlanId: 'outbound-plan' },
        { date: '2030-01-02', roomTypeName: 'Deluxe', priceSource: 'daily', rate: '175.5000', currency: 'USD', availability: 2, stopSell: false, channexRoomTypeId: 'remote-room', channexRatePlanId: 'outbound-plan' },
      ] };
    } };
    const view = await mount(React.createElement(AriPreview, { pms, range: { start: '2030-01-01', end: '2030-01-03' }, connection: { active: true, credentialsConfigured: true, inventoryReconciledAt: 'now' }, mappings: [{ active: true }] }));
    assert.equal(calls.length, 0);
    await click(view.container.querySelector('button'));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['/channels/ari-preview?start_date=2030-01-01&end_date=2030-01-03']);
    assert.equal(view.container.querySelectorAll('tbody tr').length, 2);
    assert.match(view.container.textContent, /100,00 USD/);
    assert.match(view.container.textContent, /175,50 USD/);
    assert.match(view.container.textContent, /Giá theo ngày/);
    assert.match(view.container.textContent, /outbound-plan/);
    assert.match(view.container.textContent, /không gửi giá lên Channex/);
  });
});

test('held inventory explains unresolved OTA updates and previews zero availability without writing', async () => {
  await withDraftDom(async ({ React, load, mount, click }) => {
    const { default: AriPreview } = await load('/src/apps/pms/channel-manager/pages/AriPreview.jsx');
    const calls = [];
    const pms = { tenantId: 'hotel', requestTenant: async (...args) => {
      calls.push(args);
      return { inventoryHeld: true, warning: 'Giá OTA dùng giá cơ bản hoặc giá theo ngày.', rows: [
        { date: '2030-01-01', roomTypeName: 'Deluxe', priceSource: 'base', rate: '100.0000', currency: 'USD', availability: 0, stopSell: true, channexRoomTypeId: 'remote-room', channexRatePlanId: 'outbound-plan' },
      ] };
    } };
    const view = await mount(React.createElement(AriPreview, { pms, range: { start: '2030-01-01', end: '2030-01-02' }, connection: { active: true, credentialsConfigured: true, inventoryReconciledAt: 'now' }, mappings: [{ active: true }] }));
    await click(view.container.querySelector('button'));
    assert.match(view.container.textContent, /Còn cập nhật đặt phòng OTA chưa xử lý hoặc cần đối soát/);
    const cells = [...view.container.querySelectorAll('tbody td')].map(cell => cell.textContent);
    assert.equal(cells[4], '0');
    assert.equal(cells[5], 'Đóng bán');
    assert.deepEqual(calls, [['/channels/ari-preview?start_date=2030-01-01&end_date=2030-01-02']]);
  });
});
