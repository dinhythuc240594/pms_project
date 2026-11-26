# Báo cáo backend → Client và ưu tiên tiếp theo

Ngày rà soát: **03/10/2026**. Source tại commit `d1db3ef`. Phạm vi: đối chiếu code, kế hoạch BE và `pms_system_design_final.md`; môi trường đã kiểm chứng trước đó là local. Chưa có bằng chứng backend đã triển khai và chạy nghiệp vụ trên Coolify.

## 1. Đã làm đến đâu

**Lõi BE-01–05 đã nối với giao diện Client bằng API/PostgreSQL thật.** Luồng đã kiểm chứng:

`Cấu hình phòng → đặt phòng nhiều phòng/khách → cọc → nhận phòng → dịch vụ → thanh toán đủ → checkout → phòng bẩn → dọn sạch`.

Giao diện Client hiện có được giữ. Booking, khách, giá và giao dịch trong luồng này lấy từ server, giữ sau tải lại và tách theo khách sạn. Dữ liệu demo localStorage cũ không được nhập tự động vào database.

| Nhóm | Backend hiện có | Client đã nối | Giới hạn còn lại |
| --- | --- | --- | --- |
| **BE-01 — P0** | Login/logout/session, hash mật khẩu, CSRF, giới hạn đăng nhập, tenant/membership, role API, RLS và audit; Admin tạo khách sạn/cấp Owner; Owner quản lý nhân viên | Login, chọn khách sạn, User Management; Admin Tenants và logs | Chưa có subscription/feature gating/quota của hai gói; quản trị nhân viên nội bộ nâng cao chưa hoàn tất |
| **BE-02 — P0** | Hồ sơ/cấu hình khách sạn, timezone/tiền tệ, hạng phòng/phòng, giá cơ bản, nguồn booking, dịch vụ, phương thức thanh toán và quỹ | Settings và danh mục dùng trong form booking/thanh toán | Chưa hoàn tất mọi settings trong thiết kế: kho, tỷ giá, hoa hồng và bảo mật nâng cao vẫn khóa |
| **BE-03 — P0** | Giá theo ngày, báo giá server, stop-sell, khóa/bảo trì phòng và tồn phòng | Rates, nightly rates, matrix giá/tồn, ARI | Chưa chính sách cuối tuần/LOS, voucher, promotions và quy đổi ngoại tệ |
| **BE-04 — P0** | Hồ sơ khách, booking nhiều phòng/khách, tạo/sửa/hủy, snapshot giá, chống trùng đồng thời, check-in | Reservations, chi tiết booking, Tape Chart, sơ đồ phòng và Guests | Đã nhận phòng thì chưa đổi phòng/ngày trong luồng hiện tại; chưa no-show và các luồng lưu trú nâng cao |
| **BE-05 — P0** | Dịch vụ/phí/thuế/chiết khấu, cọc/thu/hoàn, ledger, công nợ, ghi chú/lịch sử và checkout | Các tab booking, thanh toán và sổ giao dịch quỹ | Thuế/phí nhập bằng dòng tiền thủ công; chưa POS/hóa đơn độc lập hoặc điều chỉnh sau checkout |

**Quy tắc đã chốt:** checkout bị chặn khi booking còn nợ; API và giao diện cùng thực thi. Checkout thành công chuyển các phòng sang bẩn.

Nguồn: [báo cáo triển khai BE-01–05](../backend/BE01_05_IMPLEMENTATION_REPORT.md), [API contract](../../../backend/API_CONTRACT.md), [Provider gọi API](../../../frontend/src/apps/pms/data/PmsProvider.jsx), [workspace backend](../../../backend/pms_api/__init__.py), [booking API](../../../backend/pms_api/bookings/routes.py).

## 2. Những màn hình mới hoàn thành một phần

