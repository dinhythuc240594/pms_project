# QA2-04 — Kiểm thử hành trình người dùng PMS

Ngày khảo sát: 21/10/2026. Commit: `accc668f71897191cbc98b1388c21ba01d15edb3`.
Phạm vi bàn giao: tài liệu QA; không sửa mã ứng dụng, không merge.

## 1. Kết quả thực thi và giới hạn

| Hoạt động | Kết quả thực tế | Evidence |
| --- | --- | --- |
| Khám phá routes, guards, API provider, form và CSS | Đã thực hiện bằng đọc mã; không xác nhận hành vi trình duyệt | Các đường dẫn nguồn ở mục 2–3 |
| Khảo sát E2E | Không thấy dependency, config, spec hoặc npm script Playwright/Cypress trong frontend; CI chưa chạy browser | `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.js`, `.github/workflows/ci.yml` |
| Kiểm tra bổ trợ `cd frontend && npm test` | Node v26.12.0; runner báo 171 mục, 170 pass, 1 fail, 0 skip. Không phải 171 ca E2E | Bản trích log ở mục 7 |
| Browser E2E | **BLOCKED**: 0 ca chạy; không có PASS/FAIL browser | Chưa xác nhận URL test độc lập, database fixture và tài khoản được phép sử dụng |
| Screenshot / video / trace / HAR | Chưa có | Browser không được khởi chạy |
| Build/lint, backend integration | Không chạy trong ticket này | Không dùng kết quả cũ thay kết quả hiện tại |

Không truy cập deployment, không đăng nhập bằng tài khoản demo suy đoán, không khởi động API/seed database, không tạo booking hoặc ghi tiền thật. Hướng dẫn PostgreSQL local trong `backend/README.md` và báo cáo browser cũ không chứng minh có môi trường QA đang hoạt động hay tài khoản được cấp cho lượt này. Các địa chỉ localhost trong cấu hình chỉ là mặc định, chưa phải môi trường đã kiểm chứng.

**Quy ước cho toàn bộ bảng ca bên dưới:** mỗi ID là một ca dự kiến; trạng thái thực thi của tất cả các ca là **BLOCKED B1+B2**; actual result: **chưa quan sát trên browser**; evidence runtime: **chưa có**. Ca tích hợp bên ngoài còn bị **B3**. Các expected result là tiêu chí nghiệm thu, không phải tuyên bố mã đã đáp ứng. P/N/E lần lượt là positive/negative/edge; P0 ưu tiên trước P1/P2.

## 2. Routes và luồng thực tế

Nguồn chính: [`App.jsx`](../../frontend/src/app/App.jsx). Không giả định có `/booking`, `/login`, `/id/pricing` hoặc trang guest riêng.

| Nhóm | Routes đã khai báo | Luồng cần kiểm |
| --- | --- | --- |
| Marketing | `/`, `/pricing`, `/blog`, `/contact` | Header/footer, điều hướng tới đăng nhập; không gửi contact ra ngoài |
| Auth | `/id/login` | Email/password/remember/show password; query `next` |
| Dashboard / phòng | `/id/dashboard`, `/id/room-diagram`, `/id/rooms`, `/id/ari` | Dashboard → phòng/timeline → đặt phòng/chi tiết |
| Booking | `/id/reservations` | Danh sách → tạo nhiều phòng/khách → quote → lưu → nhận/trả/hủy; chi tiết gồm tiền, dịch vụ, lịch sử |
| Settings / tài khoản | `/id/settings`, `/id/profile`, `/id/users` | Settings có section business, rooms, services, accounting, inventory, channels, system; khách qua UI booking |
| Pricing | `/id/gia`, `/id/gia/:tab`, `/id/gia/vouchers`, `/id/gia/ari`, `/id/gia/promotions`, `/id/gia/exchange-rates`, `/id/matrix-rate` | Cấu hình giá, khoảng ngày, tồn, chính sách/voucher/khuyến mãi/tỷ giá |
| Housekeeping | `/id/housekeeping`, `/id/housekeeping/status`, `/id/housekeeping/staff`, `/id/housekeeping/plan`, `/id/housekeeping/:tab` | Trạng thái → nhân viên/ca → kế hoạch → giao việc → dọn → kiểm tra |
| Finance / POS | `/id/cashflow`, `/id/cashflow/:tab`, `/id/commissions`, `/id/sales` | Ledger/sổ quỹ, hoa hồng, hóa đơn POS → thu/hoàn/hủy |
| Kho | `/id/inventory` → `/id/inventory/in`; `/id/inventory/{in,out,transfer,check,stock}` | Nhập/xuất/chuyển/kiểm kê/tồn |
| Báo cáo | `/id/reports`, `/id/reports/{revenue,occupancy,source,room,roomType,cancellations,nationality,discounts}`, `/id/reports/reconciliation` | Lọc báo cáo; đối soát ngày riêng |
| OTA client | `/id/ota`, `/id/ota-history` | Redirect qua `clientOtaSettingsPath` tới settings section channels, tab channels/history; kiểm tra query callback |
| Manager | `/manager/dashboard`, `/manager/tenants`, `/manager/channex`, `/manager/tenants/:tenantId/ota`, `/manager/tenants/:tenantId/ota-history`, `/manager/{billing,features,users,logs,profile}` | Quản trị toàn hệ thống, tenant, tích hợp, thuê bao, người dùng và nhật ký |
| Index / fallback | `/id` → dashboard; `/manager` → dashboard; `*` ở từng nhánh và toàn cục | Guard trước trang; URL lạ hiển thị 404 |

