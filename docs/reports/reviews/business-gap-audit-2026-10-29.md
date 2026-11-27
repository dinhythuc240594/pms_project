# Rà soát nghiệp vụ LOHA PMS — 29/10/2026

**Nhánh:** `codex/business-gap-audit-2026-10-29` · **Mã nguồn đối chiếu:** `6d75612`.

Cập nhật sau rà soát: BIZ-01–07 được xử lý trên nhánh riêng; xem
[báo cáo triển khai và kiểm chứng P1](full-p1-business-fixes-2026-10-29.md).
Các nhận định bên dưới giữ theo mã nguồn tại thời điểm đánh giá.

**Kết luận:** Dự án đã có phần lớn luồng PMS cơ bản. Phần cần bổ sung tập trung ở thay đổi lưu trú đang diễn ra, xử lý ngoại lệ tài chính/OTA và vòng đời khách hàng SaaS. Báo cáo ghi nhận **16 khoảng trống: 7 mục P1 và 9 mục P2**, cùng các đề xuất bổ sung. Đây là đánh giá phạm vi nghiệp vụ và mã nguồn, không phải chứng nhận sẵn sàng chạy production.

## 1. Phạm vi và cách đánh giá

- Áp dụng bốn skill được yêu cầu: `saas-multi-tenant`, `webhook-integration`, `postgresql-best-practices`, `senior-fullstack`; giữ phạm vi thay đổi nhỏ theo Ponytail và lưu trên nhánh Git riêng.
- Đối chiếu [thiết kế gốc](../../../pms_system_design_final.md), [checklist](../../../tasks/todo.md), [roadmap 21/10](upgrade-roadmap-2026-10-21.md), API, model, migration, giao diện liên quan và kiểm thử hiện có. Khi tài liệu cũ khác mã nguồn, dùng mã nguồn làm căn cứ trạng thái triển khai.
- **Đã có:** tìm thấy luồng xử lý/model/API cụ thể; không mặc nhiên có nghĩa đã nghiệm thu triển khai.
- **Còn thiếu:** có giới hạn rõ trong handler/schema hoặc chưa tìm thấy luồng hoàn chỉnh sau khi đối chiếu API, model và giao diện liên quan. Một số giới hạn là chính sách đã chọn, cần chốt nhu cầu trước khi mở rộng.
- **P1:** ưu tiên xử lý hoặc chốt cách vận hành trước pilot có sử dụng luồng đó. **P2:** bổ sung theo loại khách sạn và quy mô. Mức ưu tiên là đề xuất, không phải lỗi production đã xảy ra.
- Chỉ thêm báo cáo và liên kết mục lục; không sửa nghiệp vụ, migration, cấu hình hay dữ liệu. Không tự mở ticket, gọi provider hoặc deploy.

Không có kết nối PostgreSQL MCP trong phiên này. Phần PostgreSQL chỉ rà soát source/schema/migration và kiểm thử không kết nối DB; không đọc `.env`, không tự kết nối database local hoặc môi trường thật.

## 2. Những phần đã có, tránh triển khai lại

