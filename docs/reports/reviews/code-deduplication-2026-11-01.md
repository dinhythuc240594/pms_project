# Rà soát và giảm code trùng lặp — 01/11/2026

Đã quét mã nguồn frontend/backend, đối chiếu các khối xử lý tương tự và kiểm tra
những nơi gọi trước khi gom hàm. Phạm vi gồm ứng dụng React, API Flask, tiện ích
chung, scripts và tests; không quét dependencies, bản build hoặc cache.

## Frontend

| Phần xử lý | Điều chỉnh |
| --- | --- |
| Kiểm tra ngày ISO | Thêm `parseIsoDate` tại `shared/lib/date.js`, dùng cho 8 vị trí trước đây tự kiểm tra định dạng, ngày không tồn tại và UTC. Giữ quy tắc năm của từng nơi gọi. |
| Hiển thị ngày | Reports, lịch nhân viên buồng phòng và billing dùng các hàm định dạng chung, bỏ wrapper hoặc kiểm tra ngày lặp. |
| In chứng từ | `apps/pms/data/document.js` dùng chung HTML escaping và mở cửa sổ in cho booking/billing. Giữ ngắt `opener`, thông báo popup bị chặn và thao tác bấm để in. |
| Lỗi ghi Channex | Hai form catalog/property dùng lại `uncertainChannelWrite`, giữ nguyên điều kiện phân loại lỗi. |
| Khai báo trùng/thiếu | Bỏ import trùng tại DayReconciliation và BookingDetailPanel; bổ sung import `formatDate` bị thiếu tại BookingModal; bỏ biến/import không dùng liên quan. |
| Phòng lỗi import thiếu | Bật `no-undef` trong Oxlint, khai báo môi trường browser và Node cho tests/config. |

Tests bổ sung bảo vệ ngày nhuận, ngày rollover, UTC epoch và giới hạn năm. Các test
chứng từ sẵn có tiếp tục kiểm tra escaping, cửa sổ in và tiền tệ. Cập nhật hai
selector ngày theo placeholder `dd/MM/yyyy` đã có trong dự án; cập nhật test
AdminBilling theo ô tiền tự tính, kiểm tra số tiền thập phân chính xác, tràn giới
hạn, số phòng và chu kỳ tháng/năm.

## Backend

| Phần xử lý | Điều chỉnh |
| --- | --- |
| Điện thoại khách hàng | Bỏ `phone_value` khai báo lại trong `admin/customers.py`, dùng `validation.phone_value` đã có; sửa luôn lỗi Ruff F811. |
| Hoàn tất thao tác idempotent | `bookings.routes.finish_write` nhận `record_model`, mặc định giữ bảng booking. Bốn luồng SaaS tạo hóa đơn, thu tiền, hoàn tiền và quyền vận hành tạm dùng chung helper với bảng `SaaSIdempotencyRecord`. |
| Kiểm tra hồi quy | Thêm test bảo vệ bảng idempotency riêng, response/status và lỗi lưu dữ liệu; cập nhật snapshot route bằng route `/api/admin/customer-accounts` đã có từ trước. |

Thứ tự flush, mã HTTP và namespace của yêu cầu retry được giữ nguyên. Đợt sửa này
không thêm hoặc sửa schema/migration.

## Những phần tiếp tục giữ riêng

- Các query hook có cơ chế scope khách sạn, refresh và xử lý lỗi khác nhau.
- Khai báo cột model tương tự nhưng thuộc các bảng có lịch sử nghiệp vụ riêng.
- Kiểm tra OTA trước/sau transaction có khác biệt về quyền, thứ tự và lỗi trả về.
- Một số đoạn style ngắn giống nhau chưa đủ lý do tạo abstraction dùng chung.

## Kết quả kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| Frontend `npm.cmd test` | 371 tests đạt, 0 lỗi, 0 bỏ qua. |
| Frontend `npm.cmd run lint` | Thành công; còn warning React/hooks đã có. |
| Frontend `npm.cmd run build` | Thành công; còn cảnh báo chunk lớn hơn 500 kB. |
| Backend `.venv/Scripts/python.exe -m ruff check .` | Thành công. |
| Backend `.venv/Scripts/python.exe -m unittest discover -s tests -v` | `Ran 197 tests`, `OK (skipped=98)`. |
| `git diff --check` | Thành công. |

98 mục backend bị bỏ qua vì thiếu `TEST_DATABASE_URL`,
`TEST_DATABASE_MIGRATION_URL` hoặc Channex HTTP simulation. Do đó chưa xác nhận
integration/RLS trên PostgreSQL trong môi trường này. Không tìm thấy bộ công cụ
PostgreSQL hoặc Docker sẵn có để chạy database test riêng.

## Trạng thái workspace

Workspace ban đầu đã có các thay đổi staged và 29 đường dẫn `UU`. Nội dung các
file đó không còn conflict marker ngay từ đầu. Các chỉnh sửa đợt rà soát giữ lại
công việc có sẵn; chưa stage hoặc commit nên Git index vẫn còn trạng thái `UU`.
