# Báo cáo đối chiếu dự án PMS với thiết kế cuối cùng

Ngày rà soát: **02/10/2026**.

**Cập nhật sau rà soát:** đã triển khai FE-01 và FE-02 P0 ở chế độ frontend demo: tenant store/danh mục dùng chung, session/RBAC, feature gating, Trial/quota và kết nối Admin–Client. Hướng dẫn và giới hạn tại `frontend/DEMO.md` (tài liệu demo cũ đã được gỡ). Các mô tả hiện trạng bên dưới ghi nhận thời điểm trước khi triển khai; các mục P1/P2 vẫn là công việc tiếp theo.

Tài liệu chuẩn: [pms_system_design_final.md](C:/Users/Laptop/Documents/GitHub/pms-system/pms_system_design_final.md).

## 1. Kết luận

**Dự án đã có khung giao diện rộng và một luồng đặt phòng demo liên thông, nhưng chưa hoàn thành nghiệp vụ frontend theo toàn bộ thiết kế.** Khoảng thiếu lớn nhất là dữ liệu dùng chung giữa các phân hệ, thanh toán/dịch vụ, cấu hình khách sạn, phân quyền/gói dịch vụ, thông báo và bộ báo cáo.

Đánh giá theo hướng hiện tại của dự án: **hoàn thiện frontend trước, backend sau**. Một tính năng chưa gọi API không tự động được coi là lỗi ở giai đoạn này; tuy nhiên, frontend cần chạy trọn luồng bằng dữ liệu demo thống nhất và chuẩn bị cấu trúc tương thích API. Báo cáo phân biệt rõ màn hình đã có với chức năng thực sự hoạt động.

Phạm vi kiểm tra: dùng graphify để tìm quan hệ tài liệu–mã nguồn, sau đó đọc trực tiếp routing, shared store, các trang PMS, backoffice và backend. Không sửa giao diện hoặc nghiệp vụ ứng dụng trong lần rà soát này.

### Những phần đã làm được

- Tạo, tìm kiếm, lọc, sửa và hủy booking trong demo; kiểm tra ngày và tránh trùng phòng trong khoảng `[check_in, check_out)`.
- Check-in có kiểm tra ngày lưu trú, phòng sạch và phòng đang có khách; check-out chuyển phòng thành bẩn.
- Booking được dùng chung bởi danh sách, Tape Chart, sơ đồ phòng, buồng phòng, bốn chỉ số phòng trên dashboard và báo cáo demo.
- Đổi trạng thái sạch/bẩn có cập nhật chung và ghi lịch sử buồng phòng.
- Phiếu nhập kho có thêm/xóa mặt hàng, tính tổng, kiểm tra dữ liệu và lưu danh sách.
- Backoffice đã có các màn hình tenants, billing, features, users, logs và dashboard; một số thao tác đã cập nhật state cục bộ.
- Dữ liệu PMS demo có lưu localStorage và cảnh báo nếu không lưu được.

Nguồn: [PmsProvider.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/data/PmsProvider.jsx:4), [model.js](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/data/model.js:8), `frontend/DEMO.md` (tài liệu demo cũ đã được gỡ).

## 2. Đối chiếu các phân hệ

“Demo liên thông” nghĩa là có xử lý trong shared store, chưa phải nghiệp vụ chạy trên backend. “Một phần” có thể gồm cả thao tác cục bộ và màn hình minh họa.

