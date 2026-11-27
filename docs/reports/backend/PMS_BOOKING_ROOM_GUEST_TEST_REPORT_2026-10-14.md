# Kiểm thử backend đặt phòng, phòng và khách hàng — 14/10/2026

## Phạm vi

| Chức năng client | Backend và tình huống đã kiểm tra |
|---|---|
| Lịch đặt phòng | Workspace, phòng trống từng ngày, chuyển phòng/dời ngày/gia hạn, giải phóng tồn phòng, chống đặt trùng đồng thời. |
| Sơ đồ phòng | Trạng thái lưu trú, phòng sạch/bẩn/bảo trì, điều kiện nhận/trả phòng, nhật ký người thao tác. |
| Danh sách booking | Workspace/list/detail thống nhất, ghi chú, chuyển trạng thái, giữ giá đã chốt, thanh toán và rollback khi chỉnh sửa thất bại. |
| Phòng vật lý | Tạo/sửa/đổi loại/ngừng/kích hoạt; sức chứa, phòng đã có booking, quyền Owner và cách ly khách sạn. |
| Thông tin khách trong booking | Thêm/sửa thông tin qua đặt phòng, kiểm tra dữ liệu và rollback, giữ lịch sử, phân quyền đọc/ghi và cách ly khách sạn. |

Các bộ lọc/tìm kiếm/phân trang danh sách booking hiện nằm phía frontend, không được tính là API backend riêng.

Theo yêu cầu sau lượt kiểm thử ban đầu, đã xóa trang quản lý khách hàng riêng,
route `/id/guests`, hàm lưu riêng ở frontend và ba API CRUD `/guests`.
Thông tin khách tiếp tục được tạo/sửa trong `POST/PATCH /reservations`.
Không có migration xóa dữ liệu; mô hình khách và liên kết booking được giữ.
Các test CRUD riêng đã chuyển thành kiểm tra thông tin khách trong booking;
`test_room_guest_acceptance.py` hiện có 12 ca, gồm kiểm tra ba API đã bỏ trả 404.

Kiểm tra sau khi xóa: sáu bộ booking/phòng/khách trong booking/NO_SHOW/OTA/route
chạy 72 ca, 71 ca qua ngay. Một test rollback so sánh timestamp UTC của phản hồi
tạo booking với timestamp +07 khi đọc lại; đã sửa để so sánh workspace trước/sau
cùng thao tác. Chạy lại toàn bộ nhóm phòng/khách trong booking: 12/12 qua.
Frontend 127/127 ca qua; lint và build thành công. Không chạy lại toàn bộ backend
hoặc kiểm tra trình duyệt cho lượt xóa này.

## Lỗi đã tái hiện và sửa

1. API đổi trạng thái booking nhận list/object gây lỗi máy chủ. Giờ trạng thái sai kiểu trả `422 invalid_status`; chuyển trạng thái không hợp lệ vẫn trả `409 invalid_transition`, không đổi booking hoặc tồn phòng.
2. Email khách thiếu phần trước/sau `@`, có nhiều `@` hoặc khoảng trắng vẫn được lưu. Backend giờ kiểm tra các trường hợp này trong hàm dùng chung cho hồ sơ khách và khách của booking; lỗi làm rollback toàn bộ giao dịch.
3. Workspace của nhân viên buồng phòng còn chứa giá dù API giá từ chối quyền truy cập. Đã bỏ `price`, `commission`, `tax` trong danh mục và `price` trong giá ngày cho vai trò này, giữ tên/mã phòng/ngày/stop-sell; các vai trò khác vẫn nhận giá.

## Test bổ sung

- `backend/tests/test_booking_client_acceptance.py`: 9 ca về dữ liệu dùng chung của ba màn và chỉnh sửa booking/tồn phòng.
- `backend/tests/test_room_guest_acceptance.py`: 13 ca về phòng vật lý, khách hàng, validation, phân quyền và dữ liệu trả về cho buồng phòng.
- Đã xác nhận test lỗi thất bại trước khi sửa và chạy thành công sau khi sửa.
- Bộ test liên quan có sẵn: 55 ca đã qua trước khi sửa.

## Kiểm tra sau khi cập nhật main

- Đã hợp nhất phần đang sửa với `main` tại `a558c8d`, giữ chức năng NO_SHOW, danh mục thu chi `INCOME`/`EXPENSE`, chốt/chi hoa hồng và quản lý phiên đăng nhập mới.
- Lượt backend toàn diện chạy 490 ca trong 555 giây: 489 ca qua, 1 ca đối chiếu route thất bại do snapshot thiếu 14 API Channex đã có ở main. Đã thêm đúng 14 route vào snapshot, giữ nguyên assertion và chạy lại toàn bộ `CommonAppTests`: 3/3 qua. Không chạy lại toàn bộ 490 ca sau thay đổi chỉ ở snapshot này.
- Cả 33 ca mới của booking/phòng/khách hàng và settings/profile đều qua trong lượt toàn diện. Các bộ có sẵn về cashbook categories, commissions và NO_SHOW cũng qua.
- Sửa test kho so sánh ngày UTC với ngày khách sạn: quy đổi timestamp sang `Asia/Ho_Chi_Minh`, vẫn kiểm tra chứng từ đầu kỳ được ghi đúng ngày quá khứ. Test kho qua trong lượt toàn diện.
- Frontend: 127/127 ca qua; lint kết thúc thành công với các cảnh báo còn có sẵn; build thành công. Ruff và kiểm tra diff qua.
- Migration `0022_merge_client_settings` nối `0019_self_service_audit` với `0021_booking_commissions`, giữ nguyên các revision đã có. Kiểm tra đồ thị chỉ còn một head và các test migration/PostgreSQL qua. Khi triển khai cần chạy `python manage.py db upgrade` trước khi dùng phiên bản này.

Trình chạy chuẩn của repository, từ thư mục `backend` sau khi chuẩn bị môi trường Python/PostgreSQL theo README:

```powershell
.\.venv\Scripts\python.exe scripts/run_domain_tests.py
```

## Môi trường và giới hạn

Gọi API bằng Flask test client, kết nối PostgreSQL thật qua runtime role có RLS. Mỗi lần chạy dùng database `pms_test_<UUID>` riêng trong cluster QA; trình chạy xóa đúng database tạm khi kết thúc bình thường. Lượt toàn diện cũ bị gián đoạn do PostgreSQL dừng bất thường không được tính là kết quả đạt; đã khôi phục cluster và chạy lượt 490 ca nêu trên. Không dùng database hoặc dữ liệu khách sạn thật.

Chưa kiểm tra giao diện/trình duyệt hoặc production trong lượt này. Giữ nguyên các thay đổi client settings/profile từ lượt trước; 2FA vẫn để sau theo yêu cầu.
Email sai định dạng đã lưu từ trước cần được sửa khi cập nhật hồ sơ khách đó; bản sửa không tự thay đổi dữ liệu cũ.
