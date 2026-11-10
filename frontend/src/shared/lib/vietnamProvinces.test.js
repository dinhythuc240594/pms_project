import test from 'node:test';
import assert from 'node:assert/strict';
import { VIETNAM_PROVINCES, isVietnamProvince } from './vietnamProvinces.js';

test('Vietnam province choices use the 34 unique official codes after the 2025 consolidation', () => {
  assert.equal(VIETNAM_PROVINCES.length, 34);
  assert.equal(new Set(VIETNAM_PROVINCES.map(province => province.code)).size, 34);
  assert.equal(new Set(VIETNAM_PROVINCES.map(province => province.name)).size, 34);
  assert.ok(VIETNAM_PROVINCES.every(province => /^[0-9]{2}$/.test(province.code)));
  assert.equal(VIETNAM_PROVINCES.find(province => province.code === '46').name, 'Huế');
  assert.equal(VIETNAM_PROVINCES.find(province => province.code === '79').name, 'Hồ Chí Minh');
  for (const name of ['Bình Dương', 'Bà Rịa - Vũng Tàu', 'Quảng Nam', 'Thừa Thiên Huế', 'Thái Bình']) {
    assert.equal(isVietnamProvince(name), false, name);
  }
  for (const value of ['', null, undefined, 'Hà Nội ', 'Ha Noi']) assert.equal(isVietnamProvince(value), false);
});
