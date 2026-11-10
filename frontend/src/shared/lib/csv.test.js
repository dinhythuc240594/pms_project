import test from 'node:test';
import assert from 'node:assert/strict';
import { csvContent } from './csv.js';

test('CSV preserves Unicode, decimal precision, quotes and multiline text', () => {
  assert.equal(csvContent(['Tên', 'Tiền'], [['Nguyễn "An"\nHà Nội', '1234567890123.1234'], [null, '-12.2500']]), '\uFEFF"Tên","Tiền"\r\n"Nguyễn ""An""\nHà Nội","1234567890123.1234"\r\n"","-12.2500"');
});
test('CSV neutralizes spreadsheet formulas including whitespace prefixes', () => {
  const output = csvContent(['Khách'], [['=HYPERLINK("x")'], ['\t+cmd'], ['  @SUM(1)'], ['-1+2'], ['+1']]);
  assert.ok(output.includes('"\'=HYPERLINK(""x"")"'));
  for (const text of ['\t+cmd', '  @SUM(1)', '-1+2', '+1']) assert.ok(output.includes('"\'' + text + '"'));
});
