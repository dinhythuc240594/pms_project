# Kiểm thử frontend Client và chức năng còn thiếu

Ngày kiểm tra: **15/10/2026**, múi giờ **Asia/Saigon**.
Mốc kiểm thử ban đầu: **`0a746c1` — `fix: remove currency filters from client reports`**.
Mốc đối chiếu source cập nhật: **`26e45ae` — `Update button language`**.
Các sửa lỗi QA đã được commit; sau đó dự án có thêm i18n và các layout
buồng phòng/OTA. Kết quả browser bên dưới ghi nhận các trường hợp đã thử trong
lượt QA, không tự xác nhận mọi layout mới đều đã được kiểm lại.

Bổ sung cuối lượt: thay trạng thái kiểm tra phiên/tải khách sạn bằng
`LohaLoading`, dùng lại logo và spinner có sẵn; chỉ đổi hiển thị, giữ nguyên
điều kiện phiên, quyền, lỗi và chuyển trang.

Đối chiếu với [thiết kế hệ thống](../../../pms_system_design_final.md) và
[báo cáo chức năng ngày 14/10](../reviews/remaining-functions-2026-10-14.md).
Kết quả local không xác nhận phiên bản trên Coolify đã được triển khai.

## 1. Phạm vi và cách đọc kết quả

- **Browser + API thật:** thao tác giao diện Client trên môi trường local, dùng
  backend và PostgreSQL kiểm thử riêng. Dữ liệu booking, thanh toán, kho và tài
  khoản đều là dữ liệu kiểm thử; không dùng giao dịch thật hoặc OTA thật.
- **Đọc source:** truy vết giao diện, API, model và bộ kiểm thử để xác nhận phần
  nào đã có, phần nào mới là danh mục/placeholder. Đây không phải bằng chứng đã
  nghiệm thu trong trình duyệt.
- **Chưa kiểm chứng:** provider ngoài, cấu hình triển khai thật, tải và những
  tình huống chưa được liệt kê. Một luồng đạt không có nghĩa mọi tổ hợp đầu vào
  của cả phân hệ đều đã đạt.

Phạm vi chính là `/id`: đặt phòng, sơ đồ/lịch phòng, POS, thu chi, giá, kho,
buồng phòng, báo cáo, cài đặt và tài khoản. Manager/marketing chỉ được đọc khi
liên quan trực tiếp đến luồng Client; không kiểm thử toàn bộ hai phân hệ đó.

Các quyết định mới của dự án được ưu tiên hơn thiết kế gốc:

- Đã chủ đích bỏ quản lý khách hàng độc lập và route `/guests`. Hồ sơ khách
  lưu trú được quản lý trong booking; không ghi việc bỏ route này là lỗi.
- Báo cáo Client đã bỏ bộ lọc tiền tệ theo yêu cầu. Báo cáo dùng tiền cơ sở
  khách sạn và dữ liệu quy đổi đã lưu; không yêu cầu thêm lại bộ lọc.
- **Kênh OTA chỉ nằm trong Cài đặt khách sạn**. `/id/ota` và
  `/id/ota-history` là đường dẫn tương thích chuyển về Cài đặt, không phải
  menu sidebar cần khôi phục.
- No-show chỉ ghi nhận trạng thái, không tự tính phí. Checkout bị chặn khi
  còn số dư. Hoa hồng nguồn tính trên tiền phòng sau giảm giá.

## 2. Kết quả đã kiểm chứng trong browser

Các dòng dưới mô tả những trường hợp đã thực sự thao tác. Kết quả cuối của
kiểm thử vai trò và các lệnh tự động được cập nhật tại mục 4.

