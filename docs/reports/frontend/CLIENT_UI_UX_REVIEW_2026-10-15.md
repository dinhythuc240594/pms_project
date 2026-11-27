# Báo cáo nâng cấp UI/UX Client LOHA

Ngày rà soát: **15/10/2026** · Nhánh: **main** · Mã nguồn được rà: **`de3bb34`**.

## 1. Đánh giá tổng thể

Client đã có nền giao diện và các luồng nghiệp vụ khá đầy đủ. Đợt nâng cấp tiếp theo nên tập trung vào **lưu đúng dữ liệu, bảo vệ nội dung đang nhập, giữ ngữ cảnh thao tác và làm gọn các màn hình dùng hàng ngày**. Đây là những điểm ảnh hưởng trực tiếp tới lễ tân và người vận hành.

Rà soát ghi nhận **16 hạng mục cần xử lý: 3 P1 và 13 P2**, cùng 2 đề xuất trình bày ở mức P3. P1 là thao tác có thể gây hiểu nhầm về việc lưu, làm mất bản nháp hoặc che khuất tác động đến tiền; P2 là vướng mắc thao tác, thông tin hoặc bố cục; P3 là tinh gọn sau khi hoàn tất các mục trước. Đây là mức ưu tiên đề xuất, không phải số lỗi đã xác nhận trên production.

**Nên bắt đầu từ booking và bản nháp**, sau đó đến sơ đồ phòng, báo cáo, POS và buồng phòng. Xem trước giá sau khi sửa booking và lưu riêng ghi chú dọn phòng cần phối hợp backend; các hạng mục còn lại chủ yếu thuộc frontend, tái dùng thành phần và API sẵn có.

## 2. Phạm vi và cách kiểm tra

| Nhóm | Phạm vi đọc mã | Kiểm tra trình duyệt trong lượt này |
| --- | --- | --- |
| Điều hướng, header, tổng quan | Shell, menu, quyền, trạng thái đồng bộ, dashboard | Đăng nhập, menu desktop; bố cục mobile qua danh sách booking |
| Booking và phòng | Lịch đặt phòng, danh sách, tạo/sửa booking, các tab, sơ đồ, phòng vật lý | Phím tắt sơ đồ, phạm vi nút lưu, bản nháp ghi chú, đổi danh sách phòng; booking ở 320 × 800 |
| Tài chính | POS, thu chi, hoa hồng | Đọc mã; chưa ghi sổ hoặc thanh toán |
| Kho | Phiếu kho, tồn kho, bộ lọc và các trạng thái | Mở/đóng phiếu nháp có ghi chú và 2 dòng; chưa ghi sổ |
| Buồng phòng | Trạng thái phòng, nhân viên, ca, kế hoạch | Đọc mã |
| Cài đặt, hồ sơ, báo cáo, OTA | Biểu mẫu, điều hướng, trạng thái tải/lỗi và phần chưa triển khai | Mở báo cáo; các kết luận về giữ kỳ ngày dựa trên mã |

Trình duyệt dùng **API và PostgreSQL QA riêng, dữ liệu giả**, không dùng tài khoản, khóa Channex hay dữ liệu khách sạn thật. Kích thước đã quan sát: **1280 × 720** và **320 × 800 CSS px**. Chỉ mô phỏng thao tác cần thiết để xác minh nhận xét; không sửa mã ứng dụng trong lượt này.

Nhãn **Đã tái hiện** bên dưới nghĩa là đã thao tác và quan sát được kết quả trên bản QA. Nhãn **Mã nguồn** nghĩa là xác nhận được cơ chế trong code nhưng chưa chạy đầy đủ tình huống đó trên trình duyệt.

## 3. Những phần nên giữ

