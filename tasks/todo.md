# Danh sách triển khai chức năng PMS

## Tiếp tục ngày 29/10/2026 — Full P1 nghiệp vụ

- [x] Hoàn thiện BIZ-01–07 theo [các lát triển khai và tiêu chí nghiệm thu](business-p1-implementation-2026-10-29.md). Backend 867/867, frontend 299/299; lint/build, migration và trình duyệt đạt. Xem [báo cáo và đề xuất](../docs/reports/reviews/full-p1-business-fixes-2026-10-29.md). Giữ lịch sử checklist cũ bên dưới.

Theo [plan.md](plan.md). Tất cả mục chưa đánh dấu là công việc còn lại. Mỗi nhóm BE được tách thành lát nhỏ; trước khi viết code, giới hạn phần thay đổi và chọn focused tests tương ứng, chia tiếp nếu lát đòi hỏi sửa nhiều phân hệ độc lập.

Cập nhật 14/10/2026: đã bổ sung no-show, hồ sơ khách sạn, danh mục thu chi,
hoa hồng, sáu báo cáo chuyên sâu, hồ sơ/phiên đăng nhập Client, CSV/phiếu booking,
cập nhật dữ liệu nền và worker buồng phòng. Phạm vi đã kiểm thử, migration/worker
cần vận hành và các chức năng còn mở tại [báo cáo hiện tại](../docs/reports/reviews/remaining-functions-2026-10-14.md).

## BE-01 — P0: Xác thực, người dùng và khách sạn

- [x] **01.1 Đăng nhập/session/logout thật.** Schema users/session, cấp tài khoản quản trị bằng công cụ nội bộ, API xác thực và nối Login hiện có. Hoàn thành: sai mật khẩu không tạo session; hết hạn/logout thu hồi truy cập; mật khẩu chỉ lưu hash. Kiểm chứng: API tests và login/logout trong browser. Phụ thuộc: backend nền tảng. Phạm vi dự kiến: models/migrations, auth API, auth tests, Login và API client.
- [x] **01.2 Tenant/membership và cách ly dữ liệu.** Admin tạo khách sạn/cấp owner; người dùng đổi khách sạn trong phạm vi membership. Hoàn thành: RLS đọc/ghi tenant A/B độc lập, không rò tenant qua pool; khách sạn bị khóa không nhận thao tác mới. Kiểm chứng: PostgreSQL tests và mở hai tài khoản/khách sạn. Phụ thuộc: 01.1. Phạm vi: tenant/membership models, migration/policies, tenant API, provider/selector và tests.
- [x] **01.3 Quyền và lịch sử thao tác.** Owner quản lý nhân viên, role và trạng thái; Admin/Manager dùng quyền global riêng. Hoàn thành: API kiểm tra role ở mọi thao tác đã có, không tự nâng quyền; ghi audit và frontend xử lý 401/403. Kiểm chứng: ma trận quyền API và URL trực tiếp. Phụ thuộc: 01.2. Phạm vi: authorization/audit, user API, user screens và tests.

## BE-02 — P0: Danh mục và cấu hình

- [x] **02.1 Hồ sơ, hạng phòng/phòng và giá cơ bản.** Lưu cấu hình khách sạn, timezone/currency và danh mục phòng từ Settings. Hoàn thành: đổi giá không sửa lịch sử booking; không xóa phòng có nghiệp vụ; tải lại giữ cấu hình. Kiểm chứng: CRUD API và Settings→Reservations. Phụ thuộc: 01.3. Phạm vi: catalog/settings models/API, migration, Settings/provider và tests.
- [x] **02.2 Nguồn booking, dịch vụ và phương thức thanh toán/quỹ.** Hoàn thành: các form dùng cùng danh mục tenant, mã đã có lịch sử được ngừng dùng thay vì xóa, tiền/quỹ có cấu hình rõ. Kiểm chứng: CRUD tests và kiểm tra danh mục giữa các form. Phụ thuộc: 02.1. Phạm vi: master APIs/models, Settings, POS/booking form adapters và tests.

### Checkpoint 1

- [x] Login, phân quyền, tenant A/B và Settings dùng PostgreSQL thật; kiểm thử/build giao diện liên quan đạt, giao diện Client được giữ.

## BE-03 — P0: Giá và phòng trống cơ bản

- [x] **03.1 Giá theo ngày và báo giá.** Hoàn thành: giá từng đêm đúng timezone/ngày, tổng không dùng float; khóa phòng/stop-sell không cho tạo booking mới. Kiểm chứng: boundary date/rate tests và màn hình ARI→BookingModal. Phụ thuộc: 02.1. Phạm vi: rate/availability API, ARI adapters và tests.
- [x] **03.2 Tồn phòng và khóa bán.** Hoàn thành: có trạng thái phòng bảo trì, tồn ngày không âm và dữ liệu phục vụ lịch/phòng nhất quán. Kiểm chứng: PostgreSQL và ARI/sơ đồ phòng. Phụ thuộc: 03.1; khi BE-04 ghi booking, bổ sung kiểm thử cập nhật tồn trong transaction. Phạm vi: inventory availability models/migration/API và UI adapters.