| Phân hệ trong thiết kế | Hiện trạng | Phần còn thiếu chính |
|---|---|---|
| Dashboard | Một phần; bốn chỉ số phòng lấy từ booking | Doanh thu ngày, biểu đồ, tác vụ và danh sách bên dưới còn minh họa; bộ lọc thời gian chưa điều khiển số liệu |
| Tape Chart / sơ đồ phòng | Demo liên thông | Đóng/mở bán theo ngày, phòng hỏng/đang kiểm tra và đồng bộ với ARI giá–tồn phòng; cập nhật giữa các máy cần backend |
| Reservations / khách lưu trú | Demo liên thông ở luồng cơ bản | Hồ sơ khách độc lập, nhiều khách/nhiều phòng theo mô hình thiết kế, dịch vụ, giá chi tiết, thanh toán, ghi chú và lịch sử booking |
| POS | Giỏ hàng hoạt động cục bộ | Lưu hóa đơn, thanh toán, giao dịch bán dịch vụ và liên kết booking/sổ quỹ/báo cáo |
| Cashflow / Bank | Màn hình và dữ liệu mẫu | Tạo thu/chi, tiền cọc, giao dịch ngân hàng/thẻ, số dư và lịch sử đối soát |
| ARI / giá | Một phần; MatrixRate sửa được giá trong state của trang | Giá được lưu dùng chung, giá cuối tuần/LOS, giá ngày, stop-sell/open và áp dụng giá khi tạo booking |
| Voucher / Promotion | Có file giao diện, route/menu đang bị ẩn | CRUD, hiệu lực, điều kiện áp dụng và tính tiền; cần chốt lại phạm vi vì tài liệu vẫn yêu cầu |
| Housekeeping | Sạch/bẩn liên thông | Đang kiểm tra/hỏng, quản lý nhân viên/ca, giao việc và tự sinh kế hoạch check-in/check-out/stay-over |
| Inventory | Nhập kho lưu được phiếu; các trang khác một phần | Xuất/chuyển/kiểm kê được lưu, tồn thực tế theo kho, số dư đầu kỳ và báo cáo tồn |
| Reports | Hai chế độ báo cáo demo: tiền phòng dự kiến và công suất đặt phòng | Phần lớn báo cáo kinh doanh, dòng tiền, dịch vụ và kho; chưa có dữ liệu tài chính thật để đối soát |
| Settings | Nhiều màn hình đã có, phần lớn chưa lưu | Hồ sơ đầy đủ, cấu hình nghiệp vụ dùng chung, danh mục thu chi, phân quyền, tồn đầu kỳ và thông báo |
| Người dùng / auth / trial | Giao diện minh họa | Session, tenant context, quyền thao tác, menu khóa theo gói, quota và trạng thái hết hạn |
| Internal Admin | Khung UI rộng, có nhiều thao tác state cục bộ | Store chung giữa tenants–features–billing–users, tác động xuống Client App, audit thực và tách ứng dụng theo thiết kế |

## 3. Các việc frontend nên ưu tiên

Mức ưu tiên trong báo cáo:

- **P0:** Nền tảng cần chốt trước khi nối backend, tránh nhầm khách sạn hoặc số liệu tiền/phòng.
- **P1:** Luồng quan trọng để frontend đạt phạm vi nghiệp vụ đã thiết kế.
- **P2:** Làm sau các luồng lõi. P2 ở đây là thứ tự triển khai, **không đồng nghĩa với Phase 2** của tài liệu.

### FE-01 — P0: Dữ liệu khách sạn và cấu hình chưa thống nhất

Bộ chọn khách sạn trong sidebar chỉ đổi `activeHotel` tại component. PMS vẫn dùng một key `bluejay-pms-demo-v1`, không có tenant context. Giá/hạng phòng trong `model.js`, danh mục POS, kho và Settings là các bộ dữ liệu riêng. Vì vậy thay đổi cấu hình hoặc đổi tên khách sạn trên UI chưa làm thay đổi đúng dữ liệu nghiệp vụ.

Cần làm: store demo theo `tenantId`; các danh mục phòng, giá, nguồn booking, dịch vụ, kho, mặt hàng và thanh toán dùng chung; giữ nguyên bố cục giao diện đang có.

Tiêu chí hoàn thành: booking tạo ở khách sạn A không xuất hiện ở B; sửa danh mục trong Settings được phản ánh ở các form liên quan; tải lại vẫn giữ dữ liệu đúng khách sạn.

