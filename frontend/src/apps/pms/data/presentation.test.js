import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingEvent, timestamp } from './presentation.js';

test('hotel timestamps use the hotel timezone across date boundaries', () => {
  const instant = '2026-10-14T01:30:00Z';
  assert.equal(timestamp(instant, 'America/New_York'), '13/10/2026 21:30');
  assert.match(timestamp(instant, 'America/New_York'), /13\/10\/2026/);
  assert.match(timestamp(instant, 'Asia/Ho_Chi_Minh'), /14\/10\/2026/);
  assert.equal(timestamp(null, 'Asia/Ho_Chi_Minh'), '—');
});

test('booking history describes status and money without exposing technical payloads',()=>{
  assert.equal(bookingEvent({event:'reservation.status',details:{from:'IN_HOUSE',to:'CHECKED_OUT'}}).label,'Trả phòng');
  assert.equal(bookingEvent({event:'reservation.status',details:{from:'CONFIRMED',to:'NO_SHOW'}}).label,'Khách không đến');
  assert.match(bookingEvent({event:'reservation.status',details:{from:'CONFIRMED',to:'NO_SHOW'}}).detail,/Đã xác nhận → Không đến/);
  assert.match(bookingEvent({event:'reservation.refund',details:{amount:'50000.00',reason:'Điều chỉnh',refundId:'internal-id'}}).detail,/50\.000/);
  assert.equal(bookingEvent({event:'reservation.refund',details:{amount:'50000.00',reason:'Điều chỉnh',refundId:'internal-id'}}).detail.includes('internal-id'),false);
  assert.match(bookingEvent({event:'reservation.created',details:{rooms:['101','102'],checkIn:'2026-10-03',checkOut:'2026-10-04'}}).detail,/101, 102/);
  assert.match(bookingEvent({event:'reservation.payment',details:{amount:'123.45'}},'USD').detail,/123,45 USD/);
});
