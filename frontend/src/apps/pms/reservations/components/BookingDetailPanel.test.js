import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

test('booking detail protects in-memory drafts and pending writes', async t => {
  await withDraftDom(async ({ React, act, window, document, load, mount, click, input }) => {
    const { default: BookingDetailPanel } = await load('/src/apps/pms/reservations/components/BookingDetailPanel.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { DraftGuardProvider, useDraftNavigation } = await load('/src/shared/drafts/DraftGuardProvider.jsx');
    const h = React.createElement;
    const booking = { id: 'BK-1', guest: 'Original guest', phone: '0901234567', status: 'CONFIRMED', checkIn: '2026-10-21', checkOut: '2026-10-23', source: 'Direct', version: 1, rooms: ['101'], room: '101', currency: 'VND', balance: 100000, paid: 50000, nightlyRates: [{ room: '101', date: '2026-10-21', price: 75000 }], guests: [{ id: 'guest-1', name: 'Original guest', phone: '0901234567', email: '', version: 1 }] };
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text);
    const field = label => document.querySelector(`input[aria-label="${label}"]`);
    const confirmation = () => document.querySelector('.draft-confirmation');
    async function setup(overrides = {}) {
      const context = { bookings: [booking], rooms: [{ id: '101', typeId: 'standard' }], roomTypes: [{ id: 'standard', name: 'Standard' }], bookingSources: [{ id: 'direct', name: 'Direct' }], settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' }, tenant: { id: 'hotel-a', name: 'Hotel A' }, services: [], paymentMethods: [{ id: 'cash', name: 'Cash' }], funds: [{ id: 'fund', name: 'Cash fund', currency: 'VND' }], access: () => ({ allowed: true }), updateBooking: async () => {}, changeStatus: async () => {}, refreshWorkspace: async () => {}, addNote: async () => {}, addPayment: async () => {}, ...overrides };
      let navigation;
      function Editor() {
        const [open, setOpen] = React.useState(true);
        navigation = useDraftNavigation();
        return open ? h(BookingDetailPanel, { bookingId: booking.id, onClose: () => setOpen(false) }) : h('p', null, 'Closed');
      }
      const mounted = await mount(h(React.StrictMode, null, h(DraftGuardProvider, null, h(PmsContext.Provider, { value: context }, h(Editor)))));
      return { ...mounted, navigation, context };
    }

    await t.test('VND balance and nightly price keep Vietnamese separators when switching languages', async () => {
      const { getLocale, setLocale } = await load('/src/shared/i18n/store.js');
      const previousLocale = getLocale();
      const editor = await setup();
      try {
        for (const locale of ['vi', 'en-US', 'zh-CN']) {
          await act(async () => setLocale(locale));
          assert.equal(editor.container.querySelector('.booking-detail-balance strong').textContent, '100.000 ₫');
          const nightlyPrice = editor.container.querySelector('.booking-detail-money-input input');
          assert.equal(nightlyPrice.value, '37.500');
          assert.equal(nightlyPrice.readOnly, true);
        }
      } finally {
        await editor.unmount();
        await act(async () => setLocale(previousLocale));
      }
    });

    await t.test('foreign balances and nightly prices follow their currency format across UI languages', async () => {
      const { getLocale, setLocale } = await load('/src/shared/i18n/store.js');
      const previousLocale = getLocale();
      const cases = [
        ['USD', '1234567.0000', '1,234,567.00'],
        ['EUR', '1234567.0000', '1.234.567,00'],
        ['JPY', '1234567.0000', '1,234,567'],
        ['KRW', '1234567.0000', '1,234,567'],
        ['INR', '1234567.0000', '12,34,567.00'],
        ['JPY', '1234.2500', '1,234.25'],
      ];
      try {
        for (const [currency, amount, expected] of cases) {
          const foreignBooking = { ...booking, currency, balance: amount, nightlyRates: [
            { room: '101', date: '2026-10-21', price: amount },
            { room: '101', date: '2026-10-22', price: amount },
          ] };
          const editor = await setup({ bookings: [foreignBooking] });
          try {
            for (const locale of ['vi', 'en-US', 'zh-CN']) {
              await act(async () => setLocale(locale));
              assert.equal(editor.container.querySelector('.booking-detail-balance strong').textContent, `${expected} ${currency}`, `${locale}: ${currency} balance`);
              const nightlyPrice = editor.container.querySelector('.booking-detail-money-input input');
              assert.equal(nightlyPrice.value, expected, `${locale}: ${currency} nightly price`);
              assert.equal(nightlyPrice.readOnly, true);
            }
          } finally {
            await editor.unmount();
          }
        }
      } finally {
        await act(async () => setLocale(previousLocale));
      }
    });

    await t.test('clean close is immediate; each close path offers continue or discard', async () => {
      let editor = await setup();
      await click(document.querySelector('button[aria-label="Đóng"]'));
      assert.match(document.body.textContent, /Closed/);
      assert.equal(confirmation(), null);
      await editor.unmount();

      editor = await setup();
      await input(field('Họ tên khách (*)'), 'Draft guest');
      await click(document.querySelector('button[aria-label="Đóng"]'));
      assert.ok(confirmation());
      await click(button('Tiếp tục sửa'));
      assert.equal(field('Họ tên khách (*)').value, 'Draft guest');
      await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      assert.ok(confirmation());
      await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      assert.equal(confirmation(), null);
      assert.equal(field('Họ tên khách (*)').value, 'Draft guest');
      await act(async () => document.querySelector('.pms-legacy-overlay').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })));
      assert.ok(confirmation());
      await click(button('Bỏ bản nháp'));
      assert.match(document.body.textContent, /Closed/);
      await editor.unmount();
    });

    await t.test('tab switches preserve guest and note drafts and guard hidden tabs', async () => {
      const editor = await setup();
      await click(button('Khách hàng'));
      await input(field('name khách 1'), 'Guest tab draft');
      await click(button('Ghi chú'));
      await input(field('Ghi chú mới'), 'Unsubmitted note');
      await click(button('Chi tiết'));
      let navigated = false;
      await act(async () => editor.navigation.requestLeave(() => { navigated = true; }));
      assert.equal(navigated, false);
      await click(button('Tiếp tục sửa'));
      await click(button('Khách hàng'));
      assert.equal(field('name khách 1').value, 'Guest tab draft');
      await click(button('Ghi chú'));
      assert.equal(field('Ghi chú mới').value, 'Unsubmitted note');
      await editor.unmount();
    });

    await t.test('API failures retain details; pending writes reject duplicate submits and release after save', async () => {
      let calls = 0;
      const failed = await setup({ updateBooking: async () => { throw new Error('Save failed'); } });
      await input(field('Họ tên khách (*)'), 'Retained guest');
      await click(button('Lưu thay đổi'));
      assert.equal(field('Họ tên khách (*)').value, 'Retained guest');
      assert.match(document.querySelector('[role="alert"]').textContent, /Save failed/);
      await click(document.querySelector('button[aria-label="Đóng"]'));
      assert.ok(confirmation());
      await click(button('Tiếp tục sửa'));
      await failed.unmount();

      const pending = Promise.withResolvers();
      const editor = await setup({ updateBooking: () => { calls += 1; return pending.promise; } });
      await input(field('Họ tên khách (*)'), 'Saved guest');
      const save = button('Lưu thay đổi');
      await act(async () => { save.click(); save.click(); });
      assert.equal(calls, 1);
      await click(document.querySelector('button[aria-label="Đóng"]'));
      assert.equal(button('Bỏ bản nháp').disabled, true);
      await click(button('Tiếp tục sửa'));
      await act(async () => pending.resolve());
      await click(document.querySelector('button[aria-label="Đóng"]'));
      assert.equal(confirmation(), null);
      assert.match(document.body.textContent, /Closed/);
      await editor.unmount();
    });

    await t.test('saving one payment form preserves an unfinished refund and its guard', async () => {
      const editor = await setup();
      await click(button('Thanh toán'));
      await input(field('Lý do hoàn tiền'), 'Refund draft');
      await input(field('Số tiền thanh toán'), '10000');
      await input(document.querySelector('select[aria-label="Phương thức thanh toán"]'), 'cash');
      await input(document.querySelector('select[aria-label="Quỹ nhận tiền"]'), 'fund');
      await click(button('Ghi nhận thanh toán'));
      assert.equal(field('Số tiền thanh toán').value, '');
      assert.equal(field('Lý do hoàn tiền').value, 'Refund draft');
      await click(document.querySelector('button[aria-label="Đóng"]'));
      assert.ok(confirmation());
      await click(button('Tiếp tục sửa'));
      await editor.unmount();
    });

    await t.test('detail saves ignore hidden payment controls and reject an invalid visible date draft', async () => {
      let writes = 0;
      const editor = await setup({ updateBooking: async () => { writes++; } });
      await click(button('Thanh toán'));
      await click(button('Chi tiết'));
      await input(field('Họ tên khách (*)'), 'Valid guest');
      await click(button('Lưu thay đổi'));
      assert.equal(writes, 1);
      const checkIn = field('Ngày nhận (*)');
      assert.equal(checkIn.value, '21/10/2026');
      await input(checkIn, '31/02/2026');
      await click(button('Lưu thay đổi'));
      assert.equal(writes, 1);
      assert.equal(checkIn.checkValidity(), false);
      await editor.unmount();
    });
  });
});