Nguồn: [Sidebar.jsx](../../../frontend/src/apps/pms/components/Sidebar.jsx:66), [PmsProvider.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/data/PmsProvider.jsx:4), [model.js](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/data/model.js:6).

### FE-02 — P0: Thiếu quyền truy cập và luồng gói dịch vụ phía client

Login hiện chỉ chuyển tới dashboard. Các route PMS và `/manager` không có guard xác thực/quyền. Backoffice dùng role mock trong localStorage; sidebar ẩn một số mục theo role nhưng truy cập URL không được bảo vệ bởi routing. Chưa có luồng trial 14 ngày, quota 10 booking, feature bị khóa nhưng vẫn hiển thị và popup nâng cấp như Phần 8.

Cần làm ở frontend: mock session, tenant membership, ma trận role/action, feature access, route guard, trạng thái 401/403/hết hạn và popup nâng cấp. Backend phải kiểm tra lại toàn bộ quyền khi triển khai; guard frontend chỉ phục vụ UX.

Tiêu chí hoàn thành: tài khoản Housekeeping chỉ thao tác được phần được cấp; mở URL trực tiếp vẫn được kiểm tra quyền; thay feature của tenant trong Admin làm thay đổi menu/truy cập ở Client App; hết quota không tạo thêm booking.

Nguồn: [Login.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/auth/pages/Login.jsx:12), [App.jsx](../../../frontend/src/app/App.jsx:99), [ManagerLayout.jsx](../../../frontend/src/apps/manager/layouts/ManagerLayout.jsx:19). Yêu cầu: thiết kế Phần 5 và Phần 8.

### FE-03 — P1: Booking còn sáu tab placeholder và chưa có sổ thanh toán

Chi tiết booking có bảy tab, nhưng chỉ tab Chi tiết có nội dung xử lý; sáu tab Khách hàng/Dịch vụ/Giá phòng/Thanh toán/Ghi chú/Lịch sử đang hiện câu “Nội dung … sẽ hiển thị ở đây”. Một số trường thông tin khách đã sửa được trong tab Chi tiết, nhưng chưa có hồ sơ khách và lịch sử lưu trú riêng. Số dư ở đầu panel cố định `0 ₫`.

Tổng tiền hiện bằng giá cố định hạng phòng × số đêm. Chưa có giá từng đêm, dịch vụ, thuế/phí, tiền cọc, thanh toán từng phần hoặc công nợ. Mô hình booking chỉ giữ một phòng và tên khách, chưa tương thích đầy đủ `guests`/`reservation_rooms` của thiết kế.

Cần làm: hoàn thiện các tab trên dữ liệu chung; bổ sung hồ sơ khách, chi tiết phòng/giá, dịch vụ, giao dịch tiền và lịch sử thao tác. Chốt mô hình booking nhiều phòng trước khi nối API.

Tiêu chí hoàn thành: thêm dịch vụ và nhận cọc làm thay đổi tổng phải trả/số dư; lịch sử thể hiện người thao tác và thời điểm; dữ liệu khách/booking không bị lệch giữa các trang.

Nguồn: [BookingDetailPanel.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:52), [placeholder các tab](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:188), [cách tính tiền hiện tại](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/data/PmsProvider.jsx:18).

### FE-04 — P1: POS và thu chi chưa ghi nhận giao dịch

POS có thêm/xóa sản phẩm và thay số lượng, nhưng các nút Thanh toán/Lưu nháp/Lưu hóa đơn chưa có handler xử lý. Danh sách hóa đơn là dữ liệu mẫu. Cashflow có chuyển tab quỹ tiền mặt/ngân hàng, nhưng nút Thu Tiền/Chi Tiền chưa tạo phiếu.

Cần làm: lưu hóa đơn và phiếu thu/chi trong store chung; phân biệt dịch vụ bán lẻ với dịch vụ ghi vào booking; chọn phương thức thanh toán và cập nhật quỹ. Hủy/hoàn tiền cần có quy tắc rõ, không chỉ xóa giao dịch khỏi danh sách.

