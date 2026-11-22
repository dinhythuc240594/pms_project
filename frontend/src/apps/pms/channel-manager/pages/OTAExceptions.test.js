import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

test('review reconciliation preserves failed input and reuses an intent without creating cash', async () => {
  await withDraftDom(async ({ React, act, load, mount, input, click, document, window }) => {
    const { BookingReviewResolver } = await load('/src/apps/pms/channel-manager/pages/OTAExceptions.jsx');
    const calls = [];
    let succeeded = 0;
    const pms = { bookings: [{ id: 'booking-1', guest: 'Guest', rooms: ['101'], checkIn: '2030-01-01', checkOut: '2030-01-03', total: '200', currency: 'VND', version: 7 }],
      resolveChannelReview: async (...args) => { calls.push(args); if (calls.length === 1) throw new Error('Try the same intent'); } };
    const review = { id: 'review-1', bookingId: 'provider-booking', details: { amount: '200', currency: 'VND', arrivalDate: '2030-01-01', departureDate: '2030-01-03', collectedTaxes: [{ name: 'Withheld city tax', totalPrice: '10' }] } };
    const view = await mount(React.createElement(BookingReviewResolver, { pms, review, onClose() {}, onResolved() { succeeded++; } }));
    const field = text => [...view.container.querySelectorAll('label')].find(label => label.textContent.startsWith(text)).querySelector('input, select, textarea');
    await input(field('Booking PMS'), 'booking-1');
    await input(field('Nhập lại tổng PMS'), '200');
    const reason = field('Kết quả đối soát');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(reason, 'Verified withheld tax'); reason.dispatchEvent(new window.Event('input', { bubbles: true })); });
    await click(view.container.querySelector('input[type="checkbox"]'));
    const submit = () => act(async () => view.container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await submit();
    assert.match(document.body.textContent, /Try the same intent/);
    assert.equal(reason.value, 'Verified withheld tax');
    await submit();
    assert.equal(succeeded, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(calls[0][1].expectedVersion, 7);
    assert.equal(calls[0][1].expectedTotal, '200');
    assert.equal(calls[0][1].confirm, true);
    assert.match(document.body.textContent, /Withheld city tax/);
    await view.unmount();
  });
});

test('review form blocks malformed or oversized money before a reconciliation request', async () => {
  await withDraftDom(async ({ React, act, load, mount, input, click, window }) => {
    const { BookingReviewResolver } = await load('/src/apps/pms/channel-manager/pages/OTAExceptions.jsx');
    const calls = [];
    const pms = { bookings: [{ id: 'booking-1', total: '100', currency: 'VND', version: 1 }], resolveChannelReview: async (...args) => calls.push(args) };
    const view = await mount(React.createElement(BookingReviewResolver, { pms, review: { id: 'review-1', details: { amount: '100', currency: 'VND' } }, onClose() {}, onResolved() {} }));
    await input(view.container.querySelector('select'), 'booking-1');
    const fields = view.container.querySelectorAll('input[inputmode="decimal"]');
    await input(fields[1], '100');
    await click(view.container.querySelector('input[type="checkbox"]'));
    const reason = view.container.querySelector('textarea');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(reason, 'Verified'); reason.dispatchEvent(new window.Event('input', { bubbles: true })); });
    for (const value of ['1e3', '1,5', '-1', '1.00001', '1000000000000000']) {
      await input(fields[0], value);
      await act(async () => view.container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(calls.length, 0, value);
    }
    await input(fields[0], '100.0000');
    await act(async () => view.container.querySelector('form').requestSubmit());
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].providerTotal, '100.0000');
  });
});

test('incident history filters on the server and requires verification to resolve', async () => {
  await withDraftDom(async ({ React, act, load, mount, click, input, window }) => {
    const { ChannelIncidents } = await load('/src/apps/pms/channel-manager/pages/OTAExceptions.jsx');
    const calls = [];
    const incident = { id: 'incident-1', eventCode: 'sync_error', channelName: 'Booking.com', errorType: 'rate_error' };
    const pms = { tenantId: 'hotel-a', access: () => ({ allowed: true }), requestTenant: async path => { calls.push(path); return { items: [incident], assignees: [{ id: 'owner-a', name: 'Owner' }], pagination: { page: 1, totalItems: 1, totalPages: 1 } }; },
      channelIncidentAction: async (...args) => { calls.push(args); } };
    const view = await mount(React.createElement(ChannelIncidents, { pms }));
    await input(view.container.querySelector('select'), 'all');
    assert.ok(calls.some(path => typeof path === 'string' && path.includes('status=all')));
    await click([...view.container.querySelectorAll('button')].find(button => button.textContent === 'Giao việc / xử lý'));
    const form = view.container.querySelector('form');
    const reason = form.querySelector('textarea');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(reason, 'Verified channel rates'); reason.dispatchEvent(new window.Event('input', { bubbles: true })); });
    await click(form.querySelector('input[type="checkbox"]'));
    await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    const mutation = calls.find(Array.isArray);
    assert.equal(mutation[0], 'incident-1');
    assert.deepEqual(mutation[1], { action: 'resolve', reason: 'Verified channel rates', verified: true });
    assert.ok(mutation[2]);
    await view.unmount();
  });
});
