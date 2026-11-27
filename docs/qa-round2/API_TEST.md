# QA2-03 — Kiểm thử tích hợp API PMS

Ngày rà soát: **21/10/2026**. Commit nguồn: `accc668f71897191cbc98b1388c21ba01d15edb3`.
Phạm vi thực hiện: phân tích tĩnh repository, thiết kế test và kế hoạch đối chiếu DB. **Kết luận thực thi: BLOCKED** — chưa có bằng chứng phê duyệt môi trường cô lập, tài khoản và dữ liệu QA2-03. Không gửi request, kể cả health/login; không kết nối DB, chạy migration, seed, worker hoặc bộ integration test. Không gọi production, tạo booking thật, thanh toán thật hay kích hoạt tích hợp ngoài. Chỉ thêm tài liệu này; không sửa source, push hoặc merge.

## 1. Quy ước kết quả và bằng chứng hiện tại

| Trạng thái | Ý nghĩa |
| --- | --- |
| PASSED | Kiểm tra đã thực hiện, có bằng chứng đáp ứng tiêu chí; ghi rõ tĩnh hay runtime. |
| FAILED | Kiểm tra đã thực hiện và có bằng chứng sai khác; không suy ra lỗi runtime từ việc chưa chạy. |
| NOT RUN | Ca đã thiết kế nhưng chưa thực thi; không được tính là pass. |
| BLOCKED | Điều kiện cần chưa đáp ứng, không được bắt đầu phần thực thi phụ thuộc. |

| ID | Hạng mục | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| ST-01 | Xác định contract và route hiện có | PASSED (tĩnh) | `backend/API_CONTRACT.md`, `backend/pms_api/**/urls.py`, `backend/tests/fixtures/api_routes.json`. Fixture có 166 rule, 165 cặp method/path `/api/` khi bỏ HEAD/OPTIONS; đây là snapshot, không phải chứng cứ deployment. |
| ST-02 | Rà soát tài nguyên Postman | PASSED (tĩnh) | `.postman/resources.yaml`; `postman/simulations/channex-booking-import.sim.yaml`; `postman/mocks/channex-booking-import.js`; `postman/globals/workspace.globals.yaml`. Không thấy collection PMS/OpenAPI trong file được liệt kê. Không tải workspace từ xa. |
| ST-03 | Đọc cấu hình an toàn | PASSED (tĩnh) | Đọc loader `backend/pms_api/config.py`; chỉ kiểm tra sự hiện diện biến runtime và tên biến file nếu có, không in giá trị. Kết quả tại phiên kiểm tra: toàn bộ biến được liệt kê ở mục 2 chưa đặt; bốn file env được kiểm tra không tồn tại. |
| GATE-01 | Xác nhận môi trường, phạm vi và fixture | BLOCKED | Không tìm thấy phê duyệt QA2-03 trong yêu cầu, `tasks/`, `.github/`, `docs/runbooks/`, README hoặc tài nguyên Postman đã rà soát. Báo cáo staging cũ không phải quyền thực thi hiện tại. |
| RUN-01 | HTTP API, concurrency và DB consistency | BLOCKED | Phụ thuộc GATE-01. Các ca chi tiết bên dưới đều NOT RUN. |
| RUN-02 | Channex sandbox thật | BLOCKED | Chưa có phép provider/property/egress riêng; tên môi trường staging không đủ chứng minh an toàn. |

Không có API runtime nào PASSED hoặc FAILED trong lần bàn giao này. Không có lỗi runtime đã tái hiện. Thiếu collection là khoảng trống coverage, không phải kết luận API bị lỗi.

## 2. Cấu hình, dữ liệu và điều kiện mở khóa

Loader chỉ chấp nhận `APP_ENV=development|testing|production`, không có giá trị `staging`. Runtime ghi đè `.env`; production chỉ đọc runtime. `TESTING=true` không tự chặn network hoặc bảo đảm DB cô lập. SQLAlchemy bật `hide_parameters=True` nhưng người chạy vẫn phải khử secrets trong lỗi và artifact.

