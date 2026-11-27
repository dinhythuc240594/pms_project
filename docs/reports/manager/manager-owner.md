# Manager / Owner — triển khai ngày 09/10/2026

Phạm vi: nối các trang tài khoản/tính năng Manager với PostgreSQL thật; bổ sung
nhật ký và màn hình xem tính năng của Owner. Giữ giao diện LOHA và hai gói FREE/PRO.

- [x] API tài khoản nội bộ: chỉ Super Admin tạo/sửa tên, vai trò và trạng thái;
  không tự khóa/hạ quyền, không trả mật khẩu, thu hồi phiên khi khóa/đổi quyền.
- [x] API tính năng: Super Admin bật/tắt toàn hệ thống; hai vai trò hệ thống
  cấp/thu hồi tính năng riêng hoặc dùng thử có hạn cho khách sạn.
- [x] Nhật ký riêng từng khách sạn: Owner lọc theo sự kiện/người thực hiện/khoảng
  thời gian và phân trang; không đổi tenant bằng bộ lọc.
- [x] Owner được đọc tính năng hiệu lực và thông tin cấp riêng hiện tại, không tự cấp quyền.
- [x] Màn hình Manager Users/Features và Owner dùng API thật, trạng thái tải/lỗi
  rõ ràng; không còn khóa xem trước ở các trang đã nối.
- [x] Regression PostgreSQL: phân quyền/CSRF, phiên bị thu hồi, Owner cuối cùng,
  RLS hai khách sạn, hiệu lực/hết hạn/global disable của tính năng.
- [x] Frontend tests, lint, production build và browser trên dữ liệu kiểm thử riêng.

Migration bổ sung `0012_manager_features` sau `0011_notifications`. Nó chỉ thêm
hai bảng quản trị tính năng và chính sách FORCE RLS; không sửa dữ liệu booking/tiền.
Downgrade từ chối xóa nếu bảng đã có cấu hình/cấp quyền. Khi triển khai, chạy
`python manage.py db upgrade` trong backend bằng cấu hình môi trường đích rồi kiểm
tra `/api/ready`. PostgreSQL local và Coolify tiếp tục dùng URL riêng.

Tính năng được bật vẫn chịu quyền vai trò, trạng thái thuê bao và khóa khách sạn.
Global disable thắng cấp riêng; dùng thử không vượt qua thuê bao hết hạn. Luồng này
không bổ sung 2FA, đổi mật khẩu hộ nhân viên hay thu tiền thuê bao tự động.
Không deploy production hoặc gửi thông báo ra ngoài trong nghiệm thu.

Hợp đồng chi tiết: [API_CONTRACT.md](../../../backend/API_CONTRACT.md).

Nghiệm thu: 235 tests backend toàn bộ đạt; sau đó thêm và chạy đạt regression
migration (13 tests module tính năng). 42 tests frontend đạt; Vite build đạt;
Ruff check/format đạt. Oxlint không có lỗi, còn các cảnh báo lint của dự án và
cảnh báo khởi tạo state trong effect tải cấu hình tính năng. Suite backend có
ResourceWarning đóng connection ở fixture cuối tiến trình, không có test lỗi.

Browser dùng database PostgreSQL UUID riêng: Super Admin sửa tên Manager và tải
lại vẫn còn; cấu hình POS riêng tại Hotel a hiện đúng trên Owner và chặn URL POS;
Owner sửa vai trò, lọc nhật ký theo sự kiện/người thực hiện; System Manager không
được đổi Global hoặc mở Manager Users, nhưng gỡ được ngoại lệ. Trang Owner mới
không có console error/warning trong phiên kiểm tra sạch. Đã kiểm tra giao diện
ở panel hẹp và cửa sổ desktop, giữ màu/bố cục LOHA. Các API tạo tài khoản và dùng
thử có hạn được kiểm chứng qua tests PostgreSQL và kiểm tra payload frontend.

Chưa áp dụng migration vào database nghiệp vụ local/Coolify; chưa kiểm tra tải
lớn hoặc production. Cần migrate môi trường đích trước khi dùng chức năng mới.
