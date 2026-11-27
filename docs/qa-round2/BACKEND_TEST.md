# QA2-02 — Backend Unit Test

Ngày thực hiện: 2026-10-21 (Asia/Ho_Chi_Minh). Commit kiểm tra: `accc668f71897191cbc98b1388c21ba01d15edb3`.

## Kết luận

**PASS phạm vi unit test an toàn: 121 test, 0 failure, 0 error, 0 skip, 2.810 giây. Backend đầy đủ: BLOCKED phần cần database, chưa chạy và chờ phê duyệt.** Không sửa source/config/requirements, không push/merge. Không chạy migration, seed, truncate hay cleanup database; không kết nối production hoặc gọi provider thật.

## Source và môi trường

- Có `backend/pms_api`, `common`, `tests`, `migrations`, `scripts`. Git status ban đầu sạch.
- Python hệ thống: 3.14.8, tương thích Docker `python:3.14-slim` và Ruff `target-version = "py314"`. `python3 -m pip --version` trả lỗi `No module named pip`; kiểm tra `find_spec('alembic')` trả `None`.
- Tạo `.venv/` tại gốc worktree (đã được gitignore); không cài package hệ thống. Cài thành công toàn bộ `requirements-dev.txt` cùng coverage 7.16.2. `pip check`: `No broken requirements found.`
- `requirements.txt` pin Flask 3.1.3, Flask-SQLAlchemy 3.1.1, Flask-Migrate 4.1.0, SQLAlchemy 2.0.54, Alembic 1.20.0, psycopg 3.3.6, cryptography 50.0.2 và dependency gián tiếp. Dev requirements chỉ thêm Ruff 0.16.10. Coverage là công cụ bổ sung riêng trong venv, không thay đổi manifest.
- `pyproject.toml` chỉ cấu hình Ruff; không có cấu hình pytest, conftest, tox.ini hay setup.cfg trong backend. Suite dùng `unittest`; pytest không được khai báo và không cần để chạy suite này.

## Điều tra thiếu Alembic

`pms_api/__init__.py` import `alembic.script.ScriptDirectory` ở đầu file. Khi import cả module logic như `pms_api.bookings.routes`, Python phải nạp package này trước; Alembic thiếu sẽ gây `ModuleNotFoundError` ngay lúc collection/import, dù test không dùng database. Flask-Migrate cũng phụ thuộc Alembic. Alembic đã có trong requirements hiện tại, nên không cần sửa source hay thêm dependency vào manifest.

Môi trường hệ thống hiện tại thực sự không có Alembic. Sau cài requirements vào venv, các test import và chạy thành công. Đây là bằng chứng phù hợp với lỗi môi trường/dependency hoặc chọn sai interpreter ở vòng trước; repository không chứa log vòng QA trước để xác nhận chính xác lệnh và interpreter đã dùng khi đó.

## Cấu hình database và giới hạn an toàn

`config.py` chỉ chấp nhận PostgreSQL URL có username, host, database; chuẩn hóa driver `postgresql+psycopg`. `DATABASE_MIGRATION_URL` tách riêng nhưng mặc định fallback về runtime URL. Production không đọc `.env`; development/testing có thể đọc `.env` nếu không truyền `env_file=None`.

`tests/domain_fixture.py` yêu cầu hai TEST_DATABASE URL trỏ cùng database có tiền tố `pms_test_`, cấm một số libpq override; tuy nhiên fixture **tự invoke `db upgrade` trong setUpClass và TRUNCATE toàn bộ bảng trong setUp**. Chỉ tiền tố tên chưa chứng minh đó là database an toàn. Không dùng discovery toàn suite. Không chạy `scripts/run_domain_tests.py` (CREATE/DROP database), `scripts/ci_database.py` hay bootstrap PostgreSQL. `run_ci_tests.py` yêu cầu URL và không cho suite skip; không dùng để thay thế kiểm thử unit giới hạn.

Runner chọn từng module/class/method đã đọc source. Xóa biến DATABASE/TEST_DATABASE/PG/CHANNEX khỏi environment của tiến trình test và mock `psycopg.connect` để chặn kết nối DB trong tiến trình chính. Các subprocess được chọn chỉ kiểm tra import/startup/config, dùng URL giả và `env_file=None` hoặc env tạm do test tạo, không gọi readiness. Mock này không lan sang subprocess; an toàn subprocess được xác minh bằng đọc source, không phải sandbox mạng.

