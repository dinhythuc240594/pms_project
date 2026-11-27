# Báo cáo đề xuất nâng cấp LOHA PMS

Ngày đánh giá: **21/10/2026**. Dự án: **pms-system**. Phạm vi board: project `90fb7c00-3d75-479c-83ae-ddbb58e63573`.

Snapshot source: commit `ec303906ec242dd9b7c0c278efccb08d522ec2c2`. Báo cáo dựa trên mã nguồn và tài liệu trong repository tại thời điểm đọc.

## 1. Định hướng nâng cấp

Ưu tiên bảo toàn dữ liệu và độ tin cậy giao dịch trước khi mở rộng tính năng. Đề xuất **36 ticket**, gồm **14 P1** và **22 P2**, chia thành các lát có thể giao cho agent hoặc người triển khai độc lập. Mỗi ticket có phạm vi, tiêu chí nghiệm thu, nguồn bằng chứng và phụ thuộc cụ thể.

Đây là **bản đề xuất**, chưa tạo ticket trên board. UI chỉ tạo ticket sau khi người dùng xác nhận. File [bản nháp JSON](upgrade-ticket-drafts-2026-10-21.json) là toàn bộ bộ đề xuất tương ứng; thứ tự không đồng nghĩa tất cả phải triển khai hoặc cam kết cùng một đợt.

Ba việc nên bắt đầu: UPG-01 bảo vệ dữ liệu khỏi dịch nhầm; UPG-02 và UPG-03 xử lý hai regression còn được ghi nhận trong báo cáo QA mới nhất. Sau đó xử lý timeout/kết quả ghi/bản nháp UPG-04–06 và các điều kiện vận hành UPG-07–09.

## 2. Nền tảng hiện có và giới hạn đánh giá

| Phân hệ | Đã thấy trong source/tài liệu hiện tại | Hướng nâng cấp |
| --- | --- | --- |
| Identity/tenant | Cookie HttpOnly, CSRF, session, rate limit đăng nhập, vai trò, RLS | MFA, recovery, xoay khóa và quan sát hệ thống |
| Booking/tiền | Nhiều phòng/khách, version chống ghi đè, giá đêm/tỷ giá snapshot, ledger và đối ứng, checkout chặn còn nợ | Độ tin cậy retry, chuyển phòng/gia hạn đang ở và đối soát hoa hồng |
| Kho/giá | Nhập/xuất/chuyển/kiểm kê, POS, minStock/lowStock; weekend/LOS/voucher/promotion và tỷ giá | Nghiệm thu theo luồng thực tế; tránh tạo lại module đã có |
| OTA | Mapping, queue/worker, dirty ARI, import/revision/ACK, onboarding booking cũ và checkpoint đối chiếu | Xử lý ngoại lệ, quan sát kết quả provider, lịch sử và staging pilot |
| Đối soát/vận hành | Preview/xác nhận ngày, snapshot không ghi tiền/khóa kỳ; CI PostgreSQL, heartbeat, operations panel, verify_restore.py | Cổng release và giám sát/backup trên môi trường đích |
| Giao diện | Nối nhiều API nghiệp vụ, refresh thủ công, inbox thông báo, hỗ trợ VI/EN/ZH | Bảo vệ dữ liệu/người nhập, chia tải và self service |

**Chuyển phòng/gia hạn sau check-in chưa hoàn tất.** `room_stays.py` và migration `0030_stay_changes` cung cấp nền dữ liệu; handler sửa booking vẫn trả `stay_started` khi booking `IN_HOUSE` thay ngày/phòng. `tasks/p1-implementation.md` là yêu cầu triển khai, không đủ để xác nhận đã hoàn thành. UPG-15/16 mở rộng từ nền này.

Bốn ticket QA2 về frontend, backend, API và E2E đang ở Done theo context board. Báo cáo không mở lại các đợt QA tổng quát đó. UPG-02/03 là sửa regression cụ thể; UPG-19 là nghiệm thu provider/môi trường staging chưa được tài liệu xác nhận hoàn tất.

README frontend và một số báo cáo cũ không còn đồng bộ với source. Khi có khác biệt, báo cáo này dùng source hiện tại và tài liệu mới hơn làm căn cứ; công việc hiệu chỉnh tài liệu được tách ở UPG-36.

## 3. Bằng chứng và kiểm chứng

| Kết quả | Nguồn và giới hạn |
| --- | --- |
| Đã đọc source/tài liệu hiện tại | Các đường dẫn trong từng ticket; không quan sát production/Coolify hoặc cấu hình ngoài repo |
| Lỗi dịch dữ liệu được tái hiện trong lượt này | Chạy Node trực tiếp gọi `localizeApiPayload` với dữ liệu tổng hợp, không gọi API hoặc ghi DB |
| Hai regression backend còn được báo cáo | Báo cáo OTA 20/10, chốt 21/10, mục kiểm chứng dòng 47–50; chưa chạy lại suite trong lượt này |
| Frontend 172 tests/lint/build đạt ở lượt QA trước | Theo báo cáo OTA 20/10; đây là kết quả lịch sử, không phải lần kiểm tra mới của báo cáo nâng cấp |
| JSON bản nháp và tài liệu | Kiểm cấu trúc, projectId, draftKey duy nhất, phụ thuộc tồn tại/không chu trình và đường dẫn nguồn sau khi ghi file |

Kết quả tái hiện UPG-01 ở locale `en-US`: trường `guest` có giá trị `Thanh toán` trở thành `Payment`; `notes[0].text` từ `Phòng trống` thành `Vacant rooms`; `tenant.name` từ `Tất cả` thành `All`. Điều này xác nhận adapter có thể thay đổi nội dung nghiệp vụ trong state. Chưa tái hiện lưu giá trị đã dịch xuống database và chưa có bằng chứng sự cố production.

CI thực tế đã có workflow và simulator. Báo cáo QA mới nhất còn nêu test no-show vướng guard downgrade của migration 0030 và test đối soát so chuỗi timestamp khác offset dù cùng thời điểm. Không hạ guard lịch sử hoặc cho phép skip để vượt cổng CI.

Nguồn chính: [QA OTA mới nhất](ota-fixes-2-11-12-2026-10-20.md), [runbook vận hành/restore](../../runbooks/operations-and-restore.md), [yêu cầu P1](../../../tasks/p1-implementation.md), [mã backend](../../../backend/pms_api), [mã frontend](../../../frontend/src). Các báo cáo cũ chỉ dùng để xác định bối cảnh; tính năng được đối chiếu lại source.

## 4. Ưu tiên, ước lượng và lộ trình

- **P1:** lỗi có thể ảnh hưởng dữ liệu/giao dịch; điều kiện nên đạt trước pilot; hoặc khoảng trống vận hành lễ tân/đối soát cần xử lý sớm. P1 không đồng nghĩa đã có sự cố production.
- **P2:** mở rộng bảo mật, hiệu năng, khả năng tra cứu và nghiệp vụ theo nhu cầu khách sạn pilot.
- Ước lượng từng ticket là ngày công, đã dành phần kiểm chứng phù hợp. Tổng thô **125–201 ngày công** nếu làm toàn bộ; chưa gồm thời gian chờ chính sách, credential/provider, quyền hạ tầng hoặc phản hồi UAT. Không quy đổi thành lịch giao hàng khi chưa biết nhân sự.
- Các vai trò phụ trách là gợi ý phân công, chưa phải cá nhân đã nhận việc. `dependsOn` là phụ thuộc giữa draft; điều kiện chính sách/quyền môi trường được ghi trong cảnh báo.

