import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import legacyEnUS from './locales/legacy-en-US.json' with { type: 'json' };
import legacyZhCN from './locales/legacy-zh-CN.json' with { type: 'json' };
import { dictionaries, LANGUAGE_STORAGE_KEY, normalizeLocale, translate, translateApiMessage, translateApiText, translateApiValue, translateLabel, translateUiText } from './core.js';
import { getLocale, setLocale, subscribeLocale, t } from './store.js';
import { money, today } from '../../apps/pms/data/model.js';
import { shortDate } from './formatters.js';

test('all three language catalogs contain the same nonempty keys and interpolation parameters', () => {
  const keys = Object.keys(dictionaries.vi).sort();
  assert.ok(keys.length > 700);
  const params = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const dictionary of Object.values(dictionaries)) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys);
    for (const key of keys) {
      assert.ok(typeof dictionary[key] === 'string' && dictionary[key].trim(), key);
      assert.deepEqual(params(dictionary[key]), params(dictionaries.vi[key]), key);
    }
  }
});

test('locale normalization accepts supported aliases and safely falls back to Vietnamese', () => {
  for (const [input, output] of [['vi-VN', 'vi'], ['en', 'en-US'], ['zh', 'zh-CN'], ['zh-Hans', 'zh-CN'], ['zh-CN', 'zh-CN']]) assert.equal(normalizeLocale(input), output);
  for (const value of [null, undefined, 'fr', 'constructor', '__proto__', 'toString', '']) assert.equal(normalizeLocale(value), 'vi');
  assert.equal(translate('unsupported', 'common.save'), 'Lưu');
  assert.equal(translate('en-US', 'missing.key'), 'missing.key');
});

test('translation interpolates values as plain text and preserves unknown parameters', () => {
  assert.equal(translate('en-US', 'hk.taskTitle', { room: '<101>$&' }), 'Task for room <101>$&');
  assert.equal(translate('zh-CN', 'hk.taskTitle', { room: 101 }), '客房 101 的任务');
  assert.equal(translate('en-US', 'hk.taskTitle'), 'Task for room {room}');
  assert.equal(translateLabel('en-US', 'Kế hoạch dọn phòng'), 'Housekeeping plan');
  assert.equal(translateLabel('zh-CN', 'Khách sạn Ngọc Lan'), 'Khách sạn Ngọc Lan');
});

test('legacy interface copy translates static and dynamic text while preserving Vietnamese', () => {
  assert.equal(translateUiText('en-US', 'Chọn gói phù hợp.'), 'Choose the right package.');
  assert.equal(translateUiText('zh-CN', 'Tên hoặc SKU'), '名称或 SKU');
  assert.equal(translateUiText('en-US', 'Tồn thấp · mức tối thiểu 5'), 'Low inventory · minimum level 5');
  assert.equal(translateUiText('vi', 'Chọn gói phù hợp.'), 'Chọn gói phù hợp.');
  assert.equal(translateUiText('en-US', 'Khách sạn Ngọc Lan'), 'Khách sạn Ngọc Lan');
});

test('API values translate only explicit references and preserve dictionary collisions', () => {
  const data = ['Ghi chú', 'Khách lẻ', 'Tồn thấp · mức tối thiểu 5', 'Đã lưu.', 'New booking', '备注'];
  for (const locale of ['vi', 'en-US', 'zh-CN']) {
    for (const value of [...data, null, undefined, 0, false]) {
      assert.equal(translateApiText(locale, value), value);
      assert.equal(translateApiValue(locale, value), value);
    }
    const object = { name: 'Ghi chú', values: { room: 'Khách lẻ' } };
    assert.equal(translateApiValue(locale, object), object);
  }
  assert.equal(translateApiValue('en-US', 'i18n:common.notes'), 'Notes');
  assert.equal(translateApiValue('zh-CN', 'i18n:common.notes'), dictionaries['zh-CN']['common.notes']);
});

test('API descriptors interpolate business data verbatim while known messages still translate', () => {
  const descriptor = Object.freeze({ $i18n: 'hk.taskTitle', values: Object.freeze({ room: 'Ghi chú · i18n:common.save · $&' }) });
  assert.equal(translateApiValue('en-US', descriptor), 'Task for room Ghi chú · i18n:common.save · $&');
  assert.equal(translateApiValue('zh-CN', descriptor), '客房 Ghi chú · i18n:common.save · $& 的任务');
  assert.equal(translateApiMessage('en-US', 'Cấu hình giá không hợp lệ.'), 'Invalid price configuration.');
  assert.equal(translateApiMessage('en-US', 'i18n:common.save'), 'Save');
  assert.equal(translateApiMessage('en-US', descriptor), 'Task for room Ghi chú · i18n:common.save · $&');
});