- Sidebar đã thu gọn được; menu điện thoại dùng dialog; shell có lối đi tới nội dung chính và dấu hiệu focus cho bàn phím.
- Overlay đã có quản lý focus và đóng bằng Escape. Điểm cần bổ sung là bảo vệ bản nháp trước khi đóng.
- Kho và OTA đã có nhiều trạng thái tải, lỗi, thử lại, dữ liệu trống và giải thích quyền. Tái dùng các mẫu này để chuẩn hóa màn khác.
- Danh sách booking ở 320 px không làm tràn toàn trang trong lần kiểm tra này; bảng có vùng cuộn ngang riêng.
- Hai nút **Xem tồn kho / Phiếu nhập kho** đã được sửa thành nút rõ ràng ở commit đang rà. Không đưa lại vào danh sách tồn đọng.
- Giữ thông tin khách trong booking theo yêu cầu đã chốt. Không đề xuất khôi phục trang Khách hàng riêng, bộ lọc tiền tệ báo cáo hoặc triển khai 2FA trong đợt này.

## 4. Các hạng mục cần xử lý

### UX-01 · P1 · Nút lưu booking không khớp phần đang chỉnh sửa

**Đã tái hiện:** vào tab Khách hàng trong booking, sửa tên rồi bấm **Lưu thay đổi** ở đầu bảng. Giao diện báo **Đã lưu thay đổi**; đổi tab rồi quay lại, tên vẫn là tên cũ. Nút đầu bảng chỉ lưu dữ liệu của tab Chi tiết; tab khách có state và nút lưu riêng. Đây là khách lưu trú trong booking, không phải trang Khách hàng đã bỏ.

**Đề xuất:** chỉ hiện nút đầu bảng tại tab Chi tiết, đặt tên **Lưu thông tin lưu trú**. Mỗi tab có nút lưu đúng phạm vi và dấu hiệu “Có thay đổi chưa lưu”. Không báo thành công cho phần chưa được lưu.

**Nghiệm thu:** sửa khách → thao tác lưu đang hiển thị lưu đúng khách; đổi tab và mở lại thấy dữ liệu mới. Quyền, lỗi server và trạng thái đang lưu vẫn được giữ.

Nguồn: [BookingDetailPanel.jsx:30](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:30), [nút đầu bảng:68](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:68), [BookingTabs.jsx:13](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingTabs.jsx:13), [lưu khách:31](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingTabs.jsx:31).

Ảnh QA sau khi đổi tab quay lại: có thông báo đã lưu nhưng tên vẫn là tên trước khi sửa.

![Tab khách lưu trú và thông báo lưu không đúng phạm vi](E:/Github/pms-system/docs/reports/frontend/assets/client-ux-2026-10-15/booking-save-scope.png)

### UX-02 · P1 · Bản nháp mất khi đóng hoặc chuyển màn

**Đã tái hiện:** nhập ghi chú booking, chuyển tab rồi quay lại → ghi chú trống. Nhập ghi chú phiếu kho, thêm dòng thứ hai, bấm X rồi mở lại → ghi chú và dòng thứ hai mất, không có cảnh báo. **Mã nguồn:** đổi nhóm cài đặt cũng unmount biểu mẫu; Escape/bấm nền overlay có đường đóng trực tiếp. Cơ chế hoãn cập nhật nền hiện có không bảo vệ các thao tác điều hướng này. Đây là mất dữ liệu chưa lưu, không phải mất chứng từ đã ghi sổ.

**Đề xuất:** theo dõi thay đổi tại biểu mẫu đang sửa; trước khi đổi tab, đóng, rời trang hoặc đổi khách sạn, cho chọn **Tiếp tục nhập / Bỏ thay đổi**. Form chưa sửa đóng ngay; lưu thành công xóa trạng thái nháp. Trong lúc gửi, chặn thao tác đóng có thể làm mất phản hồi. Tái dùng overlay hiện có, không cần thêm hệ thống tự động lưu.

**Nghiệm thu:** thử booking, phiếu kho có 2 dòng và chính sách khách sạn; chọn tiếp tục phải giữ nguyên nội dung; bỏ thay đổi mới được rời màn; sau lưu không hỏi lại.