`App.jsx` bọc `PmsProvider`, `LayoutGuard`, `RouteGuard`, `RouteErrorBoundary`. [`AccessControl.jsx`](../../frontend/src/shared/components/AccessControl.jsx) có loading phiên/workspace, màn lỗi và retry, chuyển login kèm path+query. [`Login.jsx`](../../frontend/src/apps/pms/auth/pages/Login.jsx) chọn home manager, housekeeping, accountant hoặc dashboard; `next` chỉ nhận nhánh id/manager và loại login.

Quyền runtime lấy từ [`api.js`](../../frontend/src/apps/pms/data/api.js) (`CORE_ROLES`, `permitted`, `subscriptionDecision`), route policy từ [`access.js`](../../frontend/src/apps/pms/data/access.js); không dùng `DEMO_USERS`/`ROLE_ACTIONS` cũ làm tài khoản hay ma trận quyền runtime. Provider gọi API cookie `credentials: include`, CSRF trong bộ nhớ, idempotency journal và scope tenant. Feature tắt chặn truy cập; gói không hoạt động chặn ghi; tenant ngưng hoạt động chặn ghi theo policy.

## 3. Công cụ và điều kiện chạy

Hiện có Node native tests (`node --test --test-isolation=none`), oxlint, Vite; không có browser assertion/fixture/trace runner. CI frontend chỉ npm ci/lint/test/build. Không cài thêm framework hoặc viết code automation do yêu cầu không tự sửa code. Đề xuất cho ticket automation riêng: Playwright, selectors theo role/label, fixtures theo role/tenant, storage state riêng (không commit), test độc lập, trace khi fail và screenshot; không tái dùng cookie thật.

| Blocker | Thiếu gì | Cách gỡ trước khi chạy |
| --- | --- | --- |
| B1 | Môi trường test/staging độc lập được xác nhận | Ghi URL frontend/API, DB QA riêng không sao chép dữ liệu thật, phiên bản/schema; kiểm tra cấu hình trỏ đúng QA, egress chặn provider ngoài; có cơ chế reset fixture |
| B2 | Tài khoản test được phép sử dụng | Cấp qua kênh bí mật: owner, front desk, housekeeping, accountant, system manager, super admin; membership A/B và tài khoản không quyền/bị khóa. Không ghi password/cookie vào báo cáo |
| B3 | Sandbox tích hợp được phép, chưa có | Mock/local stub cho OTA, thanh toán, email và webhook; không bấm probe/sync/connect/payment ngoài. Nếu cần kiểm thử provider thật phải có sandbox và phạm vi được cấp rõ ràng |
| B4 | Chưa có browser harness trong repo | Để chạy tự động cần ticket cài/config/spec riêng; chạy thủ công vẫn phải thỏa B1+B2. Không dùng B4 để thay lý do thiếu môi trường |

