import test from 'node:test';
import assert from 'node:assert/strict';
import { translateLabel } from '../../../shared/i18n/core.js';
import { bookingReviewAmount, bookingReviewStay, channelErrorMessage, channelJobLabel, channelJobStatuses, channelJobSuccessMessage, connectionFormState, connectionStatus, mappingStatus, onboardingConfirmReason, syncBlockReason, webhookStatus } from './presentation.js';

test('booking review is an operator state with distinct data, mapping, inactive room and inventory guidance', () => {
  assert.equal(channelJobStatuses.needs_review, 'Cần xử lý');
  assert.match(channelErrorMessage('invalid_booking_revision'), /dữ liệu/i);
  assert.match(channelErrorMessage('booking_unmapped'), /ghép/i);
  assert.match(channelErrorMessage('channel_room_type_inactive'), /tạm ngưng/i);
  assert.match(channelErrorMessage('channel_room_inactive'), /phòng vật lý/i);
  assert.match(channelErrorMessage('room_unavailable'), /tồn phòng/i);
  assert.match(channelErrorMessage('booking_amount_mismatch'), /tổng tiền/i);
  assert.match(channelErrorMessage('channel_cancellation_unverified'), /chưa xác minh/i);
  assert.match(channelErrorMessage('channel_cancellation_unverified'), /chưa trả phòng hoặc xác nhận/i);
  assert.match(translateLabel('en-US', channelErrorMessage('channel_cancellation_unverified')), /could not be verified/);
  assert.match(translateLabel('zh-CN', channelErrorMessage('channel_cancellation_unverified')), /尚未释放客房/);
  assert.equal(channelErrorMessage('<script>provider raw payload</script>').includes('<script>'), false);
  assert.equal(typeof channelErrorMessage('__proto__'), 'string');
});

test('review metadata keeps exact valid money and clearly labels malformed provider dates and amounts', () => {
  assert.equal(bookingReviewStay({ arrivalDate: '2026-10-19', departureDate: '2026-10-22' }), '19/10/2026 → 22/10/2026');
  assert.equal(bookingReviewStay({ arrivalDate: '1970-01-01', departureDate: '1970-01-02' }), '01/01/1970 → 02/01/1970');
  assert.equal(bookingReviewStay({ arrivalDate: '2026-02-30', departureDate: 'invalid' }), 'Ngày lưu trú chưa hợp lệ');
  assert.equal(bookingReviewStay({ arrivalDate: '2026-10-22', departureDate: '2026-10-19' }), 'Ngày lưu trú chưa hợp lệ');
  assert.equal(bookingReviewStay({}), 'Ngày lưu trú chưa hợp lệ');
  assert.equal(bookingReviewAmount({ amount: '98765432109876543210.25', currency: 'USD' }), '98.765.432.109.876.543.210,25 USD');
  assert.equal(bookingReviewAmount({ amount: '0', currency: 'USD' }), '0,00 USD');
  for (const details of [{ amount: 'bad', currency: '???' }, { amount: '12', currency: 'bad currency' }, { amount: null, currency: 'USD' }, {}]) {
    assert.equal(bookingReviewAmount(details), 'Giá trị đặt phòng chưa hợp lệ');
  }
});

test('invalid OTA rates explain the correction and that no rates or inventory were sent', () => {
  const message = channelErrorMessage('channel_rate_invalid');
  assert.match(message, /lớn hơn 0/);
  assert.match(message, /giá cơ bản và giá theo ngày/);
  assert.match(message, /chưa gửi thay đổi giá hoặc tồn phòng/);
  assert.match(translateLabel('en-US', message), /greater than 0/);
  assert.match(translateLabel('zh-CN', message), /必须大于 0/);
});

test('unverified rates and changed snapshots explain that reopening was not requested', () => {
  assert.match(channelErrorMessage('channel_rate_unverified'), /Chưa gửi yêu cầu mở bán lại/);
  assert.match(channelErrorMessage('channel_snapshot_changed'), /Chưa gửi yêu cầu mở bán lại/);
  assert.match(channelErrorMessage('channel_inventory_unverified'), /Chưa gửi giá hoặc yêu cầu mở bán lại/);
  assert.match(channelErrorMessage('channel_publish_interrupted'), /chưa xác định/);
  assert.match(channelErrorMessage('channel_bookings_pending'), /Chưa gửi yêu cầu mở bán lại/);
  assert.match(channelErrorMessage('booking_financial_extras_unsupported'), /Đối soát số tiền/);
});