Nguồn: [BookingDetailPanel.jsx:201](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:201), [LegacyOverlay.jsx:17](E:/Github/pms-system/frontend/src/apps/pms/components/LegacyOverlay.jsx:17), [InventoryDocuments.jsx:44](E:/Github/pms-system/frontend/src/apps/pms/inventory/InventoryDocuments.jsx:44), [Settings.jsx:139](E:/Github/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:139), [workspaceSync.js:6](E:/Github/pms-system/frontend/src/apps/pms/data/workspaceSync.js:6).

### UX-03 · P1 · Sửa ngày/phòng chưa cho thấy tác động đến tiền

**Đã quan sát:** chọn thêm phòng 102 cho booking phòng 101, cả hai ô được chọn nhưng các giá trị tiền vẫn là giá đã lưu; chưa có tổng mới hoặc chênh lệch. **Mã nguồn:** số đêm dùng bản nháp, tiền phòng/ngày và công nợ dùng booking cũ; backend sẽ tính lại khi lưu thay đổi ngày/phòng. Người dùng chưa có thông tin đầy đủ để đánh giá thay đổi trước lưu.

**Đề xuất:** trước mắt ghi rõ **Giá đã lưu — sẽ được tính lại khi đổi ngày/phòng**, hiển thị kết quả mới sau lưu. Để hoàn thiện luồng, bổ sung báo giá theo booking và trình bày **giá hiện tại → giá dự kiến, chênh lệch, số dư dự kiến** trước xác nhận.

**Phụ thuộc backend:** `/quote` hiện tại kiểm tra trùng và tính cả chính booking đang sửa; không thể gọi nguyên trạng để xem trước. Báo giá chỉnh sửa phải xác thực tenant/quyền, loại đúng booking hiện tại khỏi kiểm tra trùng và giữ tiền tệ/chính sách voucher đã chốt. Khi lưu vẫn phải kiểm tra lại giá và tồn để xử lý thay đổi đồng thời.

**Nghiệm thu:** đổi ngày hoặc danh sách phòng thấy đúng giá dự kiến; lỗi báo giá được giải thích; giá sau lưu khớp quy tắc backend, gồm booking có voucher và tiền đã thu. Không suy ra tổng mới chỉ bằng nhân giá cũ với số đêm.

Nguồn: [BookingDetailPanel.jsx:160](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:160), [giá cũ:190](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:190), [backend tính lại:796](E:/Github/pms-system/backend/pms_api/bookings/routes.py:796), [QuoteRouteView:1046](E:/Github/pms-system/backend/pms_api/catalog/routes.py:1046).

### UX-04 · P2 · Phần đầu chi tiết booking quá cao trên điện thoại

**Đã đo tại 320 × 800:** khối đầu, thao tác và tab cao **502 px**, phần thân cuộn còn **298 px**. Tên, UUID và ngày xuống nhiều dòng; avatar bị ép hẹp. Vùng nhập liệu ít dù bảng đã chiếm toàn màn hình. Đây là vấn đề bố cục, chưa phải kết luận vi phạm WCAG.

**Đề xuất:** trên màn hẹp, xếp tên/trạng thái gọn ở đầu; hiển thị mã ngắn có thao tác sao chép; gom ngày thành một dòng phù hợp. Chỉ giữ thao tác lưu/đóng cần thiết ở vùng cố định, đưa nhóm trạng thái vào khu vực cuộn hoặc menu thao tác. Giữ tab cuộn ngang và focus dễ nhìn.

**Nghiệm thu:** kiểm tra 320/375/768 px với tên dài, mã dài và thông báo lỗi; phần đầu không chiếm đa số màn hình; tìm được lưu/đóng, dùng bàn phím được và không che trường đang nhập.

Nguồn: [BookingDetailPanel.jsx:37](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:37), [khối đầu:40](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:40), [thân cuộn:110](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:110).