Fixture đề nghị: tenant QA-A/QA-B; tên giả `QA2-04-*`, email `qa2-04@example.test`; không dùng giấy tờ/điện thoại thật. QA-A có 2 phòng sạch cùng loại, 1 phòng bẩn, 1 bảo trì, 1 inactive, loại inactive; giá 100000 VND/đêm và dữ liệu USD tách biệt; dịch vụ 50000 VND, quỹ/phương thức giả; nhân viên/ca được gán đúng role. Dùng ngày D theo timezone khách sạn, booking [D+1,D+3), đồng hồ cố định nếu kiểm tra biên ngày. Reset bằng fixture đã duyệt trong DB QA; không xóa lịch sử tài chính qua UI hay database dùng chung.

## 4. Danh sách test cases

Các bước mỗi dòng được thực hiện theo thứ tự trái sang phải; tiền điều kiện chung là đã có fixture và login đúng role, feature/gói hoạt động, trừ khi ca nói khác.

### Login, phiên và navigation

| ID | Ưu tiên / loại | Bước / dữ liệu | Expected result |
| --- | --- | --- | --- |
| AUTH-01 | P0/P | Lần lượt đăng nhập các role test bằng email/password hợp lệ | Manager → manager dashboard; HOUSEKEEPING → status; ACCOUNTANT → cashflow; role còn lại → dashboard; tải dữ liệu đúng quyền |
| AUTH-02 | P0/N | Bỏ trống từng trường; nhập email `abc`; submit | Validation required/email; không phát request login với form sai |
| AUTH-03 | P0/N | Email không tồn tại, sai password, tài khoản inactive | Báo lỗi dễ hiểu; không tạo phiên, không lộ password; không brute force |
| AUTH-04 | P1/E | Bật/tắt mắt password; remember off/on; login rồi reload và mở phiên browser mới | Toggle không submit; nhớ phiên đúng chính sách backend; password/token không lưu web storage |
| AUTH-05 | P0/E | Mở route có query khi chưa login; login; thử next hợp lệ, external URL, `//example.test`, `/id/login` | Giữ deep link hợp lệ; next nguy hiểm quay home, không điều hướng ra ngoài; guard vẫn chặn route thiếu quyền |
| AUTH-06 | P0/N | Giả lập login chậm, 401, 500, offline rồi khôi phục | Busy/aria-busy, submit disabled; lỗi hiển thị; hết busy và có thể thử lại, không duplicate |
| AUTH-07 | P0/E | Logout → Back/reload route bảo vệ; hết hạn phiên ở tab khác rồi thao tác | Không hiện dữ liệu riêng tư từ phiên cũ; 401 về login; không ghi bằng phiên cũ |
| NAV-01 | P1/P | Click sidebar rồi Back/Forward; reload deep link; mở `/id`, `/manager` và URL lạ | Active menu/URL đúng; index redirect đúng; 404 giữ URL lạ, không vòng lặp |
| NAV-02 | P1/E | Mở OTA/history alias có query callback (stub); vào inventory root; thử tab/tenant ID lạ | Redirect đúng section/tab; query an toàn được giữ; input lạ không làm crash/lộ dữ liệu |

### Dashboard, booking và phòng