| Nhóm | Trường hợp đã thử | Kết quả |
| --- | --- | --- |
| Tạo booking | Booking hai phòng 101 + 102, 18–19/10/2026, tổng 1.000.000 VND | Tạo thành công trên API thật; lưu được email khách và ghi chú. |
| Thanh toán và checkout | Booking đang ở: thu 500.000/1.000.000 VND rồi thử checkout; thu nốt 500.000 VND | Checkout bị khóa khi chưa đủ tiền; thanh toán đủ rồi checkout thành công. |
| No-show | Booking đã xác nhận, tới ngày nhận phòng, tiền phòng 1.000.000 VND, cọc 200.000 VND | Ghi nhận no-show; giữ nguyên tiền phòng, cọc và dư nợ 800.000 VND; không phát sinh phí tự động. |
| Chi tiết POS khi đọc chậm | Giữ GET chi tiết khoảng 8 giây | Nút tạo và các nút mở chi tiết bị khóa; sau đó mở đúng hóa đơn. Trường hợp này không phải request ghi hoặc chi tiết booking. |
| Chi tiết booking trên điện thoại | Màn hình 320px | Đã tái hiện nút đóng vượt mép phải; sửa cho nhóm thao tác xuống dòng và kiểm lại nút đóng nằm trong màn hình. |
| Nguồn đặt phòng | Nhập hoa hồng 101%; sau đó tạo Travel Agency hoa hồng 12,5% | 101% bị chặn bởi kiểm tra biểu mẫu; nguồn hợp lệ lưu và tải lại còn dữ liệu. |
| Nguồn đặt phòng khi ghi chậm | Giữ POST khoảng 6 giây | Khóa ô nhập và nhóm loại nguồn trong khi lưu; tránh mất bản nháp do đổi loại/sửa dòng khác. |
| Chính sách khách sạn | Đổi nội dung chính sách, giữ PATCH khoảng 6 giây, tải lại | Khóa trường khi đang lưu; nội dung đã sửa được giữ sau tải lại. Chưa thao tác đổi giờ trong ca thử này. |
| Đổi khách sạn | Lưu chính sách tại Riverside, tải lại; chuyển sang Seaside rồi chuyển lại | Riverside giữ nội dung riêng; Seaside không hiện chính sách của Riverside; quay lại Riverside vẫn đúng dữ liệu. |
| Giá và phòng trống | Giá cơ bản, ma trận, ngày không liền nhau, đóng/mở bán, ARI | Đã thử cập nhật và kiểm tra dữ liệu tương ứng. |
| Voucher/giá nâng cao/khuyến mãi/tỷ giá | Tạo và cập nhật voucher, quy tắc giá, khuyến mãi, tỷ giá | Đã thử các luồng ghi và xem lại dữ liệu. |
| Kho | Nhập, xuất, kiểm kê, chuyển kho, trả hàng từ POS và các thao tác đảo liên quan | Đã thử các luồng chứng từ và tồn kho tương ứng. |
| POS | Thanh toán một phần, hoàn tiền, hủy và hoàn vượt số đã thu | Luồng hợp lệ chạy được; hoàn vượt số cho phép bị chặn. |
| Thu chi | Phiếu thu, phiếu chi, đảo phiếu, chuyển quỹ ngân hàng | Đã thử ghi và xem lại các giao dịch tương ứng. |
| Hoa hồng nguồn | Chi hoa hồng và đảo phiếu chi | Đã thử giao dịch và phần hoa hồng còn phải chi. Không đưa lại submenu Hoa hồng vào Tài chính & thu chi. |
| Lỗi ghi tiền và thử lại | Mô phỏng lỗi 503, giữ bản nháp, thử lại; thử tạo trùng số dư đầu kỳ | Bản nháp được giữ; thử lại không tạo hai giao dịch. Luồng số dư đầu kỳ kiểm tra trường hợp trùng. |
| Báo cáo | Hai báo cáo cơ bản và sáu báo cáo chuyên sâu; tải CSV Nguồn/Quốc tịch | Đã mở các báo cáo và kiểm tra hai loại CSV trên dữ liệu kiểm thử. |
| Responsive | Giá/kho/báo cáo ở 320px và 768px | Đã kiểm tra các màn hình này. Không suy rộng thành mọi trang/mọi thiết bị đều đã đạt. |
| Buồng phòng | Gán phòng 102, bắt đầu → chờ kiểm tra → hoàn thành; để ghi chú chưa lưu hơn 30 giây | Toàn bộ chuỗi trạng thái đạt; bản nháp vẫn còn sau đọc lại nền. |
| Sơ đồ phòng | Sau hoàn thành dọn phòng 102 | Phòng 102 hiển thị sạch, tổng hai phòng sẵn sàng; không có nút tạo đặt phòng độc lập như yêu cầu đã chốt. |
| Lịch đặt phòng | Tìm booking nhiều phòng | Booking hai phòng có hai thanh lịch; thanh của khách khác bị lọc đi; mở thanh lịch vào đúng booking. |
| Chờ kiểm tra phiên | Giữ GET phiên đăng nhập, kiểm tra ở 320/768/1024/1440px | Hiển thị logo LOHA, thông báo và spinner; không tràn ngang. Dùng chung Client/Manager, có ba ngôn ngữ và tôn trọng giảm chuyển động. |
| Khôi phục sau lỗi kiểm tra phiên | GET phiên trả 503, sau đó khôi phục API và bấm Thử lại | Hiện trang lỗi 503 với nút thử lại; khi không có phiên hợp lệ thì về đăng nhập. Đăng nhập được, hiện trạng thái chờ dữ liệu rồi vào Tổng quan; không kẹt loading. |