![Chi tiết booking tại 320 × 800, phần đầu chiếm 502 px](E:/Github/pms-system/docs/reports/frontend/assets/client-ux-2026-10-15/booking-mobile-320.png)

### UX-05 · P2 · Thao tác sơ đồ phòng mất ngữ cảnh

**Đã tái hiện:** chọn phòng trống 102 → Giữ phòng → form tạo vẫn yêu cầu kiểm tra và chọn phòng lại. Chọn phòng 101 có booking → Dịch vụ → mở tab Chi tiết. **Mã nguồn:** “Xem chi tiết phòng” của phòng trống cũng mở form tạo; Nhận phòng/Giữ phòng dùng cùng đường mở form.

**Đề xuất:** truyền phòng đã chọn vào form và vẫn kiểm tra lại tồn theo ngày; mở đúng tab Dịch vụ; đổi tên hành động mở form tạo thành **Đặt phòng này**. Phân biệt rõ mở booking để nhận phòng với tạo booking mới.

**Nghiệm thu:** chọn 102 thì thao tác tiếp theo giữ 102; nếu phòng hết phải giải thích và cho chọn lại. Dịch vụ mở đúng tab; nhãn hành động khớp kết quả.

Nguồn: [RoomDiagram.jsx:29](E:/Github/pms-system/frontend/src/apps/pms/rooms/pages/RoomDiagram.jsx:29), [các thao tác:71](E:/Github/pms-system/frontend/src/apps/pms/rooms/pages/RoomDiagram.jsx:71), [BookingModal không nhận phòng:85](E:/Github/pms-system/frontend/src/apps/pms/rooms/pages/RoomDiagram.jsx:85), [tab mặc định:11](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:11).

### UX-06 · P2 · Đổi loại báo cáo mất kỳ ngày

**Mã nguồn:** Outlet được tạo lại theo pathname; báo cáo doanh thu, công suất và chuyên sâu tự khởi tạo hôm nay → 7 ngày sau. Chọn kỳ tháng trước rồi đổi loại báo cáo phải chọn lại, dễ đối chiếu nhầm kỳ.

**Đề xuất:** giữ ngày bắt đầu/kết thúc trong query URL và chuyển tiếp khi đổi báo cáo. Giữ tiền tệ cơ sở của khách sạn như hiện tại.

**Nghiệm thu:** đổi qua ba nhóm và các báo cáo chuyên sâu vẫn giữ kỳ; tải lại URL khôi phục ngày; ngày không hợp lệ có giải thích rõ.

Nguồn: [PmsLayout.jsx:42](E:/Github/pms-system/frontend/src/apps/pms/layouts/PmsLayout.jsx:42), [Reports.jsx:23](E:/Github/pms-system/frontend/src/apps/pms/reports/pages/Reports.jsx:23), [BusinessReports.jsx:25](E:/Github/pms-system/frontend/src/apps/pms/reports/pages/BusinessReports.jsx:25).

### UX-07 · P2 · POS thiếu tổng tạm tính trước ghi nhận

**Mã nguồn:** bảng nháp có số lượng và đơn giá nhưng chưa có thành tiền từng dòng/tổng tạm tính. “Tổng đã lưu” chỉ xuất hiện khi đã có hóa đơn, có thể vẫn là tổng cũ khi đang sửa nháp tiếp.

**Đề xuất:** thêm thành tiền dòng và tổng tạm tính cập nhật khi nhập; tách rõ tổng đã lưu. Backend tiếp tục quyết định số tiền chính thức.

**Nghiệm thu:** 50.000 × 3 thấy 150.000 trước ghi nhận; đổi thành 4 thấy 200.000; dữ liệu nhập không hợp lệ không tạo tổng gây hiểu nhầm.

Nguồn: [Sales.jsx:54](E:/Github/pms-system/frontend/src/apps/pms/finance/pages/Sales.jsx:54), [tổng đã lưu:58](E:/Github/pms-system/frontend/src/apps/pms/finance/pages/Sales.jsx:58).

