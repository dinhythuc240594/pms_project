import { formatDate, parseIsoDate } from '../../../shared/lib/date.js';
import { money } from '../data/model.js';

export const channelJobStatuses = { queued: 'Đang chờ', processing: 'Đang xử lý', succeeded: 'Thành công', needs_review: 'Cần xử lý', failed: 'Cần kiểm tra' };

const errors = {
  invalid_booking_revision: 'Dữ liệu cập nhật đặt phòng chưa hợp lệ. Đối chiếu ngày lưu trú và thông tin đặt phòng trên Channex.',
  invalid_booking_occupancy: 'Số khách chưa hợp lệ hoặc vượt sức chứa. Đối chiếu số người lớn, trẻ em và sức chứa loại phòng.',
  channel_room_type_inactive: 'Loại phòng PMS đã tạm ngưng. Kiểm tra loại phòng và ghép nối trước khi xử lý lại.',
  channel_room_inactive: 'Loại phòng chưa có phòng vật lý đang hoạt động. Kiểm tra trạng thái phòng trước khi xử lý lại.',
  booking_rates_incomplete: 'Thiếu giá cho một hoặc nhiều đêm. Đối chiếu giá của toàn bộ kỳ lưu trú trên Channex.',
  booking_amount_mismatch: 'Tổng tiền chưa khớp với giá các đêm. Đối soát số tiền trên Channex trước khi xử lý lại.',
  unsupported_booking: 'Đặt phòng có cấu trúc chưa được hỗ trợ. Nhờ quản trị viên đối soát và xử lý.',
  unsupported_booking_currency: 'Tiền tệ đặt phòng chưa được hỗ trợ. Kiểm tra tiền tệ và tỷ giá trước khi xử lý lại.',
  revision_order_conflict: 'Thứ tự cập nhật đặt phòng chưa rõ. Đối soát các thay đổi trên Channex trước khi xử lý lại.',
  channel_mapping_pause_pending: 'Trạng thái đóng bán đã thay đổi. Tải lại kết nối để kiểm tra ghép nối.',
  credentials_unavailable: 'Chưa có khóa xác thực Channex. Nhờ quản trị viên kiểm tra cấu hình kết nối.',
  credential_storage_unavailable: 'Hệ thống chưa bật lưu khóa an toàn. Nhờ quản trị viên kiểm tra cấu hình chung.',
  channel_api_key_required: 'Chưa có khóa API. Nhập khóa tại trang kết nối Channex.',
  webhook_registration_unavailable: 'Hệ thống chưa bật địa chỉ nhận webhook. Đặt phòng vẫn được nhận theo lịch.',
  channel_webhook_list_too_large: 'Channex có quá nhiều webhook. Nhờ quản trị viên kiểm tra trước khi đăng ký lại.',
  channel_webhook_ambiguous: 'Có nhiều webhook trùng địa chỉ nhận. Nhờ quản trị viên kiểm tra trước khi thử lại.',
  provider_invalid_response: 'Channex trả về dữ liệu chưa hợp lệ. Vui lòng thử lại sau.',
  channel_inactive: 'Kết nối Channex đang tắt. Bật kết nối trước khi thử lại.',
  provider_unavailable: 'Tạm thời chưa liên lạc được với Channex. Vui lòng thử lại sau.',
  provider_rate_limited: 'Channex đang giới hạn số yêu cầu. Chờ ít phút trước khi thử lại.',
  provider_rejected: 'Channex chưa chấp nhận dữ liệu. Kiểm tra mã khách sạn và liên kết phòng, gói giá.',
  invalid_remote_id: 'Mã liên kết Channex chưa hợp lệ. Kiểm tra lại thông tin kết nối.',
  exchange_rate_required: 'Chưa có tỷ giá cho tiền tệ đặt phòng. Khai báo tỷ giá rồi thử lại tác vụ cập nhật.',
  channel_booking_not_found: 'Chưa tìm thấy đặt phòng gốc trong LOHA. Cần đối soát trước khi xử lý thay đổi.',
  channel_cancellation_unverified: 'Chưa xác minh được bản hủy với đặt phòng mới nhất trên Channex. Đối soát đúng khách sạn và trạng thái hủy trước khi thử lại; PMS chưa trả phòng hoặc xác nhận bản hủy.',
  booking_requires_review: 'Đặt phòng đã có thay đổi hoặc giao dịch cần đối soát. Kiểm tra thủ công trước khi cập nhật.',
  booking_unmapped: 'Chưa ghép đúng loại phòng và gói giá của cập nhật. Kiểm tra ghép nối rồi thử lại.',
  room_unavailable: 'Không đủ tồn phòng phù hợp cho toàn bộ kỳ lưu trú. Kiểm tra tồn phòng và liên hệ kênh bán trước khi xử lý lại.',
  channel_mapping_required: 'Chưa có liên kết phòng đang bật. Hoàn tất liên kết trước khi cập nhật giá.',
  channel_mapping_invalid: 'Liên kết phòng hoặc gói giá chưa khớp với khách sạn trên Channex.',
  channel_rate_plan_unsupported: 'Gói giá Channex chưa phù hợp. Kiểm tra kiểu giá theo phòng và tiền tệ.',
  channel_rate_invalid: 'Giá OTA phải lớn hơn 0 khi mở bán. Kiểm tra giá cơ bản và giá theo ngày, rồi thử lại; chưa gửi thay đổi giá hoặc tồn phòng.',
  channel_rate_unverified: 'Chưa xác minh được giá lưu tại Channex. Chưa gửi yêu cầu mở bán lại; kiểm tra giá và tồn phòng trên kênh trước khi thử lại.',
  channel_snapshot_changed: 'Giá hoặc tồn phòng đã thay đổi trong lúc gửi. Chưa gửi yêu cầu mở bán lại; tải lại và kiểm tra dữ liệu trên kênh trước khi gửi lần tiếp theo.',
  channel_inventory_unverified: 'Chưa xác minh được tồn phòng đóng tại Channex. Chưa gửi giá hoặc yêu cầu mở bán lại; kiểm tra giá và tồn phòng trên kênh trước khi thử lại.',
  channel_publish_interrupted: 'Tác vụ gửi bị gián đoạn; trạng thái giá và tồn phòng chưa xác định. Kiểm tra trực tiếp trên kênh trước khi gửi lại.',
  channel_bookings_pending: 'Chưa gửi yêu cầu mở bán lại vì còn cập nhật đặt phòng OTA chưa xử lý/cần đối soát. Xử lý booking, kiểm tra tồn trên kênh rồi thử lại tác vụ.',
  booking_financial_extras_unsupported: 'Đặt phòng có thuế hoặc khoản thu chưa được hỗ trợ. Đối soát số tiền với Channex trước khi xử lý lại.',
  channel_inventory_inconsistent: 'Số phòng trống chưa khớp với đặt phòng. Cần đối soát trước khi đồng bộ.',
  channel_inventory_unreconciled: 'Đối chiếu đặt phòng cũ và tồn phòng, rồi xác nhận trước khi gửi giá và phòng trống.',
  channel_inventory_publishing: 'Đang gửi giá hoặc tồn phòng. Chờ lượt gửi hoàn tất rồi thử lại.',
  channel_onboarding_busy: 'Đặt phòng đang xử lý hoặc còn cần đối soát. Kiểm tra lịch sử rồi tải lại trước khi xác nhận.',
  channel_onboarding_changed: 'Dữ liệu đối chiếu đã thay đổi. Tải lại, kiểm tra đặt phòng và tồn phòng rồi xác nhận lại.',
  channel_load_unsupported: 'Kênh này chưa hỗ trợ yêu cầu tải đặt phòng cũ. Nhập và đối chiếu các đặt phòng tương lai thủ công.',
  channel_load_unavailable: 'Chưa thể yêu cầu tải đặt phòng cũ. Kiểm tra kết nối và kênh bán phòng rồi thử lại.',
  channel_load_interrupted: 'Yêu cầu tải đặt phòng cũ bị gián đoạn và có thể đã đến OTA. Kiểm tra lịch sử và đặt phòng trên OTA trước khi thử lại thủ công.',
  channel_configuration_changed: 'Cấu hình kết nối đã thay đổi. Tải lại, kiểm tra ghép nối và đối chiếu đặt phòng trước khi thử lại.',
  channel_actor_revoked: 'Người tạo yêu cầu không còn quyền đồng bộ. Chủ khách sạn có thể gửi lại yêu cầu.',
  tenant_suspended: 'Khách sạn đang tạm ngưng. Liên hệ quản trị viên để tiếp tục đồng bộ.',
  subscription_inactive: 'Gói dịch vụ chưa hoạt động hoặc đã hết hạn. Cần gia hạn để tiếp tục đồng bộ.',
};

