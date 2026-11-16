import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingDocumentHtml, openBookingDocument } from './bookingDocument.js';

test('booking document escapes guest and hotel fields and preserves original currency and refunded balance', () => {
  const html = bookingDocumentHtml({id:'B1',guest:'<img onerror="alert(1)">',room:'101',rooms:['101','102'],checkIn:'2026-10-14',checkOut:'2026-10-16',currency:'USD',source:'OTA & Direct',status:'NO_SHOW',total:'100.25',paid:'20.50',balance:'79.75',nightlyRates:[{date:'2026-10-14',room:'101',price:'50.125'}],charges:[]},{name:'LOHA <script>bad</script>'},{address:'Đà Nẵng',taxCode:'123'});
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;img')); assert.ok(html.includes('101, 102')); assert.ok(html.includes('USD')); assert.ok(html.includes('79.75')); assert.ok(html.includes('20.50')); assert.ok(html.includes('OTA &amp; Direct'));
});

test('print preview opens an empty document safely and prints only after a user click', t => {
  const originalWindow = globalThis.window;
  t.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });
  let printCount = 0, html = '', click;
  const button = { addEventListener(event, handler) { assert.equal(event, 'click'); click = handler; } };
  const preview = { opener: {}, print() { printCount++; }, document: {
    open() {}, write(value) { html = value; }, close() {},
    createElement(tag) { assert.equal(tag, 'button'); return button; },
    body: { prepend(element) { assert.equal(element, button); } },
  } };
  globalThis.window = { open(url, target) { assert.equal(url, 'about:blank'); assert.equal(target, '_blank'); return preview; } };
  openBookingDocument({ id:'QA', guest:'Test', currency:'VND', rooms:[], status:'CONFIRMED' }, { name:'LOHA' }, {});
  assert.equal(preview.opener, null); assert.ok(html.includes('Phiếu đặt phòng QA'));
  assert.equal(button.type, 'button'); assert.equal(button.textContent, 'In phiếu');
  assert.equal(printCount, 0); click(); assert.equal(printCount, 1);
  globalThis.window.open = () => null;
  assert.throws(() => openBookingDocument({}, {}, {}), /chặn cửa sổ/);
});