### UX-08 · P2 · Buồng phòng có điều khiển chưa có tác dụng

**Mã nguồn:** nút Lọc không có handler; checkbox đầu bảng/từng dòng không quản lý lựa chọn hoặc dẫn tới thao tác hàng loạt. Bộ lọc đang đổi tức thì, nên nút này khiến người dùng khó hiểu trạng thái áp dụng.

**Đề xuất:** bỏ nút Lọc khi dùng lọc tức thì; bỏ checkbox chưa có nghiệp vụ. Nếu sau này có thao tác hàng loạt, triển khai trọn luồng và phân quyền khi đó.

**Nghiệm thu:** mỗi điều khiển còn hiển thị đều có tác dụng quan sát được; số dòng và thông báo trống khớp điều kiện lọc.

Nguồn: [Housekeeping.jsx:98](E:/Github/pms-system/frontend/src/apps/pms/housekeeping/pages/Housekeeping.jsx:98), [checkbox:109](E:/Github/pms-system/frontend/src/apps/pms/housekeeping/pages/Housekeeping.jsx:109).

### UX-09 · P2 · Ghi chú dọn phòng thiếu lối lưu riêng

**Mã nguồn:** ghi chú chỉ được gửi cùng chuyển trạng thái. Muốn bổ sung lưu ý nhưng giữ trạng thái Chờ dọn không có thao tác rõ ràng.

**Đề xuất:** trước mắt ghi rõ **Ghi chú được lưu khi chuyển trạng thái**. Để có nút **Lưu ghi chú** riêng, cần backend hỗ trợ cập nhật note mà giữ nguyên trạng thái, kiểm tra tenant, quyền công việc và revision. API hiện tại bắt buộc chuyển sang trạng thái khác; không thể chỉ thêm nút gọi API cũ. Thông báo rõ khi dữ liệu đã bị người khác cập nhật.

**Nghiệm thu:** lưu ghi chú rồi tải lại vẫn còn, trạng thái không đổi; lỗi hoặc xung đột không làm mất nội dung vừa nhập.

Nguồn: [HousekeepingPlan.jsx:16](E:/Github/pms-system/frontend/src/apps/pms/housekeeping/pages/HousekeepingPlan.jsx:16), [vùng ghi chú:33](E:/Github/pms-system/frontend/src/apps/pms/housekeeping/pages/HousekeepingPlan.jsx:33), [API yêu cầu trạng thái:490](E:/Github/pms-system/backend/pms_api/housekeeping/routes.py:490), [kiểm tra chuyển trạng thái:509](E:/Github/pms-system/backend/pms_api/housekeeping/routes.py:509).

### UX-10 · P2 · Tồn kho chưa phân biệt dữ liệu trống và tìm không thấy

**Mã nguồn:** tìm tên/SKU và “Chỉ xem tồn thấp” lọc bảng nhưng các thẻ tổng vẫn theo toàn báo cáo. Khi không khớp dòng nào, màn hình lại hướng dẫn ghi tồn đầu kỳ/nhập kho dù kho có thể đã có hàng.

**Đề xuất:** ghi rõ phạm vi thẻ tổng theo kỳ/kho; kết quả tìm kiếm trống có lời giải thích và nút xóa bộ lọc. Chỉ hướng dẫn tạo tồn khi dữ liệu gốc thật sự trống.

**Nghiệm thu:** kho có hàng, tìm SKU không tồn tại → thấy “Không có mặt hàng khớp”; không bị hướng dẫn ghi tồn đầu kỳ; hiểu được thẻ tổng có đổi theo tìm kiếm hay không.

Nguồn: [InventoryStock.jsx:23](E:/Github/pms-system/frontend/src/apps/pms/inventory/pages/InventoryStock.jsx:23), [thẻ tổng:32](E:/Github/pms-system/frontend/src/apps/pms/inventory/pages/InventoryStock.jsx:32), [thông điệp trống:34](E:/Github/pms-system/frontend/src/apps/pms/inventory/pages/InventoryStock.jsx:34).

