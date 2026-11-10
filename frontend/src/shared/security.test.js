import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bookingDocumentHtml } from '../apps/pms/reservations/bookingDocument.js';
import { billingDocumentHtml } from '../apps/pms/profile/pages/billingDocument.js';
import { csvContent } from './lib/csv.js';
import { withDraftDom } from './drafts/testDom.js';

test('printable documents keep title breakouts, SVG and event handlers as text in every detail section', () => {
  const payload = '</title><img src=x onerror="alert(1)"><svg onload=alert(2)><script>alert(3)</script>&\'"';
  const booking = {
    id: payload, guest: payload, phone: payload, rooms: [payload], status: payload,
    checkIn: payload, checkOut: payload, source: payload, currency: payload,
    total: '100', paid: '20', balance: '80',
    nightlyRates: [{ date: payload, room: payload, price: '100' }],
    charges: [{ description: payload, quantity: payload, amount: '20' }],
  };
  const invoice = {
    number: payload, tenantName: payload, tenantId: payload, description: payload,
    currency: payload, amount: '100', paid: '20', balance: '80', status: 'void', voidReason: payload,
    payments: [{ id: payload, method: payload, reference: payload, note: payload, amount: '20' }],
  };
  for (const html of [
    bookingDocumentHtml(booking, { name: payload }, { address: payload, phone: payload, contactEmail: payload, taxCode: payload }),
    billingDocumentHtml(invoice),
  ]) {
    const dom = new JSDOM(html);
    try {
      const document = dom.window.document;
      assert.equal(document.querySelectorAll('script,img,svg,iframe,object,embed').length, 0);
      assert.equal(document.querySelectorAll('style').length, 1);
      assert.ok(document.title.endsWith(payload));
      assert.ok(document.body.textContent.includes(payload));
      for (const element of document.querySelectorAll('*')) {
        assert.ok([...element.attributes].every(attribute => !/^on/i.test(attribute.name)));
      }
      assert.ok([...document.querySelectorAll('td')].some(cell => cell.textContent.includes(payload)));
    } finally { dom.window.close(); }
  }
});

test('CSV neutralizes formulas after every ASCII control prefix and Unicode whitespace in headers and data', () => {
  const prefixes = [...Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)), '\u00a0', '\u2000', '\u2028', '\u2029', '\u3000', '\ufeff'];
  for (const prefix of prefixes) {
    for (const operator of ['=', '+', '-', '@']) {
      const value = `${prefix}${operator}HYPERLINK("https://attacker.invalid","open")`;
      const escaped = `"'${value.replaceAll('"', '""')}"`;
      assert.equal(csvContent([value], [[value]]), `\ufeff${escaped}\r\n${escaped}`);
    }
  }
});

test('hotel logo preview rejects active protocols, URL credentials, backslashes and control characters', async () => {
  await withDraftDom(async ({ React, load, mount, input }) => {
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { BusinessProfile } = await load('/src/apps/pms/settings/pages/BusinessSettings.jsx');
    const safeUrl = 'https://cdn.example.test/logo.png';
    const pms = { settings: { name: 'Hotel', logoUrl: safeUrl }, access: () => ({ allowed: true }) };
    const view = await mount(React.createElement(PmsContext.Provider, { value: pms }, React.createElement(BusinessProfile)));
    assert.equal(view.container.querySelector('img').getAttribute('src'), safeUrl);
    assert.equal(view.container.querySelector('img').getAttribute('referrerpolicy'), 'no-referrer');
    const field = [...view.container.querySelectorAll('input')].find(element => element.value === safeUrl);
    for (const value of [
      'javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'file:///etc/passwd',
      '//attacker.invalid/logo.png', 'http://attacker.invalid/logo.png',
      'https://user:password@attacker.invalid/logo.png', 'https://@attacker.invalid/logo.png',
      'https:\\attacker.invalid/logo.png', 'https://cdn.example.test/\tlogo.png',
      'https://cdn.example.test/\u007flogo.png',
    ]) {
      await input(field, value);
      assert.equal(view.container.querySelector('img'), null, value);
    }
    await input(field, safeUrl);
    assert.equal(view.container.querySelector('img').getAttribute('src'), safeUrl);
  });
});