export function channelErrorMessage(code) {
  return Object.hasOwn(errors, code) ? errors[code] : 'Yêu cầu chưa hoàn tất. Nhờ quản trị viên kiểm tra kết nối và dữ liệu tại Channex.';
}

export function bookingReviewStay(details) {
  const dates = [details.arrivalDate, details.departureDate].map(parseIsoDate);
  return dates.every(Number.isFinite) && dates[1] > dates[0]
    ? [details.arrivalDate, details.departureDate].map(date => formatDate(date)).join(' → ')
    : 'Ngày lưu trú chưa hợp lệ';
}

export function bookingReviewAmount(details) {
  return /^\d+(?:\.\d{1,4})?$/.test(details.amount ?? '') && /^[A-Z]{3}$/.test(details.currency || '')
    ? money(details.amount, details.currency) : 'Giá trị đặt phòng chưa hợp lệ';
}

const channelJobLabels = { push_ari: 'Cập nhật giá & phòng trống', load_bookings: 'Yêu cầu tải đặt phòng cũ', ack_revision: 'Xác nhận đã nhận đặt phòng', setup_webhook: 'Thiết lập webhook', pause_mapping: 'Đóng bán & tạm dừng ghép nối' };

export function channelJobLabel(job) {
  if (job.kind === 'pull_bookings') return job.revisionId ? 'Xử lý cập nhật đặt phòng' : 'Kiểm tra cập nhật đặt phòng';
  return channelJobLabels[job.kind] || 'Đồng bộ kênh phân phối';
}