### UX-11 · P2 · Nút thu chi bị khóa nhưng thiếu cách xử lý

**Mã nguồn:** thiếu quỹ đang dùng đúng loại/tiền tệ thì các nút tạo phiếu bị khóa, chưa có giải thích tương ứng tại vị trí thao tác.

**Đề xuất:** hiển thị **Chưa có quỹ phù hợp đang hoạt động**, nêu tiền tệ/loại quỹ cần thiết và liên kết cài đặt quỹ nếu có quyền. Người không có quyền được hướng dẫn liên hệ quản lý.

**Nghiệm thu:** khách sạn mới biết cần thiết lập gì; có quỹ phù hợp thì nút hoạt động; vẫn phân biệt được bị khóa do quyền và do thiếu cấu hình.

Nguồn: [Cashflow.jsx:34](E:/Github/pms-system/frontend/src/apps/pms/finance/pages/Cashflow.jsx:34), [nút tạo:98](E:/Github/pms-system/frontend/src/apps/pms/finance/pages/Cashflow.jsx:98).

### UX-12 · P2 · Thao tác danh mục khó nhận biết

**Mã nguồn:** bấm Sửa chép dữ liệu vào dòng nhập ở cuối bảng, không đưa focus/cuộn tới đó; danh sách dài dễ khiến người dùng tưởng nút chưa hoạt động. Icon thùng rác lại dùng cho bật/tắt, kể cả bật lại; một số danh mục có thêm switch cho cùng thao tác.

**Đề xuất:** giữ cấu trúc bảng, đưa focus/cuộn tới form và ghi rõ bản ghi đang sửa. Bật/tắt dùng switch hoặc chữ **Ngừng dùng / Bật lại**, bỏ thao tác trùng; giữ lịch sử như hiện tại.

**Nghiệm thu:** với 30 bản ghi, sửa dòng đầu thấy ngay vị trí chỉnh sửa và nút Lưu/Hủy; biểu tượng không gợi ý xóa dữ liệu cho thao tác ngừng dùng; thao tác được bằng bàn phím.

Nguồn: [Settings.jsx:312](E:/Github/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:312), [nút sửa/bật tắt:345](E:/Github/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:345), [dòng nhập:347](E:/Github/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:347).

### UX-13 · P2 · Form chính sách cần phản hồi lưu và nhãn rõ hơn

**Mã nguồn:** Lưu chính sách chưa có trạng thái bận/chặn gửi lặp; lỗi và thành công cùng dùng một message/role status. Nhãn giờ và nội dung chưa liên kết với trường nhập. App đã có chỉ báo yêu cầu toàn cục; cần bổ sung phản hồi ngay tại form.

**Đề xuất:** dùng mẫu busy/error/success của form hồ sơ khách sạn hiện có; lỗi dùng alert, thành công dùng status; nối label với input/textarea. Kiểm tra việc lưu nội dung chính sách theo hợp đồng API trước khi báo thành công.

**Nghiệm thu:** mạng chậm có “Đang lưu”, chỉ một lần gửi đang chạy; lỗi rõ và giữ nội dung; bấm nhãn đặt focus đúng trường; mở lại thấy các trường đã được server lưu.

Nguồn: [Settings.jsx:439](E:/Github/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:439), [nhãn/biểu mẫu:450](E:/Github/pms-system/frontend/src/apps/pms/settings/pages/Settings.jsx:450), [RequestActivity.jsx:5](E:/Github/pms-system/frontend/src/shared/components/RequestActivity.jsx:5).

### UX-14 · P2 · Hồ sơ hiển thị trạng thái đơn hàng chưa dựa trên dữ liệu