`test_local_postgres` chỉ dùng thư mục tạm và mock connect/run; có bind socket loopback để kiểm tra port, không khởi chạy PostgreSQL. Việc xóa thư mục tạm do test thực hiện không phải cleanup database. `test_channels_client` inject mock transport; không gọi Channex thật.

## Lệnh và log thực tế

Từ gốc worktree:

```bash
python3 --version
python3 -m pip --version  # lỗi: No module named pip
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-dev.txt coverage
.venv/bin/python -m pip check
COVERAGE_FILE="$PWD/.venv/qa2/.coverage" .venv/bin/python -m coverage run --branch --source=backend/pms_api,backend/common .venv/qa2/run_safe.py
COVERAGE_FILE="$PWD/.venv/qa2/.coverage" .venv/bin/python -m coverage report
COVERAGE_FILE="$PWD/.venv/qa2/.coverage" .venv/bin/python -m coverage json -o .venv/qa2/coverage.json
```

Lệnh test thực tế redirect stdout/stderr vào `.venv/qa2/tests.log`. Các artifact local (không commit): runner, selection.txt, tests.log, coverage.txt, coverage.json và .coverage nằm trong `.venv/qa2/`. Nội dung runner để tái lập (tạo `.venv/qa2/` trước):

```python
import os, sys, unittest
from pathlib import Path
root = Path(__file__).resolve().parents[2]
os.chdir(root / 'backend')
sys.path[:0] = [str(root / 'backend'), str(root / 'backend/tests')]
for key in list(os.environ):
    if key.startswith(('DATABASE_', 'TEST_DATABASE_', 'PG', 'CHANNEX_')):
        os.environ.pop(key)
os.environ['APP_ENV'] = 'testing'
import psycopg
from unittest.mock import patch
modules = '''booking_values catalog_validation channel_source channels_client ci_runner common_app common_http config finance_values housekeeping_auto_assignment housekeeping_day_selection housekeeping_shift_creation housekeeping_values inventory_values lazy_http local_postgres pricing_values reconciliation_unit stay_segments'''.split()
names = ['tests.test_' + n for n in modules] + [
 'tests.test_channel_import_safety.ChannelOccupancyValidationTests',
 'tests.test_plan_room_limits.PlanQuotaValuesTests',
 'tests.test_channex_remote.ChannexPageTests',
 'tests.test_health.HealthTests.test_liveness_does_not_require_a_database_connection',
 'tests.test_health.HealthTests.test_cors_allows_only_configured_origin',
]
(root / '.venv/qa2/selection.txt').write_text('\n'.join(names)+'\n')
with patch.object(psycopg, 'connect', side_effect=AssertionError('QA2 forbids database connections')):
    suite = unittest.defaultTestLoader.loadTestsFromNames(names)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not result.wasSuccessful())
```

Tóm tắt log:

```text
Ran 121 tests in 2.810s
OK
TOTAL  9168 statements  6108 missed  2936 branches  73 partial  28%
```

Không có lỗi test trong phạm vi đã chạy. Lỗi kiểm tra môi trường ban đầu là thiếu pip và Alembic hệ thống; đã khắc phục bằng venv riêng. `docs/qa-round2` ban đầu chưa tồn tại, đã tạo để đặt báo cáo.

## Phạm vi validation, logic và exception