export function channelJobSuccessMessage(job) {
  if (job.kind === 'pull_bookings') return job.revisionId
    ? 'Đã xử lý cập nhật đặt phòng. Xem tác vụ xác nhận riêng.'
    : 'Đã lấy danh sách cập nhật. Việc xử lý và xác nhận đặt phòng có tác vụ riêng.';
  if (job.kind === 'ack_revision') return 'Đã xác nhận cập nhật với Channex.';
  if (job.kind === 'load_bookings') return 'Đã yêu cầu OTA gửi đặt phòng cũ. Nhận cập nhật và đối chiếu đặt phòng, tồn phòng trước khi xác nhận.';
  return 'Đồng bộ hoàn tất';
}

export function syncBlockReason(connection, mappings, kind) {
  if (!connection) return 'Thiết lập kết nối Channex để bắt đầu đồng bộ.';
  if (!connection.active) return 'Kết nối đang tạm dừng. Bật kết nối trong phần cấu hình để tiếp tục.';
  if (!connection.credentialsConfigured) return 'Chưa có khóa API. Mở Chỉnh sửa kết nối để nhập và kiểm tra khóa.';
  if (kind === 'push_ari' && !mappings.some(row => row.active && !row.pauseRequested)) return 'Ghép ít nhất một loại phòng đang bật trước khi gửi giá và phòng trống.';
  if (kind === 'push_ari' && !connection.inventoryReconciledAt) return errors.channel_inventory_unreconciled;
  return '';
}