test('booking feed completion is distinct from processing and acknowledging each revision', () => {
  const feed = { kind: 'pull_bookings' };
  const revision = { ...feed, revisionId: 'revision-a' };
  const ack = { kind: 'ack_revision', revisionId: revision.revisionId };
  assert.equal(channelJobLabel(feed), 'Kiểm tra cập nhật đặt phòng');
  assert.equal(channelJobLabel(revision), 'Xử lý cập nhật đặt phòng');
  assert.equal(channelJobLabel(ack), 'Xác nhận đã nhận đặt phòng');
  assert.equal(channelJobSuccessMessage(feed), 'Đã lấy danh sách cập nhật. Việc xử lý và xác nhận đặt phòng có tác vụ riêng.');
  assert.equal(channelJobSuccessMessage(revision), 'Đã xử lý cập nhật đặt phòng. Xem tác vụ xác nhận riêng.');
  assert.equal(channelJobSuccessMessage(ack), 'Đã xác nhận cập nhật với Channex.');
  assert.equal(channelJobLabel({ kind: 'push_ari' }), 'Cập nhật giá & phòng trống');
  assert.equal(channelJobSuccessMessage({ kind: 'push_ari' }), 'Đồng bộ hoàn tất');
  assert.equal(channelJobLabel({ kind: 'unknown' }), 'Đồng bộ kênh phân phối');
});

test('OTA actions explain missing configuration without claiming a live connection', () => {
  const ready = { active: true, credentialsConfigured: true, webhookConfigured: true, verifiedAt: '2026-10-10T08:00:00Z', inventoryReconciledAt: '2026-10-10T08:05:00Z' };
  assert.match(syncBlockReason(null, [], 'pull_bookings'), /Thiết lập/);
  assert.match(syncBlockReason({ ...ready, active: false }, [], 'pull_bookings'), /tạm dừng/);
  assert.match(syncBlockReason({ ...ready, credentialsConfigured: false }, [], 'pull_bookings'), /khóa API/i);
  assert.match(syncBlockReason(ready, [{ active: false }], 'push_ari'), /Ghép/);
  assert.match(syncBlockReason(ready, [{ active: true, pauseRequested: true }], 'push_ari'), /Ghép/);
  assert.equal(syncBlockReason(ready, [{ active: true }], 'push_ari'), '');
  assert.equal(syncBlockReason({ ...ready, webhookConfigured: false }, [], 'pull_bookings'), '');
  assert.equal(syncBlockReason({ ...ready, webhookConfigured: false }, [{ active: true }], 'push_ari'), '');
  assert.deepEqual(connectionStatus(null), { label: 'Chưa thiết lập', tone: 'neutral' });
  assert.equal(connectionStatus({ ...ready, active: false }).label, 'Tạm dừng');
  assert.equal(connectionStatus({ ...ready, credentialsConfigured: false }).tone, 'warning');
  assert.equal(connectionStatus({ ...ready, webhookConfigured: false }).label, 'Đang bật');
  assert.equal(connectionStatus(ready).label, 'Đang bật');
});

test('inventory stays blocked until a persisted reconciliation while receiving bookings remains available', () => {
  const connection = { active: true, credentialsConfigured: true };
  assert.match(syncBlockReason(connection, [{ active: true }], 'push_ari'), /đối chiếu/i);
  assert.equal(syncBlockReason(connection, [], 'pull_bookings'), '');
  assert.equal(syncBlockReason({ ...connection, inventoryReconciledAt: '2026-10-20T00:00:00Z' }, [{ active: true }], 'push_ari'), '');
  assert.match(onboardingConfirmReason(), /Tải lại/);
  assert.match(onboardingConfirmReason({ revision: 'current', pendingBookings: 1, reviewCount: 0 }), /đang xử lý/);
  assert.match(onboardingConfirmReason({ revision: 'current', pendingBookings: 0, reviewCount: 2 }), /đối soát/);
  assert.match(onboardingConfirmReason({ revision: 'current', loads: [{ status: 'queued' }] }), /đang xử lý/);
  assert.equal(onboardingConfirmReason({ revision: 'current', pendingBookings: 0, reviewCount: 0, loads: [{ status: 'succeeded' }] }), '');
  assert.match(channelJobSuccessMessage({ kind: 'load_bookings' }), /Đã yêu cầu/);
  assert.doesNotMatch(channelJobSuccessMessage({ kind: 'load_bookings' }), /hoàn tất/);
  const publishing = channelErrorMessage('channel_inventory_publishing');
  assert.match(publishing, /Chờ lượt gửi hoàn tất/);
  assert.match(translateLabel('en-US', publishing), /Wait for publishing/);
  assert.match(translateLabel('zh-CN', publishing), /等待发送完成/);
});

