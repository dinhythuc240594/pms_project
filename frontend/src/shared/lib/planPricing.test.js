import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePlanPrice, defaultPricingRules, defaultRegisteredRooms, normalizePricingRules } from './planPricing.js';

const plan = { price: '1000', priceYear: '10000', pricingRules: { baseRooms: 15, extraRoomPrice: '100', extraRoomPriceYear: '1000', adjustments: [{ aboveRooms: 30, percent: '-10' }, { aboveRooms: 50, percent: '-20' }, { aboveRooms: 100, percent: '5' }] } };

test('registration defaults to 15 rooms with neutral rules and respects a lower plan ceiling', () => {
  assert.equal(defaultRegisteredRooms({}), 15);
  assert.equal(defaultRegisteredRooms({ maxRooms: 10 }), 10);
  assert.equal(calculatePlanPrice({ price: '1000' }, 20).amount, '1000.0000');
  const first = defaultPricingRules();
  first.adjustments[0].percent = '-5';
  assert.equal(defaultPricingRules().adjustments[0].percent, '0');
});

test('base rooms and additional rooms use the selected cycle prices', () => {
  assert.equal(calculatePlanPrice(plan, 1).amount, '1000.0000');
  assert.equal(calculatePlanPrice(plan, 15).amount, '1000.0000');
  assert.equal(calculatePlanPrice(plan, 16).amount, '1100.0000');
  const yearly = calculatePlanPrice(plan, 31, 'yearly');
  assert.equal(yearly.amount, '23400.0000');
  assert.equal(yearly.extraRooms, 16);
  assert.equal(yearly.subtotal, '26000.0000');
  assert.equal(yearly.adjustmentPercent, '-10');
});

test('only the highest strictly exceeded threshold applies to the entire subtotal', () => {
  for (const [rooms, amount, threshold] of [[30, '2500.0000', null], [31, '2340.0000', 30], [50, '4050.0000', 30], [51, '3680.0000', 50], [100, '7600.0000', 50], [101, '10080.0000', 100]]) {
    const quote = calculatePlanPrice(plan, rooms);
    assert.equal(quote.amount, amount, `${rooms} rooms`);
    assert.equal(quote.aboveRooms, threshold);
  }
});

test('exact arithmetic rounds half up to four decimals and handles the largest money value', () => {
  const rules = { ...defaultPricingRules(), adjustments: [{ aboveRooms: 30, percent: '-50' }, { aboveRooms: 50, percent: '0' }, { aboveRooms: 100, percent: '0' }] };
  assert.equal(calculatePlanPrice({ price: '0.0001', pricingRules: rules }, 31).amount, '0.0001');
  assert.equal(calculatePlanPrice({ price: '999999999999999.9999' }, 15).amount, '999999999999999.9999');
  assert.throws(() => calculatePlanPrice({ ...plan, price: '999999999999999.9999' }, 16), /giới hạn số tiền/);
  rules.adjustments[0].percent = '-100';
  assert.equal(calculatePlanPrice({ price: '100', pricingRules: rules }, 31).amount, '0.0000');
});

test('invalid rule shapes, decimal amounts, percentages, cycles and room counts are rejected', () => {
  for (const rules of [{}, { ...defaultPricingRules(), extra: 1 }, { ...defaultPricingRules(), baseRooms: true }, { ...defaultPricingRules(), baseRooms: '1.5' }, { ...defaultPricingRules(), extraRoomPrice: '-1' }, { ...defaultPricingRules(), extraRoomPriceYear: '1e3' }, { ...defaultPricingRules(), adjustments: [] }, { ...defaultPricingRules(), adjustments: [{ aboveRooms: 30, percent: '-100.0001' }, { aboveRooms: 50, percent: '0' }, { aboveRooms: 100, percent: '0' }] }]) assert.throws(() => normalizePricingRules(rules));
  for (const count of ['', '0', '1.5', '1000001']) assert.throws(() => calculatePlanPrice(plan, count));
  assert.throws(() => calculatePlanPrice({ ...plan, maxRooms: 30 }, 31));
  assert.throws(() => calculatePlanPrice(plan, 15, 'weekly'));
  assert.equal(normalizePricingRules({ ...plan.pricingRules, adjustments: [{ aboveRooms: 30, percent: '+5' }, { aboveRooms: 50, percent: '0' }, { aboveRooms: 100, percent: '0' }] }).adjustments[0].percent, '+5');
});