## 3. Lỗi đã sửa hoặc đang xác minh lại

| Vấn đề | Nguyên nhân và thay đổi | Trạng thái kiểm chứng |
| --- | --- | --- |
| Lưu chính sách có thể gửi lại hồ sơ khách sạn cũ | `BusinessPolicies` từng giữ toàn bộ `settings` rồi gửi toàn bộ khi lưu giờ/nội dung. Đổi thành bản nháp và payload chỉ có ba trường của chính sách. | Source đã sửa; browser lưu/chậm/tải lại đạt. |
| Đổi nguồn/sửa dòng mới trong lúc nguồn cũ đang lưu | `BookingSources` thiếu trạng thái chờ và chặn gửi lặp. Thêm form, kiểm tra dữ liệu trình duyệt, khóa đồng thời các thao tác và giữ bản nháp khi lỗi. | Browser giá trị 101%, lưu hợp lệ và POST chậm đạt. |
| Nút đóng chi tiết booking bị cắt ở 320px | Nhóm thao tác không xuống dòng. Cho nhóm nút xuống dòng và giới hạn chiều rộng theo màn hình. | Browser đã tái hiện và kiểm lại đạt. |
| Bản nháp kho có thể mất khi tải lại danh mục dùng chung | Khi query chuyển sang loading, editor bị bỏ khỏi cây giao diện. Giữ dữ liệu gần nhất để editor còn được gắn trong lúc đọc lại. | Đã thử lại hai lần: giữ được bản nháp ở editor còn lại khi tải lại danh mục. |
| Hộp thông báo lỗi chung bị che bởi hộp thoại native | Độ ưu tiên hiển thị của native dialog cao hơn phần tử overlay thường. Cho thông báo truy cập/lỗi chung dùng native modal qua `LegacyOverlay`. | Đã thử thu chi trả 503: đóng thông báo được, form còn số tiền 2.468; thử lại tạo đúng một dòng 2.468. |

Toggle trong Settings đã dùng button native với `role="switch"`,
`aria-checked`, nhãn và trạng thái disabled tại mốc source đang kiểm tra.
Lượt này bổ sung nhãn rõ cho hai caller còn lại; không ghi đó là toàn bộ
chức năng mới được xây từ đầu.

## 4. Kết quả lệnh kiểm tra và phân quyền

| Kiểm tra | Trạng thái tại lúc lập báo cáo |
| --- | --- |
| Lint riêng `Settings.jsx` sau sửa QA | Đạt: 0 lỗi, còn 2 cảnh báo cũ tại thời điểm chạy. Các commit i18n sau đó đã thay đổi file. |
| Kiểm tra khoảng trắng của diff sau sửa Settings | Đạt. |
| Toàn bộ test frontend sau UI chờ phiên và i18n mới | **139 test đạt, 0 thất bại, 0 bỏ qua**. Gồm kiểm tra đồng bộ khóa dịch và các kiểm tra nghiệp vụ hiện có; không phải 139 ca end-to-end browser. |
| Production build sau UI chờ phiên | Đạt trên HEAD `26e45ae` kèm thay đổi UI chờ. |
| Lint toàn bộ frontend sau UI chờ phiên | Thoát thành công, 0 lỗi; còn cảnh báo có sẵn về hook/effect/ref và import không dùng. Chưa xử lý toàn bộ nợ lint. |
| Chủ khách sạn | Đã thử các nghiệp vụ ghi ở mục 2; không đồng nghĩa toàn bộ cấu hình quyền đã được nghiệm thu. |
| Lễ tân | Mở được ba màn cấu hình/kênh/lịch sử OTA ở chế độ xem tại mốc QA; truy cập trực tiếp cài đặt doanh nghiệp bị 403. |
| Kế toán | Truy cập OTA bị 403; mở báo cáo doanh thu được. |
| Buồng phòng | OTA bị 403; kế hoạch chỉ hiện một công việc được giao và trạng thái đã hoàn tất. Chuỗi xác nhận sạch tại mục 2 được thao tác bằng chủ khách sạn. |
| Hai khách sạn | Chính sách Riverside/Seaside không lẫn dữ liệu khi đổi khách sạn và tải lại, như mục 2. Chưa suy rộng thành mọi màn đều được thử đổi tenant. |
| Phiên không hợp lệ | Xác nhận về trang đăng nhập khi không có phiên; 503 khi kiểm tra phiên hiện lỗi và cho thử lại. Chưa thử mọi tình huống hết phiên giữa lúc đang ghi. |
| 404 và đổi tài khoản khi request đang chạy | Chưa có ca browser được chốt trong báo cáo này. |
| Buồng phòng: phân công → bắt đầu → kiểm tra → hoàn thành | Đạt trên dữ liệu kiểm thử. |
| Hộp lỗi thu chi khi mở native dialog | Đạt với ca 503, đóng thông báo, giữ bản nháp và thử lại không tạo trùng. |

