# Kết quả sửa P1 BE-08–09

Ngày: 05/10/2026. Đã xử lý bảy nhóm P1 trong [báo cáo kiểm thử ban đầu](../reviews/BE08_09_TEST_REPORT.md), giữ bố cục và phong cách giao diện hiện có. Báo cáo ban đầu được giữ để đối chiếu trước/sau.

## Những phần đã sửa

| P1 | Kết quả |
|---|---|
| Cách ly subscription/history | Migration 0007 bật FORCE RLS theo tenant/system; history được bảo vệ chỉ thêm. |
| Entitlement và quota | API chặn tính năng tắt, chặn ghi khi gói chưa hiệu lực/hết hạn/ngừng cung cấp. Quota tính phòng/tài khoản đang hoạt động; kiểm cả bật lại phòng, danh sách phòng hàng loạt và tạo đồng thời. Thứ tự khóa tenant trước entitlement thống nhất với gia hạn. |
| Gia hạn và lịch sử | Lưu hạn, khoản ghi nhận, tiền tệ, chu kỳ, trạng thái, người thao tác; phân biệt đổi gói và gia hạn; subscription/history cùng transaction. |
| Billing/Tenants | Đọc/sửa hai gói, cấp/đổi/gia hạn thuê bao và đọc lịch sử qua API; lưu rồi đọc lại server; bộ lọc gói và hạn trên Tenants đồng bộ. UsageInfo hiển thị quota/tính năng thực. |
| Dashboard lễ tân | Dùng dashboard.view; callback ổn định; loading/error rõ ràng; không lặp lỗi 403. |
| Phòng đang ở đến ngày checkout | Đếm trạng thái IN_HOUSE cho đến checkout thực tế, gồm phòng đến hạn/quá hạn. |
| Báo cáo và dữ liệu mẫu | Biểu đồ/cảnh báo/danh sách Dashboard lấy dữ liệu thật. Reports có doanh thu hóa đơn đã chốt, thực thu, ADR, cọc/nợ và đối soát ledger, giữ tiền chính xác. Công suất đếm mọi tiền tệ; số tiền vẫn tách VND/USD. |

Các sửa liên quan cũng hoàn tất: xác thực ngày/kỳ báo cáo, giới hạn 366 ngày, tiền Decimal string, tiền tệ mặc định theo tenant, input gói và lịch sử bất biến. Ô ngày Reports/Billing xử lý cả input/change để giá trị đang hiển thị và dữ liệu gửi server đồng bộ ngay.

## Kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| Backend trên PostgreSQL thật, role runtime hạn chế | **139/139 đạt**, không skip: 102 nền + 12 report acceptance + 3 đối soát tài chính + 22 subscription acceptance. Lần cuối sau bổ sung validation/atomicity và bật lại tài khoản: 102,246 giây. |
| Frontend Node tests | **30/30 đạt**. |
| Frontend production build | Đạt. |
| Frontend lint | Exit 0, 72 warnings; không thêm suppression. |
| Ruff check/format các 10 files backend nghiệp vụ/migration/tests liên quan | Đạt. |
| Ruff toàn backend | Còn 3 lỗi import/unused tại migration cũ, patch.py và domain_fixture.py; còn files ngoài phạm vi chưa format. Không đồng nghĩa toàn repository đã sạch lint. |
| Migration local | Nâng pms_local từ cdb4bc7d62d0 lên 0007_subscription_controls; db-check đạt. API local /api/ready trả database/schema/status=ok; frontend5173 trả200. |

Các tests bổ sung bao phủ quota qua bật lại/bulk (phòng và tài khoản), đọc khi hết hạn nhưng chặn ghi, tính năng tắt chặn API trực tiếp và dữ liệu tài chính Dashboard, gia hạn đồng thời tạo phòng, độ chính xác tiền, công suất VND+USD và rollback thuê bao/history khi ngày, số tiền, currency hoặc kiểu chu kỳ sai.

Kiểm tra trình duyệt dùng backend5001/frontend5174 và PostgreSQL QA riêng với tài khoản giả:

- Lễ tân thấy một phòng chờ nhận, một chờ trả và một đang ở, gồm phòng trả hôm nay; không có lỗi console và không có tài chính trên biểu đồ.
- Billing gia hạn Hotel a đến 05/11/2027, khoản ghi nhận 2.500.000,125 VND; tải lại vẫn có action Gia hạn, đúng hạn, số tiền và người thao tác. Chỉnh quota Free30→29, tải lại còn29. Đây là dữ liệu thử, không thanh toán thật.
- Tenants nhận đúng hạn mới và bộ lọc gói hoạt động.
- Reports đổi kỳ 03–06/10/2026: forecast470,125; doanh thu ghi nhận120,125; thực thu140,125; ADR135,0625; cọc20; nợ330 VND; đối soát đầu0 + thu140,125 − chi0 = cuối140,125. Khớp fixture. Console không có lỗi.

![Dashboard lễ tân sau sửa](C:/Users/Laptop/.codex/visualizations/2026/10/02/01a0fc72-af94-73e1-86ad-bf52b656fce6/p1-frontdesk-dashboard.png)

![Gia hạn và lịch sử](C:/Users/Laptop/.codex/visualizations/2026/10/02/01a0fc72-af94-73e1-86ad-bf52b656fce6/p1-billing-renewal.png)

![Reports đối soát dữ liệu thật](C:/Users/Laptop/.codex/visualizations/2026/10/02/01a0fc72-af94-73e1-86ad-bf52b656fce6/p1-financial-report.png)

## Phạm vi và giới hạn

Doanh thu ghi nhận hiện theo hóa đơn đã chốt/checkout, chưa phải doanh thu dồn tích từ Night Audit. ADR tính đêm đã phục vụ trước ngày kinh doanh hiện tại. Công suất lịch sử dùng tổng phòng đang hoạt động hiện tại; chưa lưu lịch sử thay đổi sức chứa. Cọc/nợ là số dư hiện tại tại asOf, không phải số dư cuối kỳ quá khứ. Các định nghĩa được trả trong API và hiện ở Reports.

Tenant chưa được cấp subscription giữ tương thích dữ liệu cũ. Feature flags chặn truy cập module; workspace vẫn tổng hợp theo quyền và tenant, không dùng flags làm ranh giới bảo mật dữ liệu riêng. Gói hạ quota không xóa tài nguyên đã có. Lịch sử API hiện trả 200 mục mới nhất. Billing ghi nhận khoản gia hạn thủ công, chưa có cổng thanh toán tự động.

Chưa triển khai lên Coolify. Khi triển khai code mới, chạy `python manage.py db upgrade` trong backend trên Coolify bằng DATABASE_MIGRATION_URL của host, rồi kiểm tra /api/ready. Không commit hoặc push trong lượt sửa này.

Hai database browser QA đã được xác minh theo tên UUID và fingerprint dữ liệu giả rồi xóa; các port QA5001/5174 đã dừng. Frontend5173 và backend5000 tiếp tục dùng pms_local.