Tiêu chí hoàn thành: lưu POS làm xuất hiện hóa đơn; thanh toán tiền mặt cập nhật đúng quỹ; ghi dịch vụ vào phòng cập nhật booking; báo cáo lấy từ cùng nguồn giao dịch.

Nguồn: [Sales.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/finance/pages/Sales.jsx:283), [Cashflow.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/finance/pages/Cashflow.jsx:104).

### FE-05 — P1: Giá và tồn phòng chưa liên kết với booking

MatrixRate có xử lý đổi giá hàng loạt nhưng chỉ cập nhật state của trang; số tồn phòng là mảng mẫu. Nút xuất Excel chỉ hiện thông báo thành công. Giá tạo booking vẫn lấy từ `model.js`, nên giá thay đổi trên lưới chưa tác động đến booking.

Cần làm: mô hình giá theo hạng phòng/gói giá/ngày, rule cuối tuần/LOS, đóng/mở bán; tách tồn phòng tính từ booking với số phòng bị khóa; lưu cấu hình và dùng khi báo giá booking. Tỷ giá phải được chốt cùng booking nếu triển khai đa tiền tệ.

Tiêu chí hoàn thành: thay giá ngày cụ thể làm thay đổi báo giá đúng đêm đó; stop-sell chặn tạo booking tương ứng; hủy/sửa booking cập nhật tồn phòng đúng; xuất file phải tạo được file thực.

Nguồn: [MatrixRate.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/rates-inventory/pages/MatrixRate.jsx:15), [xử lý đổi giá cục bộ](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/rates-inventory/pages/MatrixRate.jsx:86), [xuất Excel hiện tại](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/rates-inventory/pages/MatrixRate.jsx:204).

### FE-06 — P1: Settings còn nhiều phần chưa lưu hoặc thiếu hẳn

| Nhóm yêu cầu | Khoảng thiếu đã xác minh |
|---|---|
| Hồ sơ khách sạn | Form hiện có tên, tiền tệ cơ sở và địa chỉ; thiếu logo, liên hệ, website, MST, tài khoản ngân hàng, timezone và ngôn ngữ theo thiết kế |
| Thông tin chung | Có giờ check-in/out trong màn hình chính sách; chưa có đầy đủ cấu hình VAT/phí dịch vụ/tầng/date format/thuê theo giờ và áp dụng chung |
| Chính sách | Chưa có đầy đủ các nhóm hủy, trẻ em, giường phụ, thú cưng, hút thuốc, đặt cọc, sớm/muộn, nội quy dưới dạng cấu hình được lưu |
| Thu chi / phân quyền | Hai nội dung này đang là placeholder |
| Dịch vụ, nguồn, phương thức thanh toán, bữa ăn, tỷ giá, hoa hồng | Có UI hoặc toggle cục bộ; phần lớn nút Lưu chưa có handler và chưa đồng bộ sang nghiệp vụ |
| Kho, danh mục/mặt hàng, nhà cung cấp, giường, đơn vị tính | Có UI, chưa CRUD/lưu dùng chung đầy đủ |
| Số dư tồn kho ban đầu | Chưa có màn hình/luồng nhập và khóa sau khi thiết lập theo Phần 10.3.4 |
| Bảo mật nâng cao | Chưa có luồng đầy đủ về mật khẩu định kỳ, session/đăng xuất từ xa, audit old/new/IP và whitelist |
| Thông báo | Chưa có cấu hình notification cho tenant |

Nguồn chính: [Settings.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:129); placeholder thu chi ở dòng 177, phân quyền ở dòng 205, hồ sơ ở dòng 260 và các nút Lưu chưa xử lý xuyên suốt file.

Tiêu chí hoàn thành: lưu → đổi trang → tải lại vẫn còn cấu hình; các màn hình nghiệp vụ sử dụng đúng cấu hình vừa lưu. Không chỉ hiện thông báo “đã lưu”.