| ID | Ưu tiên / loại | Bước / dữ liệu | Expected result |
| --- | --- | --- | --- |
| DASH-01 | P0/P | Tạo booking fixture nhiều phòng; xem dashboard, diagram, rooms, ARI cùng ngày | Số phòng/công suất/trạng thái khớp mọi phòng; không đếm booking nhiều phòng thành 1 phòng |
| DASH-02 | P1/E | Tenant trống; đổi ngày qua nửa đêm theo timezone; lọc tiền tệ | Empty state rõ; ngày nghiệp vụ đúng; không cộng lẫn VND/USD; minh họa không trình bày như dữ liệu thật |
| DASH-03 | P1/N | Làm chậm/500 request dashboard rồi Retry | Có loading/lỗi/retry; không hiển thị số 0 giả như kết quả thành công |
| BOOK-01 | P0/P | Reservations → tạo 2 phòng/2 khách [D+1,D+3) → quote → lưu → mở lại/reload | 2 đêm × 2 phòng × 100000 = 400000 VND trước phụ thu; giữ phòng/khách/giá từng đêm; lưu đúng tenant |
| BOOK-02 | P0/N | Thiếu khách/phòng/ngày; checkout bằng/trước checkin; ngày không hợp lệ | Chặn hoặc API báo lỗi rõ; không tạo bản ghi một phần |
| BOOK-03 | P0/E | Hai booking [D+1,D+3) và [D+3,D+4); rồi thử overlap; chọn phòng/loại inactive, bảo trì, block, stop-sell | Cho biên ngày liền kề khi hợp lệ; không cho chọn/tạo mới với tồn không khả dụng |
| BOOK-04 | P0/E | Hai phiên cùng đặt 1 phòng; hoặc phiên 2 sửa booking trước khi phiên 1 lưu | Chỉ booking hợp lệ được lưu; conflict/version được báo; không âm tồn/ghi đè âm thầm |
| BOOK-05 | P0/P | Cọc 100000 → check-in → phụ thu 50000 → checkout khi còn nợ → thu thêm 350000 → checkout | Chặn checkout khi còn nợ; tổng 450000, balance 0 sau thu đủ; mọi phòng thành bẩn; lịch sử/ledger giữ sau reload |
| BOOK-06 | P0/N | Nhập tiền âm, 0, vượt giới hạn/hoàn vượt đã thu, lý do hoàn trống; hủy sai trạng thái | Báo validation, không đổi ledger/số dư; hành động theo trạng thái được chặn |
| BOOK-07 | P0/E | Double click thu tiền; mất response sau server ghi rồi retry/reload | Chỉ một giao dịch cho cùng intent; UI cho đối chiếu trạng thái chưa rõ, không thu lần hai |
| BOOK-08 | P1/P | Sửa khách/ghi chú, thêm dịch vụ; tìm kiếm/lọc rồi mở chi tiết | Danh sách và chi tiết nhất quán, lịch sử đúng; tên có dấu/ký tự đặc biệt hiển thị dạng text |
| ROOM-01 | P0/P | Owner → settings rooms tạo loại/phòng QA → rooms/diagram → reload | Phòng mới đúng loại/trạng thái; xuất hiện ở luồng chọn phòng khi active |
| ROOM-02 | P1/N | Trùng mã phòng, thiếu loại, dữ liệu sai; ngừng phòng đang có booking | Validation/lỗi ràng buộc rõ; lịch sử booking không mất; không tạo phòng trùng |
| ROOM-03 | P0/E | Tạo/xóa block ngày; kiểm tra timeline và quote; đổi tenant khi form đang mở | Block nhất quán với availability; form tenant cũ bị xóa; không ghi nhầm tenant |

### Housekeeping và pricing

| ID | Ưu tiên / loại | Bước / dữ liệu | Expected result |
| --- | --- | --- | --- |
| HK-01 | P0/P | Owner/front desk tạo staff gắn tài khoản → ca → kế hoạch → giao phòng bẩn | Task/staff/ca/ngày đúng; nhân viên được giao thấy công việc sau reload |
| HK-02 | P0/P | Nhân viên bắt đầu/dọn xong → gửi kiểm tra; người quản lý xác nhận sạch hoặc yêu cầu dọn lại | Trạng thái đúng vòng đời; phòng sạch chỉ sau xác nhận phù hợp; có lịch sử |
| HK-03 | P0/N | HOUSEKEEPING xem/sửa task người khác hoặc tự xác nhận sạch | UI/API từ chối, không rò task và không đổi trạng thái phòng |
| HK-04 | P1/N | Tạo ca chồng giờ; thiếu ngày/staff; ngừng staff/ca còn task; tạo plan lặp | Lỗi rõ, không task mồ côi/trùng; số lượng và lịch sử không sai |
| HK-05 | P0/E | Đổi ngày kế hoạch; tạo task rồi booking/check-out làm phiên bản phòng thay đổi; thử quick toggle phòng có task/bảo trì/inspection | Không ghi bằng task cũ; quick toggle bị chặn theo điều kiện; không bỏ qua kiểm tra |
| PRICE-01 | P0/P | Giá/MatrixRate: chọn loại/ngày → đổi 100000 thành 120000 → quote booking mới; mở booking cũ | Giá mới áp dụng đúng ngày; snapshot booking cũ giữ nguyên |
| PRICE-02 | P1/N | Ngày trống/sai, end ≤ start; chọn khoảng 366 rồi 367 ngày; nhập giá âm/không phải số | Biên 366 được xử lý; quá 366 bị báo theo rateRangeError; không lưu giá sai |
| PRICE-03 | P0/E | Chọn ô rời rạc/nhiều loại, cập nhật giá/stop sell; bỏ stop sell rồi reload | Chỉ ô đã chọn đổi; end exclusive nhất quán; availability/quote cập nhật tương ứng |
| PRICE-04 | P1/P | Tạo chính sách giá/voucher/promotion fixture; quote thỏa rồi không thỏa điều kiện | Giảm giá đúng rule/phạm vi/thời hạn; không áp dụng ngoài điều kiện; tổng tiền giải thích được |
| PRICE-05 | P1/N | Voucher trùng/hết hạn/hết lượt; min/max ngày sai; tỷ giá 0/âm, khác currency | Báo lỗi/không áp dụng; không tự cộng tiền khác currency; không gọi đổi tiền bên ngoài |