| Màn hình | Phần dùng dữ liệu thật | Phần chưa hoàn tất |
| --- | --- | --- |
| **Dashboard** | Bốn chỉ số khách/phòng đến, đi, đang ở và công suất tính từ bookings server | Biểu đồ, danh sách/công việc phía dưới là nội dung xem trước; bộ chọn tuần/tháng chưa điều khiển dữ liệu; chưa API tổng hợp |
| **Reports** | Tiền phòng dự kiến theo nightly snapshot và công suất đặt phòng, tính ở Client từ workspace thật | Chưa doanh thu ghi nhận/thực thu/cọc/nợ/ADR/Night Audit và báo cáo kế toán đầy đủ. Công suất lưu trú lịch sử cần tính riêng; công thức phòng đang giữ hiện không tính booking đã checkout |
| **Cashflow / Bank** | Thu và hoàn từ booking, ledger tách quỹ tiền mặt/ngân hàng | Chưa phiếu thu/chi độc lập, số dư đầu kỳ, rút/chuyển quỹ, lọc kỳ đầy đủ và đối soát số dư đầu–cuối |
| **Housekeeping** | Sạch/bẩn/bảo trì và nhật ký người/thời gian thao tác; checkout chuyển bẩn | Staff/Plan chưa có nhân viên, ca, nhiệm vụ hoặc tự sinh kế hoạch dọn; trạng thái đang kiểm tra chưa có |
| **Profile / Users** | Đổi mật khẩu bản thân; tạo nhân viên và cập nhật quyền/trạng thái | Chưa sửa đầy đủ hồ sơ cá nhân, reset mật khẩu nhân viên hoặc quản lý phiên từ xa |

Các trang **POS/Sales, kho, OTA, voucher/promotions, Housekeeping Staff/Plan** còn giao diện mẫu. `RouteGuard` bọc các trang này bằng `fieldset disabled inert` và hiển thị thông báo chưa triển khai. Các trang Billing/Features/Global Users của Manager cũng chưa có nghiệp vụ thật. Không dùng việc nhìn thấy màn hình làm bằng chứng đã có API.

Provider hiện tải workspace khi vào/chuyển khách sạn và sau thao tác trên chính máy đó. **Chưa tự cập nhật thay đổi từ máy lễ tân khác** bằng polling hoặc kênh sự kiện; máy thứ hai cần tải lại. Server vẫn kiểm tra tồn phòng và đặt trùng khi ghi.

Nguồn: [Dashboard](../../../frontend/src/apps/pms/dashboard/pages/Dashboard.jsx), [Reports](../../../frontend/src/apps/pms/reports/pages/Reports.jsx), [Cashflow](../../../frontend/src/apps/pms/finance/pages/Cashflow.jsx), [Housekeeping](../../../frontend/src/apps/pms/housekeeping/pages/Housekeeping.jsx), [RouteGuard](../../../frontend/src/shared/components/AccessControl.jsx), [Provider](../../../frontend/src/apps/pms/data/PmsProvider.jsx).

## 3. Ưu tiên backend và Client

Giữ nguyên mã BE trong kế hoạch. Mức ưu tiên dưới đây là đề xuất sau rà soát, chưa phải các chức năng đã triển khai. Mỗi mục cần hoàn tất migration → API → nối giao diện hiện có → kiểm chứng.