**Mã nguồn:** tab Danh sách đơn hàng luôn hiển thị “Chưa có đơn hàng nào”, không truy vấn lịch sử. Người đã mua gói có thể hiểu rằng giao dịch của mình bị thiếu.

**Đề xuất:** ẩn tab cho tới khi hỗ trợ dữ liệu thật, hoặc thông báo đúng rằng lịch sử mua gói chưa được hỗ trợ tại đây. Không cần mở thêm dự án billing cho đợt chỉnh giao diện này.

**Nghiệm thu:** không hiển thị kết luận “không có đơn hàng” khi chưa lấy dữ liệu.

Nguồn: [Profile.jsx:106](E:/Github/pms-system/frontend/src/apps/pms/profile/pages/Profile.jsx:106).

### UX-15 · P2 · Màu trạng thái và công nợ chưa nhất quán

**Đã quan sát:** booking còn phải thu 200 ₫ vẫn hiện số dư xanh lá. **Mã nguồn:** badge trạng thái chi tiết dùng xanh cố định cho cả trạng thái hủy/không đến; danh sách đã có phân biệt trạng thái.

**Đề xuất:** tái dùng màu trạng thái từ danh sách; số dư có nhãn **Còn phải thu / Đã đủ / Cần hoàn** theo giá trị. Luôn kèm chữ để không phụ thuộc khả năng phân biệt màu.

**Nghiệm thu:** trạng thái và số dư dương/0/âm có nhãn đúng, nhất quán giữa danh sách và chi tiết; đo tương phản thực tế khi chỉnh CSS.

Nguồn: [BookingDetailPanel.jsx:50](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:50), [số dư:63](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:63), [Reservations.css:38](E:/Github/pms-system/frontend/src/apps/pms/reservations/pages/Reservations.css:38).

### UX-16 · P2 · Lịch đặt phòng khó chuyển tới ngày xa

**Mã nguồn:** lịch hiển thị 14 ngày, mũi tên nhảy từng 14 ngày và nhãn chỉ ghi tháng/năm. Xem vài tháng sau cần nhiều lần bấm; hai khoảng trong cùng tháng có cùng nhãn, khoảng qua tháng cũng khó nhận biết.

**Đề xuất:** thêm bộ chọn ngày bắt đầu và ghi rõ khoảng đang xem, ví dụ **15–28/10/2026**; giữ mũi tên và Hôm nay.

**Nghiệm thu:** chọn được ngày bất kỳ bằng một lần chọn; nhãn khớp đủ 14 cột, kể cả qua tháng/năm và theo múi giờ khách sạn.

Nguồn: [ARI.jsx:14](E:/Github/pms-system/frontend/src/apps/pms/rates-inventory/pages/ARI.jsx:14), [điều hướng lịch:33](E:/Github/pms-system/frontend/src/apps/pms/rates-inventory/pages/ARI.jsx:33).

## 5. Tinh gọn trình bày sau các mục trên — P3

1. **Thu gọn trường chưa triển khai ở chi tiết booking.** Các ô theo giờ, FOC, bữa sáng, số trẻ/em bé và RTC làm biểu mẫu dài; nhóm dưới “Thông tin bổ sung” hoặc ẩn chức năng chưa khả dụng. Các giá trị chỉ đọc có thể trình bày như thông tin thay vì nhiều ô nhập bị khóa. Không suy ra rằng cần triển khai các nghiệp vụ này ngay. Nguồn: [BookingDetailPanel.jsx:140](E:/Github/pms-system/frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:140).
2. **Chia giải thích báo cáo theo chỉ số.** Hiện toàn bộ định nghĩa tài chính được ghép thành một đoạn dài ở cuối trang. Đưa giải thích gần thẻ/cột tương ứng hoặc vào vùng “Cách tính”; giữ quy tắc ngày, tỷ giá và giới hạn nghiệp vụ đầy đủ. Nguồn: [Reports.jsx:169](E:/Github/pms-system/frontend/src/apps/pms/reports/pages/Reports.jsx:169).

