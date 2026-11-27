# LOHA PMS — bổ sung chức năng và phần còn lại

Ngày cập nhật: **14/10/2026**. Báo cáo đối chiếu code đang thay đổi với
[thiết kế hệ thống](../../../pms_system_design_final.md) và
[báo cáo ngày 10/10](../../bao-cao-chuc-nang-con-thieu-2026-10-10.md).
Đây là trạng thái triển khai và kiểm thử local; không xác nhận phiên bản trên
Coolify đã có các thay đổi này.

## 1. Đã bổ sung trong lượt này

| Chức năng | Vị trí sử dụng | Hành vi và giới hạn |
| --- | --- | --- |
| Hồ sơ khách sạn | Cài đặt → Thông tin doanh nghiệp | Lưu điện thoại/email, website, URL logo HTTPS, mã số thuế, ngân hàng, múi giờ và ngôn ngữ hồ sơ. Kiểm tra độ dài/email/URL; không tải ảnh lên và không tự dịch UI. Hồ sơ này tách với ghi chú khách hàng riêng của Manager. |
| Danh mục thu chi | Cài đặt → Kế toán & Thanh toán; Tài chính & thu chi | Tạo/sửa/bật/tắt danh mục thu hoặc chi; chọn danh mục khi ghi phiếu và lọc sổ quỹ. Phiếu giữ tên/loại danh mục cũ khi danh mục đổi tên hoặc bị tắt; đảo phiếu giữ liên kết lịch sử. Số dư quỹ hiện tại không bị biến thành số dư của riêng danh mục đang lọc. |
| Không đến (NO_SHOW) | Chi tiết đặt phòng | Chỉ từ booking đã xác nhận và tới ngày nhận phòng theo múi giờ khách sạn. Trả tồn phòng, hủy việc buồng phòng của booking đó, giữ nguyên tiền phòng/cọc/thu/hoàn và tình trạng vật lý của phòng. Trạng thái lưu trú kết thúc, không cho OTA ghi đè; không tự tính phí. |
| Sáu báo cáo chuyên sâu | Báo cáo → Nguồn, Phòng, Hạng phòng, Hủy, Quốc tịch, Giảm giá | Dữ liệu thật theo kỳ và quyền REPORTS_ADVANCED; tiền gốc hoặc tiền cơ sở theo tỷ giá đã lưu. Nguồn/phòng/hạng phòng dùng giá đêm; hủy dùng ngày hủy thật; quốc tịch dùng hồ sơ hiện tại; giảm giá dùng snapshot đang lưu. Có định nghĩa chỉ tiêu và CSV. |
| Đối soát và chi hoa hồng | Cài đặt → Kế toán & Thanh toán → Quản lý Hoa hồng | Chốt sau checkout trên tiền phòng sau giảm giá tiền phòng, loại dịch vụ/thuế/phí. Lưu tỷ lệ tại lúc tạo booking, cho xác nhận rõ tỷ lệ với booking cũ chưa có snapshot. Chi một phần/đủ bằng phiếu chi, kiểm số dư và tiền tệ; đảo phiếu phục hồi phần còn phải chi. SQL phân trang, tổng toàn kỳ và ngày chốt cố định. Có liên kết mở đúng phiếu trong sổ quỹ; giữ lịch sử sau đổi múi giờ. Theo yêu cầu mới, không đặt submenu Hoa hồng tại Tài chính & thu chi. |
| Hồ sơ và phiên đăng nhập Client | Hồ sơ cá nhân → Thông tin; Bảo mật | Sửa họ tên qua API, giữ email đăng nhập; xem phiên còn hạn và thu hồi các phiên khác, giữ phiên hiện tại. Đổi mật khẩu tiếp tục thu hồi phiên khác. Chưa có 2FA hoặc bản đồ thiết bị/IP. |
| Tự cập nhật dữ liệu giữa nhân viên | Workspace PMS | Đọc lại nền mỗi 30 giây hoặc khi quay lại cửa sổ. Dừng khi tab ẩn, đang ghi dữ liệu, mở hộp thoại hoặc sửa bản nháp; kiểm tra lại trước khi áp phản hồi chậm để tránh mất nội dung đang nhập. Lỗi đọc giữ dữ liệu gần nhất và hiện nút tải lại; không phải đồng bộ tức thời bằng websocket. |
| Phiếu booking và CSV | Chi tiết booking; danh sách booking; báo cáo; buồng phòng; nhật ký Manager | Mở phiếu nội bộ để xem/in bằng trình duyệt; dữ liệu HTML được escape. CSV dùng các dòng/bộ lọc đang hiển thị, UTF-8 và bảo vệ công thức bảng tính. Chưa có mẫu hóa đơn thuế, ký số hoặc xuất XLSX nhiều sheet. |
| Tự lập kế hoạch buồng phòng | Worker backend riêng | Dùng cùng bộ tạo việc với giao diện, ngày khách sạn, gói/quyền và khóa dữ liệu hiện có. Chạy lại không trùng; bắt booking mới trong ngày và không ghi nhật ký cho lần nền không có việc mới. Cần cấu hình tiến trình worker trên môi trường triển khai. |

