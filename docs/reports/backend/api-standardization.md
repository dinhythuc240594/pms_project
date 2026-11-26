# Chuẩn hóa API trên main

Ngày: 10/10/2026. Áp dụng nền common tham khảo từ BE-PMS lên mã main hiện tại;
không nhập các handler cũ hoặc lỗi tích hợp của BE-PMS.

## Thay đổi

- `common/`: `CommonMethodView`, `CommonURL`, `RequestData`, `ApiError`,
  `ValueFormatter`, giữ lớp nhỏ và không phụ thuộc vào app/database.
- API nghiệp vụ, quản trị và health dùng class view. Các module có URL metadata
  riêng, đăng ký lazy theo chuỗi `module:ViewClass`, giữ tên endpoint và methods.
- Đã chuyển cả tài khoản hệ thống, tính năng, hồ sơ khách hàng, phiên đăng nhập
  và hóa đơn SaaS của Manager hiện có trên main.
- Registry nạp đủ model trước khi đăng ký migration; model thông báo tách khỏi
  handler. CLI nạp helper HTTP khi lệnh cần dùng; Docker image có `common/`.
- Bảo toàn decorator quyền và `tenant_id`, kiểm tra dữ liệu, CSRF/RLS, khóa tiền,
  idempotency, transaction và các helper đang được gọi từ module khác.

## Kiểm chứng

- Snapshot trước sửa có 117 URL rules: đường dẫn, endpoint và HTTP methods đều
  khớp sau chuyển đổi.
- Đối chiếu AST: giữ nguyên body, tham số và decorator quyền của handler;
  wrapper định dạng booking/housekeeping chỉ gọi helper common tương đương.
- Kiểm thử common: JSON object/lỗi, GET/POST/HEAD/OPTIONS, đăng ký nhiều methods,
  xung đột endpoint, app độc lập và tham số decorator quyền.
- Kiểm thử lazy: chỉ import handler được gọi, cache, retry import thất bại,
  request đầu đồng thời, 404/405/OPTIONS không import handler.
- Kiểm thử startup trong tiến trình mới: đủ metadata gồm bảng Manager, liveness
  không cần database, tạo nhiều app sau khi import health/thông báo vẫn hoạt động.
- Toàn bộ 272 kiểm thử backend đạt trên PostgreSQL tạm riêng, không bỏ qua test.
  Ruff check đạt; 123 file Python qua kiểm tra định dạng; diff không có lỗi whitespace.
- Rà soát độc lập: giữ 59 bảng như main trước sửa, mapper/FK biên dịch được,
  các lệnh CLI vẫn hoạt động, import lần đầu và tạo lại app với 15 module handler đạt.
- Không thay đổi file frontend hoặc migration. Chưa build image Docker tại local.

## Triển khai

Không thay đổi schema hoặc dependency trong lần chuẩn hóa này; không có migration
mới. Build lại image backend để đưa `common/` và các module URL mới lên Coolify.
Các migration chức năng đã có trước đó vẫn cần được áp dụng theo trạng thái của
database môi trường triển khai. Frontend giữ nguyên hợp đồng API.

Chưa commit/push/deploy hoặc chạy migration trên database kinh doanh/Coolify.
Đã xóa database kiểm thử có mã riêng và trả PostgreSQL thử nghiệm về trạng thái
trước khi chạy. Các thay đổi nằm trong cây làm việc trên nhánh main.