- Booking/catalog/finance/inventory: Decimal chính xác, giới hạn precision, NaN/Infinity, số âm/zero, boolean giả số, phân bổ chi phí; ngày sai, checkout trước hoặc trùng checkin, giới hạn khoảng ngày.
- Pricing: tính giảm giá và phân bổ tiền bằng dữ liệu thuần, chưa xác minh tính giá lấy từ DB.
- Housekeeping: cân bằng tải, giữ task đã làm/đóng/stale, retry không tự phân công lại; phạm vi tenant/staff/ngày qua mock; dữ liệu sai trả 422/404/409; tháng ngắn, năm nhuận, giao năm và tràn ngày 9999.
- Reconciliation/stay segments: timezone khách sạn, DST 25 giờ, mốc cuối exclusive, ngày tương lai, snapshot token thay đổi theo dữ liệu; lịch sử chuyển phòng và phạm vi giải phóng inventory.
- Channex: authorization nguồn hệ thống, chống chọn nguồn khách sạn khác, signed state/redirect, occupancy boolean/âm/zero; UUID/path, pagination int32, metadata sai, timeout/DNS/TLS/429/5xx, response quá lớn và thông tin lỗi không lộ secret qua mock.
- Common HTTP: payload JSON không phải object, JSON hỏng, method/route, format Decimal/date, lazy import/retry/concurrent initialization. App contract/liveness/CORS không cần DB.
- Config: URL/port/CORS/webhook sai, ưu tiên runtime, không đọc .env production, tách URL migration. CI runner nhận skip là gate thất bại (test con giả lập skip không làm suite 121 test bị skip).

## Coverage và nguy cơ regression

Đo line và branch cho toàn bộ `backend/pms_api` + `backend/common`; coverage kết hợp làm tròn **28%**, line coverage **33.38%** (3060/9168). Import model/route có thể làm tăng line coverage mà chưa kiểm chứng hành vi. Không có coverage threshold trong cấu hình đã kiểm tra. Không đo code ở scripts/tests. Các subprocess startup không được coverage tự động thu thập; số liệu không đại diện toàn suite.

| Module | Line coverage | Branch coverage |
|---|---:|---:|
| `common/http.py` | 98.53% | 95.83% |
| `pms_api/config.py` | 91.30% | 86.67% |
| `pms_api/bookings/room_stays.py` | 100.00% | 87.50% |
| `pms_api/channels/client.py` | 89.76% | 82.56% |
| `pms_api/pricing/engine.py` | 27.65% | 13.16% |
| `pms_api/housekeeping/service.py` | 56.52% | 52.50% |
| `pms_api/finance/routes.py` | 19.57% | 1.74% |
| `pms_api/security.py` | 39.44% | 11.90% |

Ưu tiên regression cao: auth/session/CSRF/RLS và tenant isolation; booking/inventory cạnh tranh phòng cuối; ledger/finance/commission/refund/idempotency; pricing snapshot và báo cáo; channel import/cancel/ACK/watermark/retry; subscription/quota và migration bảo toàn lịch sử. Unit test mock không chứng minh transaction, FK/check constraint, lock, quyền PostgreSQL hay rollback đúng.

## BLOCKED — chưa chạy

Hai method `HealthTests.test_readiness_fails_without_exposing_database_credentials` và `test_database_check_command_fails_when_database_is_unavailable` cố thử kết nối URL giả loopback port 1; chủ động chưa chạy vì không độc lập DB/network hoàn toàn. Không coi là lỗi ứng dụng.

Các class dưới đây cần DB (trực tiếp hoặc kế thừa DomainTestCase/ChannelTestCase), **BLOCKED chờ phê duyệt**. Số test là số method khai báo tĩnh, không gồm method kế thừa/subTest, không phải số test đã chạy:

| File | Class | Method khai báo |
|---|---|---:|
| `test_audit_filters.py` | `AuditFilterTests` | 3 |
| `test_booking_client_acceptance.py` | `BookingClientAcceptanceTests` | 9 |
| `test_booking_integration.py` | `BookingIntegrationTests` | 18 |
| `test_booking_no_show.py` | `BookingNoShowTests` | 5 |
| `test_booking_versions.py` | `BookingVersionTests` | 6 |
| `test_cashbook_categories.py` | `CashbookCategoryTests` | 6 |
| `test_catalog_postgres.py` | `CatalogPostgresTests` | 15 |
| `test_channel_ari_snapshot.py` | `ChannelAriSnapshotTests` | 5 |
| `test_channel_backpressure.py` | `ChannelBackpressureTests` | 7 |
| `test_channel_catalog.py` | `ChannelCatalogTests` | 10 |
| `test_channel_credentials.py` | `ChannelCredentialTests` | 18 |
| `test_channel_http_simulation.py` | `ChannelHttpSimulationTests` | 3 |
| `test_channel_import_safety.py` | `ChannelImportSafetyTests` | 34 |
| `test_channel_mapping_lifecycle.py` | `ChannelMappingLifecycleTests` | 10 |
| `test_channel_mapping_lifecycle.py` | `ChannelMappingMigrationTests` | 1 |
| `test_channel_notifications.py` | `ChannelNotificationTests` | 3 |
| `test_channel_pacing.py` | `ChannelPacingTests` | 10 |
| `test_channel_priority.py` | `ChannelPriorityTests` | 3 |
| `test_channel_webhooks.py` | `ChannelWebhookTests` | 6 |
| `test_channels_integration.py` | `ChannelIntegrationTests` | 26 |
| `test_channels_integration.py` | `ChannelRecoveryTests` | 7 |
| `test_channex_airbnb.py` | `AirbnbTests` | 10 |
| `test_channex_channels.py` | `ChannexChannelTests` | 24 |
| `test_channex_insights.py` | `ChannexInsightsTests` | 12 |
| `test_channex_remote.py` | `ChannexRemoteTests` | 21 |
| `test_client_profile.py` | `ClientProfileTests` | 5 |
| `test_client_settings.py` | `ClientSettingsTests` | 6 |
| `test_closed_finance.py` | `ClosedFinanceTests` | 3 |
| `test_commissions.py` | `CommissionTests` | 11 |
| `test_day_reconciliation.py` | `DayReconciliationTests` | 10 |
| `test_finance_integration.py` | `FinanceIntegrationTests` | 12 |
| `test_housekeeping_batch.py` | `HousekeepingBatchTests` | 8 |
| `test_housekeeping_calendar.py` | `HousekeepingCalendarTests` | 4 |
| `test_housekeeping_integration.py` | `HousekeepingIntegrationTests` | 10 |
| `test_housekeeping_shift_batch.py` | `ShiftBatchTests` | 4 |
| `test_housekeeping_worker.py` | `HousekeepingWorkerTests` | 6 |
| `test_identity.py` | `IdentityTests` | 10 |
| `test_inventory_integration.py` | `InventoryIntegrationTests` | 16 |
| `test_manager_billing.py` | `ManagerBillingTests` | 11 |
| `test_manager_customers.py` | `ManagerCustomerTests` | 6 |
| `test_manager_features.py` | `ManagerFeatureTests` | 13 |
| `test_manager_profile.py` | `ManagerProfileTests` | 3 |
| `test_manager_users.py` | `ManagerUserTests` | 7 |
| `test_notifications.py` | `NotificationTests` | 12 |
| `test_plan_room_limits.py` | `PlanRoomLimitTests` | 11 |
| `test_postgres_integration.py` | `PostgreSQLIntegrationTests` | 6 |
| `test_pricing_finance_snapshots.py` | `FinanceSnapshotTests` | 2 |
| `test_pricing_integration.py` | `PricingIntegrationTests` | 11 |
| `test_pricing_reports.py` | `PricingReportsTests` | 2 |
| `test_reports_acceptance.py` | `ReportsAcceptanceTests` | 12 |
| `test_reports_business.py` | `BusinessReportTests` | 7 |
| `test_reports_financial.py` | `FinancialReportsTests` | 3 |
| `test_room_guest_acceptance.py` | `RoomGuestAcceptanceTests` | 12 |
| `test_subscription_acceptance.py` | `SubscriptionAcceptanceTests` | 22 |
| `test_tenant_remote_channels.py` | `TenantRemoteChannelTests` | 8 |
| `test_tenant_remote_channels.py` | `TenantAirbnbTests` | 3 |
| `test_worker_health.py` | `WorkerHealthTests` | 5 |

Đề xuất sau khi được phê duyệt: PostgreSQL instance/container riêng cho QA trên loopback, port riêng, database mới `pms_test_qa2_<uuid>`, dữ liệu hoàn toàn giả, hai role riêng runtime/migrator có quyền chỉ trong instance test; truyền hai TEST_DATABASE URL đã kiểm tra cùng đích, không dùng `.env` hay credentials production. Cần phê duyệt rõ việc fixture tự migration/TRUNCATE và quy trình teardown trước khi chạy các class DB. Chưa tạo instance/database, chưa chạy bất kỳ bước đó. Suite production-readiness và dịch vụ provider thật cũng chưa được xác minh trong báo cáo này.
