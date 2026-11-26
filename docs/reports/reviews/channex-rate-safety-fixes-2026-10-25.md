# Kết quả sửa an toàn giá Channex

Ngày: 25/10/2026. Nhánh: **`codex/channex-rate-safety`**.

Phạm vi đã thực hiện là mã nguồn, migration, API/giao diện và kiểm thử cục bộ.
Không thay cấu hình Channex/OTA, không chạy migration trên database khách sạn
vận hành và không sửa tiền của booking cũ.

## Kết quả

| Rủi ro từ báo cáo ban đầu | Hành vi sau sửa |
| --- | --- |
| Đổi phòng có thể tính lại tiền booking OTA | Đổi phòng vật lý cùng hạng và cùng ngày giữ nguyên giá từng đêm, currency, tỷ giá, base amount và snapshot. Nhận diện bằng liên kết OTA bền vững kể cả booking cũ thiếu dấu trong snapshot. Đổi ngày/hạng/số phòng/nguồn tại PMS bị chặn để đối soát. |
| Tồn đã mở nhưng giá mới chưa gửi xong | Yêu cầu đóng tồn bằng 0 → đọc lại tồn Channex → gửi giá/stop-sell → đọc lại giá → tải lại catalog → kiểm snapshot mới dưới khóa → mới gửi mở tồn. Lỗi/timeout/chênh lệch không tự gửi bước mở lại từ snapshot cũ. |
| Một hạng phòng không nhận được nhiều gói | Giữ một gói chính gửi giá; thêm `inboundRatePlanIds` cho các gói được nhận booking rõ ràng. Kiểm cùng property/phòng/currency. Không suy bằng tên hay tự fallback về cha; không tự tính lại giá gói con. |
| Mapping sai vẫn lưu được | API kiểm catalog lúc lưu target mới/đang bật; chặn sai quan hệ và gói chính chưa hỗ trợ. Tiếp tục kiểm lúc xuất vì remote có thể đổi sau lưu. Yêu cầu đóng mapping cũ vẫn thực hiện được khi catalog tạm lỗi. |
| Không rõ giá nào thực sự gửi OTA | Thêm GET và giao diện xem trước từng ngày: giá, nguồn base/daily, tiền tệ, gói nhận giá, tồn và stop-sell. Nêu rõ rule/LOS/voucher PMS không tự sang OTA. |
| Thuế/commission bị bỏ qua | Lưu thông tin tiền được cho phép theo revision; dùng commission OTA dạng số tiền chính xác, không suy phần trăm. Thuế chưa hỗ trợ được chuyển thành hồ sơ đối soát, không ACK hoặc âm thầm bỏ qua. |
| Review chưa nhập booking nhưng ARI vẫn mở đủ tồn | Các lượt ARI giữ tồn 0 và stop-sell nếu còn review chưa giải quyết hoặc revision cụ thể chưa có receipt. Kiểm lại trước mở cuối; job giữ cửa sổ ngày để thử lại bằng dữ liệu mới. |

## Giới hạn được thực thi rõ

- Chỉ gói chính manual/per-room được PMS gửi giá. Các gói bổ sung là **chỉ nhận
  booking**; đây không phải engine định giá động hoặc hệ thống nhiều gói outbound.
- Booking có `taxes`/`collected_taxes` khác rỗng cần người đối soát. Tự cộng/trừ
  những khoản này khi chưa rõ bao gồm/chưa bao gồm/đã thu có thể tính trùng tiền.
- `payment_collect=ota` không tạo payment PMS. Commission thực tế cũng không chứng
  minh OTA đã khấu trừ hay đã chuyển tiền; thanh toán vẫn là thao tác sổ quỹ rõ ràng.
- Giá xem trước là snapshot lúc tải. Worker dựng và kiểm lại dữ liệu khi xử lý;
  preview không giữ chỗ và không chứng minh giá khách nhìn thấy trên OTA.
- Đọc lại API chỉ xác nhận dữ liệu lưu tại Channex, không chứng minh mọi OTA đã
  nhận xong. Thay đổi trực tiếp trên Channex/OTA sau lần đọc cuối không có giao
  dịch nguyên tử với PMS.
- Mỗi lượt đồng bộ có thêm request và có thể tạm ngừng bán các ngày đang gửi.
  Lỗi có thể để tồn còn đóng hoặc chưa rõ trạng thái upstream. Bước mở cuối giữ
  khóa ghi khách sạn tối đa timeout HTTP 15 giây để tránh booking vượt qua snapshot.
- Khi còn booking chưa xác minh, job có thể chờ `channel_bookings_pending`. Sau
  xử lý booking, nếu đã hết số lần thử phải retry job ARI. Không xóa review hay
  đổi mapping để né bảo vệ; booking OTA đã xác nhận vẫn cần được phục vụ/xử lý.