## BE-04 — P0: Khách hàng và booking

- [x] **04.1 Hồ sơ khách và chi tiết phòng trong booking.** Hoàn thành: hồ sơ khách độc lập, booking liên kết nhiều khách/phòng theo schema; dữ liệu có thể đọc lại bằng API. Kiểm chứng: API tests và Guests/tab Khách hàng. Phụ thuộc: 01.3, 02.1. Phạm vi: guest/reservation models/migration/API, Guests/detail UI.
- [x] **04.2 Tạo/sửa/hủy booking và lịch/sơ đồ.** Hoàn thành: snapshot giá, kiểm tra ngày/phòng ở server; hai yêu cầu đồng thời không đặt trùng; cập nhật tồn khi sửa/hủy. Kiểm chứng: concurrency tests PostgreSQL và Reservations/Tape Chart/Room Diagram. Phụ thuộc: 03.2, 04.1. Phạm vi: booking transactions/API và các UI đọc booking chung.
- [x] **04.3 Check-in và trạng thái phòng cơ bản.** Hoàn thành: chỉ check-in booking/ngày/phòng phù hợp; sạch/bẩn/bảo trì nhất quán và ghi audit. Kiểm chứng: state-transition tests và Housekeeping/booking. Phụ thuộc: 04.2. Phạm vi: lifecycle/room API và UI hiện có.

## BE-05 — P0: Dịch vụ, thanh toán và checkout

- [x] **05.1 Giá chi tiết/dịch vụ/ghi chú/lịch sử booking.** Hoàn thành: các tab đang trống dùng API thật, thêm dịch vụ cập nhật tổng đúng; các thay đổi có actor/thời gian. Kiểm chứng: booking detail API tests và các tab. Phụ thuộc: 02.2, 04.2. Phạm vi: booking charge/note/audit models/API, detail panel.
- [x] **05.2 Cọc, thanh toán từng phần và quỹ.** Hoàn thành: số dư booking và quỹ nhất quán trong transaction; gửi lại yêu cầu không ghi tiền hai lần; hoàn/hủy có đối ứng. Kiểm chứng: PostgreSQL tiền/idempotency/rollback và tab Thanh toán/Cashflow. Phụ thuộc: 05.1, 02.2. Phạm vi: payment/ledger migration/API và UI thanh toán/quỹ.
- [x] **05.3 Checkout và công nợ.** Hoàn thành: chính sách còn nợ được chốt/thực thi ở API; checkout chuyển phòng bẩn, giữ lịch sử lưu trú/doanh thu; không checkout hai lần. Kiểm chứng: lifecycle/balance tests và booking→Housekeeping. Phụ thuộc: 04.3, 05.2. Phạm vi: checkout policy/API và UI đối soát cuối booking.

### Checkpoint 2

- [x] Một booking đi hết tạo→cọc→check-in→dịch vụ→thanh toán→checkout trên PostgreSQL; số phòng và tiền đúng, không còn phụ thuộc dữ liệu demo cho luồng này.

## BE-06 — P1: POS và thu chi đầy đủ

- [x] **06.1 POS dùng chung sổ giao dịch.** Hoàn thành: lưu nháp/hóa đơn, thanh toán bán lẻ hoặc ghi vào booking, tìm lại hóa đơn. Kiểm chứng: invoice/payment API và thao tác POS. Phụ thuộc: 05.2. Phạm vi: POS schema/API và Sales.
- [x] **06.2 Phiếu thu/chi/rút và đối soát quỹ.** Hoàn thành: lọc theo kỳ/quỹ/nhân viên, số dư đầu-cuối khớp sổ, hoàn/hủy không xóa lịch sử tiền. Kiểm chứng: ledger totals và Cashflow/cash-bank UI. Phụ thuộc: 06.1. Phạm vi: cashbook API và Cashflow.

## BE-07 — P1: Buồng phòng đầy đủ

- [x] **07.1 Nhân viên, phân ca/giao việc và kế hoạch dọn.** Hoàn thành: nhiệm vụ theo check-in/check-out/stay-over, trạng thái đang kiểm tra/hỏng và lịch sử; chỉ nhân viên đúng quyền cập nhật. Kiểm chứng: assignment/role tests và Housekeeping. Phụ thuộc: 05.3. Phạm vi: housekeeping models/API và các trang liên quan.

Kiểm chứng BE-06/07 ngày 04/10/2026: 102 tests backend PostgreSQL và 29 tests frontend đạt; kiểm thử browser bằng database riêng. Chi tiết chức năng, migration và giới hạn: [BE06_07_IMPLEMENTATION_REPORT.md](../docs/reports/backend/BE06_07_IMPLEMENTATION_REPORT.md).

## BE-08 — P1: Dashboard và báo cáo