Về độ rộng, nên dùng hết **vùng nội dung khả dụng** cho lịch, sơ đồ và bảng; giữ lề và chiều rộng đọc phù hợp cho biểu mẫu. Bảng/lịch có thể có vùng cuộn riêng, còn nhãn, bộ lọc, thông báo và nút phải co giãn trên màn hẹp. Không có căn cứ từ lượt rà này để kết luận mọi màn đều bị giới hạn độ rộng.

## 6. Thứ tự thực hiện đề xuất

| Đợt | Hạng mục | Kết quả cần đạt |
| --- | --- | --- |
| **1 — Độ tin cậy thao tác** | UX-01, UX-02, UX-03 | Lưu đúng phần đang sửa; không mất nháp âm thầm; hiểu tác động đến tiền trước xác nhận. Chốt hợp đồng báo giá chỉnh sửa với backend. |
| **2 — Nghiệp vụ hàng ngày** | UX-04 đến UX-11, UX-16 | Booking dùng tốt trên điện thoại; sơ đồ giữ đúng phòng/tab; lịch đến ngày xa nhanh; báo cáo giữ kỳ; POS có tổng; buồng phòng/kho/thu chi có đường thao tác rõ. UX-09 lưu ghi chú riêng cần bổ sung backend. |
| **3 — Nhất quán và tinh gọn** | UX-12 đến UX-15 và P3 | Danh mục dễ sửa, trạng thái và phản hồi nhất quán, giảm trường/thông tin gây nhiễu. |

Mỗi hạng mục nên là thay đổi nhỏ, kiểm chứng tại màn liên quan; tái dùng các mẫu đang có. Không cần thêm bộ thư viện UI hoặc viết lại toàn bộ layout để xử lý các phát hiện này. Chưa ước lượng thời gian vì chưa chốt thiết kế và hợp đồng API của UX-03/UX-09.

## 7. Checklist nghiệm thu cho đợt nâng cấp

- Desktop 1280/1440 px, tablet 768 px, mobile 320/375 px; tên khách và mã dài, bảng nhiều dòng. Các cỡ ngoài 1280/320 là yêu cầu kiểm tra tiếp, chưa phải đã đạt.
- Loading, mạng chậm, lỗi server, thử lại, dữ liệu thực sự trống, tìm kiếm không khớp và quyền chỉ xem.
- Bàn phím Tab/Shift+Tab/Escape, focus khi mở/đóng, nhãn liên kết trường, thông báo lỗi và tương phản. Giữ các cơ chế tiếp cận đã có.
- Nhập nháp → đổi tab/đóng/chuyển khách sạn; lưu thành công và lưu lỗi; dữ liệu vẫn đúng sau mở lại.
- Booking nhiều phòng, voucher, tiền đã thu; báo cáo qua tháng/năm; kho nhiều dòng; dữ liệu cập nhật từ máy khác.
- Bảng/lịch cuộn trong vùng riêng, nội dung thông thường không bị buộc cuộn cả hai chiều. Tham chiếu: [W3C — Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [W3C — Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html).

## 8. Giới hạn báo cáo

Đây là rà soát UX dựa trên mã và một số tình huống QA đã nêu, không phải kiểm thử toàn bộ nghiệp vụ, kiểm toán bảo mật, chứng nhận WCAG hay kết luận hệ thống đã sẵn sàng production. Chưa thử điện thoại thật, trình đọc màn hình, đo tương phản, dữ liệu lớn, các vai trò khác Owner, giao dịch tài chính, OTA staging/live hoặc Coolify. Không chạy lại test/build ứng dụng vì không thay đổi mã ứng dụng. Hai ảnh chỉ chứa dữ liệu giả.

Báo cáo ngày 03/10 trong cùng thư mục là ảnh chụp trạng thái cũ; các nhận xét “chưa có backend” ở tài liệu đó không được dùng làm hiện trạng cho báo cáo này.