### Finance, POS, kho và báo cáo

| ID | Ưu tiên / loại | Bước / dữ liệu | Expected result |
| --- | --- | --- | --- |
| FIN-01 | P0/P | Accountant mở cashflow → lọc ngày/quỹ/currency → đối chiếu payment/refund booking | Ledger khớp chi tiết booking; tổng chỉ trong bộ lọc, không trộn currency |
| FIN-02 | P0/P | Tạo phiếu thu/chi giả rồi đảo phiếu có lý do → reload | Số dư thay đổi đúng; đảo bằng giao dịch đối ứng, không xóa lịch sử |
| FIN-03 | P0/N | Tiền âm/sai precision, quỹ sai currency, thiếu trường; double submit/timeout rồi retry | Chặn dữ liệu sai, không ghi một phần/trùng; lỗi không mất form hợp lệ |
| FIN-04 | P1/E | Commissions lọc nguồn/khoảng ngày; ngày trống, không kết quả, currency khác | Tính/lọc nhất quán rule đã cấu hình; empty state rõ, không NaN |
| POS-01 | P0/P | Sales → thêm dịch vụ 50000 × 2 → lưu nháp → ghi nhận → thu/hoàn một phần | Total 100000 trước rule khác; trạng thái/số dư/ledger nhất quán sau reload |
| POS-02 | P0/E | Ghi POS vào booking cùng currency; thử khác currency; hủy hóa đơn đã ghi với lý do | Không ghi chéo currency; booking nhận đúng khoản; hủy có đối ứng, không thu kép |
| POS-03 | P1/N | Không chọn item; quantity 0/âm; hoàn quá đã thu; tìm không khớp rồi phân trang | Validation đúng; empty state và nút phân trang hợp lý; không mất hóa đơn |
| INV-01 | P0/P | Nhập 10 đơn vị → xuất 2 → chuyển 3 giữa kho → kiểm kê có chênh lệch | Tổng/tồn từng kho và lịch sử khớp chứng từ; reload không mất |
| INV-02 | P0/N | Xuất vượt tồn, quantity sai, chuyển cùng kho; gửi lặp; đảo chứng từ | Không âm tồn hoặc trùng chứng từ; điều kiện đảo được kiểm tra và có lịch sử |
| INV-03 | P1/E | Gắn dịch vụ với hàng tồn → ghi POS → trả hàng một phần (fixture) | Trừ/trả đúng tồn một lần, không trả quá đã xuất |
| REP-01 | P0/P | Reports revenue/occupancy và từng route nâng cao → lọc D/currency | Số liệu đối chiếu fixture; mỗi route có tiêu đề/bộ lọc đúng, không cộng currency khác |
| REP-02 | P0/E | Reconciliation → xem ngày → xác nhận bằng role được cấp; thử ghi tiền vào ngày đóng | Quyền xác nhận theo policy/API; số đối soát khớp; ngày đóng chặn ghi theo quy tắc nghiệp vụ |
| REP-03 | P1/N | Ngày đảo/ngày trống, không dữ liệu, API 500; export nếu có | Không crash; lỗi/empty đúng; CSV Unicode và ô bắt đầu =,+,-,@ được xử lý an toàn |

### Settings, quản trị và tích hợp