### FE-07 — P1: Thiếu phân hệ thông báo theo Phần 9

Chuông trên header chưa nối với sự kiện PMS. Chưa có matrix sự kiện × kênh, người nhận theo role, lịch realtime/hourly/daily, cấu hình webhook hoặc lịch sử đọc/chưa đọc. Thông báo mẫu trong header Manager không thay thế phân hệ thông báo tenant.

Cần làm frontend: trang Notification Settings và inbox demo phát sinh từ các thao tác booking/HK/thanh toán; In-App luôn bật; Email/Webhook có cấu hình và trạng thái. Gửi email, ký HMAC và retry thực là phần backend sau.

Nguồn: [Header.jsx](../../../frontend/src/apps/pms/components/Header.jsx:54), [yêu cầu Notification Settings](C:/Users/Laptop/Documents/GitHub/pms-system/pms_system_design_final.md:456).

### FE-08 — P1: Kho chưa có tồn và buồng phòng chưa có giao việc/ca

Phiếu nhập lưu được nhưng chưa tăng một sổ tồn kho theo kho–mặt hàng. Các nút lưu phiếu xuất/chuyển/kiểm kê chưa ghi chứng từ. Vì vậy chưa đối soát được tồn đầu + nhập − xuất ± chuyển ± điều chỉnh.

Housekeeping mới hỗ trợ sạch/bẩn; nút Giao việc chưa xử lý, nhân viên/kế hoạch dùng dữ liệu mẫu, chưa tự sinh kế hoạch theo booking. Bộ lọc ngày lịch sử đang dùng ngày mẫu và chưa thực hiện lọc theo ngày.

Cần làm: chứng từ và sổ biến động tồn; nhập tồn đầu kỳ; xử lý chênh lệch kiểm kê; nhân viên/ca/công việc và trạng thái phòng kiểm tra/hỏng.

Nguồn: [InventoryOut.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/inventory/pages/InventoryOut.jsx:258), [InventoryTransfer.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/inventory/pages/InventoryTransfer.jsx:269), [InventoryCheck.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/inventory/pages/InventoryCheck.jsx:246), [Housekeeping.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/housekeeping/pages/Housekeeping.jsx:80), [HousekeepingPlan.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/housekeeping/pages/HousekeepingPlan.jsx:173).

### FE-09 — P1: Bộ báo cáo thiếu và công suất quá khứ cần sửa cách tính

Hiện có báo cáo tiền phòng dự kiến và công suất đặt phòng. Chưa có bữa sáng, Night Audit, ADR, danh sách khách đến/đi/ở, theo nhân viên/gói giá/quốc tịch, hủy phòng, báo cáo đặt cọc/công nợ/thanh toán/hoa hồng, doanh thu theo nguồn/phòng/dịch vụ và tồn kho.

**Vấn đề cụ thể:** báo cáo công suất gọi `overlaps()`, hàm chỉ nhận booking `CONFIRMED` hoặc `IN_HOUSE`. Booking chuyển sang `CHECKED_OUT` sẽ không được tính ở cả các ngày lưu trú trong quá khứ. Nếu dùng màn hình này để báo cáo công suất lịch sử thì số liệu sẽ giảm sau check-out. Cần tách cách tính phòng đang giữ để bán với đêm phòng lịch sử; hủy booking cũng cần quy tắc riêng nếu có doanh thu phí hủy.

Đã kiểm tra trực tiếp cùng một khoảng ngày: `overlaps(CONFIRMED) = true`, `overlaps(CHECKED_OUT) = false`. Đây không phải lỗi của hàm kiểm tra phòng trống; vấn đề là dùng cùng hàm cho báo cáo lịch sử.

Cần làm trước: các báo cáo phục vụ vận hành hằng ngày và đối soát tiền; thống nhất định nghĩa công suất/ADR/doanh thu dự kiến/doanh thu ghi nhận/tiền thực thu. Các báo cáo còn lại triển khai trên cùng dữ liệu sau.

