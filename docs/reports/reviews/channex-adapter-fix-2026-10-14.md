# Sửa lỗi tải cấu hình kênh OTA — 14/10/2026

## Bằng chứng

- Console production: GET `channel-adapters` trả 502 và thiếu header CORS, làm
  frontend hiện “Failed to fetch”.
- Runtime Logs: endpoint này trả 502 với body 233 byte; cùng nguồn khách sạn,
  endpoint properties/catalog/channels vẫn trả 200. Backend đã nhận request.
- Body 233 byte khớp JSON `provider_invalid_response` hiện tại. Đây là suy luận
  từ log; chưa đọc được payload Channex thực hoặc response có xác thực production.
- Tái hiện độc lập: một descriptor OTA không được hỗ trợ trong danh sách khiến
  toàn bộ GET trả 502, kể cả khi Booking.com có descriptor hợp lệ.

## Thay đổi

- Kiểm tra từng OTA riêng: kênh hợp lệ giữ nguyên, kênh chưa hỗ trợ trả riêng
  `unavailableAdapters` chỉ gồm mã/tên công khai. UI hiện rõ và khóa lựa chọn.
- Danh mục giữ các descriptor `ota` và `meta`; Channex phân loại Booking.com,
  Agoda và Expedia là `meta`. Descriptor CM không dùng trong màn hình này nên
  bỏ qua trường cấu hình. Mã/tên sai và mã trùng vẫn bị từ chối.
- Probe/tạo/sửa vẫn kiểm tra đầy đủ descriptor; không đoán trường cấu hình,
  không tạo kết nối bằng descriptor không được hỗ trợ, không trả secret/default.
- Lỗi fetch trên các màn hình Channex dùng thông báo tiếng Việt đã có của hệ
  thống. Không tự gửi lại thao tác tạo/sửa/kích hoạt.
- Backend ghi cảnh báo `Unsupported Channex OTA descriptor: <code>` để xác định
  kênh cần bổ sung hỗ trợ, không ghi body provider hoặc khóa API.

## Kiểm chứng

- Trước sửa: hai test danh mục hỗn hợp/toàn bộ OTA chưa hỗ trợ tái hiện 502.
- Sau sửa: 40 test PostgreSQL đạt (23 channel và 17 remote), gồm khóa mã hóa
  theo khách sạn, quyền, secret và CORS cho 200/401/502/503. Origin lạ không
  nhận CORS; descriptor không hỗ trợ không thể probe/tạo kết nối.
- 116 test frontend đạt; production build và Ruff đạt. Lint frontend không có
  lỗi chặn, còn cảnh báo hiện có.
- Browser dùng UI thật/dữ liệu giả lập: lỗi mạng có thông báo tiếng Việt;
  thử lại mở dropdown; Booking.com hiện trường Hotel ID; OTA chưa hỗ trợ bị
  khóa lựa chọn. Không có lỗi console; không gửi dữ liệu tới Channex.

## Áp dụng trên Coolify

Deploy backend và frontend cùng bản sửa. Không có migration mới trong sửa lỗi
này. Kiểm tra backend Runtime Environment Variable:

```text
CORS_ORIGINS=https://pms.xloc.id.vn
```

Nếu có origin khác được phép, giữ chúng trong danh sách ngăn cách bằng dấu phẩy.
Đặt ở runtime và restart/redeploy backend khi đổi. Không dùng `*` với cookie và
không tắt kiểm tra CORS/CSRF. Frontend vẫn dùng API gốc
`https://pms-api.xloc.id.vn`.

CORS đã được kiểm thử với lỗi backend; chưa xác nhận runtime/proxy production
đang giữ header này. Sau deploy, tải lại trang và kiểm tra GET trả 200. Nếu một
kênh bị khóa, xem cảnh báo descriptor trong Runtime Logs để xác định đúng mã;
không nhập lại khóa API chỉ vì thấy lỗi danh mục.

Đối chiếu giao thức: [Channex Channel API](https://docs.channex.io/api-v.1-documentation/channel-api).
Chưa deploy, chưa thay cấu hình Coolify/Cloudflare, chưa tạo kết nối OTA thật.

## Bổ sung ngày 15/10/2026 — kênh phổ biến bị lọc nhầm

Backend và form thêm kênh đều từng chỉ giữ `kind: ota`, nên bỏ qua các kênh
Channex trả về với `kind: meta`. Tài liệu adapter chính thức của
[Booking.com](https://docs.channex.io/channel-api-examples/booking.com),
[Agoda](https://docs.channex.io/channel-api-examples/agoda) và
[Expedia](https://docs.channex.io/channel-api-examples/expedia) xác nhận cách phân
loại này. Danh sách nay lấy cả hai loại từ provider, giữ kiểm tra schema và
không thêm mã kênh cố định hoặc đoán trường kết nối.

Ba test tái hiện trước sửa: hai endpoint Manager/khách sạn chỉ trả Airbnb thay
vì Booking.com, Agoda, Expedia và Airbnb; catalog hỗn hợp cũng bỏ qua meta chưa
hỗ trợ thay vì báo riêng. Test dùng PostgreSQL QA và provider giả, không tạo
kết nối OTA thật.

Sau sửa, 34/34 test backend trong `test_channex_channels` và
`test_tenant_remote_channels` đạt; gồm đọc/tạo/sửa/probe/vòng đời kênh,
phân quyền, tenant, CORS, che secrets và descriptor chưa hỗ trợ. Ruff và kiểm
tra định dạng ba file Python đạt. Chưa xác nhận danh mục tài khoản Channex thật.

Frontend: 127/127 test, lint và build đạt (lint còn cảnh báo có sẵn).
Kiểm tra component ChannelForm thật trên trình duyệt với descriptor giả lập:
trước sửa chỉ thấy Airbnb/Hopper Homes; sau sửa chọn được Booking.com, Agoda
và Expedia, hiện đúng form Hotel ID. Airbnb vẫn mở luồng OAuth; CM không có
trong danh sách, kênh chưa hỗ trợ vẫn bị khóa và console không có lỗi.
Không thử tạo/kích hoạt kênh hoặc gửi thông tin tới Channex trong kiểm tra UI.
