import test from 'node:test';
import assert from 'node:assert/strict';
import { channexCatalogInput, channexMoney, channexToday, defaultChannexAccount, inventoryDateError, inventoryValue } from './presentation.js';
import { today } from '../../pms/data/model.js';

test('default account prefers configured Staging and never selects unavailable sources', () => {
  const production = { id: 'system:production', environment: 'production', configured: true };
  const staging = { id: 'hotel:demo', environment: 'staging', configured: true };
  const system = { id: 'system:staging', environment: 'staging', configured: false };
  assert.equal(defaultChannexAccount([production, system, staging]), staging.id);
  assert.equal(defaultChannexAccount([production, { ...system, configured: true }, staging]), system.id);
  assert.equal(defaultChannexAccount([system]), '');
  assert.equal(defaultChannexAccount([production]), production.id);
});

test('remote booking money keeps exact amounts and original currency, missing data stays unknown', () => {
  assert.equal(channexMoney('1234.56', 'USD'), '1.234,56 USD');
  assert.equal(channexMoney('98765432109876543210.25', 'EUR'), '98.765.432.109.876.543.210,25 EUR');
  assert.equal(channexMoney('98765432109876543210.123456', 'EUR'), '98765432109876543210.123456 EUR');
  assert.equal(channexMoney('0', 'USD'), '0,00 USD');
  assert.equal(channexMoney(null, 'USD'), '—');
  assert.equal(channexMoney('10', null), '—');
  assert.equal(inventoryValue(null), '—');
  assert.equal(inventoryValue(undefined), '—');
  assert.equal(inventoryValue(0), 0);
});

test('inventory range includes its final day and allows at most 31 days', () => {
  assert.equal(inventoryDateError('2026-10-01', '2026-10-01'), '');
  assert.equal(inventoryDateError('2026-10-01', '2026-10-31'), '');
  assert.notEqual(inventoryDateError('2026-10-01', '2026-11-01'), '');
  assert.notEqual(inventoryDateError('2026-10-02', '2026-10-01'), '');
  assert.notEqual(inventoryDateError('', '2026-10-01'), '');
  assert.notEqual(inventoryDateError('2026-02-30', '2026-03-01'), '');
});
test('invalid remote timezone falls back to the LOHA date instead of crashing inventory', () => {
  assert.equal(channexToday('Invalid/Zone'), today());
  assert.equal(channexToday(null), today());
  assert.equal(channexToday('UTC'), today('UTC'));
});

test('catalog save fields keep decimal strings and omit immutable plan fields on edit', () => {
  const rate = { name: ' Giá linh hoạt ', rate: '123456789012345.1234', roomTypeId: 'room-1', currency: 'USD', unexpected: 'ignored' };
  assert.deepEqual(channexCatalogInput('rate', rate, false), { name: 'Giá linh hoạt', rate: rate.rate, roomTypeId: 'room-1', currency: 'USD' });
  assert.deepEqual(channexCatalogInput('rate', rate, true), { name: 'Giá linh hoạt', rate: rate.rate });
  assert.deepEqual(channexCatalogInput('room', { name: ' Deluxe ', countOfRooms: '10', adults: '2', children: '0', infants: '1' }, true), { name: 'Deluxe', countOfRooms: 10, adults: 2, children: 0, infants: 1 });
});

test('catalog rejects blank names, noninteger capacities and malformed rates before saving', () => {
  const room = { name: 'Deluxe', countOfRooms: '10', adults: '2', children: '0', infants: '0' };
  for (const value of ['', ' ', '1e2', '1.5', '-1', '10001']) {
    assert.throws(() => channexCatalogInput('room', { ...room, countOfRooms: value }, false));
  }
  for (const field of ['adults', 'children', 'infants']) {
    assert.throws(() => channexCatalogInput('room', { ...room, [field]: '51' }, false));
  }
  assert.throws(() => channexCatalogInput('room', { ...room, name: '   ' }, true));
  const rate = { name: 'Flexible', roomTypeId: 'room-1', currency: 'USD', rate: '0' };
  assert.equal(channexCatalogInput('rate', rate, false).rate, '0');
  for (const value of ['', '-1', '1e3', '1,5', '1.00001', '1000000000000000']) {
    assert.throws(() => channexCatalogInput('rate', { ...rate, rate: value }, false));
  }
  assert.throws(() => channexCatalogInput('rate', { ...rate, currency: 'US1' }, false));
  assert.throws(() => channexCatalogInput('rate', { ...rate, roomTypeId: '' }, false));
});
