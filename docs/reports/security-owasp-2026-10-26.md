# Rà soát bảo mật và OWASP Top 10 — 26/10/2026

Nhánh: `codex/owasp-security-audit`, từ `main` tại `378583e`.
Đối chiếu [OWASP Top 10:2025 cho ứng dụng web](https://top10.owasp.org/2025/).
Đây là kết quả rà mã và kiểm thử các tình huống cụ thể, không phải chứng nhận toàn bộ hệ thống an toàn.

## Phạm vi và ranh giới tin cậy

- Trình duyệt → cookie/CSRF → quyền người dùng/khách sạn → PostgreSQL RLS.
- Webhook và Channex → xác thực, property ID, giải mã JSON → worker → booking/tài chính.
- Dữ liệu khách sạn/khách lưu trú → React, chứng từ HTML, CSV và URL ảnh.
- Mã nguồn, lockfile, công cụ build và cấu hình CI/container có trong repository.

Tài sản cần bảo vệ: tài khoản, khóa OTA, dữ liệu cá nhân của khách, dữ liệu giữa các khách sạn,
tồn phòng và tính toàn vẹn giao dịch. Kiểm thử database dùng cơ sở dữ liệu tạm riêng,
runtime không phải superuser, múi giờ UTC; không sử dụng database nghiệp vụ.

## Phát hiện mới đã sửa

| Mã | Mức độ | Tình huống tái hiện và tác động | Bản sửa và bằng chứng |
| --- | --- | --- | --- |
| SEC-01 | Trung bình | JSON khoảng 200 KB với 100.000 tầng lồng nhau vượt giới hạn decoder dù nhỏ hơn giới hạn body; `RecursionError` thoát khỏi bộ đọc request, gây lỗi 500. | `common/http.py` trả lỗi `invalid_json` 422. Test mới trong `test_common_http.py` thất bại trước sửa, đạt sau sửa. |
| SEC-02 | Trung bình | JSON OTA lồng quá sâu làm thoát lỗi khỏi worker; `NaN`, `Infinity`, `-Infinity`, `±1e999` được decoder chấp nhận ở cả metadata. | `channels/client.py` từ chối số không hữu hạn và chuyển lỗi decoder thành `provider_invalid_response`; giữ nguyên kiểu int/float hợp lệ. |
| SEC-03 | Trung bình | Phản hồi HTTP có status hỏng hoặc body bị cắt gây `BadStatusLine`/`IncompleteRead` ngoài đường xử lý lỗi, có thể dừng lượt worker. | Chuyển lỗi giao thức thành `provider_unavailable` có thể thử lại, không đưa nội dung phản hồi vào lỗi trả ra. |
| SEC-04 | Trung bình | Timestamp năm 0001/+23:59 hoặc 9999/-23:59 gây tràn khi chuyển UTC ở importer và trang hỗ trợ OTA. | Hai biên xử lý bắt `OverflowError`, trả lỗi sẵn có. Test tích hợp xác nhận đúng hai job bị đánh dấu lỗi, không tạo booking hoặc ACK revision. |
| SEC-05 | Thấp | Các lần đăng nhập/CSRF/phân quyền bị từ chối không có log ứng dụng mang mã lỗi, làm giảm khả năng phát hiện và điều tra. | Ghi `security_denied` cho 401/403/429 với mã lỗi, endpoint, phương thức và actor ID. Test xác nhận không ghi body, email, mật khẩu, query secret, bearer token hoặc CSRF token; request lỗi rollback và không commit. |

Mức độ là đánh giá từ đường gọi và tác động đã chứng minh. Các lỗi OTA cần dữ liệu nhà cung cấp
bất thường; không có bằng chứng từ các bài thử này rằng người dùng thường có thể chiếm quyền hệ thống.

## Đối chiếu đủ 10 nhóm OWASP 2025

| Nhóm | Kiểm tra/bằng chứng | Kết luận trong phạm vi |
| --- | --- | --- |
| A01 — Kiểm soát truy cập | Liệt kê toàn bộ route: 191 quy tắc được bảo vệ, 270 kiểm tra phương thức đều từ chối yêu cầu chưa đăng nhập. Kiểm tra HEAD/giả phương thức, RLS, tenant khác, quyền SaaS/PMS, PII buồng phòng, thu hồi quyền trong phiên đang dùng. | Không tái hiện vượt quyền trong các đường đã thử. Webhook và danh mục gói công khai được kiểm tra theo chính sách riêng. |
| A02 — Cấu hình bảo mật | CORS exact-origin, production không đọc `.env`, debug tắt, cookie HttpOnly/Secure/SameSite và thời hạn, lỗi readiness không lộ kết nối. | Các kiểm soát được thử đạt; TLS, CSP, chống nhúng trang và header thực tế của frontend chưa xác minh được từ repository. |
| A03 — Chuỗi cung ứng phần mềm | npm audit theo lockfile; pip-audit cho ứng dụng và bộ quét riêng; hash wheel Python, chữ ký registry/attestation, Actions SHA và image digest. | CI đã chặn lifecycle scripts, kiểm tra hash và tự audit. Công cụ pip có advisory được nâng lên 26.2.2. |
| A04 — Mật mã | Password hash, session token hash, CSRF so sánh hằng thời gian, credential Fernet gắn với tenant, cookie production và URL HTTPS cố định. | Không thấy lỗi mật mã được chứng minh trong mã đã đọc và các bài thử credential/session. Quản lý khóa và TLS production ngoài phạm vi. |
| A05 — Injection | SQL dùng tham số; SQL tên bảng migration có regex allowlist. Payload thoát `title`, script/SVG/event handler trong chứng từ; CSV formula sau ký tự điều khiển/khoảng trắng; URL logo nguy hiểm. | Các payload đã thử không thực thi mã hoặc trở thành công thức; không tái hiện SQLi/XSS. |
| A06 — Thiết kế thiếu an toàn | Session fixation/rotation, CSRF giữa phiên, login CSRF, IP chuyển tiếp giả, cửa sổ rate limit; kiểm tra idempotency và ranh giới quyền/khách sạn. | Các tình huống đã thử đạt. Chưa thử tải lớn hoặc mô phỏng mạng bot phân tán. |
| A07 — Xác thực | Cookie cũ bị thu hồi khi login lại, CSRF token gắn phiên, hết hạn phiên, logout, đổi mật khẩu/thu hồi phiên; anonymous route inventory. | Không tái hiện bypass xác thực trong các bài thử. |
| A08 — Toàn vẹn dữ liệu/phần mềm | Secret webhook sai/không ASCII/property khác không tạo job; dữ liệu OTA sai không import/ACK; URL redirect không chuyển credential; kiểm tra integrity/chữ ký package. | Đã sửa SEC-02 và SEC-04; các biên toàn vẹn được thử đạt. |
| A09 — Log và cảnh báo bảo mật | Audit lịch sử nghiệp vụ, bộ lọc nhật ký, append-only/RLS; log từ chối 401/403/429 không chứa secret. | Đã sửa SEC-05. Lưu trữ log ngoài máy, cảnh báo và quy trình phản ứng chưa được xác minh. |
| A10 — Xử lý ngoại lệ | JSON quá sâu, số không hữu hạn, phản hồi HTTP lỗi/cụt, tràn timestamp; lỗi DB và rollback. | Đã sửa SEC-01 đến SEC-04 và nợ `flush`: giữ lỗi gốc, không chạy câu SQL đổi scope sau lỗi, chỉ phục hồi sau rollback. |

## Các điểm còn lại

1. **Hosting và giám sát — chưa kiểm chứng:** không có cấu hình hosting frontend/proxy thực tế
   trong repo để xác nhận TLS, CSP, HSTS, `frame-ancestors`/X-Frame-Options, header và alerting.
   Cần kiểm tra trên môi trường triển khai khi có URL/cấu hình đích.
2. **Bảo trì bản ghim:** Dependabot mở đề xuất hằng tuần cho npm, pip, GitHub Actions và Dockerfile.
   Digest PostgreSQL nằm trong lệnh shell CI và phiên bản Node/Python cố định cần được cập nhật
   thủ công khi có bản vá; không tự chuyển về tag trôi hoặc bỏ kiểm tra hash để vượt lỗi cài đặt.

## Gia cố CI/chuỗi cung ứng và xử lý lỗi tiếp theo

- `set_context` flush trước khi chuyển scope và cho ngoại lệ gốc đi qua. Hai test mới chứng minh
  lỗi không bị nuốt, không chạy SQL chuyển scope, và lỗi PostgreSQL duplicate email vẫn là
  `IntegrityError`; rollback xong mới chuyển scope an toàn.
- CI cập nhật installer từ `requirements-installer.txt` có hash, tạo venv riêng cho pip-audit,
  rồi audit cả `requirements-dev.txt` (gồm runtime) và `requirements-audit.txt`. Bất kỳ phát hiện
  Python hoặc lỗi thu thập dependency đều làm bước audit thất bại; không dùng ignore/continue-on-error.
- `pip` 26.1.2 trong bộ công cụ ban đầu bị phát hiện advisory
  [PYSEC-2026-3721](https://github.com/pypa/advisory-database/blob/main/vulns/pip/PYSEC-2026-3721.yaml).
  Khóa lại bản 26.2.2 và bootstrap nó trước khi cài app/công cụ trong CI và Docker.
- Các file `requirements*.txt` bật `--require-hashes` và `--only-binary=:all:`: chỉ nhận wheel
  đã phê duyệt, không chạy build từ sdist. `psycopg-binary` đã là dependency qua extra `binary`,
  nay được ghim rõ cùng phiên bản 3.3.6. Không nâng phiên bản thư viện ứng dụng.
- `frontend/.npmrc` chặn lifecycle scripts; CI lặp lại `npm ci --ignore-scripts`, chặn npm advisory
  mức high/critical và kiểm tra chữ ký registry. CI dùng Node 24.18.0/npm 11.16.0, Python 3.14.6.
- Actions được ghim SHA commit đầy đủ, checkout không lưu credential. Hai image Python/PostgreSQL
  được ghim digest OCI index đa kiến trúc, xác minh từ Docker Hub, registry và SHA-256 của manifest.
  Không tăng quyền GitHub token; giữ `contents: read` và toàn bộ gate lint/test/build đang có.

Sau khi duyệt việc đổi một phiên bản Python, chạy từ `backend`:

```powershell
python scripts/hash_requirements.py
python scripts/hash_requirements.py --check
```

Script chỉ làm mới hash wheel không bị yanked của đúng phiên bản đã ghi, từ PyPI chính thức;
không tự chọn hoặc nâng phiên bản. Nó xác minh tên/version/hash và lấy đủ metadata trước khi ghi
bất kỳ lockfile nào. Review diff hash, cài sạch và chạy test/audit trước khi merge.

Kiểm chứng lượt gia cố này:

- **65 kiểm thử backend chọn lọc đạt**, không bỏ qua, gồm auth/RLS, worker buồng phòng,
  OTA và publication; thêm hai bài về lỗi scope.
- **16 bài đạt trên venv Python 3.14.6 cài sạch bằng hash**, gồm scope, identity và ba test
  bộ sinh hash; không cộng trùng vào số 65 ở trên.
- **291 test frontend, lint và build đạt** sau `npm ci --ignore-scripts`; còn warning React/chunk đã có.
- Cài sạch Windows runtime/dev và audit tool thành công; `pip check` đạt. Wheel Linux x64/Python 3.14
  của cả app/dev và audit/installer tải thành công với hash; không biên dịch mã nguồn.
- Kiểm thử đối chứng: một postinstall fixture thật không chạy với `.npmrc`, chạy khi cố tình
  override trong fixture riêng; pip nhận hash hợp lệ và từ chối hash giả trong chế độ offline/dry-run.
- Audit ứng dụng và công cụ đã vá: không có lỗ hổng đã biết. npm audit: 0; 122 package có chữ ký
  registry được xác minh, 36 attestation được xác minh.
- Actionlint 1.7.12 (binary xác minh checksum release chính thức) và Ruff đạt. Docker/WSL không
  được cài trên máy này, nên chưa build/chạy container hoặc thực thi toàn workflow Linux/GitHub Actions.
  Branch protection/required checks là cấu hình GitHub ngoài repo, chưa xác minh trong lượt này.

Tham khảo: [pip secure installs](https://pip.pypa.io/en/stable/topics/secure-installs/),
[npm ignore-scripts](https://docs.npmjs.com/cli/v11/using-npm/config/#ignore-scripts),
[GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use).

## SAST và phụ thuộc

Ruff security rules (`--select S`) quét `backend/common` và `backend/pms_api`; sau khi sửa `flush`, còn 3 cảnh báo:

| Cảnh báo | Đánh giá |
| --- | --- |
| S105, `auth/urls.py` | Báo nhầm: `CHANGE_PASSWORD` là đường dẫn route, không phải mật khẩu. |
| S310, `channels/client.py` | Đã kiểm soát: host/scheme HTTPS cố định và không theo redirect. Test dùng urllib dispatch thật với 5 mã redirect × 2 đích, gồm metadata nội bộ; không có request thứ hai. |
| S608, `rls.py` | Đã kiểm soát: tên bảng được regex allowlist trước khi ghép; caller là migration, không nhận tên bảng HTTP. |

Quét phụ thuộc ban đầu lúc **16:29 ngày 26/10/2026 (UTC+07)**; lần quét lại sau gia cố được ghi ở trên:

- npm lockfile: **0 lỗ hổng đã biết**.
- pip-audit: **25 package, 0 lỗ hổng đã biết**, gồm `psycopg-binary` và Ruff.
- npm registry signatures: **122 package cài đặt được xác minh**, 36 attestation được xác minh;
  không có chữ ký invalid/missing trong tập đã kiểm tra.
- Toàn bộ **165 registry package entries** trong lockfile có integrity hash.
  Package optional không được cài trên nền tảng hiện tại không thuộc tập xác minh chữ ký.

## Kiểm thử và chạy lại

Thêm **26 bài kiểm thử mới** trên nhánh: 23 backend và 3 frontend. Lượt rà soát ban đầu có
21 bài; lượt gia cố thêm 2 bài lỗi scope và 3 bài bộ sinh hash. Ngoài số bài, route inventory
có 270 lần kiểm tra phương thức và các payload được chạy theo bảng tình huống.
Không bỏ qua test hoặc sửa test để che các phát hiện.

Kết quả lượt rà soát ban đầu (kết quả gia cố tiếp theo được ghi ở trên):

- **202/202 kiểm thử backend chọn lọc đạt**, không bỏ qua, chạy trong 204,309 giây.
  Bao gồm các bài mới và hồi quy về auth/RLS, SaaS/PMS, credential/webhook, import,
  client HTTP, JSON, cấu hình, PII, audit và idempotency.
- **291/291 kiểm thử frontend đạt**, không bỏ qua; có 3 bài payload bảo mật mới.
- Ruff backend và lint frontend đạt; lint frontend còn các warning React đã có.
- Các bài tái hiện JSON/HTTP/timestamp lỗi đã được chạy thất bại trước sửa và đạt sau sửa.
  Kiểm thử timestamp worker được tăng cường để không thể đạt khi danh sách job rỗng,
  rồi chạy lại riêng thành công.
- Rà soát độc lập không tìm thấy vấn đề cần chặn trong các bản sửa ban đầu. Không thêm suppression.
  Lượt gia cố tiếp theo thêm bộ audit cô lập và hash, không thêm thư viện runtime ứng dụng.

Các test mới được cơ chế unittest discovery/node test hiện có thu thập khi CI chạy.
Audit phụ thuộc tự động đã được thêm trong lượt gia cố tiếp theo.

Từ thư mục `backend`, với `TEST_DATABASE_URL`/`TEST_DATABASE_MIGRATION_URL` trỏ đến database
kiểm thử riêng đã được cấp quyền như hướng dẫn của dự án:

```powershell
python -m unittest -v tests.test_security_boundaries tests.test_security_http tests.test_channel_security tests.test_identity tests.test_client_profile tests.test_system_tenant_scope tests.test_tenant_authorization_race tests.test_admin_hotel_boundaries tests.test_channel_credentials tests.test_channel_webhooks tests.test_channel_import_safety tests.test_channex_insights tests.test_channels_client tests.test_config tests.test_health tests.test_common_http tests.test_lazy_http tests.test_common_app tests.test_audit_filters tests.test_owner_billing tests.test_booking_idempotency tests.test_room_guest_acceptance.RoomGuestAcceptanceTests.test_housekeeping_workspace_keeps_room_metadata_but_hides_prices_and_guest_contacts
```

Fixture của bộ test xóa dữ liệu trong database kiểm thử giữa các bài. Chỉ dùng database tạm,
không truyền URL database nghiệp vụ. Chạy frontend bằng `npm test`, `npm run lint`, `npm run build`;
quét lockfile bằng `npm audit --package-lock-only --audit-level=high` và `npm audit signatures`.

Không chạy lại toàn bộ 741 test backend trong lượt này: lượt trước đã xác định test migration
`test_no_show_migration_round_trip_and_downgrade_preserves_history` có sẵn yêu cầu downgrade
qua hàng rào giữ lịch sử `0030_stay_changes`. Không sửa hoặc bỏ qua test đó trong bản vá bảo mật.
Các test HTTP mock và timezone đã được xác minh riêng ở lượt trước.

Chưa kiểm thử xâm nhập hoặc tải lớn trên production, chưa gọi OTA thật, chưa kiểm tra backup/khóa
thực tế. Kết quả quét advisory không chứng minh không có lỗ hổng mới hoặc package độc hại chưa được công bố.