Nguồn: [Reports.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/reports/pages/Reports.jsx:12), [model.js](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/data/model.js:8), [danh sách báo cáo thiết kế](C:/Users/Laptop/Documents/GitHub/pms-system/pms_system_design_final.md:50).

### FE-10 — P1/P2: Backoffice, OTA và responsive chưa hoàn tất

- **Backoffice — P1:** tenants, features và billing giữ state riêng; thay đổi ở một trang chưa có store chung và chưa điều khiển Client App. Audit logs còn mẫu. Cần nối tenant → plan → feature overrides → users → billing → logs.
- **Tách ứng dụng — P1 trước triển khai:** Marketing, Client và Manager hiện cùng entry/router. Thiết kế yêu cầu source Admin độc lập và domain riêng. Có thể giữ monorepo, nhưng cần entry/build/deploy độc lập theo phạm vi đã chốt; tách bundle không thay thế kiểm tra quyền backend.
- **OTA — P1 giao diện, backend tích hợp sau:** có màn hình mapping và lịch sử mẫu, chưa có lưu/sync thực. Cần state kết nối, mapping dùng master data chung, thông báo lỗi và thao tác thử lại. UI cấu hình ở Admin hiện mô phỏng thông tin từng OTA; cần thống nhất với phương án một Channel Manager trong thiết kế.
- **Voucher/khuyến mãi — P2 sau lõi:** có file nhưng bị comment route/menu là “Phase 2”. Tài liệu Phần 1 và feature `VOUCHER_PROMO` vẫn yêu cầu, chưa ghi hoãn. Truy cập `/id/gia/vouchers` hiện rơi vào route chung `gia/:tab` của `Rates`, không mở đúng màn hình voucher.
- **Responsive — P1 trước chốt frontend:** đã có CSS cho shell, dashboard và nhóm `.pms-original`. Settings có sidebar 280px và lưới nhiều cột; Manager giữ sidebar 280/80px trong viewport. Cần kiểm tra đầy đủ trên desktop/tablet/mobile, đặc biệt form/table/overlay. Đây là rủi ro từ mã nguồn, chưa phải kết luận kiểm thử trực quan trên mọi thiết bị.
- **Trạng thái UI — P1:** chuẩn bị loading, empty, lỗi dữ liệu/API, 401/403, chống gửi lặp và thông báo lưu thất bại khi chuyển sang adapter API. Đây là công việc chuẩn bị tích hợp, chưa có API nghiệp vụ để kiểm thử các trạng thái đó trong phiên này.

Nguồn: [AdminTenants.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/manager/tenants/pages/AdminTenants.jsx:46), [AdminFeatures.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/manager/features/pages/AdminFeatures.jsx:45), [App.jsx](../../../frontend/src/app/App.jsx:120), [OTA.jsx](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/apps/pms/channel-manager/pages/OTA.jsx:5), [index.css](C:/Users/Laptop/Documents/GitHub/pms-system/frontend/src/index.css:354).

## 4. Backend còn thiếu — lộ trình giai đoạn sau

Backend hiện chỉ có `app.py` và `requirements.txt`, với route trạng thái `/` và `/api/health`. SQLAlchemy có trong requirements nhưng chưa có model hoặc kết nối DB. Chưa có API nghiệp vụ để frontend gọi.

Đây phù hợp với thứ tự frontend trước của dự án; **không nên coi backend đã sẵn sàng cho chạy thật chỉ vì health check hoạt động**.

