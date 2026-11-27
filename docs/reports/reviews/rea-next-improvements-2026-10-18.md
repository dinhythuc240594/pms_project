# LOHA PMS — đề xuất cải thiện giai đoạn tới

Ngày đánh giá: 18/10/2026. Đối tượng: mã nguồn tại commit `b52c3c2`.

Áp dụng skill `reverse-engineer-anything` theo nhánh repository có nguồn đầy đủ: đọc source, tests và đối chiếu báo cáo. Không chạy engine dịch ngược hoặc quan sát ứng dụng production; các mã S01–S08 dưới đây là chỉ mục nguồn của báo cáo, không phải REA Evidence ID. Không sửa mã ứng dụng hoặc gọi Channex thật.

Nên ưu tiên độ tin cậy của giao dịch và nghiệp vụ lễ tân. Nền tảng hiện đã có RLS, quyền, CSRF, khóa tồn phòng, chống gửi trùng tiền, lịch sử tiền bất biến, outbox OTA, retry và xử lý booking cần đối soát; cần phát triển tiếp từ những cơ chế này.

## Thứ tự đề xuất

### S01 — P1: Giảm sự phụ thuộc của giao dịch lễ tân vào hàng đợi và độ trễ OTA

**Quan sát:** `backend/pms_api/channels/service.py:76` trả lỗi khi có ít nhất 500 job pending. `security.py:190` gọi enqueue từ audit trong cùng transaction; `channels/service.py:113` chuyển các thay đổi booking/phòng thành ARI job. API lỗi sẽ rollback. Worker còn giữ khóa tenant (`service.py:782`) khi chạy job (`:853`), trong khi mọi API ghi cũng lấy khóa này (`security.py:162`). HTTP client có timeout mặc định 15 giây (`channels/client.py:66`).

**Suy luận, tin cậy cao:** nếu queue đầy và cần job mới, thao tác booking có thể bị rollback; nếu Channex chậm, các thao tác ghi cùng khách sạn có thể phải chờ. Chưa tái hiện hoặc đo độ trễ thực tế.

**Bước cải thiện:** gộp vùng tồn phòng cần đồng bộ bằng dirty state bền vững, giữ khả năng khôi phục đồng bộ khi worker trở lại. Đo thời gian chờ khóa, gom các truy vấn ARI theo loại phòng/ngày. Nếu tách gọi mạng khỏi khóa, cần version/lease và kiểm thử thứ tự publication; không đơn giản bỏ khóa hoặc nuốt lỗi queue.

**Điều kiện đạt:** mô phỏng queue đầy, worker ngừng và provider chậm; booking không mất, tồn phòng vẫn được đẩy lại đúng, không publish snapshot cũ.

### S02 — P1: Cảnh báo khi hai nhân viên lưu cùng booking từ dữ liệu cũ

**Quan sát:** `frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:45` gửi lại phòng, ngày, nguồn và khách. `backend/pms_api/bookings/routes.py:747` khóa bản ghi mới nhưng không kiểm tra phiên bản người dùng đã đọc; nguồn và khách được ghi ở `:836`, `:839`. Booking chưa có version, trong khi kiểm kê đã có mẫu `expectedVersion` tại `inventory/routes.py:622`.

**Suy luận, tin cậy cao:** B đổi nguồn; A vẫn mở bản cũ, sửa điện thoại rồi lưu có thể đưa nguồn về giá trị cũ mà không báo. Row lock bảo vệ transaction nhưng không phát hiện biểu mẫu cũ.

**Bước cải thiện:** thêm version booking và `expectedVersion`; trả 409 để người dùng tải lại khi có xung đột. Kiểm tra thêm version hồ sơ khách nếu thao tác sửa đồng thời cập nhật dữ liệu khách dùng chung.

**Điều kiện đạt:** hai phiên mở cùng bản, phiên thứ hai lưu dữ liệu cũ phải nhận thông báo xung đột, không ghi đè âm thầm.

### S03 — P1 trước vận hành rộng: CI, giám sát worker và phục hồi dữ liệu

