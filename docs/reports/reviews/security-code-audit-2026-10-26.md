# Security code audit — LOHA PMS — 26/10/2026

## Executive summary

Đã thực hiện review bảo mật tĩnh trên toàn bộ cây repository, đi sâu các ranh giới tin cậy của frontend, Flask API, PostgreSQL, tenant, session, thanh toán, webhook và cấu hình triển khai. Không truy cập production, domain, VPS, tài khoản Cloudflare hoặc sử dụng credential để thử truy cập dịch vụ.

**Kết quả phải được đọc cùng giới hạn:** review nguồn độc lập tìm được hai vấn đề mức Medium tại commit bắt đầu audit. Cả hai đã được một commit khác sửa trong lúc audit chạy; đối chiếu nguồn và kiểm tra cô lập cho thấy các thay đổi khắc phục đúng hai đường lỗi đã xác định. Chưa có bằng chứng đủ để báo cáo Critical/High trong các luồng đã review. Đây không phải chứng nhận repository an toàn tuyệt đối.

**Codex Security Deep Scan đã thực sự chạy nhưng thất bại, coverage partial.** Không có lượt review độc lập hoàn tất được plugin ghi nhận; không thể coi danh sách findings rỗng của plugin là kết quả quét sạch. Báo cáo này là tổng hợp review nguồn và test cục bộ độc lập, có phân biệt với trạng thái plugin.

| Snapshot | Mục đích |
| --- | --- |
| `077fe1a5a978026f7b2d8a048dda5ff05eedc881` | Commit `main` lúc bắt đầu; nguồn của hai phát hiện và target của Deep Scan. |
| `378583e3e9522f86d3c1550d19f6dba700010f2b` | `main` khi kết thúc đối chiếu; đã đổi thứ tự limiter và cập nhật Vite. Chỉ bốn file khác snapshot đầu. |

Ban đầu checkout mang tên `codex/channex-rate-safety` nhưng HEAD bằng chính xác `main`, cây làm việc sạch. Sau đó checkout chuyển sang `main` và xuất hiện commit khắc phục nêu trên từ công việc khác. Audit này không tạo commit khắc phục đó. Theo yêu cầu bổ sung của chủ repository, chỉ tài liệu báo cáo và mục lục được ghi/commit/push bởi công việc audit.

| Mức độ | Phát hiện tại snapshot đầu | Trạng thái tại `378583e` |
| --- | ---: | --- |
| Critical | 0 có đủ bằng chứng | Không có kết luận đầy đủ từ Deep Scan. |
| High | 0 có đủ bằng chứng | Không có kết luận đầy đủ từ Deep Scan. |
| Medium | 2 | Đã khắc phục đường lỗi trong nguồn; runtime/deployment chưa xác minh. |
| Low | 0 được lập thành finding | Các điểm hardening/chưa đủ bằng chứng nằm riêng bên dưới. |

## Công cụ, skill và tính trung thực của kết quả

