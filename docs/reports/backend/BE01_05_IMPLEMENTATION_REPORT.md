# Báo cáo triển khai BE-01–05

Ngày kiểm chứng: 03/10/2026. Môi trường: laptop, PostgreSQL `pms_local` tại `127.0.0.1:15432`, API port `5000`, frontend port `5173`. Chưa triển khai Coolify.

## Kết quả

| Nhóm | Đã triển khai |
| --- | --- |
| BE-01 | Login/logout/session thật; mật khẩu hash; CSRF và giới hạn lần đăng nhập; khách sạn/membership; Owner quản lý nhân viên; Admin tạo khách sạn và cấp Owner; role tại API, RLS đọc/ghi và audit. |
| BE-02 | Cấu hình khách sạn, timezone/tiền tệ, hạng phòng/phòng/giá cơ bản; nguồn booking, dịch vụ, phương thức thanh toán và quỹ; ngừng danh mục có lịch sử; giữ dữ liệu sau tải lại. |
| BE-03 | Giá từng đêm theo ngày, báo giá từ server, stop-sell, khóa phòng/bảo trì và tồn phòng; lưu giá từ màn hình giá, đọc cùng nguồn trong lưới giá. |
| BE-04 | Hồ sơ khách; booking nhiều phòng/nhiều khách; tạo/sửa/hủy; snapshot giá; chống đặt trùng đồng thời; cập nhật lịch/sơ đồ và tồn phòng; check-in và sạch/bẩn cơ bản. |
| BE-05 | Các tab khách/dịch vụ/giá/thanh toán/ghi chú/lịch sử; dịch vụ, phụ thu, thuế, chiết khấu; cọc/thanh toán từng phần/hoàn tiền có lý do; công nợ và ledger cùng transaction; checkout chuyển phòng bẩn. |

**Chính sách checkout đã áp dụng theo lựa chọn của người dùng: chỉ cho checkout khi thanh toán đủ.** API thực thi quy tắc này, giao diện đồng thời khóa nút khi còn nợ.

Frontend giữ bộ khung Client, sidebar, header, bảng, lưới giá và panel booking hiện có. Các luồng trên dùng API và PostgreSQL; dữ liệu demo cũ trong localStorage không được tự nhập. Giao dịch và thông tin xác thực không được lưu như dữ liệu demo trong trình duyệt.

## Các điểm đảm bảo nghiệp vụ

- Tenant lấy từ session/membership đã xác thực. Kiểm tra role và tenant ở API; PostgreSQL FORCE RLS bảo vệ các bảng nghiệp vụ. Runtime không dùng tài khoản superuser/migrator.
- Giá từng đêm và mã tiền tệ được chốt vào booking. Đổi giá danh mục không thay giá booking cũ. Không đổi tiền tệ khách sạn sau khi có lịch sử booking; giao dịch tạo booking đầu tiên và thay cấu hình được khóa đồng thời đúng thứ tự.
- Phòng/ngày dùng khoảng `[checkIn, checkOut)`: khách tiếp theo có thể đến đúng ngày khách trước rời. Row locks, cập nhật tồn và PostgreSQL exclusion constraint chặn hai booking đồng thời cùng phòng.
- Sửa hồ sơ khách và booking cùng một transaction; lỗi sức chứa hoặc đặt trùng rollback cả hai. Nguồn booking lịch sử vẫn giữ khi nguồn đổi tên/ngừng dùng.
- Tiền phía backend dùng Decimal/NUMERIC. Thu, hoàn và ledger ghi cùng transaction. Không thu vượt công nợ, không hoàn vượt tiền đã thu; audit và các dòng tiền không được sửa/xóa.
- Thu/hoàn/thêm khoản phí dùng Idempotency-Key. Cùng thao tác thử lại không tạo dòng tiền thứ hai; cùng mã khác nội dung bị từ chối. UI giữ fingerprint đã hash và mã thao tác trong sessionStorage khi kết quả chưa được xác nhận, kể cả qua tải lại; không lưu nội dung giao dịch hoặc token.
- Quỹ có loại tiền mặt/ngân hàng; không đổi loại sau khi đã ghi ledger. Nhật ký booking/buồng phòng có người thao tác và thời gian thật.
- Booking đóng khóa sửa lịch lưu trú/hồ sơ qua panel và khóa ghi tiền; ghi chú vẫn có thể bổ sung. Hoàn cho booking đã hủy có đối ứng; điều chỉnh sau checkout thuộc BE-06.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Backend unittest, gồm PostgreSQL thật trên database kiểm thử riêng | **73/73 đạt**, không skip; gồm migration upgrade/downgrade, RLS A/B, session/CSRF/role, đặt phòng đồng thời, idempotency đồng thời, rollback, giá bất biến, tiền và checkout. |
| Backend Ruff | `check` và `format --check` đạt. |
| Frontend | **29/29 tests đạt** (API/helpers mới và regression demo cũ); production build đạt. |
| Frontend lint | Exit 0, không lỗi; còn cảnh báo unused imports và React hooks, gồm cảnh báo trong các file mới sửa. Chưa coi đây là lint hoàn toàn sạch. |
| API/database local | `db-check` và `/api/ready` thành công, migration hiện tại `0004_booking`. |
| Git ignore | `.env`, mật khẩu/tài khoản local, cluster PostgreSQL và frontend build không được đưa vào Git. |

