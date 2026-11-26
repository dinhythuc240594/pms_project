# Báo cáo kiểm thử BE-08–09

**Cập nhật 05/10/2026:** bảy nhóm P1 đã được sửa và kiểm chứng lại: backend139/139, frontend30/30, build đạt. Xem [báo cáo sửa P1](../backend/BE08_09_P1_FIX_REPORT.md). Nội dung bên dưới là kết quả kiểm thử ban đầu ngày04/10, giữ để đối chiếu.

Ngày kiểm thử: 04/10/2026. Kết luận: **chưa đạt nghiệm thu**; yêu cầu sửa các lỗi P1 trước khi đánh dấu BE-08–09 hoàn thành.

Đối chiếu `pms_system_design_final.md`, `tasks/plan.md`, `tasks/todo.md` và quyết định của chủ dự án: hệ thống chỉ có **Miễn Phí và Chuyên Nghiệp**. Những đoạn thiết kế cũ nói ba gói không được dùng làm tiêu chí.

Phạm vi: API Flask, migration, PostgreSQL với tài khoản runtime hạn chế, frontend và trình duyệt. Chỉ thêm tests và báo cáo; không sửa mã nghiệp vụ của Antigravity. Các thao tác ghi chạy trên database QA riêng, tự xóa sau kiểm thử. Không kiểm thử Coolify/production.

## Kết quả kiểm thử

| Nhóm | Số test | Đạt | Thất bại |
|---|---:|---:|---:|
| Nghiệp vụ nền và BE-01–07 hiện có | 102 | 102 | 0 |
| BE-08: reports acceptance | 12 | 5 | 7 |
| BE-09: subscription acceptance | 16 | 1 | 15 |
| Tổng số phương thức test khác nhau đã chạy | **130** | **108** | **22** |

Lần chạy chung đầu tiên phát hiện 129 tests, gồm 15 tests BE-09, với 29 failure assertions. Sau khi bổ sung test giới hạn năm tài khoản, chạy riêng đủ 16 tests BE-09: 1 đạt, 15 phương thức thất bại, 19 failure assertions. BE-08 có 11 failure assertions. Một test có nhiều subtests nên số assertions thất bại khác số phương thức thất bại. Không có lỗi thiết lập hoặc tests bị bỏ qua.

Tests mới:

- [BE-08 acceptance](../../../backend/tests/test_reports_acceptance.py)
- [BE-09 acceptance](../../../backend/tests/test_subscription_acceptance.py)

Các tests này cố ý giữ kỳ vọng nghiệp vụ đúng; hiện sẽ thất bại cho đến khi các lỗi được sửa. Không dùng `expectedFailure`, không giảm tiêu chí để làm bộ test xanh.

| Kiểm tra bổ sung | Kết quả |
|---|---|
| `npm test` | 29/29 đạt |
| `npm run build` | Đạt |
| `npm run lint` | Exit 0; 86 warnings trong toàn frontend |
| `python -m ruff check .` | Không đạt: 9 lỗi tại migration subscription, admin và reports |
| `python -m ruff format --check .` | Không đạt: 10 files cần format trong toàn backend, gồm cả files ngoài BE-08–09 |
| Ruff cho hai files acceptance mới | Đạt |
| Kiểm soát chất lượng test phân quyền | Test đạt bình thường và bắt được thay đổi RBAC sai được áp dụng tạm trong bộ nhớ; đã khôi phục, không sửa source |

Build và các tests frontend cũ chưa chứng minh BE-08–09 hoạt động đầy đủ. Chúng chưa bao phủ các tình huống nghiệm thu mới bên dưới.

## P1 — cần sửa trước khi nghiệm thu

### 1. Subscription và lịch sử chưa được cách ly tenant bằng RLS

