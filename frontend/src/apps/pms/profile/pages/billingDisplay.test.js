import test from 'node:test';
import assert from 'node:assert/strict';
import { billingDate } from './billingDisplay.js';
import { getLocale, setLocale } from '../../../../shared/i18n/store.js';

test('billing uses padded day/month/year in every language and preserves the hotel timezone', () => {
  const previous = getLocale();
  try {
    for (const locale of ['vi', 'en-US', 'zh-CN']) {
      setLocale(locale);
      assert.equal(billingDate('2026-01-02', 'America/New_York'), '02/01/2026');
      assert.equal(billingDate('2026-01-02T01:30:00Z', 'America/New_York'), '01/01/2026 20:30');
      assert.equal(billingDate('2026-01-02T01:30:00Z', 'America/New_York', false), '01/01/2026');
      assert.equal(billingDate('invalid'), '—');
      assert.equal(billingDate(null), '—');
    }
  } finally { setLocale(previous); }
});