| ID | Ưu tiên / loại | Bước / dữ liệu | Expected result |
| --- | --- | --- | --- |
| SET-01 | P1/P | Mở từng section/tab settings; sửa danh mục giả, giờ/timezone/currency hợp lệ → reload | Query/active tab đúng; dữ liệu lưu đúng phạm vi; không phá lịch sử tiền/booking |
| SET-02 | P0/N | Tạo/gán user khách sạn; email trùng; đổi membership hoặc inactive | Danh tính hệ thống không bị sửa qua tenant; quyền mới có hiệu lực và không vượt quota |
| SET-03 | P1/P | Profile: sửa thông tin giả; đổi password test, password cũ sai/mới không khớp; thu hồi phiên khác | Validation/lỗi rõ; phiên bị thu hồi không ghi tiếp được; không log password |
| MGR-01 | P0/P | Manager xem tenant → tạo tenant/chủ giả → suspend/reactivate; tenant A/B kiểm tra lại | Status/membership đúng; suspend chặn ghi; không lộ tenant không được phép |
| MGR-02 | P0/E | Billing/features: cấp gói, hết hạn, tắt feature, chạm quota phòng/user rồi tạo thêm | UI/API thực thi cùng giới hạn; đọc/ghi đúng policy; không thanh toán SaaS qua provider thật |
| MGR-03 | P0/N | SYSTEM_MANAGER mở trực tiếp users/logs; SUPER_ADMIN mở cùng route; thử khóa/đổi quyền user QA | Manager bị chặn theo superOnly; admin có quyền; thu hồi phiên đúng, không thao tác tài khoản thật |
| MGR-04 | P1/P | Dashboard manager, logs filter, profile; billing invoice/payment/void chỉ bằng fixture nội bộ | Số liệu/lịch sử đúng; validation ngày/tiền; thao tác lặp không ghi tiền trùng |
| OTA-01 | P1/P | Với stub: settings channels/history, manager channex và tenant OTA → mapping/query callback | Đúng tenant/property, trạng thái/mapping/lịch sử; secret được che; không gửi OTA thật; thêm B3 |
| OTA-02 | P0/N | Stub 401/429/500/timeout, callback token sai/hết hạn, mapping thiếu | Lỗi/retry có kiểm soát; không lộ secret hay tự gọi provider thật; thêm B3 |
| WEB-01 | P2/P | Marketing home/pricing/blog/contact → nav và login | Route/link đúng, responsive; contact chỉ kiểm tra validation với request bị chặn/stub, không gửi thư |

### Kiểm thử xuyên module

Thực hiện các biến thể sau trên Login, Dashboard, Booking, Rooms, Housekeeping, Pricing, Finance, Settings, Reports và Manager nếu có quyền. Không coi một màn hình đạt là toàn bộ module đạt.

| ID | Ưu tiên / loại | Bước / dữ liệu | Expected result |
| --- | --- | --- | --- |
| CROSS-01 | P0/N | Với mỗi role, mở deep link thiếu quyền và thử thao tác bị cấm trong QA | UI chặn + backend 403; không chỉ ẩn menu; không có dữ liệu nhạy cảm trong response |
| CROSS-02 | P0/E | Tenant A request chậm → chọn B trước response; Back/reload; tab A đăng xuất | Không hiển thị response/form cũ ở B; pending money không nhầm actor/tenant; không ghi nhầm phạm vi |
| CROSS-03 | P1/E | Delay read/write 3 giây, double click, đóng modal/chuyển trang khi chờ | Loading/busy phù hợp, không gửi lặp; trạng thái chờ kết thúc khi resolve/reject/abort |
| CROSS-04 | P0/N | Stub 401/403/404/409/422/429/500/503, offline, JSON lỗi/204 → Retry | Lỗi rõ, không crash/leak; giữ draft phù hợp; CSRF lỗi không bị gán sai thành thiếu quyền; retry không duplicate |
| CROSS-05 | P1/E | Viewport 360×800, 390×844, 768×1024, 1440×900; xoay ngang, zoom 200% | Menu mở/đóng được; modal/form/nút submit nhìn thấy; bảng cuộn trong vùng hợp lý; không tràn trang che hành động |
| CROSS-06 | P1/E | Chỉ dùng keyboard Tab/Enter/Esc; mở/đóng modal; reduced motion | Label/focus rõ, không kẹt focus; toggle không submit; lỗi/loading đọc được; đóng modal trả focus hợp lý |
| CROSS-07 | P1/E | Đổi VI/EN/ZH, reload; tên dài/có dấu/ký tự HTML, số rất lớn | Không thiếu key/HTML thực thi; ngày, tiền, precision đúng; layout vẫn dùng được |
| CROSS-08 | P0/E | Tắt feature; gói chưa bắt đầu/hết hạn; tenant suspend, user không membership | Guard và action tuân policy; không dùng URL trực tiếp để vượt chặn; đọc được nơi policy cho phép |

