# Manager: hồ sơ khách hàng và thanh toán SaaS

Ngày kiểm chứng: 09/10/2026. Giao diện giữ hệ thống LOHA, chỉ có hai gói FREE/PRO.

## Chức năng đã hoàn thành

- Khách hàng & khách sạn: tạo khách sạn kèm Owner, sửa đầu mối liên hệ, điện thoại,
  email, địa chỉ, tỉnh/thành, mã số thuế, tên miền và ghi chú chăm sóc nội bộ.
  Tìm kiếm theo liên hệ; lọc trạng thái/gói; xem số phòng thực tế.
- Hồ sơ khách hàng: quản lý tài khoản trong khách sạn qua API hiện có; tạo tài
  khoản, sửa vai trò/trạng thái; giữ chặn vượt quota và khóa Owner cuối cùng.
  Xem nhật ký phân trang của khách sạn, kể cả khi khách sạn tạm ngưng.
- Hóa đơn phần mềm: tạo, lọc theo khách sạn/trạng thái/ngày, phân trang, ghi nhận
  thu một phần hoặc đủ, xem lịch sử, hủy hóa đơn chưa nhận thanh toán.
  Máy chủ chặn thu vượt số dư, chống tạo hóa đơn/ghi khoản thu trùng khi thử lại.
- Tổng quan hệ thống: số khách sạn, tài khoản hoạt động, gói đang hiệu lực, hóa
  đơn/khoản thu theo kỳ, công nợ và quá hạn hiện tại, khoản thu gần đây từ PostgreSQL.
  VND và USD được trình bày riêng. Ngày lọc/thời điểm hiển thị ở phần thanh toán
  thống nhất theo UTC; thuê bao vẫn sửa theo múi giờ thiết bị như trước.
- Hồ sơ cá nhân: sửa họ tên, đổi mật khẩu qua API hiện có, xem các phiên thực tế
  của chính tài khoản và thu hồi các phiên khác.

System Manager và Super Admin được dùng các chức năng trên. Đổi danh mục gói,
nhân sự nội bộ, nhật ký toàn hệ thống và bật/tắt tính năng toàn cục tiếp tục giới
hạn cho Super Admin theo chính sách đã có.

## Kiểm chứng

- Toàn bộ 256 kiểm thử backend và 58 kiểm thử frontend đều đạt, không bỏ qua
  kiểm thử. Production build, kiểm tra lint và định dạng mã đều đạt.
- Kiểm thử backend chạy trên PostgreSQL tạm riêng; bộ mới có 11 kiểm thử hóa
  đơn/công nợ và 9 kiểm thử hồ sơ khách hàng/phiên đăng nhập, gồm tình huống đồng
  thời tạo cùng hóa đơn và thu hồi phiên đăng nhập.
- Kiểm thử frontend bao gồm chuỗi tiền, ranh giới ngày/tháng UTC, phục hồi khoản
  thu theo người thao tác và phân loại/thông báo trang lỗi.
- Kiểm tra thực tế trên trình duyệt: liên hệ lưu được sau khi tải lại; tài khoản
  hiển thị đúng khách sạn; nhật ký có thao tác sửa hồ sơ; tạo hóa đơn, thu một phần,
  chặn vượt số dư, thu đủ, hủy hóa đơn, lọc đúng khách sạn/trạng thái/ngày.
- Đã phát hiện và sửa việc ngày thanh toán bị mất khi sửa trường khác. Kiểm tra
  lại thấy hạn thanh toán lưu đúng. Đổi kỳ báo cáo không làm mất công nợ hiện tại.
- Sửa tên cá nhân lưu được sau tải lại; thu hồi phiên khác giữ được phiên hiện tại.
  Owner bị chặn khỏi Manager. Không có lỗi console trong các luồng Manager đã kiểm tra.
- Đã kiểm tra giao diện ở 320, 768, 1024 và 1440px; bảng dài cuộn bên trong, menu
  và hộp thoại hoạt động trên điện thoại. Escape đóng được hồ sơ.