### Hai quy tắc nghiệp vụ đã chốt

- **No-show chỉ ghi nhận trạng thái, không tự tính phí.** Nhân viên vẫn có thể
  thêm phí/thu/hoàn thủ công. Báo cáo tiền mặt ghi nhận các giao dịch này; báo cáo
  doanh thu hóa đơn và công nợ hiện chưa có quy tắc riêng cho phí no-show.
- **Hoa hồng tính trên tiền phòng sau giảm giá.** Giảm giá đã phân bổ vào giá đêm
  được tính trong cơ sở. Chiết khấu cả hóa đơn chưa biết phần thuộc tiền phòng,
  hoặc điều chỉnh sau checkout, được đánh dấu **Cần đối soát** và chặn chi tiếp.
  Hệ thống không tự đoán cách phân bổ hay sửa khoản hoa hồng đã chốt.

Chi tiết payload, quyền, bộ lọc và response tại
[API_CONTRACT.md](../../../backend/API_CONTRACT.md).

## 2. Triển khai cần làm trên môi trường đích

Các schema mới nối tiếp lịch sử hiện có:

| Migration | Nội dung |
| --- | --- |
| `0019_cash_categories` | Thêm snapshot danh mục thu/chi vào chứng từ; phiếu cũ vẫn chưa phân loại. |
| `0020_no_show` | Thêm thời điểm no-show và trạng thái NO_SHOW, giữ toàn bộ booking/tiền cũ. |
| `0021_booking_commissions` | Thêm bảng đối soát/chi hoa hồng có RLS và lịch sử chỉ thêm. Không tự chốt hoa hồng cho booking cũ. |

Trước khi mở phiên bản mới, áp dụng `python manage.py db upgrade` trong backend
với biến môi trường của đúng database đích, rồi kiểm tra `/api/ready`. Local và
Coolify là hai database riêng. Downgrade từ chối xóa lịch sử đã phát sinh;
không dùng rollback schema để bỏ dữ liệu nghiệp vụ.

Chạy worker buồng phòng riêng, cùng image/code và cấu hình database runtime:

```sh
python manage.py process-housekeeping-plans --actor-email manager@example.com --watch --interval 900
```

Thay email bằng tài khoản SYSTEM_MANAGER/SUPER_ADMIN đang hoạt động. Bỏ
`--watch` để chạy một lượt, hoặc thêm `--tenant <tenant_id>` để giới hạn khách sạn.
Đây là lệnh vận hành tin cậy để ghi nhật ký theo tài khoản có sẵn; không tạo tài
khoản hoặc dùng email thay cho cơ chế đăng nhập HTTP. Worker Channex vẫn chạy
riêng bằng `process-channel-jobs` như [README backend](../../../backend/README.md).

Trong lượt này **chưa áp migration lên database nghiệp vụ/Coolify, chưa triển khai
worker thật, chưa gửi tiền hoặc gọi Channex/nhà cung cấp ngoài**.

## 3. Phần thiết kế còn chưa hoàn thành