**Kiểm tra sau commit mới:** đã chạy lại test/build/lint sau UI chờ và ba khóa
dịch mới. Số cũ 127 đã được thay bằng 139 ở trên, không cộng hai lượt với nhau.
Những layout mới ngoài phần chờ không được mặc định coi là đã kiểm lại toàn bộ.

Chưa kiểm thử đầy đủ: mọi danh mục Settings/nhân viên, đổi mật khẩu qua browser,
thu hồi các phiên khác, toàn bộ tùy chọn thông báo, mọi loại CSV và mọi tổ hợp
lỗi/chậm trên từng route. Các mục này là khoảng trống kiểm thử, không tự suy ra
chức năng chưa được lập trình.

Không cộng các test chồng lặp thành một tổng giả. Kết quả browser, test hàm và
build kiểm chứng các khía cạnh khác nhau; build đạt không chứng minh nghiệp vụ
hoặc phân quyền đã đúng.

## 5. Chức năng còn thiếu theo thiết kế

Đây là **backlog xác minh bằng source**, không phải danh sách lỗi browser mới
phát sinh. Ưu tiên dưới đây là đề xuất cho việc hoàn thiện Client. Các quy tắc
tài chính mới phải được chốt trước khi triển khai; không tự suy diễn từ tên ô
trong giao diện.