| Thứ tự | Mã / mức | Backend cần làm | Client cần nối | Điều kiện nghiệm thu |
| --- | --- | --- | --- | --- |
| **1** | **Triển khai / P0 trước sử dụng thật** | DB runtime/migration riêng, migration trên host, API HTTPS, cấu hình môi trường và backup/restore | URL API production, login/session/CORS/CSRF qua domain thật | `/api/ready` 200; luồng booking→tiền→checkout qua Tunnel; hai tenant không lẫn; thử phục hồi database |
| **2** | **Đồng bộ nhiều máy / P1** | Cơ chế đọc thay đổi hoặc phiên bản dữ liệu, tiếp tục kiểm tra tồn/quyền ở server | Tự refresh khi quay lại tab và theo chu kỳ hoặc sự kiện; xử lý thay đổi trong lúc mở panel | Máy A tạo/sửa booking hoặc dọn phòng; máy B thấy cập nhật trong khoảng trễ đã chốt; không mất dữ liệu form và không lẫn tenant |
| **3** | **BE-06 / P1 — POS và thu chi** | Hóa đơn/nháp/bán lẻ/ghi booking; phiếu thu/chi độc lập; tồn đầu kỳ, rút/chuyển quỹ; hoàn/hủy/điều chỉnh có đối ứng | Sales, Cashflow và Bank; lọc kỳ/quỹ/nhân viên và tìm lại chứng từ | POS hoặc booking chỉ ghi tiền một lần; chuyển quỹ cân hai đầu; số dư đầu + thu − chi = số dư cuối; không xóa lịch sử tiền |
| **4** | **BE-08 / P1 — Dashboard và báo cáo** | API tổng hợp theo tenant/kỳ; định nghĩa riêng doanh thu, thực thu, cọc và nợ; khách đến/đi/ở, công suất lưu trú, ADR | Thay biểu đồ/bảng preview; bộ lọc hoạt động; báo cáo cơ bản và xuất dữ liệu | Bộ số liệu đã biết đối soát khớp booking/ledger; checkout không làm mất công suất quá khứ; không cộng lẫn tiền tệ |
| **5** | **BE-07 / P1 — Buồng phòng đầy đủ** | Nhân viên, ca, giao việc, kế hoạch check-in/check-out/stay-over; đang kiểm tra và lịch sử | Housekeeping Staff/Plan và các thao tác trạng thái | Checkout sinh việc dọn; người đúng quyền nhận/hoàn thành việc; phòng cập nhật trên lịch/sơ đồ và có nhật ký |
| **6** | **BE-09 / P1; P0 trước mở SaaS trả phí/dùng thử** | Đúng hai gói, feature overrides, quota, hết hạn/gia hạn và lịch sử; thực thi tại API | Admin Billing/Features → trạng thái và quyền thực tế ở Client | Tắt tính năng hoặc hết hạn chặn thao tác API đúng chính sách; không vượt quota bằng URL/request đồng thời; Client hiển thị đúng gói/hạn |
| **7** | **BE-10 / P1 — Kho** | Danh mục và tồn đầu kỳ; phiếu nhập/xuất/chuyển/kiểm kê; sổ biến động | Các trang kho và Settings kho đang khóa | Nhập tăng, xuất giảm, chuyển cân hai kho, kiểm kê tạo điều chỉnh; báo cáo tồn khớp, không sửa lịch sử đã chốt |
| **8** | **Một phần BE-12 / đề xuất P1 — In-App notification** | Sự kiện booking/tiền/buồng phòng, người nhận theo role; lưu thông báo và trạng thái đọc | Chuông, danh sách/lịch sử và cài đặt thông báo tenant | Đúng người/tenant nhận sự kiện, không gửi trùng, đọc/đánh dấu đã đọc giữ sau reload |
| **9** | **BE-11 / P2 — Giá nâng cao** | Cuối tuần/LOS, voucher/promotion, snapshot tỷ giá và quy đổi theo giao dịch | Giá/chương trình giảm giá và các form tiền tệ | Quy tắc ưu tiên rõ, áp dụng đúng điều kiện; booking cũ giữ nguyên giá/tỷ giá |
| **10** | **BE-12 còn lại / P2 — Tích hợp** | OTA/Channel Manager, Email/Webhook, báo cáo nâng cao và mobile | Mapping OTA, lịch sử sync/lỗi/thử lại, cấu hình kênh thông báo | Sandbox nhà cung cấp; xác thực/idempotency/retry; không bán vượt tồn và không lẫn tenant |

### Trình tự thực hiện thực dụng

- Sau khi kiểm chứng Coolify, triển khai **BE-06 → BE-08 đầy đủ → BE-07 → BE-09 → BE-10**.
- Có thể tách **BE-08 báo cáo đến/đi/ở và booking** làm ngay từ BE-05; báo cáo quỹ/POS đầy đủ cần BE-06. Không cần chờ hoàn thành mọi phân hệ mới bỏ dashboard preview.
- Đồng bộ nhiều máy có thể làm cùng phần báo cáo hoặc luồng booking trước khi đưa nhiều lễ tân vào dùng.
- BE-09 cần hoàn tất trước phát hành SaaS trả phí/dùng thử, dù đứng sau các luồng vận hành trong thứ tự code.
- In-App notification được thiết kế cho Client web hiện tại, nên đề xuất tách lên P1. Push mobile/Zalo/SMS thuộc giai đoạn sau; Email/Webhook/OTA có thể triển khai từng tích hợp riêng.