test('legacy translation catalogs preserve every interpolation placeholder', () => {
  const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const dictionary of [legacyEnUS, legacyZhCN]) {
    assert.ok(Object.keys(dictionary).length > 1800);
    for (const [source, target] of Object.entries(dictionary)) assert.deepEqual(parameters(target), parameters(source), source);
  }
});

test('English count labels use singular and plural forms without affecting other languages', () => {
  assert.equal(translate('en-US', 'hk.taskCount', { count: 1 }), '1 task this week');
  assert.equal(translate('en-US', 'hk.taskCount', { count: 0 }), '0 tasks this week');
  assert.equal(translate('en-US', 'hk.taskCount', { count: 2 }), '2 tasks this week');
  assert.equal(translate('vi', 'hk.taskCount', { count: 1 }), '1 công việc trong tuần');
  assert.equal(translate('zh-CN', 'hk.taskCount', { count: 1 }), '本周 1 个任务');
});

test('language changes notify subscribers without requiring browser storage', () => {
  const seen = [], unsubscribe = subscribeLocale(() => seen.push(getLocale()));
  try {
    setLocale('en-US'); assert.equal(t('common.save'), 'Save');
    setLocale('en-US'); setLocale('zh-CN');
    assert.deepEqual(seen, ['en-US', 'zh-CN']);
  } finally { unsubscribe(); setLocale('vi'); }
});

test('blocked localStorage preserves the in-memory language choice', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } });
  try { assert.doesNotThrow(() => setLocale('zh-CN')); assert.equal(getLocale(), 'zh-CN'); }
  finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; setLocale('vi'); }
});

test('language persists on reload and synchronizes across browser tabs and storage clearing', async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousWindow = globalThis.window;
  const values = new Map(), events = new EventTarget();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
  globalThis.window = events;
  const unsubscribe = subscribeLocale(() => {});
  try {
    setLocale('en-US'); assert.equal(values.get(LANGUAGE_STORAGE_KEY), 'en-US');
    const reloaded = await import('./store.js?reload-test');
    assert.equal(reloaded.getLocale(), 'en-US');
    values.set(LANGUAGE_STORAGE_KEY, 'zh-CN');
    const change = new Event('storage'); Object.defineProperty(change, 'key', { value: LANGUAGE_STORAGE_KEY }); events.dispatchEvent(change);
    assert.equal(getLocale(), 'zh-CN');
    values.clear(); const clear = new Event('storage'); Object.defineProperty(clear, 'key', { value: null }); events.dispatchEvent(clear);
    assert.equal(getLocale(), 'vi');
  } finally {
    unsubscribe();
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    setLocale('vi');
  }
});

test('VND display keeps Vietnamese separators, exact decimal prices and API business dates in every language', () => {
  const businessDate = today('Asia/Ho_Chi_Minh');
  try {
    setLocale('vi'); assert.equal(money('1250000.1234'), '1.250.000,1234 ₫'); assert.equal(shortDate('2026-10-15'), '15/10');
    setLocale('en-US'); assert.equal(money('1250000.1234'), '1.250.000,1234 ₫'); assert.equal(shortDate('2026-10-15'), '15/10');
    setLocale('zh-CN'); assert.equal(money('1250000.1234'), '1.250.000,1234 ₫'); assert.equal(shortDate('2026-10-15'), '15/10');
    assert.equal(today('Asia/Ho_Chi_Minh'), businessDate);
  } finally { setLocale('vi'); }
});

test('every static translation key referenced by frontend code exists in the catalogs', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  function check(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) check(path);
      else if (/\.(?:jsx|js)$/.test(path) && !path.includes('.test.')) {
        for (const match of readFileSync(path, 'utf8').matchAll(/(?:\btUi|\bt)\(['"]([\w.]+)['"]/g)) assert.ok(Object.hasOwn(dictionaries.vi, match[1]), `${path}: ${match[1]}`);
      }
    }
  }
  check(root);
});
