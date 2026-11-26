# BE-12 — Channex và thông báo trong ứng dụng

Ngày kiểm chứng: 07/10/2026. Code nằm trên `main` theo yêu cầu người dùng.
BE-PMS được giữ nguyên; phần BE-12 được chuyển riêng sang main, không gộp
prototype của nhánh BE-PMS. Chưa push hoặc deploy trong tác vụ này.

## Kết quả

- Channex: cấu hình theo tenant bằng tham chiếu khóa/secret runtime, mapping
  loại phòng và rate plan, quyền OTA_SYNC, webhook xác thực, hàng đợi PostgreSQL,
  retry có giới hạn và lịch sử. Worker tự nhận feed mỗi phút và gửi ARI hằng ngày
  hoặc sau thay đổi booking/giá/phòng; không cần Redis/Celery.
- Booking revisions: lấy dữ liệu từ Channex, khóa tồn phòng, kiểm tra nightly
  amounts, lưu booking và receipt chống trùng. ACK chỉ chạy sau commit; giao dịch
  lỗi không ACK và không để booking/thông báo dở dang.
- Thông báo: sự kiện booking, nhận/trả phòng, thanh toán, tình trạng phòng và lỗi
  OTA; nhóm nhận theo vai trò active, hộp thư riêng được RLS bảo vệ, đánh dấu đọc
  và phân trang. Owner cấu hình người nhận. Không sao chép thông tin liên hệ khách
  vào nội dung thông báo.
- Giao diện OTA, lịch sử, chuông thông báo và cấu hình người nhận gọi API thật.
  Có đường dẫn Kênh OTA trong menu và từ cấu hình nguồn đặt phòng.

## Kiểm chứng

- Toàn suite backend cuối: **216/216 pass**, không bỏ qua, 169,844 giây trên
  Python 3.14.0/PostgreSQL 18.6, database `pms_test_<UUID>` riêng; bao gồm schema
  upgrade/downgrade và các hồi quy tài chính. Ruff check/format check đạt.
- Channex: 20 integration tests trên PostgreSQL và 6 tests HTTP stdlib đều pass.
  Provider được giả lập; không gọi OTA thật. Có test ACK sau commit qua một kết
  nối DB độc lập, rollback không ACK, booking trùng/sửa/hủy/stale, vượt tồn,
  mapping sai, quyền bị thu hồi, scheduler và CLI.
- Thông báo: 12 tests PostgreSQL pass; bao gồm RLS, người nhận, rollback,
  idempotency, phân trang, quyền cấu hình và downgrade bảo vệ lịch sử. Test đã
  tái hiện rồi sửa lỗi phát thông báo dọn xong khi chỉ tạo phòng sạch mới.
- Frontend: 34 native tests pass, lint nguồn và production build pass. Lint có
  các cảnh báo nguồn tồn tại; không giảm kiểm tra bằng suppression.
- Browser localhost với database riêng và dữ liệu giả: đăng nhập giữ phiên sau
  reload; lưu kết nối Channex staging tắt, UUID property/mapping giả, xem lịch sử
  rỗng; nút đồng bộ khóa khi chưa có credentials. Đặt phòng mới tạo thông báo,
  đánh dấu đọc về 0 và tải được cấu hình vai trò. Không kích hoạt worker/provider
  thật trong bước browser.
- Kiểm tra kho/giá và các lỗi BE-11 được ghi riêng trong
  [BE10_11_IMPLEMENTATION_REPORT.md](BE10_11_IMPLEMENTATION_REPORT.md).

## Còn lại trước nghiệm thu OTA thật

Người vận hành cần đặt khóa và secret trong runtime server, dùng property/room
type/rate plan staging thật, chạy worker và nghiệm thu ARI, booking mới/sửa/hủy,
webhook lặp/mất và ACK. Chưa có credentials/property thật nên phần này vẫn mở.

ARI hiện dùng giá cơ bản/DailyRate với rate plan manual per-room, không dịch
LOS/voucher/promotions sang OTA. Extras, tổng tiền không khớp, ngày phòng không
đồng nhất, sửa booking đã thu tiền/nhận phòng hoặc thứ tự revision không rõ bị
giữ lỗi và không ACK để operator xử lý. Cờ OTA prepaid không tạo thanh toán PMS.

Mapping đã dùng không được đổi/tắt tùy ý. Tắt kết nối dừng worker nhưng không
đóng bán trên OTA. Email chưa chốt provider; mobile, API đối tác và báo cáo nâng
cao vẫn cần phạm vi/tiêu chí riêng. Không đánh dấu toàn bộ BE-12 hoàn thành.

Hướng dẫn chạy: [backend/README.md](../../../backend/README.md).
Hợp đồng: [backend/API_CONTRACT.md](../../../backend/API_CONTRACT.md).
Checklist: [tasks/be12.md](../../../tasks/be12.md).