| Nhóm | Đã tìm thấy trong mã hiện tại | Căn cứ |
| --- | --- | --- |
| Tenant và quyền | Membership, role, CSRF, context theo transaction; kiểm lại quyền trước ghi; RLS tách PMS khỏi quản trị SaaS | [security.py](../../../backend/pms_api/security.py), [migration 0034](../../../backend/migrations/versions/0034_pms_tenant_authorization.py), [0036](../../../backend/migrations/versions/0036_channel_support.py) |
| Booking | Nhiều phòng/khách; giá từng đêm và tỷ giá snapshot; version, idempotency; cọc, thu/hoàn, no-show, checkout và công việc dọn phòng | [booking routes](../../../backend/pms_api/bookings/routes.py), [models](../../../backend/pms_api/bookings/models.py) |
| POS, quỹ và kho | POS vào booking hoặc bán lẻ; hoàn/đảo chứng từ; nhập/xuất/chuyển/kiểm kê, tồn đầu kỳ và tiêu hao/hoàn kho POS | [finance](../../../backend/pms_api/finance/routes.py), [inventory](../../../backend/pms_api/inventory/routes.py) |
| Giá | Weekend, LOS, voucher, early bird, last minute, stay/pay; VND/USD và snapshot tỷ giá | [pricing README](../../../backend/pms_api/pricing/README.md), [models](../../../backend/pms_api/pricing/models.py) |
| Buồng phòng | Nhân viên, phân ca, giao việc, kiểm tra sạch, tự tạo kế hoạch và worker | [housekeeping](../../../backend/pms_api/housekeeping/routes.py), [service](../../../backend/pms_api/housekeeping/service.py) |
| OTA | Credentials mã hóa; mapping; webhook có shared secret; queue, retry, revision/ACK, hồ sơ cần xử lý, onboarding booking cũ và lịch sử job phân trang | [channels](../../../backend/pms_api/channels/routes.py), [history](../../../backend/pms_api/channels/history.py), [onboarding](../../../backend/pms_api/channels/onboarding.py) |
| An toàn giá OTA | Kiểm rate plan, đọc lại giá/đóng bán; lưu tiền/hoa hồng provider; đưa thuế chưa hỗ trợ vào review | [publication](../../../backend/pms_api/channels/publication.py), [importer](../../../backend/pms_api/channels/importer.py), [migration 0037](../../../backend/migrations/versions/0037_channel_rate_safety.py) |
| SaaS | Gói, quota, quyền tính năng, gia hạn thủ công, hóa đơn/thu tiền; Owner xem hóa đơn và lịch sử riêng của khách sạn | [subscriptions](../../../backend/pms_api/subscriptions.py), [billing](../../../backend/pms_api/saas_billing/routes.py), [OwnerBilling](../../../frontend/src/apps/pms/profile/pages/OwnerBilling.jsx) |
| Giao diện | Bảo vệ bản nháp, xử lý retry, đọc lại workspace, phiếu booking/CSV, tầng/khu vực phòng | [BookingDetailPanel](../../../frontend/src/apps/pms/reservations/components/BookingDetailPanel.jsx), [PmsProvider](../../../frontend/src/apps/pms/data/PmsProvider.jsx), [RoomLocations](../../../frontend/src/apps/pms/settings/pages/RoomLocations.jsx) |
| Vận hành | CI có PostgreSQL riêng và chặn skip; readiness kiểm migration/role; heartbeat, operations và công cụ kiểm restore | [CI](../../../.github/workflows/ci.yml), [health](../../../backend/pms_api/health.py), [runbook](../../runbooks/operations-and-restore.md) |

Các checkbox BE-10/11 chưa đánh dấu trong `tasks/todo.md` không đủ để kết luận kho/giá nâng cao chưa có. Tương tự, Owner Billing, tầng/khu vực và lịch sử OTA đã có source; không mở lại các hạng mục tương ứng chỉ dựa trên roadmap cũ.

## 3. Danh mục khoảng trống

| Mã | Ưu tiên | Khoảng trống | Tính chất |
| --- | --- | --- | --- |
| BIZ-01 | P1 | Chuyển phòng, gia hạn, rút ngắn lưu trú sau check-in | Có nền dữ liệu, handler vẫn chặn đổi ngày/phòng |
| BIZ-02 | P1 | Night Audit, ngày kinh doanh và khóa kỳ | Đối soát hiện chỉ lưu xác nhận |
| BIZ-03 | P1 | Giải quyết hoa hồng bị treo sau điều chỉnh | Có phát hiện/chặn chi, thiếu luồng xử lý kết thúc |
| BIZ-04 | P1 | Booking OTA có thuế/dịch vụ và xử lý ngoại lệ thủ công | Có review/retry, chưa hỗ trợ đầy đủ nội dung tài chính |
| BIZ-05 | P1 | Nhận và theo dõi lỗi đồng bộ phát sinh từ OTA | Có kiểm tra Channex, chưa có luồng nhận lỗi kênh tự động tương ứng |
| BIZ-06 | P1 | Đảo/hoàn khoản thu SaaS đã ghi nhầm | Thu tiền bất biến, chỉ hủy được hóa đơn chưa thu |
| BIZ-07 | P1 | Xử lý hết hạn thuê bao khi còn khách đang ở | Chính sách hiện chặn ghi; cần chốt quy trình tiếp tục vận hành |
| BIZ-08 | P2 | Chữ ký webhook và xoay khóa theo tài liệu Channex hiện tại | Shared secret đã có; tài liệu/chú thích về HMAC đã cũ |
| BIZ-09 | P2 | Chính sách hủy/cọc, thuế/phí, nhận/trả sớm muộn có cấu trúc | Chủ yếu là nội dung chính sách và nhập tiền thủ công |
| BIZ-10 | P2 | Người lớn/trẻ em/tuổi và quyền lợi bữa ăn theo đêm/phòng | Có hồ sơ khách/danh mục bữa ăn; thiếu liên kết nghiệp vụ đầy đủ |
| BIZ-11 | P2 | City Ledger cho công ty/đại lý và tuổi nợ | Có số dư booking/POS, chưa có luồng tín dụng khách hàng |
| BIZ-12 | P2 | Báo cáo lịch sử năng lực phòng và công nợ tại cuối kỳ | Hiện dùng năng lực và một số số dư hiện tại |
| BIZ-13 | P2 | Thông báo theo lịch và kênh ngoài ứng dụng | Có inbox/role; thiếu sự kiện lịch và delivery ngoài ứng dụng |
| BIZ-14 | P2 | Xuất toàn bộ dữ liệu và kết thúc sử dụng tenant | Có tạm ngưng; chưa có vòng đời offboarding hoàn chỉnh |
| BIZ-15 | P2 | Thuê theo giờ/day-use | Schema hiện theo ngày và bắt buộc ít nhất một đêm |
| BIZ-16 | P2 | Ca buồng phòng qua đêm | Thời gian kết thúc phải sau bắt đầu trong cùng ngày |

