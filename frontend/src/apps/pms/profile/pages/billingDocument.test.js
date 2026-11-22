import test from 'node:test';
import assert from 'node:assert/strict';
import { billingDocumentHtml, downloadBillingDocument, openBillingDocument } from './billingDocument.js';
import { billingDate } from './billingDisplay.js';
import { getLocale, setLocale } from '../../../../shared/i18n/store.js';

const invoice = {
  id: 'invoice-a', number: 'SAAS-000123', tenantId: 'hotel-a', tenantName: '<script>Hotel</script>',
  description: '<img src=x onerror=alert(1)> & plan', currency: 'USD', amount: '100.2500', paid: '20.1250', balance: '80.1250',
  status: 'partial', createdAt: '2026-10-01T08:00:00Z', dueDate: '2026-10-20',
  payments: [{ id: 'payment-1', createdAt: '2026-10-02T08:00:00Z', amount: '20.1250', method: 'bank', reference: '<PAY>', note: '<script>note</script>' }],
};

test('internal SaaS documents preserve persisted decimal values and escape all invoice/payment data', () => {
  const html = billingDocumentHtml(invoice);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;Hotel'));
  assert.ok(html.includes('&lt;PAY&gt;'));
  assert.ok(html.includes('&lt;script&gt;note'));
  assert.ok(html.includes('payment-1'));
  assert.ok(html.includes('100,25 USD'));
  assert.ok(html.includes('20,125 USD'));
  assert.ok(html.includes('80,125 USD'));
  assert.ok(html.includes('Chứng từ nội bộ, không phải hóa đơn thuế.'));
});

test('calendar due dates remain on the same date across hotel time zones and document locales', () => {
  const previous = getLocale();
  try {
    setLocale('en-US');
    assert.equal(billingDate('2026-10-01', 'America/New_York'), '01/10/2026');
    assert.equal(billingDate('2026-10-01', 'Asia/Ho_Chi_Minh', false), '01/10/2026');
    assert.ok(billingDocumentHtml(invoice, 'America/New_York').includes('<html lang="en-US">'));
    assert.ok(billingDocumentHtml(invoice).includes('Internal document. This is not a tax invoice.'));
  } finally { setLocale(previous); }
});

test('SaaS refund history remains linked to its payment and safely escapes the reversal reason', () => {
  const html = billingDocumentHtml({ ...invoice, refunded: '5.1250', paid: '15.0000', balance: '85.2500', refunds: [{ id: 'refund-1', paymentId: '<payment-1>', amount: '5.1250', reason: '</td><script>refund</script>', createdAt: '2026-10-03T08:00:00Z' }] });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;payment-1&gt;'));
  assert.ok(html.includes('&lt;/td&gt;&lt;script&gt;refund'));
  assert.ok(html.includes('−5,125 USD'));
  assert.ok(html.includes('15,00 USD'));
});

test('SaaS document preview and HTML download require only persisted data and contain no automatic print script', async t => {
  const originals = new Map(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const previousCreate = URL.createObjectURL, previousRevoke = URL.revokeObjectURL;
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    URL.createObjectURL = previousCreate; URL.revokeObjectURL = previousRevoke;
  });
  let printed = 0, printClick, html;
  const button = { addEventListener(event, handler) { assert.equal(event, 'click'); printClick = handler; } };
  const preview = { opener: {}, print() { printed++; }, document: {
    open() {}, write(value) { html = value; }, close() {}, createElement() { return button; }, body: { prepend() {} },
  } };
  globalThis.window = { open(url, target) { assert.equal(url, 'about:blank'); assert.equal(target, '_blank'); return preview; } };
  openBillingDocument(invoice);
  assert.equal(preview.opener, null);
  assert.equal(printed, 0);
  assert.ok(html.includes('SAAS-000123'));
  printClick(); assert.equal(printed, 1);
  globalThis.window.open = () => null;
  assert.throws(() => openBillingDocument(invoice), /chặn cửa sổ/);

  let downloaded = false, blob, revoked;
  const link = { click() { downloaded = true; }, remove() {} };
  globalThis.document = { createElement(tag) { assert.equal(tag, 'a'); return link; }, body: { append() {} } };
  URL.createObjectURL = value => { blob = value; return 'blob:internal-document'; };
  URL.revokeObjectURL = value => { revoked = value; };
  downloadBillingDocument(invoice);
  assert.equal(downloaded, true);
  assert.equal(link.download, 'SAAS-000123.html');
  assert.equal(blob.type, 'text/html;charset=utf-8');
  assert.equal(await blob.text(), billingDocumentHtml(invoice));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(revoked, 'blob:internal-document');
});