export function onboardingConfirmReason(onboarding) {
  if (!onboarding?.revision) return 'Tải lại trạng thái trước khi xác nhận đối chiếu.';
  if (onboarding.pendingBookings > 0 || onboarding.loads?.some(job => ['queued', 'processing'].includes(job.status))) return 'Đặt phòng đang xử lý. Chờ xử lý xong rồi tải lại để đối chiếu.';
  if (onboarding.reviewCount > 0) return 'Còn đặt phòng cần đối soát. Xử lý trong Lịch sử đồng bộ trước khi xác nhận.';
  return '';
}

export function connectionStatus(connection) {
  if (!connection) return { label: 'Chưa thiết lập', tone: 'neutral' };
  if (!connection.active) return { label: 'Tạm dừng', tone: 'neutral' };
  if (!connection.credentialsConfigured) return { label: 'Thiếu khóa API', tone: 'warning' };
  if (!connection.verifiedAt) return { label: 'Chưa kiểm tra', tone: 'warning' };
  return { label: 'Đang bật', tone: 'succeeded' };
}

export function mappingStatus(mapping) {
  if (mapping.pauseRequested) return { label: 'Đang đóng bán', tone: 'processing' };
  return mapping.active
    ? { label: 'Đang bật', tone: 'succeeded' }
    : { label: 'Đã tạm dừng', tone: 'neutral' };
}

export function connectionFormState(config, connection, storageAvailable) {
  if (!config) return { keyRequired: false, canSave: false };
  const targetChanged = connection && (config.environment !== connection.environment || config.propertyId !== connection.propertyId);
  const keyRequired = !connection || Boolean(targetChanged) || (!connection.credentialsConfigured && config.active);
  const hasKey = Boolean(config.apiKey.trim());
  return { keyRequired, canSave: hasKey ? storageAvailable : !keyRequired };
}

export function webhookStatus(connection, registrationAvailable, jobs = []) {
  if (connection && !connection.active) return { label: 'Tạm dừng', tone: 'neutral', hint: 'Bật kết nối để nhận và xử lý cập nhật đặt phòng.' };
  if (connection?.webhookRegistered) return { label: 'Đã đăng ký', tone: 'succeeded', hint: 'Channex gửi cập nhật đặt phòng qua webhook.' };
  if (!registrationAvailable) return { label: 'Chưa bật webhook', tone: 'neutral', hint: 'Hệ thống vẫn nhận đặt phòng theo lịch. Quản trị viên có thể bật webhook để nhận cập nhật sớm hơn.' };
  if (connection?.credentialSource === 'environment') return { label: 'Cấu hình cũ', tone: 'neutral', hint: 'Kết nối vẫn nhận đặt phòng theo lịch. Nhập và lưu khóa API trong LOHA để tự động thiết lập webhook.' };
  if (!connection?.webhookConfigured) return { label: 'Chưa sẵn sàng', tone: 'warning', hint: 'Nhập và lưu khóa API để LOHA tạo xác thực webhook.' };
  const latest = jobs.find(row => row.kind === 'setup_webhook');
  if (latest?.status === 'failed') return { label: 'Cần kiểm tra', tone: 'warning', hint: 'Mở Lịch sử đồng bộ để xem và thử lại yêu cầu thiết lập webhook.' };
  if (latest?.status === 'processing') return { label: 'Đang đăng ký', tone: 'processing', hint: 'Đang thiết lập thông báo đặt phòng từ Channex.' };
  return { label: 'Chờ đăng ký', tone: 'queued', hint: 'Yêu cầu thiết lập webhook sẽ được xử lý trong hàng đợi.' };
}
