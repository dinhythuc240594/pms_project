import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingEditInput, bookingGuestInput } from './bookingDraft.js';

test('saving a booking uses the version and guests captured with the editable form', () => {
  const draft = {version:3,guest:'Alice',phone:'0911234567',email:'alice@example.test',identity:'ID1',nationality:'VN',rooms:['101'],checkIn:'2026-10-18',checkOut:'2026-10-20',source:'Direct',guests:[{id:'G1',name:'Old name'},{id:'G2',name:'Other guest'}]};
  const input = bookingEditInput(draft);
  assert.equal(input.expectedVersion,3);
  assert.equal(input.guests[0].id,'G1');
  assert.equal(input.guests[0].name,'Alice');
  assert.equal(input.guests[0].phone,'0911234567');
  assert.deepEqual(input.guests[1],draft.guests[1]);
  assert.equal(draft.guests[0].name,'Old name');
  assert.deepEqual(input.rooms,['101']);
  assert.equal(input.source,'Direct');
});

test('guest inputs reject malformed contacts and preserve identity fields without changing the source draft', () => {
  const guest = { name: ' Alice ', phone: ' +84 900 123 456 ', email: ' Alice+Desk@Example.TEST ', identityNumber: 'AB123', nationality: 'VN' };
  assert.deepEqual(bookingGuestInput(guest), { ...guest, name: 'Alice', phone: '+84 900 123 456', email: 'alice+desk@example.test' });
  for (const invalid of [{ name: ' ' }, { phone: '0901234567A' }, { phone: '123' }, { email: 'a..b@example.test' }]) assert.throws(() => bookingGuestInput({ ...guest, ...invalid }));
  assert.equal(guest.phone, ' +84 900 123 456 ');
});

test('booking edits reject an empty or reversed stay before saving', () => {
  for (const checkOut of ['', '2026-10-18', '2026-10-17']) assert.throws(() => bookingEditInput({ checkIn: '2026-10-18', checkOut }), /Ngày trả phòng/);
});