## Kiểm chứng đã chạy

| Nhóm | Kết quả |
| --- | --- |
| Mapping, tiền, commission, chỉnh booking, preview và contract API | **78 test đạt**, exit 0, database PostgreSQL tạm riêng |
| Lần kiểm cuối: giữ tồn, snapshot, dữ liệu thay đổi trong lúc gửi, HTTP giả lập, preview race, concurrency và migration | **43 test đạt**, exit 0, không skip |
| Snapshot query budget | Giữ tối đa **6 query**, không tăng theo ngày hoặc hạng phòng |
| Toàn bộ frontend sau thay đổi cuối | **295 test đạt**, 0 lỗi/skip |
| Backend lint / frontend lint / production build | Đạt; frontend còn cảnh báo cũ ở các phần ngoài phạm vi |
| Trình duyệt thật, dữ liệu fixture | Giá hai đêm đúng; preview chỉ GET; gói derived không chọn làm outbound; alias gửi đúng; không tràn trang ở 390/1440px; không có lỗi JavaScript trang |
| Postman simulation qua HTTP thật | Bốn kịch bản ARI đạt: thành công, lỗi gửi giá, giá đọc lại cũ, lỗi đóng tồn. Có log request của worker/client thật; mô phỏng hủy booking hiện có cũng đạt |
| Kiểm thử đối kháng | Đảo điều kiện kiểm tồn trong bộ nhớ bị regression test phát hiện; không sửa file nguồn bằng phép thử này |

Các lượt trên có test trùng nhau; không cộng số lượng thành tổng test độc lập.

Lượt backend tổng thể trước khi sửa xong fixture chạy **776 test**, có 14 failure,
1 error và 3 skip. Các ca thuộc thay đổi này đã được sửa và chạy lại theo nhóm ở
trên: fixture catalog phải có dữ liệu thật hợp lệ; kỳ vọng publication phải gồm
bước đóng; route fixture cần hai URL preview; test migration phải dùng schema
đúng phiên bản. Không bỏ test, giảm assertion hay tắt guard để đạt kết quả.

Lượt kiểm tổng thể phát hiện một lỗi **đã tồn tại trên baseline `c552af8`** ở
`test_day_reconciliation.DayReconciliationTests.test_confirmation_replays_snapshot_and_does_not_post_or_close_money`:
timestamp cùng thời điểm được trả dưới dạng `+00:00` và `+07:00`, làm so sánh JSON
khác nhau. Đã tái hiện độc lập cả baseline và mã hiện tại trên database tạm.
Theo yêu cầu bổ sung, cập nhật ngày **26/10/2026**, lỗi này đã được sửa ngay trên
cùng nhánh: serializer xác
nhận chuẩn hóa `createdAt` về UTC cho cả lúc tạo và đọc lịch sử. Ngày nghiệp vụ,
múi giờ lưu trong bản xác nhận và dữ liệu tiền không thay đổi; không cần migration.
Regression mới kiểm nhiều offset, giữ microsecond và hai thời điểm trùng giờ địa
phương khi đổi DST. **19 test đối soát ngày, boundary và contract API đã đạt**;
test lỗi ban đầu đã được chạy thất bại trước sửa và đạt sau sửa.
Không tuyên bố toàn bộ backend suite đã xanh và không chạy
lại toàn bộ suite dài sau các lần sửa tập trung.

## Migration và đưa vào sử dụng

Migration **`0037_channel_rate_safety`** thêm danh sách gói nhận booking, snapshot
tiền theo revision và cho phép commission có cơ sở số tiền thay vì phần trăm.
Các hàng cũ có giá trị JSON mặc định rỗng, không backfill tiền bằng phỏng đoán.
Áp migration trước khi chạy phiên bản mới.

Downgrade bị từ chối khi có alias, snapshot tiền đã nhận hoặc settlement dùng
số tiền OTA; đây là bảo vệ dữ liệu. Các cờ RLS tạm dùng để kiểm được khôi phục
trước khi chạy bước migration khác. Không ép downgrade qua guard.

Trước bật khách sạn thật vẫn cần kiểm kê gói đang bán, đối chiếu giá/tồn trên
Channex và OTA, có mẫu booking thật đã che dữ liệu cá nhân, và nghiệm thu một
pilot từ đầu đến cuối. Bước này chưa thực hiện vì lần làm việc này sửa mã và
kiểm thử, chưa triển khai hay vận hành tài khoản OTA.

Chi tiết hợp đồng mới: [API contract](../../../backend/API_CONTRACT.md).
Kế hoạch gốc và tiêu chí pilot: [kế hoạch](../../plans/channex-rate-safety-2026-10-25.md).