| Giai đoạn | Mục tiêu / ticket | Điều kiện chuyển bước |
| --- | --- | --- |
| A — Dữ liệu và giao dịch | UPG-01–06; UPG-02/03 có thể chạy song song với frontend | Lỗi có tái hiện/regression; timeout và retry không gây ghi trùng; giữ nháp và đúng tenant |
| B — Sẵn sàng vận hành | UPG-07–09; UPG-13/14 có thể thực hiện song song | CI bắt buộc xanh; staging chặn release lỗi; diễn tập cảnh báo và restore có bằng chứng |
| C — Pilot và nghiệp vụ chính | UPG-15–19 sau khi chốt chính sách tương ứng | Phòng/tiền/HK/OTA khớp; báo cáo go/no-go provider staging; không gọi production mặc định |
| D — Quy mô và tự phục vụ | UPG-10–12, UPG-20–35, chọn theo nhu cầu và số đo | Baseline rõ; UAT và đo trước/sau; tính năng có policy mới được bật |
| Liên tục | UPG-36 và cập nhật API_CONTRACT/runbook của mỗi thay đổi | Tài liệu phản ánh code, kiểm thử, UAT và deploy riêng biệt |

UPG-15 và UPG-16 có thể dùng chung một bộ preview/xác nhận thay đổi lưu trú sau khi chốt chính sách. Hai ticket không phụ thuộc bắt buộc nhau; nhóm triển khai cần thống nhất hợp đồng trước để tránh tạo hai cơ chế khóa/quote khác nhau.

## 5. Danh mục ticket

| Mã | Ưu tiên | Ticket | Ngày công | Phụ thuộc |
| --- | --- | --- | --- | --- |
| UPG-01 | P1 | Bảo toàn dữ liệu khi đổi ngôn ngữ | 3–5 | — |
| UPG-02 | P1 | Sửa fixture migration no-show | 2–3 | — |
| UPG-03 | P1 | Ổn định timestamp đối soát ngày | 1–2 | — |
| UPG-04 | P1 | Thêm timeout và lỗi giao thức API | 3–4 | — |
| UPG-05 | P1 | Tách kết quả ghi khỏi lỗi tải lại | 4–6 | UPG-04 |
| UPG-06 | P1 | Chặn mất bản nháp khi đóng form | 3–5 | UPG-04 |
| UPG-07 | P1 | Chặn release khi migration chưa đạt | 3–5 | UPG-02, UPG-03 |
| UPG-08 | P1 | Cảnh báo worker và backlog quá hạn | 2–3 | — |
| UPG-09 | P1 | Lập lịch backup và diễn tập restore | 3–5 | — |
| UPG-10 | P2 | Thêm MFA cho tài khoản quản trị | 5–8 | — |
| UPG-11 | P2 | Thêm luồng khôi phục mật khẩu | 4–6 | — |
| UPG-12 | P2 | Hỗ trợ xoay khóa mã hóa Channex | 3–5 | UPG-09 |
| UPG-13 | P2 | Thêm request ID và log có cấu trúc | 3–5 | — |
| UPG-14 | P2 | Thêm cổng quét bảo mật vào CI | 2–4 | — |
| UPG-15 | P1 | Thêm chuyển phòng khi khách đang ở | 7–10 | UPG-05 |
| UPG-16 | P1 | Thêm gia hạn booking đang lưu trú | 5–8 | UPG-05 |
| UPG-17 | P1 | Đối soát lại hoa hồng bị treo | 5–8 | — |
| UPG-18 | P1 | Thêm quy trình xử lý booking OTA lỗi | 5–8 | — |
| UPG-19 | P1 | Nghiệm thu Channex staging trước pilot | 3–5 | UPG-02, UPG-03, UPG-07, UPG-08, UPG-09 |
| UPG-20 | P2 | Cấu hình phạm vi full sync ARI | 3–5 | — |
| UPG-21 | P2 | Theo dõi kết quả ARI phía provider | 5–8 | — |
| UPG-22 | P2 | Phân trang lịch sử đồng bộ OTA | 2–4 | — |
| UPG-23 | P2 | Hỗ trợ ca buồng phòng qua đêm | 4–6 | — |
| UPG-24 | P2 | Phân trang lịch sử buồng phòng | 2–4 | — |
| UPG-25 | P2 | Giữ lịch sử năng lực bán phòng | 4–6 | — |
| UPG-26 | P2 | Phân trang booking tại máy chủ | 5–8 | UPG-04 |
| UPG-27 | P2 | Phân trang SQL cho sổ quỹ | 3–5 | — |
| UPG-28 | P2 | Làm mới dữ liệu theo phân hệ | 4–6 | UPG-05, UPG-26 |
| UPG-29 | P2 | Tách bundle theo route ứng dụng | 2–4 | — |
| UPG-30 | P2 | Hiển thị hóa đơn SaaS cho chủ khách sạn | 3–5 | — |
| UPG-31 | P2 | Lưu cơ cấu người lớn và trẻ em | 5–8 | — |
| UPG-32 | P2 | Thêm chính sách thuế và phí có phiên bản | 5–8 | — |
| UPG-33 | P2 | Thêm nhắc việc trong ứng dụng theo lịch | 4–6 | — |
| UPG-34 | P2 | Cấu hình tầng và khu vực phòng | 4–6 | — |
| UPG-35 | P2 | Hiển thị lỗi booking theo từng trường | 3–5 | UPG-04, UPG-06 |
| UPG-36 | P2 | Đồng bộ tài liệu với trạng thái source | 1–2 | — |

## 6. Phạm vi và nghiệm thu từng ticket

### UPG-01 — Bảo toàn dữ liệu khi đổi ngôn ngữ

**P1 · Lỗi tái hiện · 3–5 ngày công · Frontend.**

**Hiện trạng:** localizeApiPayload đang dịch mọi chuỗi, gồm tên khách, ghi chú và tên khách sạn trùng từ điển UI.

**Phạm vi:** Giới hạn dịch ở thông báo/descriptor i18n tường minh; bảo vệ dữ liệu nhập tay tại API adapter và DOM bridge.

**Nghiệm thu:** VI→EN→ZH giữ nguyên tên/ghi chú qua tải lại, sửa booking và CSV; nhãn UI vẫn dịch; có regression cho chuỗi trùng từ điển.