| Ưu tiên | Phần còn lại | Cần chốt hoặc kiểm chứng trước |
| --- | --- | --- |
| P1 | Night Audit/chốt ngày và ghi nhận doanh thu mỗi đêm | Phạm vi kiểm tra/chốt ngày hay tự thêm bút toán. Hiện doanh thu vẫn theo hóa đơn checkout; không tự chọn quy tắc tài chính khi chưa thống nhất. |
| P1 | Ngoại lệ lưu trú: chuyển phòng/đổi ngày khi đang ở, thuê giờ, FOC, bữa sáng và số người lớn/trẻ em/em bé | Quy tắc giá, sức chứa, tồn phòng, chính sách tiền và cách nhận OTA; booking nhiều phòng/nhiều khách đã có. |
| P1 | Chính sách khách sạn và đối soát điều chỉnh | VAT/phí dịch vụ mặc định, hủy/cọc/trẻ em/nhận sớm/trả muộn; phân bổ chiết khấu hóa đơn vào tiền phòng và cách sửa đối soát hoa hồng. Hiện ghi thuế/phí thủ công được, chưa có engine chính sách tự động đầy đủ. |
| P1 | Nghiệm thu Channex và vận hành thật | Property/room/rate thật, ARI, booking mới/sửa/hủy, webhook lặp/mất và ACK; worker, migration, backup/restore và tải. Có code không chứng minh môi trường đích đã hoạt động. |
| P2 | Thông báo theo lịch và kênh ngoài ứng dụng | Nhắc đến/đi/nợ/sắp hết phòng/tổng hợp/trial, email, digest và webhook thông báo gửi ra; chọn provider, người nhận và lịch. Thông báo in-app và webhook nhận OTA đã có. |
| P2 | SaaS tự phục vụ và thu tiền tự động | Đăng ký/khôi phục mật khẩu qua email, payment gateway, tự gia hạn, hóa đơn tự động và lịch sử mua gói trong tab Đơn hàng Client. Billing Manager thủ công đã có. |
| P2 | Bảo mật và vận hành mở rộng | 2FA, IP whitelist, xoay mật khẩu theo chính sách, ca buồng phòng qua đêm và lịch sử buồng phòng dài hạn phân trang. Không coi quyền/session/CSRF/RLS hiện có là chưa làm; danh sách hoa hồng đã phân trang ở database. |
| Phase 2 | Mobile/push, Zalo/SMS, API đối tác | Provider/credentials, API key và scopes, phạm vi nhận dữ liệu. Feature flag chưa tương đương chức năng tích hợp đã hoàn chỉnh. |

Đây là backlog còn mở, không phải cam kết mọi mục đều cần đưa vào MVP. Đặc biệt,
**Night Audit và tự động hóa tiền chưa được triển khai bằng cách đoán chính sách**.
Chỉ tiêu quốc tịch/công suất hiện còn giới hạn snapshot đã nêu trong hợp đồng API.

## 4. Kiểm chứng trong lượt này

Các nhóm kiểm thử đã chạy trên database PostgreSQL tạm riêng; không dùng
`pms_local` hoặc database production làm database test:

- Lượt tổng hợp cuối: **63 test PostgreSQL đạt**, gồm no-show, danh mục thu chi,
  báo cáo chuyên sâu/cơ bản/tài chính, catalog, worker buồng phòng và hoa hồng.
- Hoa hồng: **11 test tập trung đạt**; các tình huống gồm cơ sở sau giảm giá,
  tỷ lệ lịch sử/legacy, thanh toán một phần, idempotency, đảo phiếu, giới hạn
  tenant/quyền/tiền tệ, cạnh tranh ghi và rollback. Kiểm thử API/quyền frontend
  liên quan: **19 test đạt**. Ba trường hợp snapshot nguồn OTA và 40 test hồi quy
  thu chi/booking/Channex liên quan cũng đạt.
- Buồng phòng: **23 test liên quan đạt**, bao gồm worker, buồng phòng hiện có và
  no-show; có chạy lại đồng thời với tạo kế hoạch thủ công, múi giờ và quyền/gói.
- Backend không cần database: **24 test đạt**, gồm đăng ký route, khởi động và
  kiểm tra dữ liệu đầu vào. Fixture route bổ sung đúng ba API hoa hồng.
- Sau sửa lỗi cutoff ngày khi mở một chứng từ cụ thể: **29 test PostgreSQL đạt**
  cho danh mục thu chi, hoa hồng và thu chi hiện có. Phiếu giữ ngày đã ghi;
  đổi múi giờ không làm ẩn phiếu trong liên kết lịch sử. Bộ lọc ngày do người
  dùng chọn vẫn được áp dụng; sổ quỹ thông thường vẫn kết thúc ở hôm nay.
- Frontend: **116 test đạt**; production build đạt. Lint không có lỗi chặn,
  còn cảnh báo. Ruff trên các file backend thay đổi đạt.
- Browser dùng giao diện thật và API giả lập độc lập: thử lưu hồ sơ khách sạn,
  chuyển hai khách sạn, sửa tên/thu hồi phiên khác, báo cáo quốc tịch/CSV,
  tạo danh mục/phiếu chi, xác nhận no-show, chốt và chi một phần hoa hồng,
  mở đúng phiếu chi. Màn hình 320px/768px không tràn ngang toàn trang cho báo
  cáo và hoa hồng; không có lỗi console. Đã sửa lỗi hồ sơ trống lúc tải đầu.
  CSV tải về giữ tiếng Việt và số liệu đúng; không xác nhận popup in trong
  trình duyệt thật hoặc gửi lệnh in ra máy in.

Các nhóm trên có test giao nhau; **không cộng thành một tổng số test duy nhất**.
Kết quả này không thay thế nghiệm thu API thật trong browser, provider thật và cấu hình Coolify.
Phiếu in/CSV là chứng từ nội bộ và file dữ liệu, không phải hóa đơn điện tử.