test('a mapping awaiting close confirmation remains closing until the worker completes', () => {
  assert.deepEqual(mappingStatus({ active: true, pauseRequested: true }), { label: 'Đang đóng bán', tone: 'processing' });
  assert.deepEqual(mappingStatus({ active: false, pauseRequested: false }), { label: 'Đã tạm dừng', tone: 'neutral' });
  assert.deepEqual(mappingStatus({ active: true, pauseRequested: false }), { label: 'Đang bật', tone: 'succeeded' });
});

test('a webhook secret alone never implies successful callback registration', () => {
  const connection = { active: true, credentialsConfigured: true, webhookConfigured: true, webhookRegistered: false, verifiedAt: '2026-10-10T08:00:00Z' };
  assert.equal(webhookStatus(connection, false).label, 'Chưa bật webhook');
  assert.equal(webhookStatus(connection, true, []).label, 'Chờ đăng ký');
  assert.equal(webhookStatus(connection, true, [{ kind: 'setup_webhook', status: 'processing' }]).label, 'Đang đăng ký');
  assert.equal(webhookStatus(connection, true, [{ kind: 'setup_webhook', status: 'failed' }]).label, 'Cần kiểm tra');
  assert.equal(webhookStatus(connection, true, [{ kind: 'setup_webhook', status: 'queued' }, { kind: 'setup_webhook', status: 'failed' }]).label, 'Chờ đăng ký');
  assert.equal(webhookStatus({ ...connection, webhookRegistered: true }, true, [{ kind: 'setup_webhook', status: 'failed' }]).label, 'Đã đăng ký');
  assert.equal(webhookStatus({ ...connection, webhookConfigured: false }, true).label, 'Chưa sẵn sàng');
  assert.equal(webhookStatus({ ...connection, active: false }, true).label, 'Tạm dừng');
  assert.equal(connectionStatus(connection).label, 'Đang bật');
  assert.equal(syncBlockReason(connection, [], 'pull_bookings'), '');
});

test('a saved credential is not presented as a verified Channex connection', () => {
  for (const credentialSource of ['environment', 'encrypted']) {
    const connection = { active: true, credentialsConfigured: true, webhookConfigured: true, credentialSource, verifiedAt: null };
    assert.deepEqual(connectionStatus(connection), { label: 'Chưa kiểm tra', tone: 'warning' });
    assert.equal(syncBlockReason(connection, [], 'pull_bookings'), '');
  }
});

test('unavailable encrypted credentials still allow pausing the same existing connection', () => {
  const connection = { environment: 'staging', propertyId: 'hotel-a', active: true, credentialsConfigured: false };
  const config = { environment: 'staging', propertyId: 'hotel-a', active: false, apiKey: '' };
  assert.deepEqual(connectionFormState(config, connection, false), { keyRequired: false, canSave: true });
  assert.deepEqual(connectionFormState({ ...config, active: true }, connection, false), { keyRequired: true, canSave: false });
  assert.deepEqual(connectionFormState({ ...config, propertyId: 'hotel-b' }, connection, false), { keyRequired: true, canSave: false });
  assert.deepEqual(connectionFormState({ ...config, apiKey: 'replacement-key' }, connection, false), { keyRequired: false, canSave: false });
});

test('new connections and changed targets require a key while unchanged targets preserve saved credentials', () => {
  const connection = { environment: 'staging', propertyId: 'hotel-a', active: true, credentialsConfigured: true };
  const config = { environment: 'staging', propertyId: 'hotel-a', active: true, apiKey: '' };
  assert.deepEqual(connectionFormState(config, connection, true), { keyRequired: false, canSave: true });
  assert.deepEqual(connectionFormState(config, null, true), { keyRequired: true, canSave: false });
  assert.deepEqual(connectionFormState({ ...config, environment: 'production' }, connection, true), { keyRequired: true, canSave: false });
  assert.deepEqual(connectionFormState({ ...config, propertyId: 'hotel-b', apiKey: 'replacement-key' }, connection, true), { keyRequired: true, canSave: true });
  assert.deepEqual(connectionFormState({ ...config, apiKey: '   ' }, null, true), { keyRequired: true, canSave: false });
});

test('paused registered callbacks and legacy credentials do not claim to be receiving or queued', () => {
  const connection = { active: false, credentialsConfigured: true, credentialSource: 'encrypted', webhookConfigured: true, webhookRegistered: true };
  assert.equal(webhookStatus(connection, true).label, 'Tạm dừng');
  const legacy = { ...connection, active: true, webhookRegistered: false, credentialSource: 'environment' };
  assert.equal(webhookStatus(legacy, true, []).label, 'Cấu hình cũ');
  assert.match(webhookStatus(legacy, true, []).hint, /Nhập và lưu khóa API/);
  assert.equal(syncBlockReason(legacy, [], 'pull_bookings'), '');
});
