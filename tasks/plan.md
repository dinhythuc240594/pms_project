# Kế hoạch chức năng PMS sau khi kết nối PostgreSQL

Cập nhật 29/10/2026: đã hoàn thiện [BIZ-01–07](business-p1-implementation-2026-10-29.md) theo yêu cầu sửa full P1. Xem [kết quả kiểm chứng và đề xuất](../docs/reports/reviews/full-p1-business-fixes-2026-10-29.md). Kế hoạch và lịch sử bên dưới được giữ để đối chiếu.

Ngày lập: 03/10/2026. Phạm vi: triển khai nghiệp vụ backend và nối giao diện hiện có với API, giữ phong cách giao diện Client.

## Điểm xuất phát khi lập kế hoạch

- Backend Flask đã kết nối PostgreSQL local, có health/readiness, cấu hình local/production, tài khoản runtime/migration riêng và migration nền tảng.
- Chưa có bảng hoặc API nghiệp vụ. `alembic_version` không phải dữ liệu đặt phòng.
- FE-01/FE-02 đã hoạt động ở chế độ demo: tenant store, danh mục, session/quyền và feature access. Nghiệp vụ hiện vẫn dùng localStorage.
- FE-03/FE-04 còn thiếu chi tiết booking, sổ thanh toán, POS và thu chi thật. Không chuyển dữ liệu demo thành dữ liệu production tự động.
- Hệ thống chỉ có **hai gói dịch vụ** theo yêu cầu người dùng. Tên, quyền từng gói và chính sách dùng thử cần chốt trước khi triển khai billing/gating; không sao chép danh sách gói mẫu trong tài liệu thành gói thực.

Nguồn yêu cầu: [thiết kế cuối cùng](../pms_system_design_final.md), [báo cáo FE](../docs/reports/reviews/PMS_GAP_REPORT.md). Báo cáo FE có phần hiện trạng cũ; tình trạng backend ở trên đã được đối chiếu lại với source.

## Cập nhật triển khai ngày 03/10/2026

BE-01 đến BE-05 đã có migration, API, kết nối frontend và kiểm thử PostgreSQL local. Login/session, danh mục, booking và tiền trong các luồng này dùng dữ liệu server; localStorage demo không còn là nguồn dữ liệu vận hành. Giữ bố cục Client hiện có. Xem [báo cáo triển khai](../docs/reports/backend/BE01_05_IMPLEMENTATION_REPORT.md) và [todo.md](todo.md).

Chính sách đã chốt: **chặn checkout đến khi thanh toán đủ**; trả phòng chuyển phòng sang bẩn. BE-06 trở đi và triển khai Coolify vẫn là công việc tiếp theo.

## Thứ tự ưu tiên

P0 là lõi cần cho một khách sạn vận hành; P1 hoàn thiện quản lý và SaaS; P2 mở rộng sau khi lõi ổn định. Đây là thứ tự triển khai, không thay thế điều kiện đưa hệ thống ra phục vụ khách thật.

| Mã | Mức | Chức năng | Kết quả cần đạt |
| --- | --- | --- | --- |
| BE-01 | P0 | Đăng nhập, khách sạn, người dùng và phân quyền | Session thật, tenant membership, RBAC/RLS, Admin tạo khách sạn và cấp owner; kiểm tra quyền ở API. |
| BE-02 | P0 | Danh mục và cấu hình | Hồ sơ khách sạn, múi giờ/tiền tệ, hạng phòng/phòng, giá cơ bản, nguồn booking, dịch vụ, phương thức thanh toán/quỹ lưu PostgreSQL. |
| BE-03 | P0 | Giá và phòng trống cơ bản | Báo giá theo ngày, khóa phòng/bảo trì, stop-sell cơ bản và tồn phòng; làm nguồn cho booking. |
| BE-04 | P0 | Khách hàng và đặt phòng | Hồ sơ khách, nhiều khách/phòng, tạo/sửa/hủy, lịch/sơ đồ phòng, check-in và sạch/bẩn tối thiểu; chống đặt trùng khi có thao tác đồng thời. |
| BE-05 | P0 | Dịch vụ, thanh toán và checkout | Giá từng đêm, thuế/phí, dịch vụ, cọc, thanh toán từng phần, công nợ, giao dịch quỹ; checkout theo chính sách số dư đã chốt. |
| BE-06 | P1 | POS và thu chi đầy đủ | Lưu nháp/hóa đơn, bán lẻ/ghi vào booking, thu/chi/rút quỹ và hoàn/hủy có lịch sử; cùng nguồn giao dịch với BE-05. |
| BE-07 | P1 | Buồng phòng đầy đủ | Nhân viên, ca/giao việc, kế hoạch check-in/check-out/stay-over, đang kiểm tra/hỏng và lịch sử. |
| BE-08 | P1 | Dashboard và báo cáo cơ bản | Khách đến/đi/ở, công suất, ADR, doanh thu, thực thu, cọc/công nợ và đối soát quỹ từ dữ liệu thật. |
| BE-09 | P1 | Quản trị SaaS và hai gói | Khóa/mở tenant, hai gói, gia hạn, lịch sử đổi gói, bật/tắt tính năng và giới hạn thực thi ở backend. |
| BE-10 | P1 | Kho | Tồn đầu kỳ, nhập/xuất/chuyển/kiểm kê, lịch sử biến động và báo cáo tồn. |
| BE-11 | P2 | Giá nâng cao | Cuối tuần/LOS, voucher/khuyến mãi, đa tiền tệ và tỷ giá theo giao dịch. |
| BE-12 | P2 | Tích hợp và mở rộng | OTA/Channel Manager, Email/Webhook, báo cáo nâng cao, API ngoài và mobile theo thứ tự nhu cầu. |

