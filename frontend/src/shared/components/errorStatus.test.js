import test from 'node:test';
import assert from 'node:assert/strict';
import { errorStatus, readableErrorMessage } from './errorStatus.js';

test('HTTP statuses retain access, missing-page and unavailable meanings', () => {
  for (const status of [401, 403, 404, 500, 503]) assert.equal(errorStatus({ status }), status);
  assert.equal(errorStatus({ status: 502 }), 503);
  assert.equal(errorStatus({ status: 504 }), 503);
});

test('validation and conflict errors do not become outage screens', () => {
  assert.equal(errorStatus({ status: 422, message: 'Nhập tên khách sạn.' }), null);
  assert.equal(errorStatus({ status: 409 }), null);
});

test('CSRF failures show their message without claiming the user lacks permission', () => {
  assert.equal(errorStatus({ status: 403, code: 'csrf_failed', reason: 'role' }), null);
  assert.equal(errorStatus({ status: 403, code: 'forbidden' }), 403);
});

test('access decisions classify session and permissions without replacing their messages', () => {
  assert.equal(errorStatus({ reason: 'session' }), 401);
  for (const reason of ['role', 'tenant', 'feature', 'expired', 'suspended']) assert.equal(errorStatus({ reason }), 403);
  assert.equal(errorStatus({ reason: 'quota' }, null), null);
});

test('legacy network messages and numeric fallback messages use the right screen', () => {
  assert.equal(errorStatus(new TypeError('Failed to fetch')), 503);
  assert.equal(errorStatus('Yêu cầu thất bại (503).'), 503);
  assert.equal(errorStatus('Yêu cầu thất bại (403).'), 403);
  assert.equal(errorStatus('Unexpected server failure'), 500);
});

test('outage descriptions and failed retries replace raw network and generic API errors', () => {
  for (const message of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Yêu cầu thất bại (502).', 'Yêu cầu thất bại (503).', '']) {
    assert.equal(readableErrorMessage(message, 'Kiểm tra kết nối và thử lại.'), 'Kiểm tra kết nối và thử lại.');
  }
  assert.equal(readableErrorMessage('Bảo trì đến 10:00.', 'Thử lại sau.'), 'Bảo trì đến 10:00.');
});