- **Codex Security:** ban đầu chưa cài; sau yêu cầu cài bổ sung đã xác nhận installed/enabled và đọc `security-scan`, `deep-security-scan` cùng hướng dẫn source review/storage. Đã gọi `start_codex_security_deep_scan` cho toàn repository; người dùng cho phép báo cáo/trạng thái được lưu ngoài repo. Plugin phiên bản `0.1.32`.
- **Trạng thái scan:** ID `a5bc9ec0-072b-4f31-bdd4-c0a559efd492`, target `077fe1a5`, status `failed`, coverage `partial`. Context đã được đọc sau lỗi: **0 finding được plugin xác nhận**, **1 candidate đang chờ xác minh** về bucket đăng nhập dùng chung qua proxy. Không gọi completion hoặc khởi chạy scan thay thế sau lỗi.
- **Lỗi nguyên văn:** `Deep Scan stopped after 3 consecutive unsuccessful discovery workers (limit: 3); last failure (transient_error): exceeded retry limit, last status: 429 Too Many Requests`.
- **Daybreak:** kiểm tra trả `not_granted`; đây là cảnh báo về hiển thị kết quả được bảo vệ, không phải bằng chứng nguyên nhân của lỗi 429.
- **Cloudflare Skills:** có sẵn, đã đọc và áp dụng cho việc xác định bề mặt Cloudflare/edge trong repo. Không gọi Cloudflare API/CLI hoặc scan tài khoản. Không tìm thấy Worker, Wrangler, Terraform hay policy Cloudflare để kiểm tra trực tiếp.
- **Review độc lập:** ba nhánh review theo auth/tenant/admin, channels/webhook, frontend/hạ tầng/dependency; thêm lượt kiểm tra nghiệp vụ và đối chiếu của agent chính. Đã dùng hướng dẫn Security Hardening, Ponytail Audit và đọc Postman API Engineer; tái sử dụng API contract có sẵn, không chạy Postman collection trên dịch vụ thật, không tạo hoặc push workspace Postman.
- **Graphify:** chỉ đọc báo cáo/graph có sẵn làm tham khảo kiến trúc. Graph ghi ngày 02/10/2026, cũ hơn nguồn hiện tại; không dùng làm bằng chứng an ninh hiện hành và không chạy lệnh tạo cache.

## Phạm vi và kiến trúc

Inventory snapshot đầu có **786 tracked files**, **232 file Python**, **211 file JS/JSX/TS/TSX trong frontend** (gồm tests/scripts). Quét pattern trên **653 file văn bản tracked**; inventory frontend riêng có 265 JS/JSX/CSS, trong đó 159 JS/JSX runtime. Những số này là inventory/search coverage, **không có nghĩa mọi dòng của từng file đều được đọc thủ công**.

Luồng dữ liệu chính:

1. Browser React/Vite SPA nhận input của người dùng, giữ cookie session qua trình duyệt và CSRF trong bộ nhớ; API request mang tenant ID và resource ID.
2. Flask đăng ký class-based routes; middleware xác thực session phía server, kiểm tra Origin/CSRF và action, thiết lập transaction-local PostgreSQL context.
3. Service/handler dùng SQLAlchemy/bind parameters, tenant predicates, row/advisory locks; PostgreSQL bổ sung RLS, composite foreign keys và append-only triggers.
4. Channex webhook là điểm vào không có user session, được bảo vệ bằng secret tenant/property; job lấy dữ liệu chuẩn từ provider thay vì nhập booking trực tiếp từ body webhook.
5. Worker có quyền service riêng, kiểm tra lại actor/entitlements khi cần; outbound HTTP đi tới các base HTTPS Channex cố định. CLI/scripts là trust boundary quản trị local, tách khỏi HTTP routes.
6. Production frontend được tài liệu hóa là static Nginx/Coolify; Vite proxy là cấu hình development. Reverse proxy/Tunnel và các chính sách edge thực tế nằm ngoài repo.

| Khu vực | Nội dung đã kiểm tra |
| --- | --- |
| Identity và middleware | `auth/routes.py`, URL registration, `security.py`, `config.py`, identity/session models, session lifecycle, CSRF, CORS, cookie, limiter, error/transaction handling. |
| Authorization và tenant | `require_tenant`, `require_system`, workspace, subscriptions, admin/customer/feature routes, SaaS billing, RLS helpers và migrations identity/0034/0035/0036; tham chiếu thêm các migrations/constraints của module liên quan. |
| Booking/catalog/report | Resource lookups, guest/room/fund references, idempotency, tiền/hoàn tiền, redaction, settings validation, report filters và serialization. |
| Finance/inventory/pricing | POS/cashbook/commission, stock documents/movements/recipes, reconciliation, vouchers/exchange snapshots; authorization, tenant references, locks, bounds, replay. |
| Housekeeping/notifications | Assignment ownership, inspection role, worker identity, recipient filtering, inbox ownership và batch limits. |
| Channels/integration | Toàn bộ 13 file `channels/` và các helper admin Channex/Airbnb; HTTP client, credentials, mapping/importer, jobs/receipts, callback state, authoritative fetch và logs. |
| Frontend | Quét sink toàn frontend; đọc sâu API client/provider, route/login guards, storage, HTML/CSV exports, DOM translation, Airbnb return, build/chunk recovery và config. |
| Hạ tầng và supply chain | Dockerfile, Gunicorn, ignore files, CI workflow, start scripts, PostgreSQL local/restore/CI helpers, package scripts, npm lockfile và Python pins, Postman mock/config. |
| Secrets và tài liệu | Pattern scan file văn bản, phân loại context của các hit; đọc `document.xml` của 4 DOCX trong bộ nhớ. Không xác lập được secret thật bị hardcode từ các hit đã kiểm tra. |