## 5. Ma trận quyền cần đối chiếu

Owner kiểm tra đầy đủ tenant A; front desk kiểm tra booking, phòng, buồng phòng/POS/payment theo `CORE_ROLES`, bị chặn settings/users/inventory write; housekeeping chỉ profile/rooms/housekeeping phù hợp task; accountant kiểm tra thu chi/POS/kho/reports, không sửa booking bằng `reservations.write`. SYSTEM_MANAGER có manager routes thông thường; users/logs dành SUPER_ADMIN. Backend vẫn là điểm quyết định cuối cùng: ghi mismatch thành lỗi, không thay expected theo UI tình cờ cho phép. Kiểm tra thêm không membership, membership inactive, account inactive, feature tắt và tenant B.

## 6. Phát hiện và mẫu báo lỗi

Chưa xác nhận lỗi sản phẩm bằng browser. Không suy ra PASS từ đọc source hoặc kết quả unit tests.

**OBS-01 — Tài liệu frontend chưa đồng bộ runtime (khảo sát tĩnh, P2).**
Tái hiện: đọc phần “Giới hạn hiện tại” của `frontend/README.md`, rồi đối chiếu `PmsProvider.jsx` và `Sales.jsx` (save/post/pay/refund), housekeeping staff/tasks, inventory documents và subscriptionDecision trong `api.js`.
Expected: tài liệu phản ánh đúng module đã nối API. Actual: README vẫn mô tả POS/kho/kế hoạch buồng phòng/billing-feature chưa có backend hoặc tắt, trong khi runtime có các lời gọi API tương ứng. Evidence là source ở mục 2–3, không phải bằng chứng browser. Rủi ro: bỏ sót kịch bản QA. Không sửa README trong ticket này.

Mỗi lỗi runtime sau khi gỡ BLOCKED phải ghi:

- ID ca, severity/priority, thời điểm/timezone, build/commit, browser/version/viewport, tenant/role giả.
- Fixture và tiền điều kiện; các bước tái hiện có đánh số và dữ liệu đầu vào đã che thông tin bí mật.
- Expected và actual riêng biệt; tỷ lệ tái hiện; request method/path/status, request ID và trạng thái dữ liệu sau reload.
- Screenshot trước/sau; trace/video nếu harness hỗ trợ. Che cookie, CSRF, Authorization, password, secret OTA và dữ liệu khách; không commit raw HAR/storage state.
- Trạng thái OPEN → retest → PASS/FAIL/BLOCKED với evidence mới; không ghi đơn thuần “đã kiểm tra”.

## 7. Evidence kiểm tra bổ trợ và bước tiếp theo

Lệnh thực tế: `cd frontend && npm test` (không chạy browser/API). Output runner:

```text
ℹ tests 171
ℹ suites 0
ℹ pass 170
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

✖ src/apps/pms/data/PmsProvider.test.js
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'react'
imported from frontend/src/apps/pms/data/PmsProvider.test.js
```

Lỗi này là thiếu dependency trong worktree chưa có `frontend/node_modules`, không kết luận là lỗi sản phẩm. Log tạm `/tmp/qa2-04-frontend-tests.log` không phải artifact lâu dài; bản trích trên giữ kết quả cần thiết. Không cài dependency hoặc sửa test để biến kết quả thành PASS trong lượt lập tài liệu này.

Thứ tự tiếp tục: xác nhận B1+B2 → chuẩn bị/reset fixture và ghi build → chạy P0 login/quyền → booking/tiền/phòng/HK → pricing/finance/kho/báo cáo → P1 negative/loading/responsive → manager và OTA bằng stub khi B3 được gỡ → retest lỗi và điền actual/evidence cho từng ID. Chỉ công bố nghiệm thu E2E khi có kết quả browser thực tế; hiện tại **chưa đủ bằng chứng nghiệm thu E2E**.