## Quy tắc triển khai

1. Chia mỗi nhóm BE thành các lát chức năng nhỏ trong [todo.md](todo.md). Hoàn thành migration → API → giao diện hiện có → kiểm thử của lát đó trước khi chuyển lát tiếp theo.
2. Nối API theo từng phân hệ. Không coi việc tạo đủ schema là hoàn thành chức năng; dữ liệu phải dùng được từ giao diện và giữ sau tải lại.
3. Tenant context lấy từ người dùng/membership đã xác thực. Thay `tenant_id` trong request không được vượt quyền. Role runtime không được superuser hoặc BYPASSRLS; RLS phải bảo vệ cả đọc và ghi, kể cả khi dùng connection pool.
4. Audit người thao tác/thời điểm/đối tượng xây cùng thao tác ghi từ BE-01. Lịch sử dịch vụ, booking và tiền không đợi đến màn hình Logs mới ghi.
5. Sạch/bẩn và checkout chuyển phòng bẩn là lõi BE-04/05; chỉ chức năng phân ca/giao việc được để BE-07.
6. Cọc/thanh toán phải cập nhật booking và quỹ trong cùng transaction; hoàn/hủy tạo giao dịch đối ứng. Tiền dùng Decimal/NUMERIC, không FLOAT. Mô hình giữ mã tiền tệ ngay từ đầu.
7. Giá snapshot của booking cũ không đổi khi sửa giá danh mục. Cập nhật tồn phòng và booking phải nhất quán khi tạo/sửa/hủy hoặc nhận/trả phòng.
8. Báo cáo doanh thu và thực thu là hai chỉ tiêu riêng. Công suất lưu trú đã xảy ra không dùng nguyên công thức tồn phòng tương lai. Định nghĩa số liệu phải có trong API và kiểm thử.
9. Phần giới hạn/tính năng SaaS nằm sau nhóm vận hành ở thứ tự xây, nhưng phải được kiểm tra server trước khi public sản phẩm trả phí/dùng thử. Không dùng guard frontend làm cơ chế bảo mật.

## Kiểm chứng

- Backend: từ `backend`, chạy `python -m unittest discover -s tests -v`, `python -m ruff check .` và `python -m ruff format --check .` bằng Python của `.venv`.
- Khi có schema nghiệp vụ, chạy integration tests trên database `pms_test_*` riêng; migration upgrade/rollback và quyền tenant phải được kiểm tra thật trên PostgreSQL.
- Frontend khi có thay đổi: từ `frontend`, chạy `npm test`, `npm run build`, `npm run lint` và kiểm tra luồng tương ứng trong browser. Ghi rõ cảnh báo lint tồn tại trước thay đổi.
- Không tuyên bố dữ liệu đã lên Coolify chỉ dựa vào local thành công. Kiểm tra `/api/ready` và luồng API thật tại môi trường đó khi triển khai.

## Mốc hoàn thành

- Sau BE-01/02: hai khách sạn có tài khoản và danh mục độc lập; người dùng không xem/sửa dữ liệu khách sạn khác.
- Sau BE-03/04/05: cấu hình phòng → booking → cọc → check-in → dịch vụ → thanh toán → checkout chạy trọn trên PostgreSQL, nhiều máy xem cùng dữ liệu.
- Sau BE-06/07/08: hóa đơn/quỹ/phòng/báo cáo đối soát được với nhau.
- Trước phục vụ khách thật: chốt hai gói và giới hạn; kiểm tra RLS, thao tác đồng thời, tiền, backup/restore, migration và cấu hình Coolify. Checklist kỹ thuật này không phải yêu cầu thực hiện deploy trong lần lập kế hoạch.

## Điểm cần chốt khi đến chức năng tương ứng

- Tên, giá, quyền và giới hạn của đúng hai gói; có dùng thử hay không và chính sách quota.
- Checkout: đã chốt chặn khi còn nợ; muốn điều chỉnh sau khi đã chốt lưu trú cần luồng kế toán BE-06.
- Thuế/phí đã bao gồm trong giá hay cộng thêm; quy tắc hoàn cọc/hủy booking.
- Kênh thanh toán SaaS và nhà cung cấp OTA/Email khi bắt đầu tích hợp.

Các mục BE-01–05 đã triển khai local; các mục BE-06 trở đi vẫn là kế hoạch theo thứ tự ưu tiên trên.