**Quan sát:** không thấy cấu hình CI được Git theo dõi ở các vị trí workflow thông dụng. `backend/tests/domain_fixture.py:25` skip khi thiếu hai URL database test. `/api/ready` tại `pms_api/health.py:11` kiểm tra DB/schema/quyền runtime; Docker healthcheck chỉ gọi `/api/health` (`Dockerfile:21`). README backend `:207` nêu migration hậu triển khai có thể lỗi dù trạng thái deploy báo thành công.

**Bước cải thiện:** CI dựng PostgreSQL riêng, chạy migration và test nghiệp vụ/RLS/cạnh tranh, báo lỗi nếu nhóm test bắt buộc bị skip. Smoke test `/api/ready` sau deploy. Theo dõi heartbeat worker, tuổi job lâu nhất, lần import/ACK thành công gần nhất và booking `needs_review` quá hạn.

Kiểm chứng lịch backup, khôi phục thử sang môi trường riêng, thời gian phục hồi và lượng dữ liệu có thể mất. PostgreSQL có các phương án dump, backup filesystem và continuous archiving; chọn theo nhu cầu phục hồi ([tài liệu PostgreSQL](https://www.postgresql.org/docs/current/backup.html)). Khóa mã hóa Channex cần được sao lưu riêng theo README hiện có.

**Chưa biết:** CI, alert, backup và worker thực tế trên Coolify có thể được cấu hình ngoài repository; báo cáo này không khẳng định chúng chưa tồn tại.

### S04 — P1 nghiệp vụ: Chuyển phòng và gia hạn khi khách đang ở

**Quan sát:** `backend/pms_api/bookings/routes.py:779` cố ý chặn thay đổi ngày/phòng cho booking `IN_HOUSE`; UI tương ứng khóa điều khiển tại `BookingDetailPanel.jsx:120`. Đổi phòng/ngày trước check-in đã có.

**Bước cải thiện:** thao tác riêng để kiểm tra tồn, báo giá phần thay đổi, xác nhận chênh lệch, ghi lịch sử và cập nhật buồng phòng/OTA. Giữ giá và tiền lịch sử; không chỉ gỡ điều kiện chặn hiện tại.

**Điều kiện đạt:** chuyển phòng, ở thêm đêm, thiếu phòng, chênh lệch tiền và hai nhân viên cùng thao tác đều được kiểm tra trên PostgreSQL riêng.

### S05 — P1/P2 nghiệp vụ: Night Audit và đối soát ca

**Quan sát:** báo cáo hiện tách doanh thu đêm phòng và doanh thu hóa đơn checkout (`backend/pms_api/reports/routes.py:177`, `:184`, `:222`); chưa có quy trình chốt ngày. Backlog còn mở được ghi tại `docs/reports/reviews/remaining-functions-2026-10-14.md`.

**Bước cải thiện:** bắt đầu bằng màn kiểm tra booking chưa nhận/trả, no-show chưa xử lý, dư nợ, thu/hoàn và số dư quỹ; lưu người/thời điểm/kết quả đối soát. Chốt chính sách ngày kinh doanh, điều chỉnh và ghi nhận doanh thu trước khi khóa kỳ hoặc tự thêm bút toán.

### S06 — P2 kỹ thuật: Tải dữ liệu theo phạm vi và giảm mã tải ban đầu

**Quan sát:** workspace ghép nhiều phân hệ (`backend/pms_api/workspace.py:22`); booking snapshot tải toàn bộ booking và các bảng con (`bookings/routes.py:160`, `:355`). Danh sách frontend phân trang sau khi đã nhận toàn bộ dữ liệu (`Reservations.jsx:21`). Sổ quỹ cũng tải ledger rồi cắt trang trong Python (`finance/routes.py:1146`, `:1171`). Router import tĩnh các màn hình (`frontend/src/app/App.jsx`).

Build hiện tại tạo chunk ứng dụng chính **1.268,26 kB**, gzip **336,24 kB**, chưa tính vendor/CSS. Đây là kích thước build, chưa phải số đo tải trang hoặc trải nghiệm trên thiết bị.

**Bước cải thiện:** SQL filtering/pagination cho booking và ledger; tải chi tiết theo ID, làm mới đúng phân hệ sau ghi. Tách mã theo nhóm trang bằng cơ chế `lazy`/`Suspense` sẵn có của React ([tài liệu React](https://react.dev/reference/react/lazy)). Đo với lịch sử lớn trước/sau; chưa cần thêm thư viện quản lý state.

Giữ chủ trương tải lại thủ công đã chốt ngày 17/10 (`docs/reports/frontend/manual-refresh-2026-10-17.md`), cùng bảo vệ bản nháp và phản hồi tenant cũ.

### S07 — P2 mở rộng OTA: Làm rõ chính sách giá PMS và OTA

**Quan sát:** ARI dùng giá ngày hoặc giá cơ bản và stop-sell (`channels/service.py:494`); engine PMS còn có LOS/cuối tuần, voucher và promotion (`pricing/engine.py:171`). Hai phạm vi này không tự động tương đương.

**Bước cải thiện:** công bố chính sách nào áp dụng từng kênh, có preview giá gửi OTA và cảnh báo khác biệt. Mở rộng từng rate plan/restriction được hỗ trợ. Không tự áp voucher nội bộ lên OTA. Với booking cần đối soát, làm rõ người phụ trách và thời hạn xử lý trước khi mở rộng tự động hóa.

### S08 — P2 trước bán SaaS rộng: Khôi phục tài khoản và dịch vụ tự phục vụ

**Quan sát:** login hướng người quên mật khẩu liên hệ quản trị (`frontend/src/apps/pms/auth/pages/Login.jsx:70`); tab đơn hàng vẫn là empty state (`profile/pages/Profile.jsx:109`). Thay mật khẩu khi đã đăng nhập, xem/thu hồi phiên và billing Manager đã có; 2FA backend chưa được triển khai.

**Bước cải thiện:** reset mật khẩu một lần có hạn dùng, lịch sử hóa đơn/gói chỉ đọc theo tenant; MFA cho Super Admin/Manager/Owner theo mức độ sử dụng thực tế, có quy trình recovery ([hướng dẫn OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)). Sau đó mới chọn payment gateway, tự gia hạn và kênh thông báo email/Zalo/SMS theo nhu cầu khách hàng.

## Kiểm chứng đã thực hiện

| Kiểm tra | Kết quả và giới hạn |
| --- | --- |
| Frontend `npm test` | 165 đạt, 0 thất bại. |
| Frontend `npm run lint` | Exit 0, còn warning hiện có. |
| Frontend `npm run build` | Thành công; số đo bundle ở S06. |
| Frontend `npm run i18n:audit` | Exit 0; còn 4 mục chưa catalogued, là việc hoàn thiện nhỏ. |
| Backend unittest discovery | `Ran 122 tests`, `OK (skipped=58)`; chủ động bỏ hai URL database test trong tiến trình chạy. Không xác nhận nhóm PostgreSQL đã đạt. Lượt đầu gặp quyền Temp của sandbox; chạy lại ngoài sandbox sau phê duyệt đạt. |
| Đối chiếu tài liệu | README frontend còn mô tả POS/kho/OTA/billing chưa triển khai; source hiện đã có. Nên cập nhật khi chốt roadmap. Báo cáo cũ mô tả polling 30 giây đã được thay bằng refresh thủ công ngày 17/10. |

Chưa chạy browser trong lượt này, chưa thử tải/concurrency trên PostgreSQL, chưa nghiệm thu production/Coolify hoặc Channex thật. Các rủi ro suy ra từ source cần test tái hiện trước khi coi là sự cố vận hành đã xác nhận.

## Gợi ý chia đợt

- Đợt 1: tái hiện S01/S02, bổ sung cổng kiểm chứng và giám sát S03; xử lý vấn đề được xác nhận.
- Đợt 2: chuyển phòng/gia hạn S04, đối soát ca và phần Night Audit đã chốt chính sách S05.
- Đợt 3: dữ liệu/bundle S06, phạm vi giá OTA S07 và tự phục vụ SaaS S08 theo nhu cầu pilot.

Đây là thứ tự khuyến nghị, chưa phải ước lượng thời gian hoặc cam kết triển khai.
