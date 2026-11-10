import test from 'node:test';
import assert from 'node:assert/strict';
import { dateInputText, parseDateInput, parseIsoDate, formatDate, formatDateTime } from './date.js';

test('ISO calendar parsing rejects rollover and timestamps while preserving UTC midnight and four-digit years', () => {
  for (const value of ['0000-01-01', '0001-01-01', '1970-01-01', '2028-02-29', '9999-12-31']) {
    assert.equal(new Date(parseIsoDate(value)).toISOString().slice(0, 10), value);
  }
  assert.equal(parseIsoDate('1970-01-01'), 0);
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', '10000-01-01', '', null, undefined, 20260101]) {
    assert.ok(Number.isNaN(parseIsoDate(value)), String(value));
  }
});

test('date inputs show day/month/year and round-trip ISO dates without timezone conversion', () => {
  assert.equal(dateInputText('2028-02-29'), '29/02/2028');
  assert.equal(dateInputText('2026-10-30T09:05'), '30/10/2026 09:05');
  assert.equal(parseDateInput('29/02/2028'), '2028-02-29');
  assert.equal(parseDateInput('30/10/2026 09:05', true), '2026-10-30T09:05');
  assert.equal(parseDateInput('01/02/2026'), '2026-02-01');
  assert.equal(parseDateInput(''), '');
});

test('date parsing rejects impossible dates, ambiguous formats, incomplete times and rollover', () => {
  for (const value of ['29/02/2026', '31/04/2026', '00/10/2026', '30/13/2026', '30/10/0000', '2026-10-30', '1/2/2026', '10/30/2026']) assert.equal(parseDateInput(value), undefined, value);
  for (const value of ['30/10/2026', '30/10/2026 24:00', '30/10/2026 12:60', '31/02/2026 12:00']) assert.equal(parseDateInput(value, true), undefined, value);
});

test('manager display dates stay padded and UTC timestamps preserve their declared timezone', () => {
  assert.equal(formatDate('2026-02-01'), '01/02/2026');
  assert.equal(formatDateTime('2026-10-30T00:05:00Z', 'UTC'), '30/10/2026 00:05');
  assert.equal(formatDateTime('2026-10-30T00:05:00Z', 'Asia/Ho_Chi_Minh'), '30/10/2026 07:05');
  assert.equal(formatDateTime('invalid'), '—');
  assert.equal(formatDate(null), '—');
});

test('calendar display dates stay stable while timestamp dates follow the hotel timezone', () => {
  assert.equal(formatDate('2026-01-01', 'America/New_York'), '01/01/2026');
  assert.equal(formatDate('2026-01-01T01:30:00Z', 'America/New_York'), '31/12/2025');
  assert.equal(formatDate('2026-01-01T01:30:00Z', 'Asia/Ho_Chi_Minh'), '01/01/2026');
  for (const value of ['invalid', '2026-02-30', '2026-13-01', '', undefined]) assert.equal(formatDate(value), '—');
});
