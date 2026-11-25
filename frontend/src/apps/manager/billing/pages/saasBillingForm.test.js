import test from 'node:test'
import assert from 'node:assert/strict'
import {
  nonnegativeMoneyInput,
  positiveMoneyInput,
  dateFilterRange,
  currentMonthRange,
} from './saasBillingForm.js'

test('subscription history amounts allow zero while keeping the same decimal format as invoices', () => {
  assert.equal(nonnegativeMoneyInput(' 0.0000 '), '0.0000')
  assert.equal(nonnegativeMoneyInput('999999999999999.9999'), '999999999999999.9999')
  for (const value of ['', '-1', '1e3', '1,5', '1.00001', '1000000000000000'])
    assert.throws(() => nonnegativeMoneyInput(value))
})

test('money inputs retain exact decimal strings including the maximum value', () => {
  assert.equal(positiveMoneyInput('999999999999999.9999'), '999999999999999.9999')
  assert.equal(positiveMoneyInput(' 0.0001 '), '0.0001')
  assert.equal(positiveMoneyInput('12.3400'), '12.3400')
})

test('money inputs reject zero, negative, exponent, comma and excess precision or size', () => {
  for (const value of ['0', '000.0000', '-1', '1e3', '1,25', '1.00001', '1000000000000000', ''])
    assert.throws(() => positiveMoneyInput(value))
})

test('inclusive date controls become an exclusive API end across leap days and year boundaries', () => {
  assert.deepEqual(dateFilterRange('2028-02-01', '2028-02-29'), {
    start: '2028-02-01',
    end: '2028-03-01',
  })
  assert.deepEqual(dateFilterRange('', '2026-12-31'), { end: '2027-01-01' })
  assert.deepEqual(dateFilterRange('', ''), {})
})

test('date range rejects nonexistent and reversed calendar dates', () => {
  assert.throws(() => dateFilterRange('2026-02-29', ''))
  assert.throws(() => dateFilterRange('2026-10-10', '2026-10-09'))
})

test('default overview covers the UTC calendar month', () => {
  assert.deepEqual(currentMonthRange(new Date(2028, 1, 12)), {
    start: '2028-02-01',
    through: '2028-02-29',
  })
})

test('default overview uses UTC across local month and year boundaries', () => {
  assert.deepEqual(currentMonthRange(new Date('2026-11-01T00:30:00+07:00')), {
    start: '2026-10-01',
    through: '2026-10-31',
  })
  assert.deepEqual(currentMonthRange(new Date('2026-12-31T23:30:00-07:00')), {
    start: '2027-01-01',
    through: '2027-01-31',
  })
})
