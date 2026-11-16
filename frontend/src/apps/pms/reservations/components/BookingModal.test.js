import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('booking dates are day-first and invalid date drafts never search the previous ISO range', async () => {
  await withDraftDom(async ({ React, load, mount, input, click }) => {
    const { default: BookingModal } = await load('/src/apps/pms/reservations/components/BookingModal.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    let reads = 0;
    const pms = { settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND', checkInTime: '14:00', checkOutTime: '12:00' }, bookingSources: [], roomTypes: [], available: () => [], getAvailability: async () => { reads++; return { availability: [] }; }, allowAction: () => true };
    const view = await mount(React.createElement(PmsContext.Provider, { value: pms }, React.createElement(BookingModal, { onClose() {} })));
    const checkIn = view.container.querySelector('[aria-label="Ngày nhận phòng"]');
    assert.match(checkIn.value, /^\d{2}\/\d{2}\/\d{4}$/);
    await input(checkIn, '31/02/2030');
    await click([...view.container.querySelectorAll('button')].find(button => button.textContent.includes('Kiểm tra phòng trống')));
    assert.equal(reads, 0);
    assert.equal(checkIn.checkValidity(), false);
    assert.equal(checkIn.value, '31/02/2030');
  });
});

test('new booking protects its in-memory draft and pending create request', async t => {
  await withDraftDom(async ({ React, act, window, document, load, mount, click, input }) => {
    const { default: BookingModal } = await load('/src/apps/pms/reservations/components/BookingModal.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { DraftGuardProvider, useDraftNavigation } = await load('/src/shared/drafts/DraftGuardProvider.jsx');
    const h = React.createElement;

    async function mountBooking(overrides = {}) {
      let navigation;
      let closed = 0;
      const blockersAtClose = [];
      const pms = {
        settings: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND', checkInTime: '14:00', checkOutTime: '12:00' },
        bookingSources: [{ id: 'direct', name: 'Direct' }],
        roomTypes: [{ id: 'standard', name: 'Standard', capacity: 2, price: 1000000 }],
        available: () => [{ id: '101', typeId: 'standard' }],
        allowAction: () => true,
        getAvailability: async () => ({ availability: [] }),
        quote: async () => ({ currency: 'VND', total: 1000000, nightlyRates: [{ room: '101', date: '2026-10-21', price: 1000000 }] }),
        createBooking: async () => ({ id: 'new-booking' }),
        ...overrides,
      };
      function NavigationProbe() {
        navigation = useDraftNavigation();
        return null;
      }
      function Host() {
        const [open, setOpen] = React.useState(true);
        return h(DraftGuardProvider, null,
          h(NavigationProbe),
          h(PmsContext.Provider, { value: pms }, open && h(BookingModal, { onClose: () => {
            blockersAtClose.push(navigation.hasBlockers());
            closed += 1;
            setOpen(false);
          } })),
        );
      }
      const mounted = await mount(h(Host));
      return { ...mounted, get navigation() { return navigation; }, get closed() { return closed; }, blockersAtClose };
    }

    const confirmation = () => document.querySelector('.draft-confirmation');
    const continueEditing = () => click(confirmation()?.querySelector('button'));
    const createButton = () => document.querySelector('.booking-create-footer-actions button:last-child');
    const control = label => document.querySelector(`[aria-label="${label}"]`);

    async function selectRoom() {
      await click([...document.querySelectorAll('button')].find(button => button.textContent.includes('Kiểm tra phòng trống')));
      await click(document.querySelector('input[type="checkbox"]'));
      assert.equal(document.querySelector('input[type="checkbox"]').checked, true);
      assert.equal(createButton().disabled, false);
    }

    for (const currency of ['VND', 'USD', 'EUR', 'JPY']) {
      await t.test(`new bookings quote and save in the hotel's ${currency} currency without voucher or exchange-rate inputs`, async () => {
        const quotes = [], bookings = [];
        const view = await mountBooking({
          settings: { timezone: 'Asia/Ho_Chi_Minh', currency, checkInTime: '14:00', checkOutTime: '12:00' },
          quote: async payload => {
            quotes.push(payload);
            return { currency, total: 1000000, nightlyRates: [{ room: '101', date: '2026-10-21', price: 1000000 }] };
          },
          createBooking: async payload => { bookings.push(payload); return { id: 'new-booking' }; },
        });
        assert.equal(control('Tiền đặt phòng').value, currency);
        assert.equal(control('Tiền đặt phòng').readOnly, true);
        assert.equal(control('Mã voucher'), null);
        assert.equal(document.querySelector('#booking-currency-note'), null);
        assert.doesNotMatch(view.container.textContent, /voucher|tỷ giá/i);
        assert.equal(view.navigation.hasBlockers(), false);
        await selectRoom();
        assert.equal(quotes.length, 1);
        assert.equal(quotes[0].currency, currency);
        assert.deepEqual(quotes[0].rooms, ['101']);
        assert.equal(Object.hasOwn(quotes[0], 'voucherCode'), false);
        const symbol = currency === 'VND' ? '₫' : currency;
        assert.ok(document.querySelector('.booking-create-footer strong').textContent.endsWith(` ${symbol}`));
        await input(control('Họ và tên khách'), 'Nguyễn An');
        await click(createButton());
        assert.equal(bookings.length, 1);
        assert.equal(bookings[0].currency, currency);
        assert.equal(Object.hasOwn(bookings[0], 'voucherCode'), false);
        assert.equal(view.closed, 1);
        assert.deepEqual(view.blockersAtClose, [false]);
        await view.unmount();
      });
    }

    await t.test('a pristine form closes immediately, including while only availability is loading', async () => {
      const availability = deferred();
      const view = await mountBooking({ getAvailability: () => availability.promise });
      await click([...document.querySelectorAll('button')].find(button => button.textContent.includes('Kiểm tra phòng trống')));
      assert.equal(view.navigation.hasBlockers(), false, 'an availability read is not a pending create');
      await click(document.querySelector('.booking-create-close'));
      assert.equal(view.closed, 1);
      assert.equal(confirmation(), null);
      assert.equal(document.querySelector('.booking-create-panel'), null);
      await act(async () => availability.resolve({ availability: [] }));
      await view.unmount();
    });

    await t.test('header, cancel, backdrop and Escape preserve a draft until discard is chosen', async () => {
      const view = await mountBooking();
      await selectRoom();
      await input(control('Họ và tên khách'), 'Nguyễn An');
      await click(document.querySelector('.booking-create-close'));
      assert.ok(confirmation());
      assert.equal(view.closed, 0);
      await continueEditing();
      assert.equal(control('Họ và tên khách').value, 'Nguyễn An');

      await click(document.querySelector('.booking-create-footer-actions button'));
      assert.ok(confirmation(), 'the footer cancel uses the same guard');
      await continueEditing();
      await act(async () => document.querySelector('.pms-legacy-overlay').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })));
      assert.ok(confirmation(), 'the backdrop uses the same guard');
      await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      assert.equal(confirmation(), null, 'Escape first dismisses the confirmation');
      assert.equal(view.closed, 0);
      assert.equal(control('Họ và tên khách').value, 'Nguyễn An');
      await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      assert.ok(confirmation(), 'Escape on the form requests confirmation');
      await click(confirmation().querySelector('.draft-confirmation-discard'));
      assert.equal(view.closed, 1);
      assert.equal(view.navigation.hasBlockers(), false);
      assert.equal(document.querySelector('.booking-create-panel'), null);
      await view.unmount();
    });

    await t.test('room selection itself is a draft', async () => {
      const view = await mountBooking();
      await selectRoom();
      await click(document.querySelector('.booking-create-close'));
      assert.ok(confirmation());
      await continueEditing();
      assert.equal(document.querySelector('input[type="checkbox"]').checked, true);
      await view.unmount();
    });

    await t.test('API failure retains all content; retry guards pending writes and clears the guard on success', async () => {
      const pending = deferred();
      const requests = [];
      const view = await mountBooking({ createBooking: payload => {
        requests.push(payload);
        return requests.length === 1 ? Promise.reject(new Error('Không thể lưu đặt phòng.')) : pending.promise;
      } });
      await selectRoom();
      await input(control('Họ và tên khách'), 'Nguyễn An');
      await input(document.querySelector('input[type="tel"]'), '0901234567');
      await click([...document.querySelectorAll('button')].find(button => button.textContent.includes('+ Thêm khách lưu trú')));
      await input(control('Khách bổ sung 1'), 'Trần Bình');
      await input(control('Điện thoại khách 1'), '0912345678');
      await click(createButton());
      assert.equal(requests.length, 1);
      assert.match(document.querySelector('[role="alert"]').textContent, /Không thể lưu đặt phòng/);
      assert.equal(control('Họ và tên khách').value, 'Nguyễn An');
      assert.equal(control('Khách bổ sung 1').value, 'Trần Bình');
      assert.equal(control('Điện thoại khách 1').value, '0912345678');
      assert.equal(document.querySelector('input[type="checkbox"]').checked, true);
      assert.equal(view.navigation.hasBlockers(), true);
      await click(document.querySelector('.booking-create-close'));
      assert.ok(confirmation(), 'an API failure leaves the draft guarded');
      await continueEditing();

      let navigated = false;
      let navigationAllowed;
      let unload;
      await act(async () => {
        const submit = createButton();
        submit.click();
        submit.click();
        navigationAllowed = view.navigation.requestLeave(() => { navigated = true; });
        unload = new window.Event('beforeunload', { cancelable: true });
        window.dispatchEvent(unload);
      });
      assert.equal(requests.length, 2, 'rapid repeated submit creates one pending write');
      assert.equal(navigationAllowed, false, 'navigation reads the pending ref before a rerender');
      assert.equal(navigated, false);
      assert.equal(unload.defaultPrevented, true);
      assert.ok(confirmation());
      assert.equal(confirmation().querySelector('.draft-confirmation-discard').disabled, true);
      assert.equal(view.navigation.discard(), false, 'a pending write cannot be discarded programmatically');
      assert.deepEqual(requests[1].rooms, ['101']);
      assert.deepEqual(requests[1].guests, [
        { name: 'Nguyễn An', phone: '0901234567' },
        { name: 'Trần Bình', phone: '0912345678' },
      ]);
      await continueEditing();
      await act(async () => pending.resolve({ id: 'created-booking' }));
      assert.equal(view.closed, 1);
      assert.deepEqual(view.blockersAtClose, [false], 'success clears dirty and pending before closing');
      assert.equal(view.navigation.hasBlockers(), false);
      assert.equal(document.querySelector('.booking-create-panel'), null);
      assert.equal(confirmation(), null);
      const afterSave = new window.Event('beforeunload', { cancelable: true });
      window.dispatchEvent(afterSave);
      assert.equal(afterSave.defaultPrevented, false);
      await view.unmount();
    });
  });
});