## 4. Chi tiết P1 và đề xuất hoàn thiện

### BIZ-01 — Thay đổi lưu trú sau check-in

**Hiện trạng:** `EditReservationView` trả `409 stay_started` khi booking `IN_HOUSE` thay phòng/ngày. `room_stays.py` và migration `0030` mới là nền lưu lịch sử. Checkout áp dụng cho cả booking, chưa có luồng trả từng phòng độc lập. Trả sớm cũng chưa có bước xem trước cắt đêm và xử lý tiền tương ứng.

**Tình huống:** khách đang ở phòng 101 gặp sự cố, chuyển sang 102 hoặc ở thêm hai đêm. Lễ tân chưa thể ghi nhận qua một luồng chuẩn giữ nguyên booking và lịch sử tiền.

**Đề xuất tối thiểu:** xem trước thay đổi → xác nhận có version/idempotency → lưu phân đoạn phòng/đêm và chênh lệch tiền. Giữ đêm đã phục vụ; cập nhật tồn, buồng phòng, OTA trong cùng quy trình. Tách trả từng phòng thành lát tiếp theo nếu pilot cần.

**Nghiệm thu:** chuyển A→B không trùng tồn; gia hạn bị chặn nếu phòng đã có booking khác; thử lại không tính tiền hai lần; rút ngắn có quy tắc phí/hoàn; lịch sử báo cáo vẫn chỉ đúng phòng đã ở.