| Hạng mục thiết kế | Việc phải làm ở backend |
|---|---|
| PostgreSQL / multi-tenant / RLS | Model, migration, tenant-scoped access, RLS và kiểm tra FK không nối dữ liệu chéo tenant |
| Auth / RBAC / feature gating | Session/token, mật khẩu, tenant membership, quyền theo hành động, feature overrides, quota và trạng thái subscription |
| Booking / daily inventory | API lifecycle, transaction, chống đặt trùng khi nhiều người thao tác, cập nhật daily availability và lịch sử |
| Giá / đa tiền tệ | Rate plans/daily rates/stop-sell; money chính xác, currency và snapshot tỷ giá; thống nhất làm tròn/thuế/phí |
| POS / thu chi / kho | API chứng từ, thanh toán/cọc/công nợ, biến động tồn và giao dịch được xử lý trọn vẹn |
| Settings / Reports / Admin | CRUD, truy vấn báo cáo, phân trang/export và audit phát sinh từ thao tác thật |
| OTA | Tích hợp Channel Manager, mapping, nhận booking webhook, đồng bộ giá/tồn, retry và chống xử lý sự kiện trùng |
| Notifications | Event pipeline/worker, email/webhook, HMAC, retry, digest và lịch sử đọc/gửi |
| Migration / Redis / replica | Alembic hoặc Flask-Migrate; expand–contract; cache/invalidation, session/rate limit và read/write routing |
| CIA / vận hành | HTTPS, secret/config môi trường, cấu hình CORS theo triển khai, tắt debug production, backup/PITR, giám sát và kiểm tra phục hồi |

**Bắt buộc trước khi chạy thật:** auth/quyền, cách ly tenant, tính đúng tiền, chống overbooking đồng thời, audit và phục hồi dữ liệu. Redis/replica triển khai theo kế hoạch và tải thực tế; nếu giảm phạm vi so với thiết kế cần ghi nhận quyết định rõ ràng.

Nguồn: [backend/app.py](C:/Users/Laptop/Documents/GitHub/pms-system/backend/app.py:1), [backend/requirements.txt](C:/Users/Laptop/Documents/GitHub/pms-system/backend/requirements.txt).

## 5. Những điểm cần bổ sung hoặc chốt trong chính tài liệu thiết kế

Các mục dưới đây là **đề xuất làm rõ**, không phải yêu cầu đã được mô tả đầy đủ trong file:

1. **Phạm vi release:** tách danh sách bắt buộc ra mắt và phần làm sau; ghi rõ quyết định về voucher/promotions/40+ báo cáo. Native mobile, push mobile, OCR và Zalo/SMS đã được ghi là Phase 2, không tính là thiếu frontend web hiện tại.
2. **Vai trò và feature codes:** thiết kế dùng `SYSTEM_MANAGER`, frontend Manager dùng `BUSINESS_ADMIN`; thiết kế đưa `OTA_SYNC`/`POS_SALES`, mock dùng `OTA_CHANNEL_MANAGER`/`POS_FNB_SPA` và thêm AI/kiosk/e-invoice. Cần một danh sách chuẩn hoặc bảng ánh xạ; các tính năng mở rộng chưa nên lấn phạm vi lõi chưa hoàn thành.
3. **Ma trận quyền:** chốt xem/tạo/sửa/hủy/xuất báo cáo theo từng role. Điều kiện “feature của tenant bật” và “user được phép” phải cùng được đáp ứng; không dùng một role mock để thay cả hai.
4. **State machine và dữ liệu nghiệp vụ:** bổ sung luồng nhiều phòng, đổi phòng/gia hạn, no-show, hủy/hoàn tiền, dịch vụ, chứng từ kho và chốt ngày/Night Audit. Mô tả trạng thái và quy tắc tiền/phòng ở từng bước trước khi thiết kế API.
5. **Schema tài chính/kho:** tài liệu đã liệt kê chức năng nhưng chưa mô tả đủ quan hệ chứng từ POS, chi tiết hóa đơn, payments/refunds/cashbook, stock movements và sự liên kết với booking. Cần bổ sung để báo cáo có nguồn dữ liệu kiểm chứng.
6. **Hợp đồng API:** request/response, ID/tenant context, lỗi, phân trang, định dạng ngày/giờ, đơn vị tiền và chống gửi trùng. Chuẩn hóa timezone theo tenant thay cho timezone Việt Nam cố định hiện tại.
7. **Phạm vi `tenant_id`:** đoạn đầu nói mọi bảng trừ users đều có tenant_id, nhưng phần sau có master toàn hệ thống như features/service_plans/notification_events. Cần liệt kê bảng global và bảng tenant-scoped rõ ràng; một số bảng chi tiết cũng cần quy tắc kiểm tra tenant qua quan hệ.
8. **Tính nhất quán/concurrency:** daily inventory và cache không tự bảo đảm chống overbooking. Chốt transaction/locking/ràng buộc DB, idempotency OTA/payment và cách cập nhật lại khi lỗi. Không chuyển mọi GET sang replica một cách máy móc: cần đọc thấy dữ liệu vừa ghi khi tạo/sửa booking và xử lý replication lag.
9. **Mục tiêu vận hành:** bổ sung cách đo tải, giới hạn chấp nhận, thời gian/phạm vi mất dữ liệu khi phục hồi và diễn tập backup. Có Redis/replica chưa đủ để chứng minh mục tiêu uptime 99.99% trong tài liệu.

