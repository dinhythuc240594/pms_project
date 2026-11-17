import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

const booking = { id: 'stay-a', version: 7, room: '101', checkIn: '2030-01-01', checkOut: '2030-01-03', currency: 'VND', status: 'IN_HOUSE' };
const quote = { previewToken: 'quote-a', previousTotal: '100', total: '120', difference: '20', balance: '20', refundRequired: '0', checkoutNow: false, otaLinked: false, nightlyRates: [{ date: '2030-01-02', room: '102', price: '120' }] };
const context = overrides => ({ tenantId: 'hotel-a', user: { id: 'owner-a' }, authGeneration: 1, settings: { timezone: 'Asia/Ho_Chi_Minh' }, rooms: [{ id: 'room-101', number: '101' }, { id: 'room-102', number: '102' }], ...overrides });

test('an invalid day-first checkout draft blocks confirming an earlier valid stay preview', async () => {
  await withDraftDom(async ({ React, load, mount, input, click, act, window }) => {
    const { default: StayChangeForm } = await load('/src/apps/pms/reservations/components/StayChangeForm.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    let writes = 0;
    const view = await mount(React.createElement(PmsContext.Provider, { value: context({ previewStayChange: async () => quote, confirmStayChange: async () => { writes++; } }) }, React.createElement(StayChangeForm, { booking, onDone() {}, onCancel() {} })));
    await click([...view.container.querySelectorAll('button')].find(button => button.textContent === 'Xem trước thay đổi'));
    const checkout = view.container.querySelector('input[placeholder="dd/MM/yyyy"]:not([readonly])');
    await input(checkout, '31/02/2030');
    await reasonInput({ act, window }, view.container.querySelector('textarea'), 'Change stay');
    await click([...view.container.querySelectorAll('button')].find(button => button.textContent === 'Xác nhận thay đổi'));
    assert.equal(writes, 0);
    assert.equal(checkout.value, '31/02/2030');
  });
});

async function reasonInput({ act, window }, element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

test('Stay change previews selected rooms and requires a reason plus explicit OTA acknowledgment', async () => {
  await withDraftDom(async tools => {
    const { React, load, mount, click, input } = tools;
    const { default: StayChangeForm } = await load('/src/apps/pms/reservations/components/StayChangeForm.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const previews = [], writes = [];
    let done = 0;
    const value = context({ previewStayChange: async (...args) => { previews.push(args); return { ...quote, otaLinked: true }; }, confirmStayChange: async (...args) => { writes.push(args); } });
    const view = await mount(React.createElement(PmsContext.Provider, { value }, React.createElement(StayChangeForm, { booking, group: 'stay', onDone() { done++; }, onCancel() {} })));
    const button = label => [...view.container.querySelectorAll('button')].find(item => item.textContent === label);
    await input(view.container.querySelector('select'), '102');
    await click(button('Xem trước thay đổi'));
    assert.equal(previews.length, 1);
    assert.equal(previews[0][0], booking.id);
    assert.deepEqual(previews[0][1].rooms, ['102']);
    assert.equal(previews[0][1].expectedVersion, 7);
    assert.equal(button('Xác nhận thay đổi').disabled, true);
    await reasonInput(tools, view.container.querySelector('textarea'), 'Move after room issue');
    assert.equal(button('Xác nhận thay đổi').disabled, true);
    await click(view.container.querySelector('input[type="checkbox"]'));
    await click(button('Xác nhận thay đổi'));
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].previewToken, 'quote-a');
    assert.equal(writes[0][1].reason, 'Move after room issue');
    assert.equal(writes[0][1].confirmOta, true);
    assert.equal(done, 1);
  });
});

test('Stay change preserves a failed draft and retry identity while preventing a second in-flight write', async () => {
  await withDraftDom(async tools => {
    const { React, act, load, mount, click, input } = tools;
    const { default: StayChangeForm } = await load('/src/apps/pms/reservations/components/StayChangeForm.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const pending = Promise.withResolvers(), writes = [];
    let done = 0;
    const value = context({ previewStayChange: async () => quote, confirmStayChange: (...args) => { writes.push(args); return writes.length === 1 ? Promise.reject(new Error('Unknown write result')) : pending.promise; } });
    const view = await mount(React.createElement(PmsContext.Provider, { value }, React.createElement(StayChangeForm, { booking, onDone() { done++; }, onCancel() {} })));
    const button = label => [...view.container.querySelectorAll('button')].find(item => item.textContent === label);
    await input(view.container.querySelector('select'), '102');
    await click(button('Xem trước thay đổi'));
    await reasonInput(tools, view.container.querySelector('textarea'), 'Extend with selected room');
    await click(button('Xác nhận thay đổi'));
    assert.match(view.container.querySelector('[role="alert"]').textContent, /Unknown write result/);
    assert.equal(view.container.querySelector('textarea').value, 'Extend with selected room');
    assert.equal(view.container.querySelector('select').value, '102');
    assert.equal(done, 0);
    await click(button('Xác nhận thay đổi'));
    await click(button('Xác nhận thay đổi'));
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(button('Đóng').disabled, true);
    await act(async () => pending.resolve({ id: booking.id }));
    assert.equal(done, 1);
  });
});

test('Changing the stay after preview invalidates the quote before confirmation', async () => {
  await withDraftDom(async tools => {
    const { React, load, mount, click, input } = tools;
    const { default: StayChangeForm } = await load('/src/apps/pms/reservations/components/StayChangeForm.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const value = context({ previewStayChange: async () => quote });
    const view = await mount(React.createElement(PmsContext.Provider, { value }, React.createElement(StayChangeForm, { booking, onDone() {}, onCancel() {} })));
    await click([...view.container.querySelectorAll('button')].find(item => item.textContent === 'Xem trước thay đổi'));
    assert.ok(view.container.querySelector('textarea'));
    await input(view.container.querySelector('select'), '102');
    assert.equal(view.container.querySelector('textarea'), null);
    assert.ok(!view.container.textContent.includes('Xác nhận thay đổi'));
  });
});

test('A delayed stay quote cannot appear in another hotel or booking scope', async () => {
  await withDraftDom(async tools => {
    const { React, act, load, mount, click } = tools;
    const { default: StayChangeForm } = await load('/src/apps/pms/reservations/components/StayChangeForm.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const pending = Promise.withResolvers();
    let switchHotel;
    function Host() {
      const [hotel, setHotel] = React.useState('hotel-a');
      React.useEffect(() => { switchHotel = setHotel; }, []);
      const value = context({ tenantId: hotel, previewStayChange: () => hotel === 'hotel-a' ? pending.promise : Promise.resolve(quote) });
      return React.createElement(PmsContext.Provider, { value }, React.createElement(StayChangeForm, { booking: hotel === 'hotel-a' ? booking : { ...booking, id: 'stay-b', room: '102' }, onDone() {}, onCancel() {} }));
    }
    const view = await mount(React.createElement(Host));
    await click([...view.container.querySelectorAll('button')].find(item => item.textContent === 'Xem trước thay đổi'));
    await act(async () => switchHotel('hotel-b'));
    await act(async () => pending.resolve({ ...quote, total: '987654', nightlyRates: [{ date: '2030-01-02', room: 'PRIVATE-A-ROOM', price: '987654' }] }));
    assert.ok(!view.container.textContent.includes('PRIVATE-A-ROOM'));
    assert.equal(view.container.querySelector('textarea'), null);
    assert.equal(view.container.querySelector('select').value, '102');
    assert.equal(view.container.querySelector('select').disabled, false);
  });
});

test('An old stay write cannot close or modify a form opened under another hotel or session', async () => {
  for (const next of [{ tenantId: 'hotel-b', authGeneration: 1, bookingId: 'stay-b' }, { tenantId: 'hotel-a', authGeneration: 2, bookingId: 'stay-a' }]) {
    await withDraftDom(async tools => {
      const { React, act, load, mount, click } = tools;
      const { default: StayChangeForm } = await load('/src/apps/pms/reservations/components/StayChangeForm.jsx');
      const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
      const pending = Promise.withResolvers(), completed = [], writes = [];
      let switchScope;
      function Host() {
        const [scope, setScope] = React.useState({ tenantId: 'hotel-a', authGeneration: 1, bookingId: 'stay-a' });
        React.useEffect(() => { switchScope = setScope; }, []);
        const value = context({ ...scope, previewStayChange: async () => quote, confirmStayChange: (...args) => { writes.push(args); return pending.promise; } });
        return React.createElement(PmsContext.Provider, { value }, React.createElement(StayChangeForm, { booking: { ...booking, id: scope.bookingId }, onDone() { completed.push(scope.tenantId); }, onCancel() {} }));
      }
      const view = await mount(React.createElement(Host));
      const button = label => [...view.container.querySelectorAll('button')].find(item => item.textContent === label);
      await click(button('Xem trước thay đổi'));
      await reasonInput(tools, view.container.querySelector('textarea'), 'Finish original request');
      await click(button('Xác nhận thay đổi'));
      assert.equal(writes.length, 1);
      await act(async () => switchScope(next));
      await act(async () => pending.resolve({ ...booking, id: 'stay-a' }));
      assert.deepEqual(completed, [], `${next.tenantId}:${next.authGeneration}`);
      assert.equal(view.container.querySelector('textarea'), null);
      assert.equal(view.container.querySelector('select').disabled, false);
    });
  }
});
