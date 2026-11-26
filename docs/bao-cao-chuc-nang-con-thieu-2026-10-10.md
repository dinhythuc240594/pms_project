# Báo cáo kiểm tra chức năng còn thiếu - LOHA PMS

Ngày rà soát: 10/10/2026. Baseline là main local a57777c trước thay đổi menu Khách hàng. Không fetch/đối chiếu remote; không xác minh database nghiệp vụ, Coolify hoặc production. Đây là rà soát source và tài liệu, không phải chứng nhận sẵn sàng vận hành.

## Kết luận

Lõi vận hành đã triển khai. Không coi mọi mục trong thiết kế tổng thể là điều kiện bắt buộc của MVP. Cần phân biệt thiếu code, giới hạn hiện tại và nghiệm thu chưa xong.

## 1. Đã có

- **Lõi vận hành:** Đăng nhập/session, tenant/quyền, danh mục, khách hàng, booking nhiều phòng/nhiều khách, check-in/out, tiền/cọc/hoàn và audit.
- **POS, quỹ, buồng phòng:** Hóa đơn nháp/chốt, ghi vào booking, thu/chi/chuyển/đảo quỹ, nhân sự/ca/giao việc và kế hoạch dọn.
- **Kho và giá nâng cao:** Tồn đầu kỳ, nhập/xuất/chuyển/kiểm kê, giá vốn/POS; cuối tuần/LOS, voucher/khuyến mãi và snapshot tỷ giá VND/USD.
- **Báo cáo và SaaS:** Dashboard và báo cáo tiền/công suất cơ bản; FREE/PRO, quota, tính năng và gia hạn thủ công.
- **Tích hợp và quản trị:** Connector Channex, ARI/jobs/revisions/webhook/ACK; thông báo in-app; Manager Users/Features và Owner Audit [R26](#r26).
- **Sửa cục bộ trong lượt này:** Đã thêm menu Khách hàng tới /id/guests qua sidebar dùng chung desktop/mobile và quyền hiện có. CRUD khách hàng đã có; mục này không còn backlog [R36](#r36).

## 2. Chức năng chưa làm hoặc mới làm một phần

Ưu tiên dưới đây là đề xuất theo nhu cầu pilot, không thay phạm vi MVP đã được duyệt.

### 01. Báo cáo chuyên sâu và Night Audit

Ưu tiên khi cần chốt ngày hoặc kế toán vận hành. Hiện chỉ có dashboard, doanh thu và tài chính cơ bản. Chưa có quy trình chốt ngày/posting doanh thu mỗi đêm; các báo cáo bữa sáng, quốc tịch, nguồn/gói giá, hoa hồng và voucher/khuyến mãi trong thiết kế chưa đủ. Không gọi toàn bộ BE08 là chưa làm [R01](#r01) [R02](#r02) [R03](#r03).

### 02. Ngoại lệ lưu trú và các trường booking

Booking đang theo đêm, chưa có no-show; đổi ngày/phòng sau check-in bị từ chối. Thuê giờ, FOC, bữa sáng và số người lớn/trẻ em/em bé vẫn khóa. Booking nhiều phòng/nhiều khách đã có. No-show/chuyển phòng khi đang ở cần chốt tiêu chí riêng; thuê giờ có thể loại khỏi MVP nếu chỉ bán lưu trú qua đêm [R04](#r04) [R05](#r05) [R06](#r06) [R34](#r34).

### 03. Thiết lập tài chính và chính sách khách sạn

Danh mục thu chi và quản lý hoa hồng vẫn là màn hình xem trước. Tỷ lệ hoa hồng nguồn đã lưu được, nhưng chưa có tính/chi/đối soát hoa hồng đầy đủ. Hồ sơ khách sạn còn thiếu logo, liên hệ, mã số thuế, ngôn ngữ; chưa có VAT/phí dịch vụ mặc định và engine chính sách hủy/cọc/trẻ em/nhận sớm-trả muộn. Giờ nhận/trả và văn bản chính sách đã lưu được [R07](#r07) [R09](#r09).

### 04. Tự cập nhật dữ liệu giữa nhiều nhân viên

Workspace chủ yếu cập nhật khi chọn tenant hoặc phiên hiện tại thao tác. Chưa có polling/focus refresh hay realtime chung cho booking/phòng/quỹ; dữ liệu máy khác có thể cần tải lại. Chuông thông báo có polling riêng, không đồng nghĩa mọi màn hình tự cập nhật. Cần chốt yêu cầu đồng bộ và cách báo dữ liệu cũ trước pilot nhiều nhân viên [R32](#r32) [R33](#r33).

### 05. Thông báo theo lịch và kênh ngoài ứng dụng

Mới có 9 sự kiện in-app. Chưa có nhắc khách đến/đi hôm nay, nợ quá hạn, sắp hết phòng, tổng hợp ngày và sắp hết trial. Chưa có Email, webhook gửi ra hệ thống khách sạn, digest theo giờ/ngày. Đây là webhook thông báo, khác webhook nhận OTA đã có. Email còn chờ chọn provider [R10](#r10) [R11](#r11) [R12](#r12) [R13](#r13) [R31](#r31).

### 06. Bảo mật nâng cao và hồ sơ cá nhân

Chưa có 2FA, quản lý thiết bị/phiên để đăng xuất từ xa, đổi mật khẩu định kỳ hoặc IP whitelist. Sửa hồ sơ cá nhân cũng đang khóa. Đăng nhập, đổi mật khẩu thông thường, phân quyền và audit đã có; không tính các phần này là thiếu [R08](#r08) [R19](#r19).

### 07. Buồng phòng tự động đầy đủ

Có giao việc, ca và tạo kế hoạch theo ngày bằng nút; checkout tự tạo việc. Chưa có scheduler lập kế hoạch mỗi ngày, ca qua đêm và lịch sử dài hạn phân trang. Đây là phần mở rộng của phân hệ đã hoạt động [R14](#r14) [R15](#r15).

### 08. In/xuất dữ liệu và hoàn thiện quản trị

In chứng từ booking, Excel buồng phòng và CSV log Manager đang tắt. Log có dữ liệu audit thật nhưng IP hiển thị '-', mức độ/kết quả bị gán mặc định; không coi đó là giám sát sự cố đầy đủ. Domain tenant riêng chưa vận hành; hồ sơ tự sửa cũng chưa có [R16](#r16) [R17](#r17) [R18](#r18) [R19](#r19).

### 09. Thu tiền SaaS tự động

Đã có đổi gói, gia hạn và lịch sử thủ công. Chưa có payment gateway, tự gia hạn và hóa đơn thuê bao tự động. Đây là backlog có điều kiện sau khi chọn provider/quy tắc thu tiền, không phải lỗi của luồng billing thủ công hiện tại [R20](#r20).

## 3. Có code nhưng nghiệm thu/vận hành chưa xong

### Channex: có code, chưa nghiệm thu provider thật

Cần property/room type/rate plan và khóa staging thật, chạy worker để kiểm ARI, booking mới/sửa/hủy, webhook lặp/mất và ACK. ARI hiện dùng giá cơ bản/DailyRate, chưa truyền LOS/voucher/promotions. Extras, ngày phòng khác nhau, tổng tiền không khớp hoặc sửa booking đã thu tiền/nhận phòng còn bị giữ lỗi; prepaid không tạo thanh toán PMS [R21](#r21) [R22](#r22).

### Kho/giá: cần nghiệm thu trọn luồng

BE10/11 đã có code/API/UI và kiểm thử tự động trước đây. Còn kiểm tra browser toàn bộ nhập/xuất/chuyển/kiểm kê, voucher/khuyến mãi/tỷ giá/hoàn tiền và đối soát. Các ô tổng chưa tick là nghiệm thu còn mở, không phải các phân hệ chưa được viết [R23](#r23).

### Vận hành thật: còn checkpoint riêng

Chưa đóng đối soát tổng thể và checkpoint trước sử dụng thật. Cần kiểm chứng môi trường đích, migration, backup/restore, tải/giám sát và các luồng nghiệp vụ. Tài liệu Manager/Owner ghi chưa áp migration mới vào database nghiệp vụ/Coolify; rà source local không chứng minh trạng thái bên ngoài [R24](#r24) [R25](#r25) [R35](#r35).

## 4. Phase 2 và phạm vi cần chốt

Mobile app/push và Zalo/SMS đã được xếp Phase 2. API đối tác còn cần API keys/scopes và tiêu chí riêng; feature flag API_EXTERNAL chưa phải API tích hợp. Redis/read replica là hướng mở rộng hạ tầng khi có nhu cầu đo được, không phải chức năng MVP bắt buộc còn thiếu [R29](#r29) [R30](#r30) [R31](#r31).

## 5. Kiểm chứng và giới hạn của báo cáo

Trong lượt này, agent chính đã chạy frontend npm test: 46/46 đạt; npm run build đạt; npm run lint exit 0 và còn cảnh báo. Sau sửa menu không chạy browser thật. Không chạy lại backend/PostgreSQL, DB migration, real OTA hoặc kiểm thử production.

Không chạy server, database hoặc external provider để tạo báo cáo. Các test count trong implementation reports cũ là lịch sử. Không sửa thư mục docs/bao-cao-tien-do có sẵn.

## 6. Tài liệu cũ dễ gây hiểu sai

README frontend và plan còn ghi POS/kho/OTA/pricing/billing/BE06+ chưa làm; các mô tả này đã lỗi thời. Ưu tiên source hiện tại và checklist mới BE10/11, BE12, Manager/Owner. Các báo cáo đầu tháng và test count cũ là lịch sử kiểm chứng, không phải kết quả chạy lại hôm nay [R27](#r27) [R28](#r28) [R26](#r26).

## 7. Thứ tự tiếp tục đề xuất

1. Chốt MVP qua đêm và các ngoại lệ lưu trú cần cho pilot.
2. Nghiệm thu xuyên suốt booking/POS/quỹ/kho/pricing; sandbox Channex nếu đưa OTA vào MVP.
3. Hoàn thiện báo cáo, in/xuất và cảnh báo khách thật cần.
4. Kiểm chứng triển khai/restore trước khi mở rộng Phase 2.

## 8. Nguồn đối chiếu

Đường dẫn tuyệt đối trên workspace; số sau dấu hai chấm là dòng đã kiểm tra.

- <a id="r01"></a>**R01 - Danh mục báo cáo trong thiết kế:** [E:/Github/pms-system/pms_system_design_final.md:54](<E:/Github/pms-system/pms_system_design_final.md:54>)
- <a id="r02"></a>**R02 - Night Audit là công việc tương lai:** [E:/Github/pms-system/backend/API_CONTRACT.md:260](<E:/Github/pms-system/backend/API_CONTRACT.md:260>)
- <a id="r03"></a>**R03 - Báo cáo hiện tại: dashboard / revenue / financial:** [E:/Github/pms-system/backend/pms_api/reports/routes.py:396](<E:/Github/pms-system/backend/pms_api/reports/routes.py:396>)
- <a id="r04"></a>**R04 - Booking theo ngày, chỉ bốn trạng thái:** [E:/Github/pms-system/backend/pms_api/bookings/models.py:30](<E:/Github/pms-system/backend/pms_api/bookings/models.py:30>)
- <a id="r05"></a>**R05 - Khóa đổi ngày/phòng sau check-in:** [E:/Github/pms-system/backend/pms_api/bookings/routes.py:780](<E:/Github/pms-system/backend/pms_api/bookings/routes.py:780>)
- <a id="r06"></a>**R06 - Thuê giờ, FOC và bữa sáng đang bị khóa:** [E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:131](<E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:131>)
- <a id="r07"></a>**R07 - Danh mục thu chi và hoa hồng là xem trước:** [E:/Github/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:188](<E:/Github/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:188>)
- <a id="r08"></a>**R08 - Bảo mật nâng cao chưa nối nghiệp vụ:** [E:/Github/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:216](<E:/Github/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:216>)
- <a id="r09"></a>**R09 - Các trường cấu hình khách sạn được API chấp nhận:** [E:/Github/pms-system/backend/pms_api/catalog/routes.py:99](<E:/Github/pms-system/backend/pms_api/catalog/routes.py:99>)
- <a id="r10"></a>**R10 - Chín sự kiện thông báo nghiệp vụ hiện có:** [E:/Github/pms-system/backend/pms_api/notifications.py:16](<E:/Github/pms-system/backend/pms_api/notifications.py:16>)
- <a id="r11"></a>**R11 - Kênh thông báo hiện tại chỉ là in_app:** [E:/Github/pms-system/backend/pms_api/notifications.py:255](<E:/Github/pms-system/backend/pms_api/notifications.py:255>)
- <a id="r12"></a>**R12 - Các cảnh báo theo lịch/điều kiện trong thiết kế:** [E:/Github/pms-system/pms_system_design_final.md:431](<E:/Github/pms-system/pms_system_design_final.md:431>)
- <a id="r13"></a>**R13 - Email, webhook thông báo và lịch gửi:** [E:/Github/pms-system/pms_system_design_final.md:449](<E:/Github/pms-system/pms_system_design_final.md:449>)
- <a id="r14"></a>**R14 - Ca buồng phòng phải nằm trong cùng ngày:** [E:/Github/pms-system/backend/pms_api/housekeeping/routes.py:51](<E:/Github/pms-system/backend/pms_api/housekeeping/routes.py:51>)
- <a id="r15"></a>**R15 - Lập kế hoạch dọn bằng nút trên giao diện:** [E:/Github/pms-system/frontend/src/apps/pms/housekeeping/pages/HousekeepingPlan.jsx:88](<E:/Github/pms-system/frontend/src/apps/pms/housekeeping/pages/HousekeepingPlan.jsx:88>)
- <a id="r16"></a>**R16 - In chứng từ booking chưa triển khai:** [E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:63](<E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:63>)
- <a id="r17"></a>**R17 - Xuất Excel buồng phòng chưa triển khai:** [E:/Github/pms-system/frontend/src/apps/pms/housekeeping/pages/Housekeeping.jsx:61](<E:/Github/pms-system/frontend/src/apps/pms/housekeeping/pages/Housekeeping.jsx:61>)
- <a id="r18"></a>**R18 - Log Manager: IP/mức độ/kết quả đang gán hiển thị:** [E:/Github/pms-system/frontend/src/apps/manager/logs/pages/AdminLogs.jsx:31](<E:/Github/pms-system/frontend/src/apps/manager/logs/pages/AdminLogs.jsx:31>)
- <a id="r19"></a>**R19 - Sửa hồ sơ cá nhân đang bị khóa:** [E:/Github/pms-system/frontend/src/apps/pms/profile/pages/Profile.jsx:84](<E:/Github/pms-system/frontend/src/apps/pms/profile/pages/Profile.jsx:84>)
- <a id="r20"></a>**R20 - Gia hạn SaaS hiện là thao tác quản trị:** [E:/Github/pms-system/backend/pms_api/admin/routes.py:550](<E:/Github/pms-system/backend/pms_api/admin/routes.py:550>)
- <a id="r21"></a>**R21 - Giới hạn ARI/booking/prepaid Channex:** [E:/Github/pms-system/BE12_IMPLEMENTATION_REPORT.md:51](<E:/Github/pms-system/BE12_IMPLEMENTATION_REPORT.md:51>)
- <a id="r22"></a>**R22 - Nghiệm thu Channex sandbox thật còn mở:** [E:/Github/pms-system/tasks/be12.md:12](<E:/Github/pms-system/tasks/be12.md:12>)
- <a id="r23"></a>**R23 - BE10/11 còn nghiệm thu browser đầy đủ:** [E:/Github/pms-system/tasks/be10-be11.md:26](<E:/Github/pms-system/tasks/be10-be11.md:26>)
- <a id="r24"></a>**R24 - Checkpoint đối soát tổng thể chưa đóng:** [E:/Github/pms-system/tasks/todo.md:58](<E:/Github/pms-system/tasks/todo.md:58>)
- <a id="r25"></a>**R25 - Checkpoint trước sử dụng thật chưa đóng:** [E:/Github/pms-system/tasks/todo.md:94](<E:/Github/pms-system/tasks/todo.md:94>)
- <a id="r26"></a>**R26 - Manager/Owner đã triển khai:** [E:/Github/pms-system/tasks/manager-owner.md:6](<E:/Github/pms-system/tasks/manager-owner.md:6>)
- <a id="r27"></a>**R27 - README frontend có mô tả hiện trạng lỗi thời:** [E:/Github/pms-system/frontend/README.md:60](<E:/Github/pms-system/frontend/README.md:60>)
- <a id="r28"></a>**R28 - Plan còn ghi BE06 trở đi chưa triển khai:** [E:/Github/pms-system/tasks/plan.md:73](<E:/Github/pms-system/tasks/plan.md:73>)
- <a id="r29"></a>**R29 - Mobile app/push thuộc Phase 2:** [E:/Github/pms-system/pms_system_design_final.md:239](<E:/Github/pms-system/pms_system_design_final.md:239>)
- <a id="r30"></a>**R30 - Zalo/SMS được hoãn rõ sang Phase 2:** [E:/Github/pms-system/pms_system_design_final.md:454](<E:/Github/pms-system/pms_system_design_final.md:454>)
- <a id="r31"></a>**R31 - API đối tác/báo cáo nâng cao chưa chốt phạm vi:** [E:/Github/pms-system/tasks/be12.md:14](<E:/Github/pms-system/tasks/be12.md:14>)
- <a id="r32"></a>**R32 - Workspace tải lại theo tenant và thao tác của phiên:** [E:/Github/pms-system/frontend/src/apps/pms/data/PmsProvider.jsx:32](<E:/Github/pms-system/frontend/src/apps/pms/data/PmsProvider.jsx:32>)
- <a id="r33"></a>**R33 - Chuông thông báo có polling riêng:** [E:/Github/pms-system/frontend/src/apps/pms/components/NotificationBell.jsx:35](<E:/Github/pms-system/frontend/src/apps/pms/components/NotificationBell.jsx:35>)
- <a id="r34"></a>**R34 - Số người lớn/trẻ em/em bé chưa triển khai:** [E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:165](<E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:165>)
- <a id="r35"></a>**R35 - Chưa áp migration vào database nghiệp vụ/Coolify:** [E:/Github/pms-system/tasks/manager-owner.md:46](<E:/Github/pms-system/tasks/manager-owner.md:46>)
- <a id="r36"></a>**R36 - Menu Khách hàng đã bổ sung trong lượt này:** [E:/Github/pms-system/frontend/src/apps/pms/components/Sidebar.jsx:13](<E:/Github/pms-system/frontend/src/apps/pms/components/Sidebar.jsx:13>)