- [x] **08.1 Chỉ số vận hành và báo cáo tiền cơ bản.** Hoàn thành: khách đến/đi/ở, công suất/ADR, doanh thu/thực thu/cọc/nợ có định nghĩa riêng và cùng nguồn ledger/booking; lọc theo kỳ/tenant. Kiểm chứng: bộ số liệu đối soát đã biết và Dashboard/Reports. Phụ thuộc: 05.3, 06.2. Phạm vi: aggregation/report API và UI báo cáo.

### Checkpoint 3

- [ ] POS, booking, sổ quỹ, buồng phòng và báo cáo có số liệu khớp; không còn bảng giao dịch mẫu trong các luồng đã nối API.

## BE-09 — P1: Quản trị SaaS và gói dịch vụ

- [x] **09.1 Gói, feature access và giới hạn.** FREE/PRO là mặc định; Super Admin tạo thêm gói và marketing đọc cùng giá/tính năng qua API. Mỗi thuê bao có số phòng đăng ký hữu hạn; Admin bật/tắt tính năng/khóa tenant tác động tới API. Kiểm chứng: subscription/permission/quota tests và Admin→Client. Phụ thuộc: 01.3, 04.2. Phạm vi: plans/entitlements models/API và Billing/Features/access adapters.
- [x] **09.2 Gia hạn và lịch sử SaaS.** Hoàn thành: lưu thay đổi gói/gia hạn, hiển thị hạn và trạng thái; tích hợp thu tiền tự động chỉ khi nhà cung cấp được chọn. Kiểm chứng: expiry/renewal tests và Billing. Phụ thuộc: 09.1. Phạm vi: subscription API và quản trị Billing.

## BE-10 — P1: Kho

- [ ] **10.1 Tồn đầu kỳ, nhập/xuất/chuyển/kiểm kê.** Chia tiếp theo từng loại phiếu khi triển khai. Hoàn thành: mỗi phiếu có lịch sử biến động, chuyển kho cân hai đầu, chốt kiểm kê không sửa lịch sử; báo cáo tồn khớp. Kiểm chứng: stock transaction/concurrency tests và các trang kho. Phụ thuộc: 01.3, 02.2; liên kết tiêu hao POS khi 06.1 hoàn thành. Phạm vi: inventory models/API và warehouse UI.

## BE-11 — P2: Giá nâng cao

- [ ] **11.1 Cuối tuần/LOS, voucher/khuyến mãi và đa tiền tệ.** Chia từng chính sách giá thành lát riêng. Hoàn thành: ưu tiên/điều kiện áp dụng rõ, snapshot giá/tỷ giá bảo toàn; tổng tiền booking cũ không bị tính lại từ giá hiện hành. Kiểm chứng: pricing rule tests và booking/rate UI. Phụ thuộc: 03.1, 05.2, 09.1. Phạm vi: pricing policies và giao diện cấu hình/tính giá.

Code BE-10/11 và các màn hình API đã triển khai. Kiểm chứng ngày 07/10/2026:
216/216 tests backend PostgreSQL, 34/34 tests frontend và lint/build frontend
đạt. Browser đã thử kho/mặt hàng, tồn đầu kỳ/báo cáo và giá cuối tuần→booking;
hai mục tổng thể còn mở cho nghiệm thu đầy đủ; không coi deploy
hoặc checkpoint vận hành đã hoàn tất. Xem [checklist từng lát](be10-be11.md)
và [báo cáo BE-10/11](../docs/reports/backend/BE10_11_IMPLEMENTATION_REPORT.md).

## BE-12 — P2: Tích hợp và mở rộng

- [ ] **12.1 OTA, thông báo và mở rộng báo cáo/API/mobile.** Tách thành kế hoạch riêng theo từng tích hợp khi chọn nhà cung cấp. Hoàn thành: webhook có xác thực/idempotency, đồng bộ không bán vượt tồn; thông báo tôn trọng cấu hình tenant và trạng thái thực. Kiểm chứng: sandbox/provider tests và các luồng thực tương ứng. Phụ thuộc: lõi booking/tiền ổn định và nhà cung cấp/phạm vi được chọn. Phạm vi: adapter/tích hợp và UI liên quan.

Đã triển khai connector Channex, mapping tenant, hàng đợi/worker ARI và booking
revisions, webhook/ACK, thông báo trong ứng dụng và các màn hình API tương ứng.
Kiểm thử provider giả lập/PostgreSQL đạt; browser đã thử cấu hình staging tắt,
mapping giả và thông báo. Mục 12.1 còn mở cho Channex sandbox thật, Email/mobile,
API đối tác và phạm vi báo cáo mở rộng. Xem [checklist BE-12](be12.md) và
[báo cáo BE-12](../docs/reports/backend/BE12_IMPLEMENTATION_REPORT.md); chưa deploy hoặc gọi OTA thật
trong nghiệm thu này.

## Checkpoint trước sử dụng thật

- [ ] Kiểm tra RLS/quyền với hai tenant, cạnh tranh đặt phòng/ghi tiền, hai gói/giới hạn, migration và backup/restore trên môi trường riêng; cấu hình và kiểm tra Coolify thực tế theo backend/README.md. Chỉ thực hiện deploy khi được yêu cầu trong nhiệm vụ triển khai.