| Mã | Ưu tiên | Chức năng còn lại | Bằng chứng và phần đã có | Bước hoàn thiện nhỏ nhất |
| --- | --- | --- | --- | --- |
| CL-01 | P1 | Night Audit/chốt ngày kinh doanh | Thiết kế mục 1.9 yêu cầu Night Audit. `backend/pms_api/reports/urls.py` hiện có dashboard/revenue/financial/business; `Reports.jsx` ghi nhận doanh thu hóa đơn đã chốt. Chưa có quy trình kiểm tra/khóa ngày kinh doanh. | Chốt phạm vi chốt ngày và ghi nhận tiền; làm màn kiểm tra sai lệch và lịch sử chốt trước khi tự sinh bút toán. |
| CL-02 | P1 | Chuyển phòng/gia hạn khi đang ở | `backend/pms_api/bookings/routes.py`, `EditReservationView`, trả `409 stay_started` nếu đổi phòng/ngày khi IN_HOUSE. `BookingDetailPanel.jsx` chỉ cho sửa các trường đó khi CONFIRMED. Đổi trước check-in đã có. | Bổ sung luồng riêng có kiểm tra tồn, giá mới, tiền đã thu và công việc buồng phòng. |
| CL-03 | P1 | Bữa sáng và phân loại tuổi trong booking | Checkbox bữa sáng và trường người lớn/trẻ em/em bé ở `BookingDetailPanel.jsx` đang disabled/chưa triển khai. `Settings.jsx`, `Meals`, mới CRUD tên/phụ thu. Hồ sơ nhiều khách và kiểm tra sức chứa tổng đã có. | Nối cấu hình bữa ăn/số khách vào booking và gói giá; chốt phụ thu và cách nhận dữ liệu OTA. |
| CL-04 | P1 | Tự áp chính sách thuế/phí/cọc/hủy/trẻ em/nhận sớm trả muộn | `BusinessPolicies` mới lưu giờ và nội dung. `catalog/routes.py`, `DEFAULT_SETTINGS`, chưa có engine các chính sách trên. Booking đã thêm thuế/phí/giảm giá thủ công được. | Chốt từng quy tắc, lưu snapshot khi tính tiền; làm từng chính sách thay vì biến văn bản thành công thức ngầm. |
| CL-05 | P2 | Thuê giờ và FOC | `BookingDetailPanel.jsx` vẫn disabled hai tùy chọn. `bookings/models.py` dùng ngày và ràng buộc checkout sau check-in. | Xác định giá/thời lượng/đụng lịch và quyền miễn phí trước khi mở thao tác. |
| CL-06 | P2 | Báo cáo chi tiết còn lại | `BusinessReports.jsx` và `reports/routes.py`, `BusinessReportView`, hỗ trợ sáu báo cáo chuyên sâu. Chưa có các màn theo kỳ cho danh sách đến/đi/ở, booking theo nhân viên/gói giá, bữa sáng và dịch vụ theo nhóm. **ADR, tiền cọc, công nợ, sổ quỹ, kho, hoa hồng đã có chỉ tiêu hoặc màn tương ứng.** | Chọn báo cáo cần vận hành trước, dùng API định nghĩa số liệu và bộ lọc riêng; không chỉ nhân bản bảng frontend. |
| CL-07 | P2 | Thông báo theo lịch, email và webhook gửi ra | `notifications.py`, `EVENTS`, có chín sự kiện tức thời; thiếu nhắc đến/đi, quá hạn thanh toán, sắp hết phòng, tổng hợp ngày và trial. `NotificationBell.jsx` mới cấu hình vai trò nhận in-app. Webhook **nhận Channex** đã có. | Chốt lịch/người nhận, chọn provider gửi ngoài; thêm worker và trạng thái gửi/thử lại. |
| CL-08 | P2 | Lịch sử đơn hàng và mua/gia hạn gói tự phục vụ | `Profile.jsx`, tab orders, hiện trả empty state cố định. Các invoice API trong `saas_billing/routes.py` dùng `require_system`. Billing Manager thủ công và marketing lấy gói/tính năng từ API đã có. | Thêm API lịch sử chỉ đọc theo tenant cho Client trước; payment gateway và tự gia hạn làm sau khi chốt cách thu tiền. |
| CL-09 | P2 | Tự đăng ký và khôi phục mật khẩu | `Login.jsx` yêu cầu liên hệ quản trị khi quên mật khẩu; `auth/urls.py` chưa có luồng reset token/email hoặc tự đăng ký. Đổi mật khẩu khi đã đăng nhập đã có. | Chọn nhà cung cấp email và luồng cấp tài khoản; làm reset một lần, có hạn sử dụng. |
| CL-10 | P2 | Bảo mật nâng cao | Settings bọc `AdvancedSecurity` bằng `FutureSettings` disabled/inert. Chưa có 2FA, IP whitelist và mật khẩu định kỳ. **Session, CSRF, RLS, phân quyền, đổi mật khẩu và nhật ký hiện có không được tính là chưa làm.** | Chốt phạm vi từng tính năng; ưu tiên 2FA cho tài khoản quản trị nếu đưa vào đợt phát hành. |
| CL-11 | P2 | Gắn loại giường vào phòng/loại phòng | `Settings.jsx`, `BedTypes`, chỉ CRUD tên; `RoomTypesGrid` và `catalog/models.py` chưa có liên kết loại giường. | Nối danh mục với loại phòng; xác định một hay nhiều loại giường cho mỗi loại phòng. |
| CL-12 | P2 | Ca buồng phòng qua đêm và lịch sử hoạt động dài hạn | `housekeeping/routes.py`, `shift_times`, vẫn từ chối giờ kết thúc trước/bằng giờ bắt đầu. Snapshot work log mới nhất còn giới hạn 100 dòng. **Lịch công việc/ca theo khoảng 1–31 ngày và tạo công việc thủ công đã có**, không tính các phần đó là thiếu; query khoảng ngày không còn bị cắt 500 dòng như snapshot. | Dùng ngày/giờ kết thúc rõ ràng cho ca qua đêm; thêm lọc/phân trang API cho work log dài hạn. |
| CL-13 | P2 | Hoa hồng nhân viên/đối tác theo quy tắc | Settings nêu rõ danh mục loại chi phí/đối tượng chưa liên kết đối soát nguồn. Hoa hồng **nguồn đặt phòng sau giảm giá** đã có luồng chốt/chi/đảo. | Chốt đối tượng, cơ sở và thời điểm chốt trước khi nối danh mục này vào giao dịch. |
| CL-14 | P3 | Upload logo khách sạn | Hồ sơ hiện nhận URL logo HTTPS, chưa có tải tệp lên. **i18n đã có** tại `shared/i18n`: Việt/Anh/Trung, lưu lựa chọn ở trình duyệt, đổi locale hiển thị; không tiếp tục báo thiếu toàn bộ dịch giao diện. | Chỉ thêm upload nếu cần trong phạm vi phát hành; không gọi phần lưu hồ sơ hiện tại là hỏng. |
| CL-15 | P2 | Dùng thống nhất danh mục đơn vị tính cho hàng hóa/dịch vụ | `InventorySettings.jsx`, `definitions.items`, hiện dùng ô text `unit`. API `inventory/routes.py` nhận `unitId` và kiểm tra danh mục nếu được gửi, nhưng vẫn nhận `unit` tự do; dịch vụ ở Settings chọn đơn vị bằng tên và cũng lưu tên. Danh mục đơn vị đã CRUD được. | Cho hàng hóa chọn `unitId` từ danh mục, giữ tên đơn vị làm snapshot hiển thị; chốt cách xử lý dữ liệu tên tự do cũ và dịch vụ để đổi tên/bật tắt đơn vị không tạo hai nguồn dữ liệu rời nhau. |

