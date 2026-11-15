import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../shared/drafts/testDom.js';

function notification(id, eventCode, readAt = null) {
  return {
    id,
    eventCode,
    title: `i18n:notifications.events.${eventCode}`,
    body: { $i18n: `notifications.eventBodies.${eventCode}`, values: { entityId: id } },
    entityId: id,
    createdAt: '2026-10-23T03:30:00Z',
    readAt,
  };
}

test('hotel notification inbox preserves accessible reading and recipient workflows', async context => {
  await withDraftDom(async ({ React, act, window, document, load, mount, click }) => {
    const { default: NotificationBell } = await load('/src/apps/pms/components/NotificationBell.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { getLocale, setLocale } = await load('/src/shared/i18n/store.js');
    const previousLocale = getLocale();
    setLocale('vi');
    const createElement = React.createElement;
    const button = label => [...document.querySelectorAll('button')].find(element => (element.getAttribute('aria-label') || element.textContent.trim()) === label);
    const filter = label => [...document.querySelectorAll('button[aria-pressed]')].find(element => element.textContent.trim().startsWith(label));
    const trigger = () => document.querySelector('button[aria-haspopup="dialog"]');
    const dialog = () => document.querySelector('dialog[role="dialog"]');

    async function setup(overrides = {}, interceptRequest) {
      const calls = [];
      let rows = [notification('BK-101', 'NEW_BOOKING'), notification('PAY-102', 'PAYMENT_RECEIVED')];
      let preferences = {
        availableRoles: ['HOTEL_OWNER', 'FRONT_DESK', 'ACCOUNTANT'],
        events: [
          { code: 'NEW_BOOKING', name: 'i18n:notifications.events.NEW_BOOKING', roles: ['HOTEL_OWNER', 'FRONT_DESK'] },
          { code: 'PAYMENT_RECEIVED', name: { $i18n: 'notifications.events.PAYMENT_RECEIVED' }, roles: ['HOTEL_OWNER', 'ACCOUNTANT'] },
        ],
      };
      async function requestTenant(path, options) {
        calls.push({ path, options });
        const intercepted = interceptRequest?.(path, options);
        if (intercepted !== undefined) return intercepted;
        const url = new URL(path, 'http://localhost');
        if (url.pathname === '/notifications/preferences') {
          if (options?.method === 'PATCH') {
            preferences = { ...preferences, events: preferences.events.map(event => ({ ...event, roles: options.body.events.find(row => row.code === event.code).roles })) };
          }
          return structuredClone(preferences);
        }
        if (url.pathname === '/notifications/read-all') {
          rows = rows.map(row => ({ ...row, readAt: '2026-10-23T04:00:00Z' }));
          return {};
        }
        if (url.pathname.endsWith('/read')) {
          const id = decodeURIComponent(url.pathname.split('/')[2]);
          rows = rows.map(row => row.id === id ? { ...row, readAt: '2026-10-23T04:00:00Z' } : row);
          return rows.find(row => row.id === id);
        }
        assert.equal(url.pathname, '/notifications');
        const unreadOnly = url.searchParams.get('unread') === 'true';
        return {
          items: url.searchParams.has('before') ? [notification('ROOM-103', 'ROOM_CLEANED', '2026-10-23T03:40:00Z')] : rows.filter(row => !unreadOnly || !row.readAt),
          unreadCount: rows.filter(row => !row.readAt).length,
          nextBefore: unreadOnly || url.searchParams.has('before') ? null : 'older-cursor',
        };
      }
      const pms = {
        tenantId: 'hotel-a',
        tenant: { id: 'hotel-a', name: 'Khách sạn Mây' },
        user: { id: 'owner-a' },
        settings: { timezone: 'Asia/Ho_Chi_Minh' },
        access: () => ({ allowed: true }),
        requestTenant,
        ...overrides,
      };
      const mounted = await mount(createElement(PmsContext.Provider, { value: pms }, createElement(NotificationBell)));
      return { ...mounted, calls, pms };
    }

    try {
      await context.test('filters, pagination, individual read and read-all update the visible inbox and unread count', async () => {
        const mounted = await setup();
        try {
          assert.match(trigger().getAttribute('aria-label'), /^Thông báo khách sạn.*2 chưa đọc/);
          assert.equal(trigger().getAttribute('aria-expanded'), 'false');
          await click(trigger());
          assert.equal(trigger().getAttribute('aria-expanded'), 'true');
          assert.equal(dialog().getAttribute('aria-label'), 'Thông báo khách sạn');
          assert.match(dialog().textContent, /Khách sạn Mây/);
          assert.match(dialog().textContent, /Đặt phòng mới: BK-101/);
          assert.match(dialog().textContent, /Đã nhận thanh toán: PAY-102/);
          assert.equal(filter('Tất cả thông báo').getAttribute('aria-pressed'), 'true');

          await click(button('Xem thông báo trước'));
          assert.match(dialog().textContent, /Phòng đã dọn xong: ROOM-103/);
          assert.equal(button('Xem thông báo trước'), undefined);
          assert.ok(mounted.calls.some(call => new URL(call.path, 'http://localhost').searchParams.get('before') === 'older-cursor'));

          await click(filter('Chưa đọc'));
          assert.equal(filter('Chưa đọc').getAttribute('aria-pressed'), 'true');
          assert.doesNotMatch(dialog().textContent, /ROOM-103/);
          assert.ok(mounted.calls.some(call => new URL(call.path, 'http://localhost').searchParams.get('unread') === 'true'));
          await click(button('Đánh dấu đã đọc'));
          assert.doesNotMatch(dialog().textContent, /BK-101/);
          assert.match(trigger().getAttribute('aria-label'), /1 chưa đọc/);
          assert.ok(mounted.calls.some(call => call.path === '/notifications/BK-101/read' && call.options?.method === 'POST'));

          await click(button('Đánh dấu tất cả đã đọc'));
          assert.match(dialog().textContent, /Bạn đã xem hết thông báo/);
          assert.match(dialog().textContent, /Tất cả thông báo đã được đọc\./);
          assert.doesNotMatch(trigger().getAttribute('aria-label'), /chưa đọc/);
          assert.ok(mounted.calls.some(call => call.path === '/notifications/read-all' && call.options?.method === 'POST'));
          await click(filter('Tất cả thông báo'));
          assert.match(dialog().textContent, /BK-101/);
          assert.match(dialog().textContent, /PAY-102/);
          assert.equal(button('Đánh dấu đã đọc'), undefined);
        } finally { await mounted.unmount(); }
      });

      await context.test('owners configure recipients with translated event names and save only event roles', async () => {
        const mounted = await setup();
        try {
          await click(trigger());
          await click(button('Nhóm người nhận'));
          const frontDesk = document.querySelector('input[aria-label="Đặt phòng mới: Lễ tân"]');
          const accountant = document.querySelector('input[aria-label="Đặt phòng mới: Kế toán"]');
          assert.equal(frontDesk.checked, true);
          assert.equal(accountant.checked, false);
          assert.ok(document.querySelector('input[aria-label="Đã nhận thanh toán: Kế toán"]'));
          await click(frontDesk);
          await click(accountant);
          await click(button('Lưu nhóm người nhận'));
          const saved = mounted.calls.find(call => call.path === '/notifications/preferences' && call.options?.method === 'PATCH');
          assert.deepEqual(saved.options.body, { events: [
            { code: 'NEW_BOOKING', roles: ['HOTEL_OWNER', 'ACCOUNTANT'] },
            { code: 'PAYMENT_RECEIVED', roles: ['HOTEL_OWNER', 'ACCOUNTANT'] },
          ] });
          assert.match(document.querySelector('[role="status"]').textContent, /Đã lưu nhóm người nhận cho các thông báo mới\./);
          await click(button('Lịch sử thông báo'));
          assert.match(dialog().textContent, /BK-101/);
        } finally { await mounted.unmount(); }
      });

      await context.test('recipient loading failures offer retry and tab switches preserve unsaved role choices', async () => {
        let preferenceLoads = 0;
        const mounted = await setup({}, (path, options) => {
          if (path === '/notifications/preferences' && !options?.method) {
            preferenceLoads += 1;
            if (preferenceLoads === 1) throw new Error('Không thể tải nhóm người nhận. Vui lòng thử lại.');
          }
        });
        try {
          await click(trigger());
          await click(button('Nhóm người nhận'));
          assert.match(document.querySelector('[role="alert"]').textContent, /Không thể tải nhóm người nhận\. Vui lòng thử lại\./);
          assert.equal(button('Thử lại').disabled, false);
          assert.equal(document.querySelector('input[type="checkbox"]'), null);
          assert.equal(preferenceLoads, 1);

          await click(button('Thử lại'));
          assert.equal(document.querySelector('[role="alert"]'), null);
          assert.equal(preferenceLoads, 2);
          await click(document.querySelector('input[aria-label="Đặt phòng mới: Lễ tân"]'));
          await click(document.querySelector('input[aria-label="Đặt phòng mới: Kế toán"]'));
          await click(button('Lịch sử thông báo'));
          assert.match(dialog().textContent, /BK-101/);
          await click(button('Nhóm người nhận'));
          assert.equal(document.querySelector('input[aria-label="Đặt phòng mới: Lễ tân"]').checked, false);
          assert.equal(document.querySelector('input[aria-label="Đặt phòng mới: Kế toán"]').checked, true);
          assert.equal(preferenceLoads, 2);
          assert.equal(mounted.calls.filter(call => call.options?.method === 'PATCH').length, 0);
        } finally { await mounted.unmount(); }
      });

      await context.test('pending read requests reject duplicate actions and close attempts, then recover after failure', async () => {
        const pending = Promise.withResolvers();
        let readAttempts = 0;
        const mounted = await setup({}, path => {
          if (path === '/notifications/BK-101/read') {
            readAttempts += 1;
            if (readAttempts === 1) return pending.promise;
          }
        });
        try {
          await click(trigger());
          const markRead = button('Đánh dấu đã đọc');
          await act(async () => { markRead.click(); markRead.click(); });
          assert.equal(readAttempts, 1);
          assert.equal(button('Đánh dấu đã đọc').disabled, true);
          assert.equal(button('Đánh dấu tất cả đã đọc').disabled, true);
          assert.equal(button('Đóng thông báo').disabled, true);
          assert.equal(filter('Chưa đọc').disabled, true);
          await click(button('Đánh dấu tất cả đã đọc'));
          await click(button('Đóng thông báo'));
          await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
          assert.ok(dialog());
          assert.equal(mounted.calls.filter(call => call.path === '/notifications/read-all').length, 0);

          await act(async () => pending.reject(new Error('Không thể đánh dấu đã đọc. Hãy thử lại.')));
          assert.match(document.querySelector('[role="alert"]').textContent, /Không thể đánh dấu đã đọc\. Hãy thử lại\./);
          assert.match(dialog().textContent, /Đặt phòng mới: BK-101/);
          assert.match(trigger().getAttribute('aria-label'), /2 chưa đọc/);
          assert.equal(button('Đánh dấu đã đọc').disabled, false);
          assert.equal(button('Đánh dấu tất cả đã đọc').disabled, false);
          assert.equal(button('Đóng thông báo').disabled, false);
          assert.equal(filter('Chưa đọc').disabled, false);

          await click(button('Đánh dấu đã đọc'));
          assert.equal(readAttempts, 2);
          assert.equal(document.querySelector('[role="alert"]'), null);
          assert.match(trigger().getAttribute('aria-label'), /1 chưa đọc/);
          assert.equal(document.querySelectorAll('button[aria-label="Đánh dấu đã đọc"]').length, 1);
          await click(button('Đóng thông báo'));
          assert.equal(dialog(), null);
        } finally { await mounted.unmount(); }
      });

      await context.test('read-only members can view notifications while unavailable writes stay disabled', async () => {
        const mounted = await setup({ access: action => ({ allowed: false, message: action === 'notifications.view' ? 'Khách sạn chỉ có quyền xem.' : '' }) });
        try {
          await click(trigger());
          assert.equal(button('Nhóm người nhận'), undefined);
          assert.match(dialog().textContent, /Khách sạn chỉ có quyền xem\./);
          assert.match(dialog().textContent, /Chưa thể đánh dấu thông báo đã đọc\./);
          assert.equal(button('Đánh dấu đã đọc').disabled, true);
          assert.equal(button('Đánh dấu tất cả đã đọc').disabled, true);
          await click(button('Đánh dấu đã đọc'));
          await click(button('Đánh dấu tất cả đã đọc'));
          assert.equal(mounted.calls.filter(call => call.options?.method).length, 0);
          assert.match(dialog().textContent, /BK-101/);
        } finally { await mounted.unmount(); }
      });

      await context.test('the modal traps focus, closes on Escape and returns focus to the bell', async () => {
        const mounted = await setup();
        try {
          trigger().focus();
          const bell = trigger();
          await click(bell);
          assert.equal(dialog().open, true);
          assert.equal(document.body.style.overflow, 'hidden');
          const controls = [...dialog().querySelectorAll('button:not(:disabled), input:not(:disabled)')];
          controls.at(-1).focus();
          await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
          assert.equal(document.activeElement, controls[0]);
          await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
          assert.equal(dialog(), null);
          assert.equal(document.activeElement, bell);
          assert.equal(bell.getAttribute('aria-expanded'), 'false');
          assert.equal(document.body.style.overflow, '');
        } finally { await mounted.unmount(); }
      });

      await context.test('a pending hotel response cannot replace the next hotel inbox', async () => {
        const pending = Promise.withResolvers();
        const requests = [];
        const hotelA = { tenantId: 'hotel-a', tenant: { name: 'Khách sạn A' }, user: { id: 'user-a' }, settings: { timezone: 'Asia/Ho_Chi_Minh' }, access: () => ({ allowed: true }), requestTenant: () => pending.promise };
        const hotelB = { ...hotelA, tenantId: 'hotel-b', tenant: { name: 'Khách sạn B' }, requestTenant: async path => { requests.push(path); return { items: [notification('HOTEL-B', 'NEW_BOOKING')], unreadCount: 1, nextBefore: null }; } };
        const controls = {};
        function Hotels() {
          const [hotel, setHotel] = React.useState(hotelA);
          React.useEffect(() => { controls.switchHotel = () => setHotel(hotelB); }, []);
          return createElement(PmsContext.Provider, { value: hotel }, createElement(NotificationBell));
        }
        const mounted = await mount(createElement(Hotels));
        try {
          await click(trigger());
          assert.match(dialog().textContent, /Đang tải thông báo/);
          await act(async () => controls.switchHotel());
          assert.equal(dialog(), null);
          await click(trigger());
          assert.match(dialog().textContent, /Khách sạn B/);
          assert.match(dialog().textContent, /HOTEL-B/);
          await act(async () => pending.resolve({ items: [notification('HOTEL-A', 'NEW_BOOKING')], unreadCount: 99, nextBefore: null }));
          assert.doesNotMatch(dialog().textContent, /HOTEL-A/);
          assert.match(trigger().getAttribute('aria-label'), /1 chưa đọc/);
          assert.ok(requests.length);
        } finally { await mounted.unmount(); }
      });
    } finally { setLocale(previousLocale); }
  });
});