- Dữ liệu trình duyệt là fixture trong database thử nghiệm riêng; không cập nhật
  thông tin hoặc thanh toán trên database kinh doanh/Coolify.
  Đã dừng máy chủ QA, xóa database thử nghiệm có mã riêng và khôi phục trạng thái
  PostgreSQL thử nghiệm trước khi kiểm tra.
- Trang lỗi 401/403/404/500/503 đồng bộ LOHA, có nút quay về/đăng nhập/thử lại.
  Đã kiểm tra 403/404 trên trình duyệt và 503 khi API thực sự mất kết nối rồi phục
  hồi; có trang HTML dự phòng cho Nginx. Xem [báo cáo trang lỗi](../frontend/error-pages.md).

## Bổ sung quản lý thuê bao — 10/10/2026

- Trang Khách hàng tách trạng thái khách sạn (đang mở/tạm ngưng) khỏi trạng thái
  gói. Hiển thị và lọc: đang hiệu lực, sắp hết hạn trong 7 ngày, hết hạn, đã hủy,
  chưa bắt đầu, gói ngừng cung cấp và chưa cấp gói. Gói sắp hết hạn vẫn được tính
  trong nhóm đang hiệu lực; gói không thời hạn không bị nhắc hết hạn.
- Nút Cấp gói/Đổi gói/Gia hạn ở từng khách hàng mở đúng thuê bao tại trang Billing.
  Có nút tải lại thuê bao; dữ liệu đang tải hoặc tải lỗi không bị hiểu thành
  “chưa cấp gói” hay danh sách rỗng. Billing dùng cùng quy tắc trạng thái và chỉ
  hiển thị dữ liệu của lần tải hiện tại.
- Dùng lại API GET/PUT subscription và lịch sử hiện có theo nền common vừa
  chuẩn hóa. “Sắp hết hạn” là nhắc việc trên giao diện, không phải trạng thái gửi
  xuống database. Không thay đổi hợp đồng API hoặc thêm migration/dependency.
- Kiểm thử: 63 test frontend đạt (5 test mới về trạng thái, ranh giới thời gian và
  bộ lọc); 31 test backend liên quan đến thuê bao, khách hàng và startup/common
  đạt trên PostgreSQL tạm. Frontend build đạt; lint không có lỗi, vẫn có cảnh báo
  cũ ở các phần khác và luồng auto-open Billing.
- Trình duyệt: lọc sắp hết hạn nhất quán ở Khách hàng/Billing, gói hết hạn vẫn
  phân biệt với khách sạn đang mở; gia hạn ghi nhận hạn mới và lịch sử trên máy
  chủ. Kiểm tra 320/768/1280/1440px; sửa minimum width của grid để bảng cuộn trong
  vùng riêng và bộ lọc không bị cắt trên điện thoại.

## Triển khai lên Coolify

Backend mới cần migration `0013_manager_billing` và `0014_manager_customers`.
Trong container backend của môi trường cần triển khai, dùng cấu hình kết nối
migration của môi trường đó và chạy:

```sh
python manage.py db upgrade
```

Kiểm tra `/api/ready` trước khi dùng frontend mới. Xem hướng dẫn vận hành migration
và biến môi trường trong [backend/README.md](../../../backend/README.md). Chưa chạy lệnh
trên database kinh doanh hoặc Coolify trong đợt làm này. Hai migration chỉ thêm
bảng; nếu đã lưu hồ sơ hoặc hóa đơn, downgrade bị chặn để tránh mất dữ liệu.

## Phạm vi còn lại

- Khoản thanh toán hiện được ghi nhận thủ công; chưa có cổng thanh toán hoặc đối
  soát ngân hàng. Trả tiền không tự động cấp/gia hạn gói.
- Chưa triển khai 2FA; tên miền trong hồ sơ chưa tự cấu hình DNS/Cloudflare Tunnel.
- Trang khách hàng/thuê bao vẫn tải một subscription cho mỗi khách sạn. Khi số
  lượng khách sạn tăng khiến tải chậm, nên thêm API lấy danh sách thuê bao theo lô.

Chi tiết hợp đồng: [backend/API_CONTRACT.md](../../../backend/API_CONTRACT.md).
