import test from 'node:test';
import assert from 'node:assert/strict';
import { commissionRateLabel } from './commissionPresentation.js';

test('provider commission is displayed as an amount basis without an invented percentage', () => {
  assert.equal(commissionRateLabel({ calculationBasis: 'provider_amount', percent: null }), 'Theo số tiền OTA');
  assert.equal(commissionRateLabel({ percent: '12.5000' }), '12.5000%');
  assert.equal(commissionRateLabel({ percent: '0.0000' }), '0.0000%');
  assert.equal(commissionRateLabel({ percent: null }), 'Chưa có tỷ lệ · cần xác nhận');
  assert.equal(commissionRateLabel({ percent: '12.0000', missingRate: true }), 'Chưa có tỷ lệ · cần xác nhận');
});