Luồng đã thao tác trong browser tại Blue Jay Quận 7:

1. Tạo booking 2 phòng (101/102), 2 khách, 1 đêm: tiền phòng **1.600.000 VND**.
2. Thu cọc **500.000 VND** rồi nhận phòng. Checkout bị khóa vì còn nợ.
3. Thêm 2 suất ăn sáng: **160.000 VND**, tổng booking **1.760.000 VND**.
4. Hoàn cọc **50.000 VND**, có lý do và lịch sử; còn phải thu **1.310.000 VND**.
5. Thu đủ phần còn lại, số dư **0**, checkout thành công. Cả hai phòng chuyển bẩn; đánh dấu dọn sạch và nhật ký ghi đúng người/thời gian.
6. Sổ tiền mặt có 3 dòng: +500.000 −50.000 +1.310.000 = **1.760.000 VND**; quỹ ngân hàng không lẫn các dòng tiền mặt.
7. Tải lại và chuyển sang khách sạn Đà Nẵng: không có booking này. Chuyển về Quận 7: booking đã trả phòng, tiền và lịch sử còn nguyên.
8. Lưu giá thử 850.000 từ màn hình giá, lưới ngày đọc đúng giá/tồn mới; khôi phục 800.000 sau kiểm thử. Giá booking cũ vẫn giữ.

Booking kiểm thử tên **Kiểm thử BE-01–05** vẫn lưu trong database local để đối chiếu. Đây là dữ liệu thử nghiệp vụ, không có chuyển tiền thực qua cổng thanh toán. Tài khoản browser kiểm thử tạm được vô hiệu hóa sau khi kiểm tra.

## Cách dùng local

- Khởi động backend: chạy `start_backend.bat` ở thư mục gốc.
- Khởi động frontend: từ `frontend`, chạy `npm run dev`.
- Mở `http://127.0.0.1:5173/id/login`.
- Tài khoản/mật khẩu local nằm trong `backend/.local-postgres/demo-users.json`, được Git ignore. Mật khẩu demo cũ không còn dùng. Chọn Owner để thử PMS; chọn Super Admin để quản lý khách sạn.
- Hướng dẫn database, migration và Coolify: [backend/README.md](../../../backend/README.md). Hợp đồng API: [backend/API_CONTRACT.md](../../../backend/API_CONTRACT.md).

## Phạm vi tiếp theo

BE-06 trở đi vẫn chưa hoàn tất: POS/hóa đơn đầy đủ; phiếu thu/chi/rút/chuyển quỹ độc lập; phân ca/giao việc buồng phòng; dashboard/báo cáo kế toán đầy đủ; kho; SaaS/billing và đúng **hai gói**; giá nâng cao/đa tiền tệ theo giao dịch; OTA/thông báo.

Thuế/phí hiện nhập thành các dòng cộng, chiết khấu thành dòng trừ; chưa tự tính chính sách thuế chưa chốt. Mỗi khách sạn có một tiền tệ cơ sở; màn hình tiền hiển thị đúng mã tiền tệ của dữ liệu, chưa có đổi ngoại tệ/tỷ giá. Các tính năng tương lai khóa thao tác lưu trên giao diện, không báo thành công giả.

Session và giới hạn đăng nhập hiện lưu PostgreSQL để có hiệu lực giữa nhiều worker. Redis/cache, JWT/mobile và xử lý thông báo nền trong thiết kế tổng thể là các phần mở rộng sau lõi này.

Dockerfile và hướng dẫn cấu hình production đã có, nhưng chưa build Docker hoặc kiểm chứng backend trên Coolify/Tunnel trong lần triển khai local này. Cần triển khai riêng, migration trên database host và kiểm tra `/api/ready` tại môi trường đó. Commit code không sao chép database hay DATABASE_URL local lên host.