**Căn cứ:** [booking routes:794](../../../backend/pms_api/bookings/routes.py#L794), [status:933](../../../backend/pms_api/bookings/routes.py#L933), [room_stays](../../../backend/pms_api/bookings/room_stays.py), [0030](../../../backend/migrations/versions/0030_stay_changes.py).

### BIZ-02 — Night Audit và khóa ngày kinh doanh

**Hiện trạng:** đối soát lưu snapshot với `periodLocked: false`; không ghi doanh thu đêm hay khóa kỳ. Báo cáo đã phân biệt doanh thu đêm và hóa đơn checkout, nhưng chưa phải sổ doanh thu được ghi nhận bởi Night Audit.

**Đề xuất tối thiểu:** chốt chính sách ngày kinh doanh/cutoff; thêm bước kiểm khách đến/đi chưa xử lý, ghi nhận đêm đúng một lần, chốt ngày và quy trình điều chỉnh sau chốt. Nếu pilot chỉ dùng đối soát, tên màn hình và hướng dẫn phải giữ đúng giới hạn hiện tại.

**Nghiệm thu:** chạy lại không nhân doanh thu; giao dịch sau giờ cutoff vào đúng ngày; sửa kỳ đã chốt có quyền/lý do và bút toán đối ứng; tiền quỹ không bị ghi lần nữa khi ghi doanh thu.

**Căn cứ:** [reconciliation:99](../../../backend/pms_api/reconciliation/routes.py#L99), [report definitions:813](../../../frontend/src/shared/i18n/locales/vi.json#L813), [thiết kế báo cáo](../../../pms_system_design_final.md#L50).

### BIZ-03 — Hoa hồng cần đối soát chưa có đường kết thúc

**Hiện trạng:** `review_condition` đánh dấu các khoản giảm giá hóa đơn hoặc điều chỉnh/hoàn sau checkout; API chi tiếp trả `commission_needs_review`. Gọi settle lại trả settlement cũ, chưa có thao tác phân bổ chiết khấu, chấp thuận cơ sở mới hoặc tạo điều chỉnh settlement để gỡ tình trạng này.

**Tác động:** nhân viên đã kiểm tra xong vẫn chưa có cách ghi nhận quyết định trên hệ thống. Thử lại không giải quyết được nguyên nhân nằm trong lịch sử bất biến.

**Đề xuất tối thiểu:** thêm quyết định đối soát có cơ sở tính, phân bổ giảm giá, lý do/người duyệt; tạo bản điều chỉnh liên kết settlement cũ. Giữ nguyên khoản đã chi và xử lý rõ chênh lệch phải thu lại/phải chi thêm.

**Nghiệm thu:** giảm giá hóa đơn và hoàn sau checkout đều xử lý được; chi một phần rồi điều chỉnh không mất dấu; không cho chi tiếp vượt nghĩa vụ mới; replay không tạo thêm điều chỉnh.

**Căn cứ:** [review_condition:33](../../../backend/pms_api/finance/commissions.py#L33), [settle:299](../../../backend/pms_api/finance/commissions.py#L299), [pay:414](../../../backend/pms_api/finance/commissions.py#L414), [API hoa hồng](../../../backend/pms_api/finance/urls.py).

### BIZ-04 — Thuế/dịch vụ OTA và giải quyết booking ngoại lệ

**Hiện trạng:** importer chủ động từ chối `taxes`, `collected_taxes`, services và tiền tệ ngoài VND/USD; cơ cấu người được gộp thành tổng. Có hồ sơ review và retry nhưng chưa có luồng nhập bổ sung/ghép booking có quyết định xử lý để hoàn thành các ngoại lệ chưa được adapter hỗ trợ. Review chưa giải quyết còn có thể giữ việc mở bán ARI để bảo vệ tồn.

**Đề xuất tối thiểu:** chọn một kênh pilot và hỗ trợ đúng hợp đồng thuế/phí của kênh đó; hiển thị tiền khách trả, phần OTA thu hộ, phần khách sạn thu và hoa hồng riêng. Bổ sung luồng giải quyết ngoại lệ có kiểm tồn/tiền, liên kết booking và audit; chỉ ACK sau khi kết quả hợp lệ đã lưu bền vững. Không bỏ guard thuế hoặc ACK cưỡng bức để làm sạch hàng đợi.

**Nghiệm thu:** thuế đã gồm/chưa gồm giá; OTA thu hộ; sửa/hủy booking có dịch vụ; thiếu mapping; retry sau chỉnh mapping; không mất bản cũ hoặc mở bán khi chưa xử lý xong tồn liên quan.

**Căn cứ:** [normalize:94](../../../backend/pms_api/channels/importer.py#L94), [review details:185](../../../backend/pms_api/channels/importer.py#L185), [reviews API:174](../../../backend/pms_api/channels/routes.py#L174), [inventory hold:493](../../../backend/pms_api/channels/service.py#L493).

### BIZ-05 — Theo dõi kết quả đến OTA

**Hiện trạng:** đã có đọc lại ARI, kiểm warnings và công cụ xem dữ liệu provider. Tuy nhiên webhook nhận vào chỉ chấp nhận nhóm booking; đăng ký tự động cũng dùng `event_mask: booking`. Chưa tìm thấy luồng tự nhận lỗi kênh rồi gắn vào lần đồng bộ/phòng/ngày, giao người xử lý và xác nhận khắc phục.

**Đề xuất tối thiểu:** nhận `sync_error`, `sync_warning`, `rate_error`; liên kết lỗi với kênh và job khi đủ thông tin, đưa vào inbox vận hành, có xử lý/kiểm tra lại. Các sự kiện này có trong [tài liệu Channex hiện tại](https://docs.channex.io/api-v.1-documentation/webhook-collection#list-of-webhook-events-available).

**Nghiệm thu:** request Channex thành công nhưng OTA báo lỗi sau đó vẫn hiện vấn đề; webhook trùng không tạo nhiều hồ sơ; lỗi thiếu thông tin được giữ để tra cứu, không tự gắn nhầm tenant/job.

**Căn cứ:** [webhook:646](../../../backend/pms_api/channels/routes.py#L646), [registration:227](../../../backend/pms_api/channels/client.py#L227), [publication](../../../backend/pms_api/channels/publication.py), [insights](../../../backend/pms_api/admin/channex_insights.py).

### BIZ-06 — Sửa sai khoản thu SaaS

**Hiện trạng:** SaaS payment là append-only; API chỉ tạo hóa đơn, ghi thu và hủy hóa đơn chưa thu. `VoidInvoiceView` từ chối khi đã có tiền. Chưa có chứng từ đảo/hoàn khoản thu SaaS như phân hệ quỹ PMS.

**Tình huống:** Manager nhập khoản chuyển khoản vào nhầm hóa đơn/khách sạn hoặc cần hoàn tiền. Không nên sửa/xóa trực tiếp lịch sử để khắc phục.

**Đề xuất tối thiểu:** chứng từ đảo khoản thu hoặc hoàn tiền liên kết bản gốc, quyền Manager, lý do bắt buộc, idempotency; cập nhật số dư và báo cáo SaaS theo đối ứng. Phân biệt sửa ghi nhận với việc thực sự chuyển tiền ra ngân hàng.

**Nghiệm thu:** hoàn một phần/đủ không vượt tiền đã thu; retry không trùng; số dư hóa đơn và tổng thực thu khớp; đảo thu không tự thay đổi thuê bao nếu chưa có chính sách liên kết.

**Căn cứ:** [billing URLs](../../../backend/pms_api/saas_billing/urls.py), [payment model:39](../../../backend/pms_api/saas_billing/models.py#L39), [void:387](../../../backend/pms_api/saas_billing/routes.py#L387), [append-only migration](../../../backend/migrations/versions/0013_manager_billing.py#L76).

### BIZ-07 — Thuê bao hết hạn và khách đang lưu trú

**Hiện trạng:** `enforce_entitlements` chặn yêu cầu ghi khi subscription hết hạn/không hoạt động, bao gồm thu tiền và checkout; worker/webhook cũng kiểm quyền sử dụng. Owner vẫn có màn hình đọc billing. Đây là chính sách hiện có, không kết luận là lỗi phân quyền.

**Khoảng trống vận hành:** chưa có luồng được mô tả và thực thi riêng cho khách đang ở, refund cần hoàn tất, hoặc revision OTA còn tồn khi vừa hết hạn. Nhắc hết hạn tự động cũng chưa có trong tập sự kiện thông báo.

**Đề xuất:** chốt một trong hai cách: gia hạn tạm có audit/phạm vi/hạn dùng, hoặc chế độ hoàn tất lưu trú với danh sách thao tác cho phép cụ thể. Nếu giữ chặn toàn bộ ghi, cần quy trình gia hạn khẩn và người trực chịu trách nhiệm. Không tự mở quyền cho mọi tenant hết hạn.

**Nghiệm thu:** thời điểm hết hạn giữa thao tác thu/checkout có hành vi rõ; tenant bị khóa bảo mật không được hưởng ngoại lệ thương mại; revision OTA tồn được xử lý theo quy tắc đã duyệt.

**Căn cứ:** [entitlements:214](../../../backend/pms_api/subscriptions.py#L214), [tenant guard](../../../backend/pms_api/security.py#L161), [webhook](../../../backend/pms_api/channels/routes.py#L646), [billing Owner](../../../backend/pms_api/saas_billing/routes.py#L209).

## 5. Chi tiết P2

| Mã | Bằng chứng/giới hạn hiện tại | Đề xuất nhỏ nhất và tiêu chí hoàn tất |
| --- | --- | --- |
| BIZ-08 | [Webhook](../../../backend/pms_api/channels/routes.py#L646) chỉ so shared secret; chú thích nói Channex không hỗ trợ HMAC. [Đăng ký](../../../backend/pms_api/channels/client.py#L227) chưa quản lý signing key. | Tài liệu Channex nay có HMAC-SHA256 trên `timestamp.raw_body`, timestamp và chữ ký chồng lấn khi xoay khóa. Thêm chế độ ký sau khi kiểm tài khoản staging; test sửa body, timestamp cũ và xoay khóa. Shared secret hiện vẫn là phương thức được provider hỗ trợ; không kết luận endpoint đang bỏ xác thực. [Nguồn chính thức](https://docs.channex.io/api-v.1-documentation/webhook-collection#webhook-security). |
| BIZ-09 | [Settings](../../../backend/pms_api/catalog/routes.py#L42) lưu giờ và `policies` dạng text; [AddCharge](../../../backend/pms_api/bookings/routes.py#L1142) nhận fee/tax/discount thủ công. Có VAT trong danh mục dịch vụ, nhưng chưa có chính sách áp phí được snapshot theo booking. | Chọn trước hủy/no-show hoặc thuế/phí cho pilot; phiên bản chính sách, báo giá và snapshot phải rõ. Test đổi policy không tính lại booking cũ; phí cọc/hủy và hoàn không ghi hai lần. Không tự đổi quy tắc no-show hiện đã chốt là không thu phí tự động. |
| BIZ-10 | [Guest/Reservation/Room](../../../backend/pms_api/bookings/models.py) chưa lưu cơ cấu adults/children/ages hoặc quyền lợi bữa ăn; [OTA normalize](../../../backend/pms_api/channels/importer.py#L125) chỉ giữ tổng occupancy. [Danh mục meals](../../../backend/pms_api/catalog/routes.py#L39) chưa tạo quyền ăn theo đêm. | Lưu cơ cấu theo phòng, tuổi nếu cần tính giá, meal plan và quyền ăn snapshot. Nghiệm thu trẻ em không bị tính như người lớn; danh sách bữa sáng theo ngày, phòng, số suất đúng sau sửa/hủy. |
| BIZ-11 | [Checkout](../../../backend/pms_api/bookings/routes.py#L960) yêu cầu balance bằng 0; [báo cáo](../../../backend/pms_api/reports/routes.py#L324) có số dư hiện tại. Chưa thấy tài khoản công nợ công ty/đại lý, hạn thanh toán hay chuyển folio sang khách hàng tín dụng. | Nếu bán corporate: tài khoản tín dụng, hạn mức, người duyệt, chuyển nợ, thu và phân bổ nhiều booking, tuổi nợ. Test không phải giả lập thanh toán quỹ để checkout; chuyển nợ và thu nợ không tính hai lần doanh thu. Nếu pilot chỉ nhận khách trả đủ, có thể hoãn. |
| BIZ-12 | [Định nghĩa capacity/snapshot](../../../frontend/src/shared/i18n/locales/vi.json#L818) nêu rõ công suất theo phòng đang hoạt động và cọc/nợ là số dư hiện tại. Không phải lịch sử cuối kỳ. | Lưu năng lực bán có ngày hiệu lực và tính số dư theo cutoff giao dịch. Test ngừng phòng hôm nay không đổi công suất tháng trước; báo cáo nợ cuối tháng không đổi vì thu tiền tháng sau. Snapshot đối soát ngày hiện có là nền dùng lại. |
| BIZ-13 | [EVENTS](../../../backend/pms_api/notifications.py#L18) chỉ có 9 sự kiện tức thời; preferences chỉ trả `in_app`. Chưa có CHECKIN_TODAY, CHECKOUT_TODAY, PAYMENT_OVERDUE, LOW_INVENTORY, DAILY_SUMMARY, TRIAL_EXPIRING trong tập này. | Làm nhắc đến/đi/hết hạn trong ứng dụng trước, dùng ngày tenant và khóa chống trùng. Email/digest/webhook gửi ra chỉ triển khai khi chọn kênh/người nhận; kiểm quyền, retry và trạng thái gửi. Mobile push thuộc giai đoạn sau theo thiết kế. |
| BIZ-14 | [Tenant](../../../backend/pms_api/core_models.py#L35) có active/suspended; [admin](../../../backend/pms_api/admin/routes.py#L208) chỉ cập nhật trạng thái/hồ sơ. CSV và công cụ restore đã có, nhưng chưa thấy API/job xuất đầy đủ tenant hoặc offboarding. | Gói xuất gồm dữ liệu/phụ thuộc, snapshot tiền và phiên bản schema; bước kết thúc hợp đồng, thu hồi quyền tích hợp, lưu giữ rồi xử lý dữ liệu theo chính sách đã chốt. User dùng nhiều khách sạn chỉ mất quyền ở tenant đó. Test export không lẫn tenant và không xuất secret. |
| BIZ-15 | [Reservation](../../../backend/pms_api/bookings/models.py#L32) dùng Date và `check_out > check_in`; [stay_dates](../../../backend/pms_api/bookings/routes.py#L71) theo đêm. Thiết kế có `allow_hourly_booking` nhưng chưa có luồng thực thi. | Chỉ làm nếu phân khúc cần day-use: thời điểm nhận/trả, giá giờ, khoảng chiếm phòng và dọn phòng giữa lượt. Nghiệm thu không cho booking theo giờ chồng booking đêm; không dùng hai booking ngày để giả lập. |
| BIZ-16 | [shift_times](../../../backend/pms_api/housekeeping/routes.py#L41) và [positive_shift](../../../backend/pms_api/housekeeping/models.py#L43) chặn ca 22:00–06:00. | Lưu khoảng bắt đầu/kết thúc có ngày hoặc ngày kết thúc rõ. Test giao việc trước/sau nửa đêm, trùng ca và báo cáo đúng ngày khách sạn. Hoãn nếu đội pilot chỉ làm ca ngày. |

## 6. Đề xuất bổ sung theo bốn skill

Các mục sau là gợi ý để lựa chọn; không mặc nhiên nằm trong cam kết MVP.

### SaaS multi-tenant

- **SUG-01 — Khôi phục tài khoản và MFA cho quản trị.** [Auth URLs](../../../backend/pms_api/auth/urls.py) đã có đổi mật khẩu và thu hồi phiên nhưng chưa có recovery/MFA. Chọn cơ chế khôi phục kiểm chứng người yêu cầu, token một lần có hạn, và MFA cho Super Admin trước khi mở self-service rộng. Đây là khả năng vận hành tài khoản, không đề nghị đổi hệ thống xác thực hiện có.
- **SUG-02 — Checklist onboarding khách sạn.** Từ [CreateTenant](../../../backend/pms_api/admin/routes.py#L170), bổ sung trạng thái hoàn tất owner/gói/số phòng/quỹ đầu kỳ/mapping/đối chiếu booking. Chỉ mở đồng bộ khi điều kiện hiện có đã đạt; tránh khách mới tưởng chỉ tạo tenant là có thể bán OTA.
- **SUG-03 — Liên kết thương mại SaaS trước khi tự động thu tiền.** Hóa đơn và cập nhật subscription đang là hai thao tác riêng. Nên lưu kỳ dịch vụ, plan/room-count snapshot và quan hệ hóa đơn–gia hạn; chốt nâng/hạ gói, hiệu lực và chia tiền giữa kỳ. Chưa cần cổng thanh toán định kỳ khi chưa chọn provider. Khi triển khai, webhook tiền cần chống trùng, hoàn/đảo và đối soát; không cấp quyền chỉ vì trình duyệt báo thanh toán thành công.

### Webhook integration

- **SUG-04 — Biên nhận đầu vào và xử lý lỗi có thể tra cứu.** Hiện webhook booking chủ yếu kích hoạt pull, còn revision lưu kết quả và snapshot tiền; mô hình này có cơ chế phục hồi qua feed. Có thể thêm receipt/review có thời điểm, mã liên hệ, hash, trạng thái và dữ liệu đã lọc để điều tra/replay; lưu dữ liệu revision cần dùng trước mapping nếu thực sự cần phục hồi độc lập provider. Không lưu nguyên thông tin thẻ, mọi header hay toàn bộ PII chỉ để đạt một checklist chung.
- **SUG-05 — Ghi rõ hợp đồng retry của provider.** Tách retry giao webhook và retry worker; tài liệu Channex mô tả retry khi nhận 5xx, tối đa khoảng 24 giờ. Kiểm lỗi queue/DB trả trạng thái phù hợp; duplicate vẫn phải thành công sau khi công việc đã được ghi bền vững. Không suy ra cùng chính sách cho mọi provider. [Nguồn](https://docs.channex.io/api-v.1-documentation/webhook-collection#webhook-repeat-logic).

### PostgreSQL best practices

- **SUG-06 — Kiểm RLS trong môi trường triển khai.** Mã đã có FORCE RLS, context transaction-local, ràng buộc tenant và kiểm role readiness. Bổ sung bằng chứng test dưới app role thật, tenant A/B/C, rollback rồi tái dùng connection, worker/support và export. PostgreSQL cho phép superuser/BYPASSRLS bỏ qua policy; FORCE RLS áp dụng cho owner. Vì vậy chỉ nhìn schema hoặc kết quả chạy dưới role mạnh chưa chứng minh cách ly môi trường thật. [Tài liệu PostgreSQL](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).
- **SUG-07 — Phân trang và đo trước khi thêm hạ tầng.** [booking_snapshot](../../../backend/pms_api/bookings/routes.py#L369) tải toàn bộ booking/children; [workspace](../../../backend/pms_api/workspace.py#L18) ghép nhiều phân hệ. Ưu tiên lọc kỳ/ngày tại SQL và phân trang trước; đo số query, thời gian và kích thước response trên dữ liệu đại diện. Chọn index theo câu truy vấn và EXPLAIN, không kết luận thiếu index chỉ vì không có `index=True` khi unique/composite index đã đáp ứng. Chưa có số đo để yêu cầu Redis, replica hay partition.
- **SUG-08 — Kiểm pool và đường kết nối worker.** [Config](../../../backend/pms_api/config.py#L124) đã có pool 5 + overflow 5 mỗi process. [publisher_lock](../../../backend/pms_api/channels/publication.py#L21) dùng session advisory lock qua nhiều transaction. Nếu sau này thêm PgBouncer transaction pooling, cần kiểm riêng đường kết nối giữ lock; không coi mọi connection đều chỉ dùng trạng thái transaction-local. Hiện chưa xác minh có PgBouncer trong môi trường đích.

### Senior fullstack / vận hành thực tế

- **SUG-09 — Bàn giao ca quỹ.** Đối soát ngày có số sổ quỹ nhưng chưa ghi kiểm đếm thực tế, chênh lệch, người giao/nhận ca. Nếu nhiều lễ tân, thêm bàn giao theo ca/quỹ và lý do chênh lệch trước khi phát triển thêm báo cáo trang trí.
- **SUG-10 — Mua hàng và công nợ nhà cung cấp.** Kho đã có supplier và phiếu nhập; chưa thấy luồng đơn mua–nhận hàng–hóa đơn NCC–thanh toán/công nợ. Đây là mở rộng kế toán mua hàng, không phải lý do viết lại kho. Chỉ làm nếu khách sạn pilot yêu cầu quản trị mua hàng.
- **SUG-11 — Chứng từ ngoài hệ thống.** Phiếu in/CSV hiện là chứng từ nội bộ. Nếu cần hóa đơn điện tử, thanh toán ngân hàng/thẻ, khai báo lưu trú hoặc kết nối khóa cửa, tách thành tích hợp có provider/phạm vi riêng và nghiệm thu độc lập. Không gắn nhãn đã có chỉ vì có nút in hay danh mục phương thức thanh toán.
- **SUG-12 — Đồng bộ backlog và nghiệm thu theo luồng.** Cập nhật trạng thái những mục đã triển khai trong checklist cũ; tách rõ “có source”, “test local”, “nghiệm thu staging” và “đã deploy”. Giữ lại CI, guard migration và test hiện có; chưa có bằng chứng mới để mở lại các lỗi từng nêu trong roadmap cũ như lỗi timestamp hoặc mất dữ liệu khi đổi ngôn ngữ.

## 7. Thứ tự thực hiện đề xuất

| Đợt | Mục tiêu | Hạng mục | Điều kiện hoàn tất |
| --- | --- | --- | --- |
| 1 | Xử lý được ngoại lệ tiền và tiếp tục vận hành | BIZ-03, 06, 07; chốt policy BIZ-02, 09 | Có quy trình sửa sai/hoàn tất, audit và test tiền; khách đang ở không bị bỏ ngỏ khi hết hạn |
| 2 | Lễ tân và OTA đi hết tình huống pilot | BIZ-01, 04, 05; BIZ-08 nếu bật signed webhook | Đổi phòng/gia hạn và booking có thuế của kênh pilot đi hết luồng; tồn/tiền/HK/OTA khớp |
| 3 | Chốt ngày và đối soát lịch sử | BIZ-02, 12; SUG-09 nếu có nhiều ca | Có định nghĩa doanh thu/ngày kinh doanh, cách điều chỉnh sau chốt và bộ số liệu đối soát |
| 4 | Mở rộng đúng phân khúc | BIZ-09–16, SUG-01–03, 10–11 theo nhu cầu | Chọn từng năng lực theo khách sạn pilot, không mở đồng loạt mọi module |
| Xuyên suốt | An toàn dữ liệu và bằng chứng triển khai | SUG-04–08, 12 | Test tenant/tiền/retry; backup/restore và nghiệm thu provider trên môi trường riêng |

Các quyết định cần chốt trước khi triển khai: giá khi chuyển phòng/gia hạn; phí trả sớm/hủy/no-show; ngày kinh doanh và doanh thu; cơ sở điều chỉnh hoa hồng; cách thuế/thu hộ OTA; sửa sai khoản thu SaaS; ngoại lệ hết hạn; đối tượng được mua chịu. Báo cáo đề xuất hướng xử lý, chưa tự chọn chính sách thương mại thay chủ sản phẩm.

## 8. Kiểm chứng trong lượt rà soát

| Kiểm chứng | Kết quả mới trong phiên này | Giới hạn |
| --- | --- | --- |
| Backend chọn lọc | **51 tests đạt**, không skip | Unit, client provider giả lập, route contract và khởi tạo app; không kiểm RLS/transaction bằng PostgreSQL thật |
| Frontend chọn lọc | **13 tests đạt**, không skip | Owner Billing, booking detail/draft và trạng thái tích hợp; không phải E2E trên trình duyệt thật |
| Tài liệu provider | Đọc lại Webhook Collection Channex ngày 29/10/2026 | Xác nhận tài liệu có signing/rotation/retry/events; chưa xác minh khả năng trên tài khoản staging của dự án |
| Tài liệu PostgreSQL | Đối chiếu nguyên tắc RLS với PostgreSQL 18 | Không đọc catalog role/policy đang chạy của môi trường đích |

Lệnh backend, chạy từ `backend/` bằng Python sẵn có trong `.tools/python314`:

```text
python -m unittest tests.test_booking_values tests.test_stay_segments tests.test_catalog_validation tests.test_reconciliation_unit tests.test_channels_client tests.test_channel_rate_safety.RateMoneyNormalizationTests tests.test_common_app
```

Lệnh frontend, chạy từ `frontend/`:

```text
node --test --test-isolation=none src/apps/pms/profile/pages/OwnerBilling.test.js src/apps/pms/reservations/components/BookingDetailPanel.test.js src/apps/pms/channel-manager/integration.test.js src/apps/pms/reservations/bookingDraft.test.js
```

Không chạy lại toàn bộ suite, build, kiểm tải, browser E2E, PostgreSQL integration, backup/restore hay OTA thật. Không suy diễn các kết quả lịch sử trong báo cáo cũ thành kết quả mới. Các mục thiếu được kết luận trong phạm vi repository; cấu hình hoặc công cụ ngoài repo có thể bổ sung một phần quy trình và cần xác minh khi nghiệm thu.