Vị trí: [migration subscription:31](../../../backend/migrations/versions/cdb4bc7d62d0_add_plan_and_subscription_models.py#L31).

Migration tạo `subscriptions` và `subscription_history` nhưng không bật RLS/policies như các bảng tenant khác. Trên kết nối **pms_app**, đã đặt context tenant A, tests vẫn đọc được subscription và history của tenant B; `UPDATE subscriptions` của B trả `rowcount=1`.

Đây là lỗi ở lớp bảo vệ database. API quản trị subscription hiện vẫn chặn người dùng tenant thông thường bằng 403; chưa chứng minh được một URL công khai cho phép tenant A lấy subscription B. Không nên diễn giải kết quả SQL thành lỗ hổng HTTP đã khai thác.

Hướng sửa: áp dụng chính sách RLS và quyền system tương ứng với các migration tenant hiện có; kiểm tra cả đọc, ghi và reset context khi trả connection về pool.

### 2. API chưa thực thi tính năng, hạn gói và quota

Vị trí: [security:150](../../../backend/pms_api/security.py#L150), [workspace:32](../../../backend/pms_api/workspace.py#L32), [catalog:503](../../../backend/pms_api/catalog/routes.py#L503), [admin/users:114](../../../backend/pms_api/admin/routes.py#L114).

Kết quả tái hiện:

- Gói có `POS_SALES=false`: gọi trực tiếp tạo POS vẫn nhận **201**.
- Subscription có trạng thái `expired`: tạo POS vẫn **201**.
- Subscription mang `status=active` nhưng `end_date` đã qua: workspace vẫn cấp tính năng.
- Plan bị `active=false`: workspace vẫn cấp tính năng.
- Tenant đã đủ `maxRooms`: tạo phòng tiếp theo vẫn **201**.
- Hai yêu cầu tạo phòng đồng thời khi chỉ còn một suất: cả hai nhận **[201, 201]** và vượt quota.
- Gói Miễn Phí đang quảng bá tối đa năm tài khoản: tài khoản thứ sáu vẫn được tạo với **201**.

Khóa/mở tenant bằng trạng thái `suspended` vẫn hoạt động; đây là phần kiểm soát gói chưa được tích hợp vào middleware, không phải toàn bộ phân quyền bị mất.

Hướng sửa: dùng một kiểm tra entitlement chung tại API; đọc hạn thực tế và trạng thái plan; khóa bản ghi tenant/subscription khi kiểm tra rồi tạo tài nguyên để tránh vượt quota đồng thời. Không chỉ khóa nút ở frontend.

### 3. Gia hạn không lưu hạn mới và chi tiết lịch sử

Vị trí: [admin/subscription:255](../../../backend/pms_api/admin/routes.py#L255).

`PUT /api/tenants/<id>/subscription` nhận `endDate`, `amount`, `currency` nhưng chỉ lưu `planId` và `status`. Test gia hạn từ hạn cũ sang tháng sau nhận **200**, GET lại vẫn trả hạn cũ. So sánh timestamps đã loại trừ khác biệt múi giờ. History được tạo với action `changed_plan`, nhưng `amount=None`; source cũng không ghi kỳ hạn/currency từ yêu cầu.

Hướng sửa: phân biệt đổi gói và gia hạn, xác thực kỳ hạn và số tiền; cập nhật subscription và history trong cùng transaction. Cần API đọc history phục vụ màn hình quản trị.

### 4. Client quản trị gói/gia hạn chưa nối với API

Vị trí: [AccessControl:23](../../../frontend/src/shared/components/AccessControl.jsx#L23), [AdminBilling:32](../../../frontend/src/apps/manager/billing/pages/AdminBilling.jsx#L32), [PmsProvider:84](../../../frontend/src/apps/pms/data/PmsProvider.jsx#L84), [AdminTenants:505](../../../frontend/src/apps/manager/tenants/pages/AdminTenants.jsx#L505).

Đăng nhập bằng Super Admin trong browser QA:

- `/manager/billing` hiện thông báo **“Chức năng này chưa được triển khai. Các thao tác lưu đang tắt.”**.
- Trang Tenants ghi **“Chưa triển khai (BE-09)”**, bộ lọc/chỉnh gói bị vô hiệu hóa.
- Billing vẫn dùng `INITIAL_PRICING_PLANS` và `INITIAL_INVOICES`; provider trả features rỗng và quota không có limit.

RouteGuard đã vô hiệu hóa thao tác trên Billing/Features; không kết luận rằng người dùng hiện có thể bấm lưu hóa đơn giả. Vấn đề là luồng BE-09 từ quản trị tới database còn chưa hoàn thành.

Hướng sửa: nối đọc/cập nhật plan, subscription, hạn và history tới API; chỉ bỏ trạng thái chưa triển khai sau khi lưu và tải lại từ database được kiểm chứng.

### 5. Dashboard lễ tân bị 403 và lặp yêu cầu liên tục

Vị trí: [reports/dashboard:14](../../../backend/pms_api/reports/routes.py#L14), [Dashboard:16](../../../frontend/src/apps/pms/dashboard/pages/Dashboard.jsx#L16), [PmsProvider:30](../../../frontend/src/apps/pms/data/PmsProvider.jsx#L30), [PmsProvider:109](../../../frontend/src/apps/pms/data/PmsProvider.jsx#L109).

Lễ tân có `dashboard.view` nhưng endpoint dùng `reports.view`, nên test nhận **403 thay vì 200**. Trình duyệt vẫn cho vào route Dashboard, hiện hộp báo lỗi và dòng xanh “Số liệu phòng được đồng bộ từ máy chủ”.

Quan sát thực tế: đóng hộp báo lỗi rồi hộp lại xuất hiện; console liên tục nhận lỗi. Callback `getDashboardReport` được tạo lại mỗi lần provider render; lỗi gọi `setAccessDialog`, làm callback đổi và effect chạy lại. Cơ chế tương tự có thể xảy ra ở Reports khi yêu cầu thất bại.

Hướng sửa: dùng quyền vận hành `dashboard.view`, giữ báo cáo tài chính dưới `reports.view`; ổn định callback và hiển thị loading/error tại trang. Không tự gửi lại 403 sau mỗi render, không hiển thị đồng bộ thành công khi fetch thất bại.

### 6. Phòng vẫn IN_HOUSE nhưng đến ngày trả bị tính không còn ở

Vị trí: [reports/dashboard:50](../../../backend/pms_api/reports/routes.py#L50).

Booking đang `IN_HOUSE`, trả dự kiến hôm nay và chưa checkout: API trả `occupied=0`, test kỳ vọng **1**. Điều kiện `check_out > date` loại phòng trước khi checkout thực sự hoàn thành, gây sai số “Khách đang ở” và công suất Dashboard.

Hướng sửa: định nghĩa số đang ở hiện tại theo trạng thái và checkout thực tế; tách khỏi công suất lịch sử/dự kiến theo đêm.

### 7. Dashboard còn dữ liệu mẫu; báo cáo thiếu chỉ số đã ghi hoàn thành

Vị trí: [Dashboard:103](../../../frontend/src/apps/pms/dashboard/pages/Dashboard.jsx#L103), [Dashboard:124](../../../frontend/src/apps/pms/dashboard/pages/Dashboard.jsx#L124), [reports:55](../../../backend/pms_api/reports/routes.py#L55), [todo:54](../../../tasks/todo.md#L54).

Browser QA có hai phòng sạch và **không có booking**. Các số tổng quan từ server bằng 0, nhưng phía dưới vẫn có biểu đồ doanh thu/công suất cố định, cảnh báo hai phòng bẩn, đoàn 15 khách, khách quá giờ và danh sách **3 khách chờ nhận/10 khách chờ trả** được viết sẵn.

API hiện chỉ có ba số vận hành và tổng giá đêm phòng. Chưa có ADR, doanh thu thực hiện, thực thu, tiền cọc, công nợ và đối soát từ booking/ledger như yêu cầu BE-08.1.

Trang Reports đã ghi rõ **“Tiền phòng dự kiến”**, chưa gồm dịch vụ, thuế và thanh toán. Việc forecast gồm booking xác nhận/tương lai là phù hợp với nhãn này; không ghi thành lỗi cộng doanh thu thực hiện. Lỗi là các báo cáo tài chính thực tế còn thiếu, và Dashboard đưa dữ liệu mẫu vào hoạt động thật.

Hướng sửa: nối biểu đồ, cảnh báo và danh sách với dữ liệu thật; bổ sung các chỉ số có định nghĩa riêng và fixture đối soát. Giữ giao diện hiện có khi thay nguồn dữ liệu.

## P2 — xử lý sau các lỗi P1

| Vấn đề | Bằng chứng | Vị trí và hướng sửa |
|---|---|---|
| History còn sửa được | `UPDATE subscription_history SET amount=1` bằng runtime thực thi thành công | Migration subscription: bổ sung bảo vệ append-only theo mẫu ledger/audit đang có |
| Chưa ràng buộc hai gói và input plan | Gói thứ ba được tạo với 201; giá âm/NaN, maxRooms âm, currency `ZZZ`, features dạng list đều 201 | `admin/routes.py:224`: giới hạn hai định danh gói, xác thực tiền hữu hạn, currency, quota, cấu trúc feature; không thêm tier thứ ba |
| Ngày sai làm API 500 | `not-a-date` hoặc `2026-02-30` trả 500 ở cả dashboard/revenue | `reports/routes.py:19,69`: dùng validator ngày chung và trả lỗi 400/422 có cấu trúc |
| API cho phép kỳ sai/quá dài | Kỳ đảo hoặc start=end trả 200; 367 ngày trả 200 và 367 rows | `reports/routes.py:94`: giới hạn kỳ tại server; dùng map theo ngày thay vì tìm lại trong toàn bộ rows cho từng ngày |
| Tiền mất độ chính xác khi serialize | `999999999999999.9999` thành `1000000000000000.0` | `reports/routes.py:98`, `admin/routes.py:215`: trả Decimal dưới dạng chuỗi theo quy ước API tiền đang có; client không dùng float để đối soát |
| Currency mặc định không theo tenant | Tenant USD có đêm 25.1250 USD; bỏ currency thì API trả 0 vì mặc định VND | `reports/routes.py:71`: lấy mặc định từ settings tenant, vẫn tách tiền tệ và không tự quy đổi |

## Những phần đã kiểm chứng hoạt động

- Báo cáo forecast loại booking hủy, tách tenant/currency và không bao gồm ngày kết thúc; tổng fixture biết trước đạt.
- Các số đến/đi/ở đạt cho fixture thông thường, ngoại trừ phòng đến ngày checkout chưa checkout nêu trên.
- Đổi tenant trên URL báo cáo bị chặn 403.
- Lễ tân và buồng phòng không được xem báo cáo tài chính.
- Chỉ system roles được quản trị subscription; manager không được tạo plan.
- Tenant suspended bị chặn ghi; quyền đọc hiện có vẫn được giữ.
- 102 tests nền, booking, tài chính và housekeeping đều đạt trong lần chạy chung.

## Bằng chứng trình duyệt

Trình duyệt dùng frontend hiện tại tại port 5174 và backend QA tại port 5001, database riêng và tài khoản giả. Tab người dùng đang mở tại port 5173 không bị đổi phiên.

![Dashboard: số server bằng 0 nhưng biểu đồ và cảnh báo vẫn là dữ liệu mẫu](C:/Users/Laptop/.codex/visualizations/2026/10/02/01a0fc72-af94-73e1-86ad-bf52b656fce6/be08-dashboard-mock.png)

![Lễ tân bị 403 trong Dashboard vẫn ghi đồng bộ thành công](C:/Users/Laptop/.codex/visualizations/2026/10/02/01a0fc72-af94-73e1-86ad-bf52b656fce6/be08-frontdesk-dashboard.png)

![Billing chưa triển khai và thao tác lưu bị tắt](C:/Users/Laptop/.codex/visualizations/2026/10/02/01a0fc72-af94-73e1-86ad-bf52b656fce6/be09-billing-unavailable.png)

![Tenant chưa có luồng cấu hình gói BE09](C:/Users/Laptop/.codex/visualizations/2026/10/02/01a0fc72-af94-73e1-86ad-bf52b656fce6/be09-tenant-plan-unavailable.png)

## Thứ tự sửa đề xuất

1. RLS subscription/history, bảo vệ lịch sử và entitlement/quota tại API.
2. Dashboard permission, vòng lặp lỗi và phòng chờ checkout; thay dữ liệu mẫu bằng nguồn thật.
3. Gia hạn/history và kết nối Billing/Tenants với API.
4. Hoàn thiện ADR, doanh thu/thực thu/cọc/nợ và đối soát ledger.
5. Validation plan/ngày, serialize tiền chính xác, mặc định currency và lint/format.

Chạy lại toàn bộ acceptance sau từng nhóm sửa. Chỉ nghiệm thu BE-08–09 khi các tests nghiệp vụ mới đạt và luồng client lưu/tải lại dữ liệu thật hoạt động.