**Căn cứ:** [frontend/src/apps/pms/data/api.js:4](../../../frontend/src/apps/pms/data/api.js#L4); [frontend/src/shared/i18n/core.js:83](../../../frontend/src/shared/i18n/core.js#L83); [frontend/src/shared/i18n/LegacyI18nBridge.jsx:65](../../../frontend/src/shared/i18n/LegacyI18nBridge.jsx#L65).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Đã tái hiện bằng Node; chưa xác minh ghi sai xuống database hoặc ảnh hưởng production.

### UPG-02 — Sửa fixture migration no-show

**P1 · Regression theo báo cáo QA · 2–3 ngày công · Backend / QA.**

**Hiện trạng:** Test no-show hạ từ HEAD xuống 0019 sau khi đã tạo lịch sử đêm, xung đột guard migration 0030.

**Phạm vi:** Dựng fixture tại schema tiền nhiệm của no-show rồi nâng cấp; tách kiểm tra downgrade từ chối xóa lịch sử tại HEAD.

**Nghiệm thu:** Test migration no-show đạt; giữ kiểm tra bảo toàn trạng thái/tiền/RLS và guard 0030; cổng bắt buộc không skip.

**Căn cứ:** [backend/tests/test_booking_no_show.py:200](../../../backend/tests/test_booking_no_show.py#L200); [backend/migrations/versions/0030_stay_changes.py:31](../../../backend/migrations/versions/0030_stay_changes.py#L31); [docs/reports/reviews/ota-fixes-2-11-12-2026-10-20.md:50](../../../docs/reports/reviews/ota-fixes-2-11-12-2026-10-20.md#L50).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Lỗi được ghi trong QA 20/10; chưa chạy lại toàn suite trong lượt lập báo cáo.

### UPG-03 — Ổn định timestamp đối soát ngày

**P1 · Regression theo báo cáo QA · 1–2 ngày công · Backend.**

**Hiện trạng:** Response xác nhận, replay và lịch sử có thể biểu diễn cùng thời điểm bằng offset khác nhau, làm assertion toàn payload thất bại.

**Phạm vi:** Chốt hợp đồng timestamp, chuẩn hóa serialization nếu cần và kiểm tra thời điểm tương đương đúng ngữ nghĩa; giữ snapshot/idempotency.

**Nghiệm thu:** Xác nhận→replay→history nhất quán theo hợp đồng; đúng ranh giới ngày khách sạn; một xác nhận/audit và không phát sinh ledger khi replay.

**Căn cứ:** [backend/tests/test_day_reconciliation.py:130](../../../backend/tests/test_day_reconciliation.py#L130); [backend/pms_api/reconciliation/routes.py:131](../../../backend/pms_api/reconciliation/routes.py#L131); [docs/reports/reviews/ota-fixes-2-11-12-2026-10-20.md:50](../../../docs/reports/reviews/ota-fixes-2-11-12-2026-10-20.md#L50).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Cần phân biệt lỗi hợp đồng serialization với lỗi assertion; không bỏ kiểm tra snapshot để làm xanh CI.

### UPG-04 — Thêm timeout và lỗi giao thức API

**P1 · Khoảng trống từ source · 3–4 ngày công · Frontend.**

**Hiện trạng:** API client chưa đặt deadline mặc định và chuyển JSON lỗi thành null kể cả response 2xx.

**Phạm vi:** Đặt timeout read/write, gộp AbortSignal; phân loại offline/timeout/HTTP/payload sai và giữ mã lỗi.

**Nghiệm thu:** Request treo kết thúc theo cấu hình; 200 chứa HTML/JSON sai báo lỗi giao thức; không xóa dữ liệu gần nhất; timeout ghi giữ intent để đối soát.

**Căn cứ:** [frontend/src/apps/pms/data/api.js:90](../../../frontend/src/apps/pms/data/api.js#L90).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Không tự retry thao tác ghi thiếu idempotency; timeout không chứng minh server chưa ghi.

### UPG-05 — Tách kết quả ghi khỏi lỗi tải lại

**P1 · Rủi ro từ luồng mã · 4–6 ngày công · Full stack.**

**Hiện trạng:** mutate chờ POST/PATCH rồi refresh trong cùng try/catch; refresh lỗi có thể khiến giao dịch đã ghi bị báo thất bại.

**Phạm vi:** Hiển thị riêng kết quả ghi và lỗi đồng bộ; giữ ID/intent; bổ sung idempotency backend cho tạo booking và write cần retry.

**Nghiệm thu:** POST thành công + refresh 503 vẫn báo đã ghi; retry/reload không tạo booking hoặc thanh toán trùng; kết quả chưa rõ được đối soát bằng cùng intent.

**Căn cứ:** [frontend/src/apps/pms/data/PmsProvider.jsx:66](../../../frontend/src/apps/pms/data/PmsProvider.jsx#L66); [frontend/src/apps/pms/data/PmsProvider.jsx:154](../../../frontend/src/apps/pms/data/PmsProvider.jsx#L154); [backend/pms_api/bookings/routes.py:693](../../../backend/pms_api/bookings/routes.py#L693).

**Phụ thuộc draft:** UPG-04.

**Điều kiện/giới hạn:** Cần hợp đồng idempotency phía server cho write hiện chưa hỗ trợ; chưa tái hiện lỗi này trong browser.

### UPG-06 — Chặn mất bản nháp khi đóng form

**P1 · Khoảng trống từ source · 3–5 ngày công · Frontend.**

**Hiện trạng:** BookingDetailPanel có dirty state nhưng đóng bằng nút, Escape hoặc backdrop vẫn gọi onClose trực tiếp.

**Phạm vi:** Thêm guard dùng chung cho đóng form/chuyển route/tenant; quản lý thao tác ghi đang chờ và bản nháp trong bộ nhớ.

**Nghiệm thu:** Người dùng chọn tiếp tục sửa hoặc bỏ nháp; API lỗi giữ dữ liệu; lưu thành công gỡ guard; chuyển tenant không giữ dữ liệu khách sạn cũ.

**Căn cứ:** [frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:26](../../../frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx#L26); [frontend/src/apps/pms/components/LegacyOverlay.jsx:32](../../../frontend/src/apps/pms/components/LegacyOverlay.jsx#L32).

**Phụ thuộc draft:** UPG-04.

**Điều kiện/giới hạn:** Không lưu hồ sơ khách hoặc nội dung giao dịch vào localStorage để giữ nháp.

### UPG-07 — Chặn release khi migration chưa đạt

**P1 · Tăng cường vận hành · 3–5 ngày công · DevOps.**

**Hiện trạng:** CI đã có; readiness sau migration và kiểm phiên bản API/worker vẫn phụ thuộc quy trình vận hành.

**Phạm vi:** Tạo release gate theo commit/image, migration một lần, readiness và smoke test; kiểm tra required checks tại repository.

**Nghiệm thu:** Migration lỗi hoặc /api/ready 503 chặn mở traffic nghiệp vụ; API/worker cùng bản; diễn tập lỗi staging và rollback ứng dụng tương thích schema.

**Căn cứ:** [.github/workflows/ci.yml:12](../../../.github/workflows/ci.yml#L12); [backend/README.md:207](../../../backend/README.md#L207); [backend/Dockerfile:21](../../../backend/Dockerfile#L21); [docs/runbooks/operations-and-restore.md:78](../../../docs/runbooks/operations-and-restore.md#L78).

**Phụ thuộc draft:** UPG-02, UPG-03.

**Điều kiện/giới hạn:** Cần kiểm kê cấu hình Coolify/branch protection đang có; ticket không tự cho phép deploy production.

### UPG-08 — Cảnh báo worker và backlog quá hạn

**P1 · Tăng cường vận hành · 2–3 ngày công · DevOps.**

**Hiện trạng:** Đã có heartbeat, queue, dirty ARI và operations panel; cảnh báo ngoài hệ thống chưa được cấu hình trong repo.

**Phạm vi:** Kết nối monitoring với xác thực phù hợp, ngưỡng SLA, người trực, chống gửi lặp và thông báo phục hồi.

**Nghiệm thu:** Dừng worker/tạo backlog staging phát cảnh báo trong ngưỡng đã chốt; phục hồi có thông báo; cảnh báo không chứa PII hoặc secrets.

**Căn cứ:** [docs/runbooks/operations-and-restore.md:28](../../../docs/runbooks/operations-and-restore.md#L28); [backend/pms_api/worker_health.py:69](../../../backend/pms_api/worker_health.py#L69).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Giám sát có thể đã tồn tại ngoài repo; kiểm kê trước khi bổ sung, không dùng phiên cá nhân làm credential máy.

### UPG-09 — Lập lịch backup và diễn tập restore

**P1 · Tăng cường vận hành · 3–5 ngày công · DevOps.**

**Hiện trạng:** Đã có verify_restore.py; repo chưa chứng minh lịch backup thực tế, RPO/RTO và kết quả diễn tập môi trường đích.

**Phạm vi:** Chốt owner/RPO/RTO, backup/retention/bản sao ngoài máy chủ, manifest/checksum và sao lưu khóa Channex riêng; diễn tập định kỳ.

**Nghiệm thu:** Khôi phục bản backup vào môi trường cô lập; manifest/schema/RLS đạt; UAT booking/tiền hai tenant; ghi RTO đo được và mốc dữ liệu phục hồi.

**Căn cứ:** [docs/runbooks/operations-and-restore.md:36](../../../docs/runbooks/operations-and-restore.md#L36); [docs/runbooks/operations-and-restore.md:58](../../../docs/runbooks/operations-and-restore.md#L58); [backend/scripts/verify_restore.py:20](../../../backend/scripts/verify_restore.py#L20).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Cần quyền hạ tầng và bản backup tin cậy; chọn dump/PITR sau khi chốt RPO, giữ worker OTA thật tắt trong môi trường restore.

### UPG-10 — Thêm MFA cho tài khoản quản trị

**P2 · Mở rộng bảo mật · 5–8 ngày công · Full stack / Security.**

**Hiện trạng:** Đăng nhập hiện kiểm mật khẩu rồi cấp session; chưa có yếu tố xác thực thứ hai.

**Phạm vi:** Thêm enrollment, xác minh OTP, recovery code lưu hash và policy bật MFA cho vai trò đặc quyền; audit reset.

**Nghiệm thu:** Chưa xác thực OTP thì chưa có phiên đầy đủ; chặn OTP replay và brute force; recovery dùng một lần; có quy trình tránh khóa toàn bộ quản trị.

**Căn cứ:** [backend/pms_api/auth/routes.py:94](../../../backend/pms_api/auth/routes.py#L94); [backend/pms_api/core_models.py:19](../../../backend/pms_api/core_models.py#L19).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Cần chốt phương thức MFA và recovery; rollout theo giai đoạn, bảo vệ secret MFA.

### UPG-11 — Thêm luồng khôi phục mật khẩu

**P2 · Mở rộng SaaS · 4–6 ngày công · Full stack.**

**Hiện trạng:** Trang đăng nhập hướng liên hệ quản trị khi quên mật khẩu; auth hiện chỉ có đổi mật khẩu sau đăng nhập.

**Phạm vi:** Thêm yêu cầu reset, token ngẫu nhiên lưu hash/TTL, adapter kênh xác minh, reset nguyên tử và thu hồi phiên.

**Nghiệm thu:** Phản hồi không tiết lộ email tồn tại; có rate limit; token hết hạn/dùng lại bị từ chối; reset đồng thời chỉ một lần; không lộ token trong log.

**Căn cứ:** [frontend/src/apps/pms/auth/pages/Login.jsx:70](../../../frontend/src/apps/pms/auth/pages/Login.jsx#L70); [backend/pms_api/auth/routes.py:167](../../../backend/pms_api/auth/routes.py#L167); [backend/pms_api/auth/urls.py:8](../../../backend/pms_api/auth/urls.py#L8).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Cần chọn và cấu hình kênh gửi xác minh; chưa gửi email thật trong phạm vi ticket draft.

### UPG-12 — Hỗ trợ xoay khóa mã hóa Channex

**P2 · Mở rộng bảo mật · 3–5 ngày công · Backend / DevOps.**

**Hiện trạng:** Credentials hiện dùng một Fernet key; thay key trực tiếp làm ciphertext cũ không đọc được.

**Phạm vi:** Thêm keyring/version khóa và CLI re-encrypt theo batch có dry run/checkpoint; tài liệu rollout/retire khóa.

**Nghiệm thu:** Đọc được dữ liệu cũ/mới trong rollout; chạy lại batch an toàn; ciphertext hỏng không fallback env; kiểm phục hồi khóa cùng backup.

**Căn cứ:** [backend/pms_api/channels/credentials.py:12](../../../backend/pms_api/channels/credentials.py#L12); [backend/pms_api/channels/credentials.py:52](../../../backend/pms_api/channels/credentials.py#L52).

**Phụ thuộc draft:** UPG-09.

**Điều kiện/giới hạn:** Phải có bản sao khóa an toàn trước khi xoay thật; không ghi plaintext credentials vào log.

### UPG-13 — Thêm request ID và log có cấu trúc

**P2 · Tăng cường quan sát · 3–5 ngày công · Backend / DevOps.**

**Hiện trạng:** Worker có mã lỗi an toàn và log tenant/job; chưa có middleware request ID và định dạng log chung API/worker.

**Phạm vi:** Chuẩn hóa JSON log, request ID, route/status/duration/version và metric lỗi/độ trễ; giữ correlation với job.

**Nghiệm thu:** Tra được lỗi qua request ID; đo p95/tỷ lệ lỗi; kiểm redaction cookie/password/API key/PII; metric không dùng ID khách/job làm label.

**Căn cứ:** [backend/gunicorn_conf.py:8](../../../backend/gunicorn_conf.py#L8); [backend/pms_api/security.py:228](../../../backend/pms_api/security.py#L228); [backend/pms_api/channels/service.py:1040](../../../backend/pms_api/channels/service.py#L1040).

**Phụ thuộc draft:** Không có.

### UPG-14 — Thêm cổng quét bảo mật vào CI

**P2 · Tăng cường CI · 2–4 ngày công · DevOps / Security.**

**Hiện trạng:** Workflow hiện chạy lint/test/build, chưa có bước quét dependency, secret và image.

**Phạm vi:** Thêm scan PR/định kỳ, SBOM theo release và quy trình xử lý finding/ngoại lệ có hạn.

**Nghiệm thu:** Fixture secret bị chặn; finding vượt ngưỡng làm check thất bại; ngoại lệ có owner/hạn; scanner không in secret; SBOM gắn commit/image.

**Căn cứ:** [.github/workflows/ci.yml:25](../../../.github/workflows/ci.yml#L25); [backend/requirements.txt:1](../../../backend/requirements.txt#L1); [backend/Dockerfile:1](../../../backend/Dockerfile#L1).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Đây là bổ sung kiểm soát; chưa có bằng chứng dependency hiện tại chứa lỗ hổng cụ thể.

### UPG-15 — Thêm chuyển phòng khi khách đang ở

**P1 · Mở rộng nghiệp vụ · 7–10 ngày công · Full stack / Nghiệp vụ.**

**Hiện trạng:** Đã có roomStays và snapshot hạng phòng từng đêm; API vẫn chặn đổi phòng cho booking IN_HOUSE.

**Phạm vi:** Thêm preview/xác nhận chuyển phòng với ngày hiệu lực, chênh giá và expectedVersion; giao dịch cập nhật tồn, housekeeping, audit và OTA.

**Nghiệm thu:** Giữ lịch sử đêm đã qua; phòng đích trống/sạch đúng chính sách; sơ đồ hiển thị phòng theo roomStay đang hiệu lực; concurrent requests không overbook; rollback giữ nguyên phòng/tiền.

**Căn cứ:** [backend/pms_api/bookings/routes.py:797](../../../backend/pms_api/bookings/routes.py#L797); [backend/pms_api/bookings/room_stays.py:7](../../../backend/pms_api/bookings/room_stays.py#L7); [backend/migrations/versions/0030_stay_changes.py:12](../../../backend/migrations/versions/0030_stay_changes.py#L12); [frontend/src/apps/pms/rooms/pages/RoomDiagram.jsx:25](../../../frontend/src/apps/pms/rooms/pages/RoomDiagram.jsx#L25).

**Phụ thuộc draft:** UPG-05.

**Điều kiện/giới hạn:** Chốt thời điểm chuyển, chính sách chênh giá và trạng thái phòng trước khi mở ghi; không chỉ bỏ chặn stay_started.

### UPG-16 — Thêm gia hạn booking đang lưu trú

**P1 · Mở rộng nghiệp vụ · 5–8 ngày công · Full stack / Nghiệp vụ.**

**Hiện trạng:** Booking IN_HOUSE chưa được đổi ngày trả phòng; thay ngày trước check-in đã có.

**Phạm vi:** Thêm báo giá đêm tăng thêm và xác nhận gia hạn, kiểm tồn/stop-sell/bảo trì; dùng giao dịch và version riêng.

**Nghiệm thu:** Đêm cũ giữ giá/tỷ giá; đêm thêm được xác nhận giá; booking tiếp theo chặn gia hạn; concurrent requests không bán trùng; cập nhật công nợ/HK/OTA.

**Căn cứ:** [backend/pms_api/bookings/routes.py:797](../../../backend/pms_api/bookings/routes.py#L797); [frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx:124](../../../frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx#L124).

**Phụ thuộc draft:** UPG-05.

**Điều kiện/giới hạn:** Chốt quy tắc giá đêm gia hạn và xử lý giảm thời gian lưu trú riêng; không tự tính lại toàn bộ booking.

### UPG-17 — Đối soát lại hoa hồng bị treo

**P1 · Mở rộng nghiệp vụ tài chính · 5–8 ngày công · Full stack / Kế toán.**

**Hiện trạng:** Chi hoa hồng bị chặn khi có chiết khấu hóa đơn hoặc điều chỉnh sau checkout; chưa có luồng xác nhận cơ sở điều chỉnh để tiếp tục.

**Phạm vi:** Thêm preview phân bổ, phê duyệt và bản điều chỉnh chỉ thêm, liên kết settlement/payout cũ; giữ audit và idempotency.

**Nghiệm thu:** Tổng hoa hồng và phần còn trả đúng sau chi một phần/hoàn/điều chỉnh; không sửa lịch sử đã chi; dữ liệu thay đổi sau preview bị từ chối.

**Căn cứ:** [backend/pms_api/finance/commissions.py:32](../../../backend/pms_api/finance/commissions.py#L32); [backend/pms_api/finance/commissions.py:415](../../../backend/pms_api/finance/commissions.py#L415).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Cần kế toán chốt cách phân bổ chiết khấu, xử lý chi vượt và thẩm quyền phê duyệt trước khi tự động hóa.

### UPG-18 — Thêm quy trình xử lý booking OTA lỗi

**P1 · Mở rộng vận hành OTA · 5–8 ngày công · Full stack / OTA.**

**Hiện trạng:** Đã có booking review, lý do và retry; chưa có quy trình giao người xử lý và giải quyết ngoại lệ thủ công có bằng chứng.

**Phạm vi:** Thêm assignee/trạng thái/ghi chú, xem revision và đề xuất mapping/booking; xác nhận xử lý có version và audit.

**Nghiệm thu:** Hai người không xử lý ghi đè; liên kết booking đúng tenant; không ACK trước khi lưu đối soát hợp lệ; checkpoint ARI chỉ mở sau khi hết review theo quy tắc.

**Căn cứ:** [backend/pms_api/channels/models.py:113](../../../backend/pms_api/channels/models.py#L113); [backend/pms_api/channels/routes.py:166](../../../backend/pms_api/channels/routes.py#L166); [backend/pms_api/channels/routes.py:512](../../../backend/pms_api/channels/routes.py#L512).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Không thêm nút bỏ qua hoặc ACK mọi exception; chốt từng loại ngoại lệ được phép xử lý thủ công.

### UPG-19 — Nghiệm thu Channex staging trước pilot

**P1 · Nghiệm thu môi trường đích · 3–5 ngày công · OTA / QA / DevOps.**

**Hiện trạng:** Onboarding, ARI, import/ACK và simulator đã có; báo cáo mới nhất chưa xác nhận tài khoản Channex thật hoặc triển khai production.

**Phạm vi:** Dùng property staging được cấp để nghiệm thu mapping, booking cũ, giá/tồn, mới/sửa/hủy, timeout/retry, webhook lặp và worker.

**Nghiệm thu:** Có bằng chứng đối chiếu PMS/upstream, không ACK sớm/bán trùng; diễn tập migration 0031 yêu cầu đối chiếu lại; ghi quyết định go/no-go pilot.

**Căn cứ:** [tasks/be12.md:12](../../../tasks/be12.md#L12); [docs/reports/reviews/ota-fixes-2-11-12-2026-10-20.md:54](../../../docs/reports/reviews/ota-fixes-2-11-12-2026-10-20.md#L54).

**Phụ thuộc draft:** UPG-02, UPG-03, UPG-07, UPG-08, UPG-09.

**Điều kiện/giới hạn:** Cần tài khoản/property staging và người vận hành cấp quyền; không dùng OTA đang bán thật; phạm vi này bổ sung cho QA2 đã done.

### UPG-20 — Cấu hình phạm vi full sync ARI

**P2 · Mở rộng OTA · 3–5 ngày công · Backend / OTA.**

**Hiện trạng:** Daily baseline hiện cố định 366 ngày và chia job 31 ngày, chưa cấu hình theo yêu cầu kết nối.

**Phạm vi:** Thêm horizon/batch size có giới hạn được xác minh với provider, trạng thái tiến độ và resume theo ngày.

**Nghiệm thu:** Phủ đủ khoảng ngày cấu hình, không hở/trùng biên; crash/retry không mất phạm vi; tôn trọng quota, queue và checkpoint đối chiếu.

**Căn cứ:** [backend/pms_api/channels/service.py:816](../../../backend/pms_api/channels/service.py#L816); [backend/pms_api/channels/service.py:853](../../../backend/pms_api/channels/service.py#L853).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Xác minh giới hạn provider hiện hành trước khi chốt cấu hình; chưa kết luận 366 ngày hiện tại là lỗi.

### UPG-21 — Theo dõi kết quả ARI phía provider

**P2 · Mở rộng quan sát OTA · 5–8 ngày công · Backend / OTA.**

**Hiện trạng:** push_availability/push_restrictions hiện bỏ response; trạng thái job chưa lưu tham chiếu xử lý phía provider nếu có.

**Phạm vi:** Xác minh hợp đồng provider; lưu receipt/task ID được hỗ trợ, phân biệt đã nhận với đã áp dụng, xử lý lỗi downstream theo scope property.

**Nghiệm thu:** Simulator phủ nhận thành công rồi lỗi downstream, sự kiện lặp/sai property, timeout và retry; UI không báo đã áp dụng chỉ từ HTTP accepted.

**Căn cứ:** [backend/pms_api/channels/client.py:353](../../../backend/pms_api/channels/client.py#L353); [backend/pms_api/channels/client.py:356](../../../backend/pms_api/channels/client.py#L356).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Cần xác minh API/event của provider trước khi chọn poll hoặc webhook; không giả định mọi kênh trả task ID.

### UPG-22 — Phân trang lịch sử đồng bộ OTA

**P2 · Tăng cường tra cứu · 2–4 ngày công · Full stack.**

**Hiện trạng:** Snapshot OTA chỉ trả 50 job mới nhất nên bộ lọc giao diện không tìm được lịch sử cũ.

**Phạm vi:** Thêm API phân trang SQL theo ngày/trạng thái/loại job/revision; tải chi tiết theo quyền và đưa bộ lọc lên server.

**Nghiệm thu:** Tìm được job ngoài 50 dòng gần nhất; thứ tự ổn định khi job mới đến; tổng/filter đúng tenant; không lộ payload nhạy cảm.

**Căn cứ:** [backend/pms_api/channels/routes.py:138](../../../backend/pms_api/channels/routes.py#L138); [backend/pms_api/channels/routes.py:144](../../../backend/pms_api/channels/routes.py#L144).

**Phụ thuộc draft:** Không có.

### UPG-23 — Hỗ trợ ca buồng phòng qua đêm

**P2 · Mở rộng buồng phòng · 4–6 ngày công · Full stack.**

**Hiện trạng:** shift_times hiện yêu cầu giờ kết thúc lớn hơn giờ bắt đầu trong cùng ngày.

**Phạm vi:** Thêm ngày kết thúc/qua đêm tường minh, validation giao ca và khoảng thời gian theo timezone khách sạn.

**Nghiệm thu:** Ca 22:00–06:00 có độ dài đúng; không trùng ca ngoài chính sách; việc trước/sau nửa đêm được giao đúng; ca cũ và quyền nhân viên vẫn đúng.

**Căn cứ:** [backend/pms_api/housekeeping/routes.py:41](../../../backend/pms_api/housekeeping/routes.py#L41).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Cần chốt ngày nghiệp vụ của ca và giới hạn độ dài ca; không suy đoán end < start luôn là qua đêm.

### UPG-24 — Phân trang lịch sử buồng phòng

**P2 · Tăng cường tra cứu · 2–4 ngày công · Full stack.**

**Hiện trạng:** housekeeping_snapshot chỉ giữ 100 sự kiện mới nhất trong response.

**Phạm vi:** Thêm endpoint phân trang theo phòng/nhân viên/khoảng ngày/trạng thái và màn tra cứu lịch sử riêng.

**Nghiệm thu:** Tìm được sự kiện cũ hơn 100 dòng; nhân viên chỉ xem phạm vi được cấp; thứ tự không lặp/mất khi có log mới; workspace không tải toàn bộ lịch sử.

**Căn cứ:** [backend/pms_api/housekeeping/routes.py:932](../../../backend/pms_api/housekeeping/routes.py#L932); [backend/pms_api/housekeeping/routes.py:953](../../../backend/pms_api/housekeeping/routes.py#L953).

**Phụ thuộc draft:** Không có.

### UPG-25 — Giữ lịch sử năng lực bán phòng

**P2 · Tăng cường độ đúng báo cáo · 4–6 ngày công · Backend / Reports.**

**Hiện trạng:** Biểu đồ công suất dùng số phòng hiện tại làm capacity cho cả các ngày lịch sử.

**Phạm vi:** Lưu năng lực phòng theo ngày hiệu lực hoặc snapshot; chốt cách loại phòng bảo trì/stop-sell và hiển thị giới hạn dữ liệu cũ.

**Nghiệm thu:** Thêm/ngừng phòng không làm đổi công suất kỳ đã chốt; test zero capacity/bảo trì/thay hạng; dashboard/report dùng cùng định nghĩa.

**Căn cứ:** [backend/pms_api/reports/routes.py:464](../../../backend/pms_api/reports/routes.py#L464); [backend/pms_api/reports/routes.py:487](../../../backend/pms_api/reports/routes.py#L487).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Chốt mẫu số công suất theo nghiệp vụ; dữ liệu cũ thiếu lịch sử phải được đánh dấu, không tạo số liệu giả.

### UPG-26 — Phân trang booking tại máy chủ

**P2 · Tăng cường hiệu năng · 5–8 ngày công · Full stack.**

**Hiện trạng:** Reservations lọc/cắt trang tại trình duyệt sau khi workspace đã tải toàn bộ booking và dữ liệu liên quan.

**Phạm vi:** Mở rộng API list sẵn có với filter/page hoặc cursor, nối frontend tới detail theo ID hiện có và export cùng bộ lọc; giữ dataset riêng cho phòng/lịch theo cửa sổ ngày.

**Nghiệm thu:** Đo trước/sau với 10.000 booking; payload/DOM danh sách theo page; tổng/filter/CSV nhất quán; lịch/sơ đồ/counters vẫn đủ dữ liệu ngoài page; bảo toàn RLS/quyền/tenant scope.

**Căn cứ:** [frontend/src/apps/pms/reservations/pages/Reservations.jsx:21](../../../frontend/src/apps/pms/reservations/pages/Reservations.jsx#L21); [backend/pms_api/bookings/routes.py:368](../../../backend/pms_api/bookings/routes.py#L368); [backend/pms_api/bookings/routes.py:679](../../../backend/pms_api/bookings/routes.py#L679).

**Phụ thuộc draft:** UPG-04.

**Điều kiện/giới hạn:** Mốc 10.000 là bộ dữ liệu kiểm chứng đề xuất; chưa có benchmark hiện tại hoặc SLA đã cam kết.

### UPG-27 — Phân trang SQL cho sổ quỹ

**P2 · Tăng cường hiệu năng · 3–5 ngày công · Backend / Finance.**

**Hiện trạng:** Sổ quỹ có tham số trang nhưng đang tải ledger vào Python, cộng tổng và cắt trang trong bộ nhớ.

**Phạm vi:** Đẩy lọc/ngày/aggregate/pagination xuống SQL; giữ số dư đầu-cuối toàn kỳ và liên kết phiếu đảo.

**Nghiệm thu:** Tổng và số dư không phụ thuộc trang; đúng timezone/legacy booked_at/category/currency; benchmark 100.000 dòng và so số liệu chuẩn.

**Căn cứ:** [backend/pms_api/finance/routes.py:1146](../../../backend/pms_api/finance/routes.py#L1146); [backend/pms_api/finance/routes.py:1171](../../../backend/pms_api/finance/routes.py#L1171).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Không phân trang trước khi tính tổng toàn kỳ; tối ưu không được đổi quy tắc tiền hiện có.

### UPG-28 — Làm mới dữ liệu theo phân hệ

**P2 · Tăng cường hiệu năng · 4–6 ngày công · Full stack.**

**Hiện trạng:** Mỗi mutation hiện tải lại workspace gồm booking, finance, housekeeping và inventory theo quyền.

**Phạm vi:** Chia read model/invalidation theo phân hệ; xử lý dependency sau booking/checkout/payment, vẫn hỗ trợ refresh thủ công.

**Nghiệm thu:** Ghi chú không tải lại kho/sổ quỹ; checkout cập nhật booking/phòng/HK đúng; lỗi read không đổi kết quả write; giữ nháp và tenant scope.

**Căn cứ:** [frontend/src/apps/pms/data/PmsProvider.jsx:66](../../../frontend/src/apps/pms/data/PmsProvider.jsx#L66); [backend/pms_api/workspace.py:22](../../../backend/pms_api/workspace.py#L22).

**Phụ thuộc draft:** UPG-05, UPG-26.

**Điều kiện/giới hạn:** Giữ quyết định refresh thủ công hiện có; chưa thêm polling hoặc websocket theo suy đoán.

### UPG-29 — Tách bundle theo route ứng dụng

**P2 · Tăng cường hiệu năng · 2–4 ngày công · Frontend.**

**Hiện trạng:** App.jsx import tĩnh đồng thời Marketing, PMS và Manager.

**Phạm vi:** Dùng lazy/Suspense theo nhóm route, fallback tải và xử lý lỗi chunk sau deploy; đo bundle trước/sau.

**Nghiệm thu:** Login/marketing không tải module Manager/kho/báo cáo chưa mở; deep link và quyền vẫn đúng; lỗi chunk có cách phục hồi; lưu số đo nén.

**Căn cứ:** [frontend/src/app/App.jsx:8](../../../frontend/src/app/App.jsx#L8); [frontend/src/app/App.jsx:30](../../../frontend/src/app/App.jsx#L30); [frontend/src/app/App.jsx:64](../../../frontend/src/app/App.jsx#L64).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Đặt mục tiêu giảm từ baseline đo thực tế; không coi số đo bundle cũ là số đo hiện tại.

### UPG-30 — Hiển thị hóa đơn SaaS cho chủ khách sạn

**P2 · Mở rộng SaaS · 3–5 ngày công · Full stack.**

**Hiện trạng:** Billing Manager đã có hóa đơn/thanh toán; tab Đơn hàng Client vẫn là empty state.

**Phạm vi:** Thêm API read-only theo tenant cho owner và UI lịch sử gói/hóa đơn/đã thu/còn nợ, phân trang và tải chứng từ nội bộ.

**Nghiệm thu:** Owner chỉ xem tenant mình; nhân viên khác bị chặn theo policy; số liệu khớp Manager; không cho sửa hoặc tự gia hạn từ API đọc.

**Căn cứ:** [frontend/src/apps/pms/profile/pages/Profile.jsx:109](../../../frontend/src/apps/pms/profile/pages/Profile.jsx#L109); [backend/pms_api/saas_billing/urls.py:8](../../../backend/pms_api/saas_billing/urls.py#L8).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Phạm vi đọc dữ liệu hiện có; payment gateway và hóa đơn điện tử cần dự án tích hợp riêng.

### UPG-31 — Lưu cơ cấu người lớn và trẻ em

**P2 · Mở rộng lưu trú · 5–8 ngày công · Full stack / Nghiệp vụ.**

**Hiện trạng:** Booking có nhiều khách và kiểm tổng sức chứa, chưa có snapshot người lớn/trẻ em/em bé riêng.

**Phạm vi:** Thêm occupancy snapshot theo phòng, nhóm tuổi cấu hình và preview phụ thu; mapping OTA theo capability.

**Nghiệm thu:** Validate số lượng/tuổi/sức chứa ở server; lịch sử booking giữ policy/giá cũ; payload OTA thiếu tuổi được đánh dấu cần xử lý, không tự đoán.

**Căn cứ:** [backend/pms_api/bookings/models.py:56](../../../backend/pms_api/bookings/models.py#L56); [backend/pms_api/bookings/routes.py:665](../../../backend/pms_api/bookings/routes.py#L665); [backend/pms_api/channels/importer.py:121](../../../backend/pms_api/channels/importer.py#L121).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Cần chốt nhóm tuổi, trẻ em có tính sức chứa và chính sách phụ thu; không thu phí khi thiếu quy tắc.

### UPG-32 — Thêm chính sách thuế và phí có phiên bản

**P2 · Mở rộng chính sách giá · 5–8 ngày công · Full stack / Kế toán.**

**Hiện trạng:** Hiện thêm tax/fee thủ công và có thuế dịch vụ; chưa có policy thuế/phí mặc định cấp khách sạn với snapshot rõ.

**Phạm vi:** Thêm cấu hình có ngày hiệu lực, giá gồm/chưa gồm thuế, cơ sở tính/thứ tự/làm tròn; preview và snapshot trên booking.

**Nghiệm thu:** Thay policy không đổi booking cũ; quote/tổng/thuế/giảm giá khớp; không tính trùng phí OTA đã gồm; tắt policy giữ luồng thủ công.

**Căn cứ:** [backend/pms_api/bookings/routes.py:1092](../../../backend/pms_api/bookings/routes.py#L1092); [backend/pms_api/catalog/routes.py:30](../../../backend/pms_api/catalog/routes.py#L30); [backend/pms_api/pricing/engine.py:160](../../../backend/pms_api/pricing/engine.py#L160).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Kế toán phải xác nhận công thức và mức áp dụng; không hard-code thuế suất hoặc mặc định đáp ứng pháp luật/hóa đơn điện tử.

### UPG-33 — Thêm nhắc việc trong ứng dụng theo lịch

**P2 · Mở rộng thông báo · 4–6 ngày công · Full stack.**

**Hiện trạng:** Thông báo in-app hiện phát từ audit event; chưa có lịch nhắc khách đến/đi hoặc dư nợ theo timezone.

**Phạm vi:** Thêm scheduler theo tenant, thời điểm/người nhận cấu hình, dedupe và deep link tới booking được phép xem.

**Nghiệm thu:** Chạy lại worker không gửi trùng; đổi/hủy booking cập nhật lịch nhắc; tenant/quyền đúng; tắt loại nhắc dừng phát mới.

**Căn cứ:** [backend/pms_api/notifications.py:29](../../../backend/pms_api/notifications.py#L29); [backend/pms_api/notifications.py:56](../../../backend/pms_api/notifications.py#L56); [backend/pms_api/notification_models.py:7](../../../backend/pms_api/notification_models.py#L7).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Lát đầu chỉ dùng inbox hiện có; email/SMS/Zalo cần lựa chọn provider và scope riêng.

### UPG-34 — Cấu hình tầng và khu vực phòng

**P2 · Mở rộng danh mục · 4–6 ngày công · Full stack.**

**Hiện trạng:** Rooms/RoomDiagram đang suy tầng từ ký tự đầu của số phòng; PhysicalRoom chưa có tầng/khu.

**Phạm vi:** Thêm metadata tầng/khu trong catalog/API/Settings; chuyển sơ đồ và bộ lọc sang dùng dữ liệu cấu hình.

**Nghiệm thu:** Phòng 1001 có thể thuộc tầng 10; Villa-A/A101 nhóm đúng; chưa gán có nhóm riêng; migration không đổi ID hay liên kết booking.

**Căn cứ:** [frontend/src/apps/pms/rooms/pages/Rooms.jsx:11](../../../frontend/src/apps/pms/rooms/pages/Rooms.jsx#L11); [frontend/src/apps/pms/rooms/pages/RoomDiagram.jsx:49](../../../frontend/src/apps/pms/rooms/pages/RoomDiagram.jsx#L49); [backend/pms_api/catalog/models.py:31](../../../backend/pms_api/catalog/models.py#L31).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Cho preview/xác nhận khi gán dữ liệu cũ, không âm thầm suy tầng từ số phòng.

### UPG-35 — Hiển thị lỗi booking theo từng trường

**P2 · Tăng cường UX / a11y · 3–5 ngày công · Full stack.**

**Hiện trạng:** BookingModal chủ yếu hiển thị alert tổng quát; API client đã có error.details nhưng form chưa ánh xạ trường.

**Phạm vi:** Chuẩn hóa API error.details có field path/index khách; form submit, validation theo API, aria-invalid/describedby và focus lỗi đầu; fallback lỗi tổng quát khi thiếu path.

**Nghiệm thu:** Enter/click nhanh không submit lặp; lỗi từng khách phụ hiển thị đúng dòng; giữ nháp; bàn phím/screen reader tìm được lỗi; server quyết định dữ liệu hợp lệ.

**Căn cứ:** [frontend/src/apps/pms/reservations/components/BookingModal.jsx:42](../../../frontend/src/apps/pms/reservations/components/BookingModal.jsx#L42); [frontend/src/apps/pms/reservations/components/BookingModal.jsx:140](../../../frontend/src/apps/pms/reservations/components/BookingModal.jsx#L140); [frontend/src/apps/pms/data/api.js:104](../../../frontend/src/apps/pms/data/api.js#L104); [backend/pms_api/bookings/routes.py:460](../../../backend/pms_api/bookings/routes.py#L460).

**Phụ thuộc draft:** UPG-04, UPG-06.

**Điều kiện/giới hạn:** Không suy trường lỗi từ chuỗi thông báo đã dịch; không dùng regex quá hẹp để chặn tên/số điện thoại quốc tế.

### UPG-36 — Đồng bộ tài liệu với trạng thái source

**P2 · Sai lệch tài liệu xác minh · 1–2 ngày công · Tech lead / Docs.**

**Hiện trạng:** Frontend README còn ghi POS/kho/OTA/gói chưa triển khai trong khi source đã có; tasks/p1 là yêu cầu, không phải toàn bộ kết quả hoàn thành.

**Phạm vi:** Cập nhật README/checklist theo module: đã có code, đã test, đã UAT, đã deploy; lập ma trận nguồn minh chứng và giới hạn.

**Nghiệm thu:** Mỗi trạng thái có commit/ngày/bằng chứng; còn mở thể hiện đúng; không gọi các kết quả QA cũ là kiểm chứng hiện tại; link hợp đồng/runbook hợp lệ.

**Căn cứ:** [frontend/README.md:58](../../../frontend/README.md#L58); [frontend/README.md:64](../../../frontend/README.md#L64); [tasks/p1-implementation.md:5](../../../tasks/p1-implementation.md#L5); [tasks/todo.md:67](../../../tasks/todo.md#L67).

**Phụ thuộc draft:** Không có.

**Điều kiện/giới hạn:** Đối chiếu hồ sơ QA2 đã done trước khi sửa checklist; không tự đóng ticket hoặc xác nhận deploy.

## 7. Điều kiện chung khi triển khai

Giữ tenant RLS/FORCE RLS, kiểm quyền backend, CSRF, thứ tự lock, Decimal, version và idempotency. Lịch sử tiền/hoa hồng đã chốt cần đối ứng hoặc bản điều chỉnh chỉ thêm. Thay model bằng migration mới; bảo toàn guard lịch sử. Giao diện không là nơi quyết định quyền hoặc tính đúng của giao dịch.

Chạy kiểm tra tập trung đúng phần thay đổi và các cổng bắt buộc hiện có; dùng database tạm riêng `pms_test_*`. Với UI mới, kiểm tra bàn phím, tiếng Việt/Anh/Trung và các độ rộng cần dùng. Tối ưu hiệu năng phải có baseline, dữ liệu kiểm chứng và kết quả trước/sau; không đặt SLA dựa trên số đo chưa thu thập.

Các quyết định cần chủ nghiệp vụ xác nhận gồm giá chuyển phòng/gia hạn, phân bổ hoa hồng, định nghĩa công suất, nhóm tuổi và công thức thuế/phí. Các điều kiện cần người vận hành cung cấp gồm quyền Coolify/monitoring, mục tiêu phục hồi, backup tin cậy, kênh xác minh tài khoản và property Channex staging. Có thể triển khai phần độc lập trước khi các quyết định đó hoàn tất.

## 8. Kết quả bàn giao

- Báo cáo này: hiện trạng, bằng chứng, ưu tiên, lộ trình và 36 phạm vi triển khai.
- [JSON 36 bản nháp cho project board](upgrade-ticket-drafts-2026-10-21.json): đúng schema `drafts`, mỗi draft có `draftKey`, `projectId`, `dependsOn` và `warnings`.
- Chưa sửa mã ứng dụng, chưa triển khai môi trường đích và chưa tạo ticket trên board. Ticket chỉ được UI tạo sau xác nhận của người dùng.