## Phát hiện có bằng chứng

### SEC-01 — Medium — IP đã bị chặn vẫn tạo counter email bền vững

**Phân loại:** CWE-770, uncontrolled resource allocation. **Xác minh:** Confirmed ở luồng nguồn tại `077fe1a5`; cạn disk/DoS thực tế chưa đo tải. **Hiện trạng:** đường bypass limiter đã được sửa tại `378583e`, được kiểm tra cô lập; chưa xác minh triển khai.

**Bằng chứng snapshot đầu:**

- [`backend/pms_api/auth/routes.py:80–95`](https://github.com/xuanloc11/pms-system/blob/077fe1a5a978026f7b2d8a048dda5ff05eedc881/backend/pms_api/auth/routes.py#L80): `count_attempt` thực hiện PostgreSQL `INSERT ... ON CONFLICT`, key là digest; email chưa có trong database vẫn tạo row.
- [`auth/routes.py:107–115`](https://github.com/xuanloc11/pms-system/blob/077fe1a5a978026f7b2d8a048dda5ff05eedc881/backend/pms_api/auth/routes.py#L107): `g.commit_on_error = True`, tăng counter email trước counter IP; quá ngưỡng trả 429, lookup user diễn ra sau đó.
- [`backend/pms_api/security.py:238–241`](https://github.com/xuanloc11/pms-system/blob/077fe1a5a978026f7b2d8a048dda5ff05eedc881/backend/pms_api/security.py#L238): response lỗi vẫn commit khi `commit_on_error` được bật.
- [`backend/pms_api/core_models.py:78–82`](https://github.com/xuanloc11/pms-system/blob/077fe1a5a978026f7b2d8a048dda5ff05eedc881/backend/pms_api/core_models.py#L78): `LoginAttempt` được lưu bền vững; cửa sổ 15 phút reset counter nhưng không xóa các key cũ. Không tìm thấy tác vụ prune trong nguồn đã tra cứu.

```python
# Tại 077fe1a5, sau khi đã bật commit_on_error:
limited = count_attempt("email:" + email) > 10
limited = count_attempt("ip:" + (request.remote_addr or "unknown")) > 60 or limited
```

**Attack path và điều kiện:** người chưa đăng nhập gọi `POST /api/auth/login`, đổi email hợp lệ về cú pháp mỗi request. Dù cùng IP đã vượt ngưỡng 60, mỗi email mới vẫn tạo row rồi được commit cùng response 429. Không cần tài khoản tồn tại, session hoặc nhiều IP. Client HTTP trực tiếp có thể không gửi Origin; một lớp edge độc lập có thể giảm lưu lượng nhưng không được chứng minh từ repo.

**Tác động:** số row/index/WAL tăng theo input tùy ý, kèm tranh chấp trên counter IP; đủ lưu lượng có thể tăng chi phí hoặc ảnh hưởng tính sẵn sàng của database/API. Không khẳng định đã xảy ra cạn disk hoặc có throughput khai thác cụ thể.

**Khắc phục đã có trong nguồn:** [`auth/routes.py:108–110` tại `378583e`](https://github.com/xuanloc11/pms-system/blob/378583e3e9522f86d3c1550d19f6dba700010f2b/backend/pms_api/auth/routes.py#L108) kiểm tra IP trước và chỉ tạo/tăng email counter khi IP chưa bị chặn. Kiểm tra AST thật với counter RAM, preload IP=60 rồi gọi 1.000 email khác nhau: bản cũ tạo 1.000 key email; bản mới tạo **0**; cả hai trả 429.

**Test/việc còn lại:** commit mới đã thêm [`test_blocked_ip_cannot_create_or_increment_email_counters`, `backend/tests/test_identity.py:135`](https://github.com/xuanloc11/pms-system/blob/378583e3e9522f86d3c1550d19f6dba700010f2b/backend/tests/test_identity.py#L135). Test PostgreSQL này chưa chạy trong audit. Cần chạy trên DB test chuyên dụng, kiểm tra concurrency và chính sách TTL/prune; bản sửa giới hạn cardinality từ một IP trong mỗi cửa sổ, không tự cung cấp retention cho key cũ.

### SEC-02 — Medium — Vite development dependency thuộc dải có lỗi đọc file

**Phân loại:** CWE-22/CWE-200; vulnerable dependency. **Xác minh:** Confirmed về version/advisory tại `077fe1a5`; **Needs Verification về khả năng khai thác môi trường thực tế**. **Hiện trạng:** đã khóa bản sửa tại `378583e`; chưa kiểm tra package đang chạy trên máy khác/preview.

**Bằng chứng:** [`frontend/package-lock.json:2303–2307` tại snapshot đầu](https://github.com/xuanloc11/pms-system/blob/077fe1a5a978026f7b2d8a048dda5ff05eedc881/frontend/package-lock.json#L2303) khóa Vite `8.2.2`, `dev: true`; [`frontend/package.json:10,37`](https://github.com/xuanloc11/pms-system/blob/077fe1a5a978026f7b2d8a048dda5ff05eedc881/frontend/package.json#L10) có script `dev: vite` và range `^8.2.2`.

Hai advisory chính thức đã mở và đối chiếu:

| Advisory | Dải liên quan snapshot | Bản sửa cùng nhánh | Điều kiện/tác động |
| --- | --- | --- | --- |
| [CVE-2026-112947 / GHSA-vfpm-58rq-9qcg](https://github.com/vitejs/vite/security/advisories/GHSA-vfpm-58rq-9qcg) | `8.2.0–8.2.3` | `8.2.4` | Request qua WASM module có thể làm lộ 4 byte đầu của file ngoài giới hạn filesystem; cần đánh giá khả năng tiếp cận dev server và dữ liệu nhạy cảm trong các byte đó. |
| [CVE-2026-112946 / GHSA-rq7h-c2jc-7f22](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22) | `8.2.0–8.2.3` | `8.2.4` | Có thể trả file host ngoài allowlist khi import project trùng đường dẫn tuyệt đối trên host, file không bị deny và server không chạy Windows. |

**Attack path:** attacker tiếp cận Vite dev server bị ảnh hưởng, gửi request đánh vào đường xử lý file, vượt giới hạn filesystem theo điều kiện của từng advisory. Advisory thứ nhất chỉ chứng minh rò rỉ bốn byte; không coi đó là đọc toàn bộ secret.

**Counterevidence:** [`frontend/vite.config.js:7`](../../../frontend/vite.config.js#L7) chỉ có proxy API, không có cấu hình chủ động mở `server.host`; script mặc định không có `--host`. Máy audit là Windows. [`frontend/README.md:13–35`](../../../frontend/README.md#L13) hướng dẫn production là static Nginx. Không có bằng chứng production chạy Vite hoặc đáp ứng điều kiện import của advisory thứ hai; không báo thành lỗi đọc file production đã xác nhận.

**Khắc phục đã có:** manifest và lockfile ở `378583e` đã cùng chuyển Vite sang `^8.2.4`/`8.2.4`; đối chiếu JSON bằng assert đạt. Cần giữ development server ở loopback và triển khai lại toolchain của các môi trường dùng bản cũ.

**Test cần thêm:** kiểm tra build/test sau clean install đã khóa; trên máy cô lập dùng file fixture không nhạy cảm ngoài root để xác minh response không lộ dữ liệu. Audit không cài dependency, khởi động Vite hoặc chạy PoC đọc file.

## Needs Verification và hardening — chưa coi là lỗ hổng xác nhận

| ID | Bằng chứng và proof gap | Việc xác minh/khắc phục đề xuất |
| --- | --- | --- |
| NV-01 — proxy/shared login bucket | `auth/routes.py:108` dùng trực tiếp `request.remote_addr`; app factory không có lớp chuẩn hóa IP tin cậy. Tài liệu hỗ trợ Tunnel/proxy. Nếu WSGI chỉ thấy peer proxy chung, một client có thể dùng hết bucket đăng nhập của các client khác. Đây cũng là candidate duy nhất plugin lưu, chưa validate. | Kiểm tra offline cấu hình proxy/Gunicorn và test local qua proxy đáng tin cậy: hai client có bucket riêng; header giả không đổi được IP. Chỉ áp dụng forwarded headers với đúng proxy chain, không tin header tùy ý. Không xác nhận có lỗi deployment khi chưa có cấu hình thực. |
| NV-02 — stock report tải toàn lịch sử | `backend/pms_api/inventory/routes.py:1021–1056` tải movement của tenant rồi tổng hợp trong Python, kể cả query có ngày. Caller cần quyền `inventory.view`; có tenant filter. Chưa có dữ liệu/lưu lượng để chứng minh DoS. | Benchmark trên dataset tổng hợp, đo RAM/latency và concurrency; cân nhắc SQL aggregation/date filters hoặc snapshot. Không xếp severity bảo mật chỉ từ một query không phân trang. |
| NV-03 — retention limiter/session | Các key counter không tự bị xóa; timestamp reset không phải TTL xóa row. Sau bản sửa vẫn cần chính sách lifecycle theo số client/thời gian vận hành. Chưa chứng minh có nguồn tấn công vượt limiter hiện tại. | Bổ sung retention/prune và test expiry trên DB test; xem xét store TTL dùng chung. Không nhập chung việc này với xác nhận đường bypass đã sửa. |
| NV-04 — edge/deployment | Không có policy Cloudflare, TLS, WAF, Access, cache, CSP/HSTS hoặc cấu hình Nginx đầy đủ trong nguồn. Docs không chứng minh trạng thái triển khai. | Chủ hệ thống review cấu hình được xuất hoặc cấu hình staging theo quyền riêng; kiểm tra no-store dữ liệu nhạy cảm, origin exposure, trusted proxy và edge limits. Audit này không truy cập account/domain để xác minh. |

## Các biện pháp bảo vệ đã có và candidate đã loại

- **Authentication/session/CSRF:** token ngẫu nhiên, chỉ lưu hash phía server; thời hạn 8 giờ hoặc 7 ngày; cookie HttpOnly/SameSite=Lax/Secure ở production. Mutation kiểm tra Origin và CSRF constant-time. Không dùng JWT trong luồng session đã kiểm tra; không áp dụng checklist thuật toán JWT cho một cơ chế không tồn tại.
- **Authorization/tenant:** tất cả business views được inventory đều có `require_tenant`/`require_system` hoặc guard channels tương ứng. Membership/action được kiểm tra, mutation kiểm tra lại sau tenant lock. RLS dùng active user/membership và transaction-local context; composite foreign keys hỗ trợ tenant isolation. SaaS admin không tự có quyền đọc PMS; quyền service là nhánh riêng.
- **Privacy/serialization:** housekeeping workspace redacts guest/phone/giá/thanh toán; helper room-stays chỉ trả room/start/end. Notification lookup có cả tenant và recipient. Feature flags không phải ranh giới bảo mật dữ liệu theo `backend/API_CONTRACT.md:564–566`; việc workspace trả dataset của module bị tắt không được báo là access-control bypass.
- **Money:** booking/POS/refund/fund references có tenant predicate, idempotency gắn actor/path/method/body, khóa dòng/quỹ, chặn vượt mức và giữ ledger append-only. Quyền Front Desk với payment/refund là contract đã nêu, không tự xem là leo quyền.
- **Webhook:** secret tenant tối thiểu 32 ký tự và constant-time compare; body cap 16 KiB, kiểm tra property. Payload chỉ tạo job để fetch dữ liệu chuẩn từ provider. Job/receipt dedupe theo tenant/revision, queue coalescing và cap 500. Không có timestamp/HMAC body, nhưng không đủ căn cứ báo giả mạo booking/replay mutation khi các control này có hiệu lực; secret bị lộ/rotation thực tế chưa kiểm tra.
- **SSRF/outbound:** HTTPS bases Channex cố định, UUID path validation, cấm redirect, timeout và response cap 2 MiB; không thấy đường URL tùy ý của user đi vào HTTP client. Airbnb link allowlist HTTPS/host/port; state bound session hash, actor/tenant/property/environment và expiration.
- **Secrets/logs:** credentials tích hợp mã hóa Fernet với context tenant/environment/property; lỗi ciphertext không fallback. API/log trả mã trạng thái được lọc; không thấy đường trả khóa. Các hit hardcoded đã kiểm tra là fixture/dummy/CI ephemeral hoặc tên field, không có bằng chứng đủ để báo credential thật bị commit. Không thử tính hợp lệ bằng gọi dịch vụ.
- **Injection/RCE/filesystem:** source search và truy vết các sink không xác lập SQL/NoSQL injection, shell injection, unsafe deserialization, path traversal HTTP hoặc RCE trong luồng đã review. SQL runtime dùng binds/ORM; dynamic identifiers ở migration/scripts có validation hoặc Identifier/Literal; subprocess quản trị dùng argument arrays. Không có bằng chứng NoSQL datastore trong repo.
- **XSS/CSV:** HTML exports escape input trước `document.write`, opener được ngắt; raw HTML ở modal là CSS constant; DOM translation ghi text/attribute allowlist. CSV có neutralize formula prefix. React render mặc định không đủ để tự kết luận mọi sink an toàn, nên các sink trên đã được đọc riêng.
- **Infrastructure:** Docker chạy UID không phải root, bỏ `.env`; CI token `contents: read`, không thấy `pull_request_target`/PR-input shell interpolation. DB CI cô lập loopback; package scripts/lockfiles không có bằng chứng mã độc. Không có compose, Nginx deployment config đầy đủ hoặc infrastructure-as-code để review các lớp không được lưu trong repo.
- **Advisory false positives đã loại:** các bản pin Flask `3.1.3`, Werkzeug `3.1.9`, happy-dom `21.0.4` bằng các bản sửa đã đối chiếu; không có RSC/server-dom endpoint để áp React RSC RCE; không có custom Vite middleware/`transformIndexHtml` phù hợp advisory XSS. Những loại trừ này không thay cho việc match toàn bộ dependency graph.

## Kiểm tra thực sự đã chạy

**109 test hiện có đạt, 0 lỗi**, qua ba nhóm an toàn; không khởi động app kết nối DB hoặc gọi provider thật:

| Nhóm | Kiểm tra | Kết quả |
| --- | --- | --- |
| Channels | `python -B -m unittest tests.test_channels_client tests.test_channel_source` | 31 passed; mocked transport/source helpers. |
| Business values/helpers | `tests.test_finance_values`, `test_inventory_values`, `test_pricing_values`, `test_reconciliation_unit`, `test_housekeeping_values`, `test_housekeeping_day_selection`, `test_housekeeping_shift_creation`, `test_housekeeping_auto_assignment` | 33 passed; không DB/network. |
| Frontend | `node --test` với `csv.test.js`, `bookingDocument.test.js`, `billingDocument.test.js`, `api.test.js`, `airbnbReturn.test.js` | 45 passed, 0 skip. |
| Control-flow regression | Trích AST thật của `LoginView`/email validator ở hai revision, counter RAM, IP đã bị chặn, 1.000 request mỗi bản | Cũ tạo 1.000 key; mới 0; mọi response 429. Không xác minh hành vi PostgreSQL. |
| Dependency fix | JSON assert manifest/lock Vite ở `378583e` | Cùng version đã sửa `8.2.4`. |

Các test hiện có ở ba nhóm chạy trong review ban đầu. Kiểm tra AST so sánh và lockfile được chạy lại trên commit khắc phục. Không gán kết quả này cho full suite hoặc cho test integration mới chưa chạy. Cây nguồn vẫn sạch trước khi tạo báo cáo.

## Chưa kiểm tra và độ đầy đủ

- Deep Scan không hoàn tất; không có canonical successful scan/report để công bố. Báo cáo lỗi/partial của plugin được giữ ngoài repository, không thay đổi hoặc gắn nhãn thành công.
- Không chạy full PostgreSQL integration, RLS runtime, race/concurrency, test login-counter mới hoặc load tests vì chúng thay đổi DB. Không đọc `.env` thật hoặc dùng test URL từ môi trường để tránh truy cập nhầm.
- Không phân tích pháp chứng 2 PDF/123 PNG; DOCX chỉ kiểm tra XML văn bản cho credential terms, không phân tích embedded objects. Không audit toàn lịch sử Git, ignored files, binary dependency contents hoặc dependency install scripts từ registry.
- Không match được toàn bộ graph với OSV: yêu cầu querybatch chỉ chứa package/version thất bại với `fetch failed`. Đã đối chiếu advisory chính thức có liên quan, không khẳng định không còn CVE khác.
- Không kiểm chứng production image, package thực được deploy, DB role thực tế, applied migrations, reverse proxy, edge headers, WAF/rate limit, Cloudflare TLS/Access hoặc secret rotation.
- Review sâu tập trung trust boundaries và đường dữ liệu có tác động cao; broad search/inventory không phải bảo đảm đã audit đầy đủ từng dòng của cả 786 file.
- Không có số liệu token tổng đầy đủ cho Deep Scan thất bại; không ước lượng thành 0 hoặc gán usage của review độc lập cho plugin.

## Remediation plan theo thứ tự ưu tiên

1. **Xác minh bản sửa đã đến môi trường dùng thật:** source `378583e` đã chặn tạo email counter sau IP limit và khóa Vite `8.2.4`. Chạy regression PostgreSQL mới trên DB test riêng, clean install/build/test toolchain, rồi xác minh revision/package của môi trường triển khai theo quy trình riêng.
2. **Kiểm tra proxy và lifecycle auth:** test trusted client-IP separation/spoofing ở staging local; bổ sung retention/prune cho counters và dữ liệu session hết hạn khi có policy thống nhất.
3. **Đóng khoảng trống xác minh:** thực hiện một lần Deep Scan mới trong công việc tiếp theo khi dịch vụ/usage cho phép; match dependency graph đầy đủ và chạy RLS/tenant/concurrency integration trong môi trường cô lập. Không coi cần thiết quét lại production để hoàn thành các bước này.
4. **Đánh giá capacity có số đo:** benchmark stock-report và các snapshot trên dữ liệu tổng hợp lớn; chỉ đổi query/aggregation khi có bằng chứng về giới hạn cần đáp ứng.
5. **Review cấu hình triển khai ngoài repo:** kiểm tra policy Cloudflare/proxy/TLS/cache và secret rotation từ cấu hình được chủ hệ thống cung cấp hoặc môi trường staging được cho phép. Không suy diễn các control đó từ hướng dẫn README.

Không tự động sửa source, nâng dependency hoặc thay đổi database trong công việc audit này. Kết quả được giới hạn bởi snapshot, những test đã thực hiện và coverage partial nêu trên.