Các thay đổi mới đã xác minh qua source tại `26e45ae`: bộ chọn ngôn ngữ và ba
bộ từ điển, lịch công việc/ca buồng phòng theo khoảng ngày, tạo việc thủ công,
và màn tích hợp Channex tập trung trong Cài đặt. Theo
[README i18n](../../../frontend/src/shared/i18n/README.md), một số nội dung
chuyên sâu và thông báo backend vẫn giữ văn bản gốc. Đây là phạm vi dịch còn
hoàn thiện, không phải thiếu nền tảng i18n. Chưa thực hiện lại mọi luồng browser
bằng cả ba ngôn ngữ hoặc trên toàn bộ layout mới trong báo cáo này.

Các backlog trên không thay đổi quy tắc **chặn checkout khi còn nợ**. Việc có
phương thức mang tên CITY_LEDGER trong danh mục chưa tương đương luồng cho doanh
nghiệp trả sau. Nếu cần luồng đó, phải chốt công nợ riêng; không tự dùng tên
phương thức để bỏ kiểm tra thanh toán.

Mobile/push, Zalo/SMS và API cho đối tác thuộc **Phase 2** trong thiết kế. Chưa
đưa các mục này vào nhóm lỗi chặn MVP hoặc tự thêm provider/tích hợp mới.

## 6. Đã có code nhưng còn phải nghiệm thu môi trường thật

- Channex: danh mục property/room/rate thật, tạo/sửa/hủy booking OTA, ARI,
  webhook lặp/mất, ACK, OAuth của kênh yêu cầu xác nhận ngoài và quyền tài khoản.
  Không dùng kết quả local để khẳng định tài khoản trả phí/production hoạt động.
- Worker Channex, worker tạo kế hoạch buồng phòng, migration và biến môi trường
  trên Coolify. Code worker tồn tại không chứng minh tiến trình đã chạy trên host.
- Backup/restore, tải đồng thời thực tế và độ trễ đọc lại giữa nhân viên.
  Workspace hiện đọc lại nền khoảng 30 giây; chưa phải cập nhật WebSocket tức thời.
- In ra máy in, hóa đơn thuế/ký số và kiểm thử thiết bị di động thật. Phiếu nội
  bộ/CSV hiện có không tương đương hóa đơn điện tử.

## 7. Thứ tự đề xuất tiếp theo

1. Nghiệm thu trên staging những luồng Channex/worker và cấu hình triển khai ở
   mục 6; kiểm lại các layout/i18n vừa đổi ngoài phạm vi đã xác nhận ở mục 4.
2. Ưu tiên **CL-02: chuyển phòng/gia hạn khi đang ở**, vì đây là ngoại lệ thường
   gặp trong vận hành, hiện backend chủ động chặn.
3. Chốt quy tắc **CL-01/CL-04** trước khi tự động hóa doanh thu/chính sách tiền.
4. Nối bữa ăn/số khách và hoàn thiện các báo cáo cần dùng thực tế; các tiện ích
   tự phục vụ và Phase 2 xếp sau theo phạm vi phát hành.

Không suy ra phần trăm hoàn thành dự án từ số trang hoặc số test. Báo cáo này
ghi lại phạm vi đã kiểm chứng và phần chưa hoàn thiện tại mốc source nêu trên.