**BE-06 cần mở rộng schema**, không chỉ gắn onClick cho Sales: `LedgerEntry` hiện bắt buộc gắn `reservation_id` và `payment_id`, chỉ nhận `payment/refund`. Phiếu chi hoặc chuyển quỹ độc lập cần mô hình chứng từ và đối ứng riêng. Nguồn: [booking_models.py](../../../backend/pms_api/bookings/models.py).

Nguồn mã BE và phụ thuộc hiện có: [plan.md](../../../tasks/plan.md), [todo.md](../../../tasks/todo.md). Đề xuất thứ tự BE-08 sớm và tách In-App P1 trong báo cáo này chưa thay đổi các checkbox hoặc tự đánh dấu nhiệm vụ hoàn tất.

## 4. Những điều cần chốt ở đúng chức năng

1. **Hai gói dịch vụ:** tên, giá, tính năng, quota và chính sách dùng thử. Dùng thử là trạng thái/chính sách, không tự thêm một gói thương mại thứ ba từ dữ liệu mẫu của thiết kế.
2. **Thuế/phí:** giá đã bao gồm hay cộng thêm; cách tính và làm tròn. Hiện mới nhập các dòng charge thủ công.
3. **Lưu trú nâng cao:** đổi phòng/gia hạn sau check-in, no-show và điều chỉnh sau checkout cần đặc tả riêng; không xem chúng đã xong cùng CRUD booking cơ bản.
4. **Báo cáo:** doanh thu theo đêm/ngày ghi nhận, thu tiền theo ngày giao dịch, cọc/nợ và công suất đặt phòng/lưu trú phải có định nghĩa riêng.
5. **Tích hợp:** nhà cung cấp OTA, Email và kênh thu tiền SaaS khi bắt đầu các mục tương ứng.

Thiết kế còn yêu cầu Admin có source/build và domain riêng. Manager/Client hiện cùng router/bundle; nếu giữ yêu cầu này, cần tách entry/build/deploy trước launch, đồng thời tiếp tục kiểm tra quyền ở backend. Nguồn: [kiến trúc ứng dụng](../../../pms_system_design_final.md), [router hiện tại](../../../frontend/src/app/App.jsx).

Những trường nâng cao còn khóa trong panel booking gồm giờ/FOC/bữa sáng và phân loại người lớn/trẻ em/em bé; Settings nâng cao chưa được coi là hoàn tất chỉ vì có layout. Redis/cache, replica, JWT/mobile còn là hạng mục kiến trúc mở rộng; session và giới hạn đăng nhập hiện dùng PostgreSQL.

## 5. Bằng chứng và giới hạn

- Báo cáo triển khai ngày 03/10 ghi **73/73 backend tests** và **29/29 frontend tests** đạt; frontend build và backend Ruff đạt; frontend lint còn warnings.
- Luồng browser đã kiểm chứng: booking hai phòng, cọc, dịch vụ, hoàn một phần, thu đủ, checkout, dọn sạch và đối soát ledger **1.760.000 VND**; reload/chuyển tenant giữ dữ liệu và cách ly đúng.
- Các kết quả trên là **kiểm chứng đã ghi ở lần triển khai**, không phải chạy lại test trong lần rà soát báo cáo này. Runtime hiện tại và môi trường Coolify chưa được kiểm chứng lại.
- `../reviews/PMS_GAP_REPORT.md` mô tả hiện trạng cũ trước BE-01–05. Đoạn nói backend chỉ có health check không còn đúng với source hiện tại. Dùng báo cáo này và `BE01_05_IMPLEMENTATION_REPORT.md` cho tình trạng mới.
- Graphify được dùng để định vị phân hệ theo các từ khóa `auth tenant booking payment reports pos cashflow housekeeping inventory billing notification api`; đồ thị cũ chưa phản ánh hết BE-01–05, nên các kết luận hiện trạng được đối chiếu trực tiếp với source.
- Không quy đổi sang tỷ lệ hoàn thành toàn dự án vì chưa có danh sách nghiệm thu và trọng số cho toàn bộ thiết kế.

Đối chiếu thiết kế: [Client modules](../../../pms_system_design_final.md#phần-1-phân-hệ-chức-năng-client-dành-cho-khách-sạntenant), [thiết kế đầy đủ](../../../pms_system_design_final.md), [báo cáo triển khai](../backend/BE01_05_IMPLEMENTATION_REPORT.md).