Đã kiểm tra hiện diện, không đọc/in giá trị runtime: `APP_ENV`, `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `TEST_DATABASE_URL`, `TEST_DATABASE_MIGRATION_URL`, `CHANNEX_ENCRYPTION_KEY`, `CHANNEX_MANAGER_API_KEY_STAGING`, `CHANNEX_MANAGER_API_KEY_PRODUCTION`, `CHANNEX_WEBHOOK_BASE_URL`: **UNSET** tại phiên kiểm tra. `backend/.env`, `.env`, `backend/.env.testing`, `backend/.env.staging`: **ABSENT**. Đây chỉ là trạng thái worktree/shell hiện tại, không suy ra cấu hình trên máy triển khai.

Trước request đầu tiên, người phụ trách phải cung cấp và QA xác minh nội bộ:

1. Người phê duyệt, thời điểm, hạn hiệu lực, mã phê duyệt, commit triển khai; base URL allowlist và bằng chứng không trỏ production, kể cả redirect/proxy. Không tự chuyển host khi lỗi.
2. DB đích cùng môi trường, database dùng một lần `pms_test_*`, runtime role không superuser/BYPASSRLS; migrator tách biệt. Xác nhận dữ liệu được phép xóa, snapshot/cleanup và không dùng DB khách hàng. Không ghi DSN vào bằng chứng.
3. Hai tenant QA A/B; tài khoản riêng OWNER, FRONT_DESK, HOUSEKEEPING, ACCOUNTANT, SYSTEM_MANAGER, SUPER_ADMIN, tài khoản inactive và non-member; không dùng danh tính khách thật. Gói/quota/feature bật theo ca, thêm tenant suspended/expired để kiểm tra gate.
4. Hai phòng 101/102, room type Standard, nguồn Direct, dịch vụ mẫu, quỹ cash/bank và phương thức trả tiền giả; hai kho, hàng hóa, recipe POS, voucher quota=1. Tiền tệ VND/USD, timezone Asia/Ho_Chi_Minh, ngày kiểm thử theo business date cố định.
5. Phê duyệt riêng cho mutation, fault injection và mức concurrency (đề xuất chỉ 2 request đồng thời, không load test). Chặn egress provider, email/mobile; worker tắt hoặc dùng mock đã kiểm chứng. Booking/payment chỉ là bản ghi giả trong DB dùng một lần.
6. Với Channex: ban đầu chỉ HTTP mock loopback; cần phép riêng mới dùng sandbox có property/account riêng. GET `/channels/catalog`, `/channels/remote*`, `/api/admin/channex/properties*` có thể gọi upstream; không coi GET mặc nhiên an toàn.

Không tự chạy `backend/scripts/run_domain_tests.py` hay CI runner trước gate. `backend/tests/domain_fixture.py` có guard hai URL cùng DB `pms_test_*`, nhưng setup vẫn chạy migration và **TRUNCATE toàn bộ bảng**. Guard tên DB không thay thế xác nhận chủ sở hữu và môi trường.

## 3. Bản đồ API và rủi ro

Ký hiệu `T=/api/tenants/<tenant_id>`. Đường dẫn dưới đây được đối chiếu metadata route trong source, chưa xác nhận trên deployment. Contract sử dụng cookie session, JSON camelCase, mutation cần `X-CSRF-Token` trừ ngoại lệ cụ thể như login/webhook. Lỗi dạng `{error:{code,message,details?}}`; tiền thường là chuỗi decimal, không so sánh float.

| Module | Endpoint chính | Luồng/rủi ro cần ưu tiên |
| --- | --- | --- |
| Authentication | `/api/auth/login`, `/session`, `/logout`, `/change-password`, `/profile`, `/sessions`, `/sessions/revoke-others` | Cookie, CSRF, origin, rate limit, thu hồi phiên. |
| Catalog và tồn phòng | `T/workspace`, `/masters/<catalog_name>`, `/settings`, `/rates`, `/quote`, `/availability`, `/room-blocks`, `/rooms/<number>/condition` | Phân biệt UUID/code/number, stop sell, phòng bảo trì, rò rỉ giá theo vai trò. |
| Booking/guest | `T/reservations`, `/<id>`, `/<id>/status`, `/charges`, `/payments`, `/payments/<payment_id>/refund`, `/notes`, `/adjustments` | Multiroom/guest, optimistic version, trùng phòng, snapshot, idempotency. Không có endpoint guest CRUD độc lập. |
| Inventory hàng hóa | `T/inventory/masters`, `/masters/<catalog_name>`, `/service-stock-links`, `/documents`, `/documents/<id>`, `/documents/<id>/reverse`, `/stock`, `/pos/<invoice_id>/returns` | Sổ kho bất biến, giá vốn, stock version, POS trừ kho nguyên tử. Khác tồn phòng. |
| Pricing | `T/pricing`, `/pricing/rules`, `/pricing/promotions`, `/pricing/vouchers`, `/pricing/exchange-rates`; `T/quote` | PATCH truyền id trong body; thứ tự rule, quota voucher, FX và snapshot. |
| Finance/POS/commission | `T/pos/invoices` và detail/post/payments/refund/cancel; `/cash-documents`, `/<id>/reverse`, `/cashbook`, `/commissions`, `/commissions/settle`, `/commissions/<id>/payments` | Không gọi gateway thật; ledger append-only, chống ghi trùng, khóa quỹ, bảo toàn tiền. |
| Housekeeping | `T/housekeeping/staff`, `/shifts`, `/tasks`, `/tasks/manual`, `/tasks/<id>/assign`, `/tasks/<id>/status` | Phạm vi người được giao, giao ca, hoàn thành và trạng thái phòng. |
| Reports/đối soát | `T/reports/dashboard`, `/revenue`, `/business`, `/financial`; `T/reconciliation`, `/confirm`, `/history` | Business date, phân trang, snapshot xác nhận không khóa sổ hay tự ghi tiền. |
| Manager/SaaS | `/api/users`, `/api/tenants`, `T/users`, `T/customer-history`, `T/subscription`, `/history`, `/api/plans`, `/api/public/plans`, `/api/features`, `T/feature-overrides`, `/api/billing/invoices`, `/<id>/payments`, `/<id>/void`, `/api/manager/overview` | Tách tiền SaaS/khách sạn, quota, last Owner/Super Admin, quyền hệ thống. |
| Channels/notifications | `T/channels` và config/mappings/jobs/booking-reviews/catalog/remote; `/api/admin/channex/*`; `/api/channex/webhooks/<tenant_id>`; `T/notifications` và preferences/read | External side effects, mã hóa credential, revision/ACK, hộp thư riêng. |
| Health/audit | `/api/health`, `/api/ready`, `/api/admin/operations`, `/api/audit`, `T/audit` | Readiness khác worker health; audit chỉ cho vai trò phù hợp, không lộ dữ liệu tenant khác. |

Postman hiện chỉ mô phỏng Channex booking cancellation: key fixture, revision cũ/mới, sai property, booking không tồn tại và upstream 503; endpoint ngoài mô hình trả 501. Simulation này không bao phủ Authentication/Booking/Inventory/Pricing/Finance của PMS. `backend/tests/test_channel_http_simulation.py` giới hạn URL HTTP `127.0.0.1`; không khởi động mock trong lượt này. Workspace ID trong cấu hình không chứng minh có collection hoặc quyền staging.

## 4. Bộ ca chuẩn bị — tất cả NOT RUN

Mỗi hàng là một kịch bản; các biến thể phân cách bằng dấu chấm phẩy phải ghi thành lượt chạy riêng khi thực thi. Mọi ca dùng fixture mục 2, cookie riêng theo actor và tenant A trừ khi nêu khác. Với mutation hợp lệ, lấy CSRF từ login/session; các ca lỗi quyền giữ payload hợp lệ để không bị validation che khuất lỗi quyền. Các giá trị ID được lấy từ response/fixture, không dùng ID production.

| ID / mức | Request và thao tác | Kết quả mong đợi / assertion | Trạng thái |
| --- | --- | --- | --- |
| AU-01 P0 positive | POST login bằng owner QA; GET session cùng cookie | 200; user/tenants/csrfToken/expiresAt đúng; cookie HttpOnly, cấu hình Secure/SameSite đúng môi trường; không lộ password/hash. | NOT RUN |
| AU-02 P0 negative | Login sai mật khẩu; tài khoản inactive; email sai định dạng | 401 invalid_credentials cho hai ca đầu; 422 invalid_email cho email sai; không tạo session. Bộ đếm login lỗi được phép tồn tại. | NOT RUN |
| AU-03 P0 unauthorized | GET session và T/reservations không cookie; cookie hết hạn/đã revoke | 401 unauthenticated; không trả dữ liệu nghiệp vụ. | NOT RUN |
| AU-04 P0 security | POST/PATCH hợp lệ thiếu/sai CSRF; Origin không allowlist | 403; kiểm tra code theo nhánh CSRF/origin_denied; không ghi nghiệp vụ. | NOT RUN |
| AU-05 P1 session | Login hai client; revoke-others; logout; đổi mật khẩu QA | Chỉ phiên được phép còn hiệu lực; phiên đã thu hồi nhận 401; mật khẩu cũ không đăng nhập được sau đổi. | NOT RUN |
| AU-06 P1 error | Trên IP/tài khoản QA riêng, vượt 10 lần sai/email trong 15 phút | 429 rate_limited; không ảnh hưởng tài khoản chung; reset fixture sau kiểm thử. | NOT RUN |
| RB-01 P0 forbidden | Owner A đọc/ghi T(B); user tenant gọi /api/users; SYSTEM_MANAGER gọi /api/users | 403 tenant_denied/forbidden; không lộ hoặc thay đổi B; SUPER_ADMIN được dùng /api/users. | NOT RUN |
| RB-02 P0 forbidden | HK gọi payments/inventory/pricing-write; FRONT_DESK gọi finance adjustment; HK xem workspace | 403 ở thao tác ngoài quyền; workspace chỉ trả trường được phép, không giá/contact/tài chính bị hạn chế. | NOT RUN |
| RB-03 P1 gate | Mutation trên tenant suspended, gói hết hạn, feature tắt, quota phòng đã đầy | Bị chặn theo contract từng gate; không side effect. Ghi riêng code thực tế và đối chiếu, không chấp nhận mọi 4xx. | NOT RUN |
| BK-01 P0 positive | POST quote rồi POST reservations: rooms=[101,102], 2 guest, 2 đêm, source Direct | Quote 200; create 201; tổng 400.0000 khi giá mỗi phòng/đêm 100.0000 và không policy; 4 nightly rows, inventory mỗi ngày +2. | NOT RUN |
| BK-02 P0 validation | checkOut<=checkIn; ngày sai; rooms trùng/không tồn tại; email guest sai | 422/404 theo lỗi tham chiếu cụ thể; invalid_guest cho email sai; không tạo guest/reservation/night/inventory dở dang. | NOT RUN |
| BK-03 P0 negative | Quote/create phòng maintenance/inactive/block/stopSell/đã có stay overlap | Bị từ chối đúng nhánh contract; không tạo stay. Booking tiếp theo bắt đầu đúng checkOut được phép (khoảng ngày nửa mở). | NOT RUN |
| BK-04 P0 version | PATCH detail và POST status bỏ/invalid expectedVersion; dùng version cũ | 422 version_required; 409 stale_booking; toàn bộ booking/guest giữ nguyên. | NOT RUN |
| BK-05 P0 concurrency | Hai phiên sửa cùng version; hai POST đặt cùng phòng/ngày với barrier | Sửa: một thành công, một stale_booking; tạo: đúng một 201 và một 409; không overbook, không orphan. Không dùng helper tự thêm version cho ca version. | NOT RUN |
| BK-06 P1 lifecycle | CONFIRMED→IN_HOUSE→CHECKED_OUT sau trả đủ; checkout còn nợ; status dạng số; transition sai | Luồng hợp lệ thành công; còn nợ bị chặn; 422 invalid_status; 409 invalid_transition; kiểm tra HK/inventory theo trạng thái. | NOT RUN |
| BK-07 P1 no-show | NO_SHOW trước/ngay ngày check-in theo timezone; sau đó thử check-in/edit stay | Trước ngày bị chặn; đúng ngày được phép, giải phóng tồn và hủy HK mở; terminal; giữ tiền/charge, không tự refund/fee. | NOT RUN |
| BK-08 P0 rollback | PATCH guest cùng booking rồi cố ý gây lỗi cuối transaction; attach guest với profile cũ | Không ghi một phần guest/stay; stale profile trả 409 stale_guest; dữ liệu/version cũ còn nguyên. | NOT RUN |
| CT-01 P1 catalog | Tạo room type code 2 và 02; đổi setting tiền tệ khi có lịch sử; chỉnh rate sau booking | Hai code khác nhau, UUID ổn định; history guard chặn thay đổi bị cấm; nightly snapshot cũ không đổi. | NOT RUN |
| IN-01 P0 positive | POST opening rồi receipt/issue/transfer; GET documents/detail/stock với dữ liệu kho giả | Sổ kho/phiếu khớp; transfer bảo toàn lượng/giá trị; không stock âm; unit quantity/cost 4 số lẻ, value 8. | NOT RUN |
| IN-02 P0 validation | Quantity âm/quá precision; hai kho giống nhau; ID hàng/kho tenant B; ngày tương lai/trước phiếu cuối | 422/404 theo nhánh xác thực; không movement/balance/document mới. | NOT RUN |
| IN-03 P0 concurrency | Hai issue tranh lượng cuối; count với expectedVersion cũ | Chỉ lượng khả dụng được xuất; thao tác thua 409, không âm; count cũ bị chặn; journal/balance nhất quán. | NOT RUN |
| IN-04 P1 idempotency | Replay create/reverse cùng key; payload khác cùng key; đảo phiếu lần hai bằng key mới | Replay trả kết quả cũ, không movement mới; mismatch 409; reverse lần hai 409 already_reversed; phiếu gốc giữ nguyên. | NOT RUN |
| IN-05 P0 atomicity | POST POS invoice có recipe rồi post khi thiếu hàng; refund tiền; return vật lý quá lượng | Thiếu hàng rollback cả post/charge/stock; refund không tự nhập kho; return quá tiêu hao bị chặn. | NOT RUN |
| PR-01 P1 priority | Tạo weekend/LOS cùng priority; daily override; quote qua ngày ISO 1/7 | Daily override thắng; rule đủ điều kiện priority cao nhất, tie theo ID tăng; tính từng đêm bằng Decimal. | NOT RUN |
| PR-02 P1 discount | Earlybird/lastminute/staypay; voucher explicit; quote tại validFrom/validTo | Không stacking, promotion giảm lớn nhất; staypay miễn đêm rẻ nhất/phòng; voucher thay promotion; validTo exclusive. | NOT RUN |
| PR-03 P0 quota | Quote lặp voucher usageLimit=1; hai booking phòng khác nhau đồng thời dùng voucher | Quote không trừ quota; đúng một redemption khi booking; không vượt 1, kể cả zero discount; cancel không hoàn quota. | NOT RUN |
| PR-04 P1 validation | Voucher code trùng; rate<=0; currency không hỗ trợ; PATCH thiếu id | duplicate_voucher 409; các payload sai bị chặn theo contract; không đổi cấu hình. | NOT RUN |
| PR-05 P0 FX | Tạo booking VND/USD, thay FX rồi đọc booking và refund payment cũ; thiếu FX | Snapshot cũ bất biến; refund dùng FX payment, tổng base refund bảo toàn; không tự suy tỷ giá khi thiếu. | NOT RUN |
| FI-01 P0 positive | Booking payment rồi partial refund với key riêng; checkout khi balance=0 | Payment/refund/ledger cùng commit; paid/balance đúng; tiền là chuỗi 4 số lẻ; không gọi thanh toán ngoài. | NOT RUN |
| FI-02 P0 negative | Overpay; over-refund; amount<=0; method/fund B; fund sai currency; thiếu key | Bị chặn, không ledger/payment/refund dở dang; xác nhận code theo nhánh contract. | NOT RUN |
| FI-03 P0 concurrency | Hai payment cho balance cuối; hai refund cùng khoản; hai expense tranh quỹ | Tổng thu/refund không vượt giới hạn, quỹ không âm; response conflict rõ ràng, không 500/deadlock treo. | NOT RUN |
| FI-04 P0 idempotency | Cùng key/payload gửi song song rồi replay; đổi amount/actor/endpoint cùng key | Một hiệu ứng tài chính; replay cùng response gốc; intent khác trả 409; kiểm tra journal tenant/key. | NOT RUN |
| FI-05 P0 ledger | Tạo receipt/expense/transfer; reverse; opening sau history; đảo hai lần | Transfer hai bút toán đối nhau; reversal nối gốc, không sửa/xóa ledger; opening bị chặn sau history, không tạo opening mới sau reversal. | NOT RUN |
| FI-06 P1 POS | Draft→post retail/pay/refund/cancel; post vào booking; sửa posted | Snapshot item bất biến; post booking chỉ thêm charge, không receipt trùng; chỉnh posted bị chặn; compensation giữ lịch sử. | NOT RUN |
| FI-07 P1 adjustment | Owner/accountant debit/credit booking CHECKED_OUT đã trả đủ; FRONT_DESK thử tương tự | Chỉ vai trò được phép ghi fee/payment hoặc discount/refund nguyên tử; booking vẫn tất toán, lịch sử gốc giữ nguyên. | NOT RUN |
| FI-08 P1 commission | Settle source commission rồi pay và replay | Snapshot/quỹ/ledger khớp, không payout trùng; thay config không sửa lịch sử; không trộn SaaS receipts. | NOT RUN |
| HK-01 P1 | Tạo shift/manual task, assign A; HK khác thử status; lặp generate plan | Chỉ người được phép/được giao thao tác; lặp không task trùng; hoàn thành/inspection đổi phòng theo contract. | NOT RUN |
| RP-01 P0 consistency | Cashbook/reports nhiều trang; cùng business day/filter/fund/currency; kiểm tra sát 00:00 | Summary trên toàn bộ filter không theo page; opening+income−outflow=closing; fundBalances hiện tại độc lập period/actor; không trộn native currencies. | NOT RUN |
| RC-01 P1 | GET reconciliation, confirm snapshot hợp lệ; đổi tiền rồi confirm token cũ; replay confirm | Snapshot có business date/timezone đúng; token cũ bị chặn; replay không trùng; không tự post tiền/khóa kỳ (periodLocked=false). | NOT RUN |
| MG-01 P1 | Super Admin quản lý system user; self-demote; bỏ last Super Admin/Owner; role đổi | Guard 409 cho thao tác bị cấm; revoke session khi đổi role/deactivate; không trả hash; tenant user không thành system user. | NOT RUN |
| MG-02 P1 | SaaS invoice/payment/void; subscription quota; public plans; feature override | Quyền hệ thống đúng; thu SaaS không tự gia hạn và không vào ledger khách sạn; giá/quota theo cấu hình, không hardcode. | NOT RUN |
| NT-01 P1 | User A đọc/read notification của B; owner sửa preferences; lặp read-all | Không lộ inbox B; chỉ quyền phù hợp sửa preferences; read idempotent; không gửi email/mobile. | NOT RUN |
| CH-01 P0 mock | Webhook secret sai; revision lặp; cancellation sai property/latest; upstream 503 | Không import/ACK sai; revision dedup; needs_review hoặc retry phù hợp; 503 không commit cancellation/ACK; chỉ mock loopback. | NOT RUN |
| CH-02 P1 mock | GET channels/admin snapshot; config response; retry job, mapping đã dùng | Không trả secret/provider payload nhạy cảm; mapping đã dùng được bảo vệ; chỉ giả lập worker, không ARI/OAuth thật. | NOT RUN |
| EH-01 P1 validation | JSON array/null/malformed; sai Content-Type; field/type lạ; method không hỗ trợ; body >1MiB | 4xx đúng từng contract (400/415/422/405/413 tùy nhánh); envelope error, không stack/SQL/secret, không partial write. | NOT RUN |
| EH-02 P0 fault | Trong môi trường được phép fault injection, ngắt DB ở read/commit; uniqueness conflict | 503 database_unavailable hoặc 409 conflict đúng handler; rollback toàn bộ, retry idempotent sau kết quả không chắc chắn. | NOT RUN |
| OP-01 P1 | Health/ready; admin operations với anonymous/HK/system; audit filter timestamp/page | 401/403 đúng quyền; worker missing/stale không đồng nghĩa DB unready; audit filter sai 422, phân trang/sort đúng, không lộ credential. | NOT RUN |

Các mã HTTP chưa được contract xác định duy nhất phải được chốt từ handler/test tương ứng trước khi chạy; không dùng “bất kỳ 4xx” làm tiêu chí pass. Kiểm tra quyền thiếu cookie/khác vai trò/khác tenant áp dụng lại cho mọi nhóm protected endpoint, không chỉ các ví dụ RB-01/02.

## 5. Kế hoạch consistency API ↔ database

Chỉ bắt đầu sau GATE-01. Đọc baseline trước request và đọc lại **sau commit bằng session DB mới** để tránh identity-map cache. Dùng runtime role đúng tenant/RLS để kiểm tra cách ly; đối chiếu quản trị bằng kết nối read-only được phép riêng. Không dùng migrator để chứng minh RLS. Mỗi assertion scope theo tenant ID + entity ID + run ID; không dump toàn bảng hoặc PII.

| Luồng | Bảng/đối tượng đối chiếu | Bất biến cần kiểm tra |
| --- | --- | --- |
| Auth | users, tenant_users, auth_sessions, login_attempts, audit_logs | Danh tính/role đúng, session hết hạn/revoke mất hiệu lực; chỉ lưu digest theo thiết kế. Login sai có chủ ý lưu attempt, không áp dụng assertion “mọi lỗi không ghi gì” cho auth. |
| Booking | reservations, reservation_rooms, reservation_guests, guests, reservation_nights, room_type_availability | IDs/rooms/guest/version khớp response; số đêm/phòng và tổng snapshot đúng; booked_rooms khớp stay chiếm tồn; overlap bị cấm, guest edit lỗi rollback. |
| Pricing | pricing_rules, pricing_promotions, pricing_vouchers, voucher_redemptions, exchange_rates; snapshot trên reservation/night | Quote không tạo redemption; quota nguyên tử; total từ nightly/charge/discount theo schema; FX/policy cũ không bị cập nhật hồi tố. |
| Finance | charges, payments, refunds, ledger_entries, idempotency_records, cash_documents, pos_invoices/items/payments/refunds | paid = payment − refund; balance theo tổng hiện hành; ledger ký dấu đúng và cùng transaction; replay không thêm hàng; transfer/reversal bảo toàn tiền từng currency; original/base amount tách biệt. |
| Inventory | inventory_documents, stock_movements, stock_balances, inventory_controls, service_stock_links/ingredients | Lượng cuối = lượng đầu + tổng movement; giá trị bảo toàn theo weighted average/precision; count version tăng đúng; transfer hai kho cân bằng; reversal liên kết gốc, không sửa history. |
| HK | housekeeping_tasks, housekeeping_shifts, housekeeping_staff, housekeeping_logs, physical_rooms | Người nhận/trạng thái/phòng đúng; no-show hủy task mở đúng booking, không đổi condition ngoài ý muốn. |
| Reports/reconciliation | ledger_entries, reservations, day_reconciliations | Tính lại aggregates độc lập theo date/timezone/basis/currency, không copy summary API làm oracle; confirmation lưu snapshot/token đúng, không thêm bút toán. |
| Manager/SaaS | plans, subscriptions, subscription_history và models tại saas_billing | Quota/quyền/thu hồi session đúng; SaaS tách ledger tenant. |
| Channels/notifications | models tại channels/models.py, notification_models.py; audit_logs | Revision/job/review/dedup/ACK đúng thứ tự; chỉ ACK sau commit; tenant/recipient đúng, credential không trả lại API. |

Ví dụ đối chiếu có tham số, chỉ dùng trên DB đã được xác nhận; không chèn DSN/password vào câu lệnh hoặc artifact:

```sql
SELECT tenant_id, reservation_id, COUNT(*) AS night_rows, SUM(price) AS total
FROM reservation_nights
WHERE tenant_id = :tenant_id AND reservation_id = :reservation_id
GROUP BY tenant_id, reservation_id;
```

Trước dùng ví dụ phải đối chiếu tên cột thực tế trong model/migration của commit triển khai. Dùng `Decimal` với tiền 4 chữ số thập phân, FX 8; inventory value 8; không epsilon float che sai số. So sánh JSON null với DB NULL và ISO date/timestamp có timezone. Kiểm tra tenant B không thay đổi ở cả thành công và thất bại của A.

Với lỗi validation/forbidden/stale/conflict, chụp số lượng và tổng giá trị các bảng liên quan trước/sau: không tồn tại reservation/guest/charge/payment/movement/journal thành công dở dang. Retry provider có thể chủ ý giữ job/error; login lỗi giữ attempt. Fault injection và concurrency dùng hai session độc lập với barrier; kiểm tra kết quả cuối sau cả hai transaction, đặt timeout để phát hiện treo và luôn ghi nhận cả hai response.

## 6. Cách thực thi và lưu bằng chứng sau phê duyệt

1. Điền đủ mục 2, lưu phê duyệt và manifest fixture đã khử secrets. Xác minh commit deploy/DB role/migration heads qua kênh quản trị được phép trước HTTP; chỉ sau đó mới health → ready → login → session.
2. Tạo dataset xác định, bật đúng feature, khóa business clock nếu harness hỗ trợ. Dùng `backend/tests/domain_fixture.py` làm tham chiếu dữ liệu; kiểm tra tên trường theo contract trước seed. Không chạy migration/truncate tự động trên staging dùng chung.
3. Chạy P0 trước: auth/tenant isolation → quote/booking → version/race → pricing quota → payment/idempotency → inventory/POS atomicity → report consistency. Chạy P1 và fault injection trong phạm vi phê duyệt. Channex mock tách khỏi provider thật.
4. Tận dụng test hiện có sau khi đọc harness: `test_identity.py`, `test_booking_integration.py`, `test_booking_versions.py`, `test_booking_no_show.py`, `test_inventory_integration.py`, `test_pricing_integration.py`, `test_finance_integration.py`, `test_closed_finance.py`, `test_housekeeping_integration.py`, `test_day_reconciliation.py`, `test_reports_financial.py`, `test_manager_users.py`, `test_channel_http_simulation.py`. Các file tồn tại không đồng nghĩa đã chạy/pass; unittest skip phải ghi NOT RUN.
5. Nếu cần collection, chuyển từng ca thành request Postman theo source và assertion rõ status/schema/domain/DB. Không export cookie, password, API key, CSRF hay DSN vào collection/globals. Không dùng runner hiện tại như thể đã có collection PMS hoàn chỉnh.
6. Lưu artifact riêng theo `docs/qa-round2/evidence/api/<run-id>/` (chưa tạo bằng chứng runtime trong lượt này): manifest commit/environment alias/approval ID/timezone; request method/path/body tổng hợp đã redact; status và response đã redact; DB assertions trước/sau; duration; hai response concurrency; log lỗi đã lọc. Không lưu Authorization/Cookie/Set-Cookie, token, webhook secret, provider key, email/điện thoại khách, password hoặc URL chứa credentials. Raw evidence nếu cần chỉ ở kho hạn chế được phê duyệt.
7. Mỗi lượt ghi `case ID, variant, actor role, tenant alias, expected, actual, PASSED|FAILED|NOT RUN|BLOCKED, evidence path, issue ID`. FAILED cần request tái hiện tối thiểu và khác biệt DB; không tự sửa source trong ticket này. Timeout sau ghi tiền: giữ cùng Idempotency-Key, xác minh kết quả rồi mới retry.
8. Cleanup chỉ fixture được phép: ưu tiên hủy toàn DB dùng một lần theo phê duyệt; kiểm tra job không thoát ra ngoài. Với sổ bất biến không xóa row lịch sử tùy tiện trên môi trường dùng chung. Ghi lại số ca từng trạng thái và mọi blocker còn lại.

## 7. Khoảng trống và bàn giao

- Chưa có base URL/DB/fixture/approval cho QA2-03: **BLOCKED** toàn bộ thực thi. Cần chủ môi trường hoàn tất mục 2; không cần cấp hoặc dán secrets vào tài liệu này.
- Chưa có collection API PMS đầy đủ trong repository: bộ ca mục 4 sẵn cho việc triển khai runner/collection sau gate; tài nguyên Postman hiện chỉ hỗ trợ simulation hẹp.
- Chưa đo coverage runtime, chưa xác nhận contract drift deployment hoặc tính đúng của DB thực tế. Báo cáo test cũ chỉ là tham khảo, không được tái sử dụng làm PASSED của vòng này.
- Endpoint kiểm kê dựa trên metadata source và fixture route; muốn khẳng định endpoint thực tế phải đối chiếu deployment được phép. Không truy cập internet/provider để xác minh trong phạm vi lần này.