## 6. Thứ tự triển khai frontend đề xuất

1. **Chốt tenant context + dữ liệu dùng chung + cấu trúc API**, hoàn thiện các Settings nền tảng.
2. **Hoàn thiện booking: khách, giá, dịch vụ, cọc/thanh toán, số dư và lịch sử.**
3. **Nối POS → booking/sổ quỹ → báo cáo**, đồng thời chốt cách tính giá ARI.
4. **Hoàn thiện xuất/chuyển/kiểm kê/tồn kho và housekeeping giao việc/ca.**
5. **Hoàn thiện role/feature/trial, nối backoffice với Client App và thêm Notifications.** Thiết kế ma trận quyền phải chốt từ bước 1 để các luồng sau dùng đúng quyền.
6. **Mở rộng bộ báo cáo, voucher/promotions và OTA demo theo phạm vi release**, kiểm tra responsive và các luồng đầu-cuối trước khi nối backend thật.

Có thể thực hiện trên UI hiện tại bằng cách bổ sung state, handler, validation và nội dung còn thiếu; không cần thiết kế lại toàn bộ giao diện.

## 7. Kết quả kiểm tra và giới hạn báo cáo

- `npm run build`: **đạt**.
- `npm run lint`: **exit 0, còn cảnh báo**, chủ yếu import/state/handler chưa dùng; có cảnh báo expression và React purity ở Manager. Lint không xác nhận nút bấm đã có nghiệp vụ.
- `npm test`: môi trường sandbox chặn việc spawn tiến trình test (`EPERM`). Chạy cùng file với `node --test --test-isolation=none src/apps/pms/data/model.test.js`: **5/5 đạt**.
- Năm test hiện tập trung vào ngày, số đêm, phòng trùng, trạng thái không giữ phòng và phòng maintenance. Chưa xác nhận tích hợp payment/POS/kho/quyền/tenant hoặc UI đầu-cuối.
- Đã xác minh cách lọc `CHECKED_OUT` bằng lời gọi trực tiếp hàm `overlaps`; chưa thay đổi mã nguồn.
- Phiên rà soát này dựa trên mã nguồn và kiểm tra nêu trên; chưa thực hiện kiểm thử trực quan toàn bộ màn hình trên nhiều thiết bị, API/DB/OTA hoặc tải production.
- Không đưa tỷ lệ “hoàn thành %” vì phạm vi thiết kế chưa có danh sách nghiệm thu và trọng số thống nhất.

Trace graphify: expanded tokens từ vocabulary đồ thị hiện có là `planned demo reservations reports inventory settings auth tenant feature notification security architecture`. Đồ thị được dùng để điều hướng; các kết luận thiếu/chưa hoạt động được kiểm tra lại ở source, không suy từ tên node đơn thuần.
