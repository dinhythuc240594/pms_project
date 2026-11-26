# Hoàn thiện BIZ-01–07 — 29/10/2026

Nhánh hiện tại `full-p1-business-fixes-2026-10-29`, từ `f8cf4d9`.
Yêu cầu: triển khai đủ P1 trong [báo cáo](../docs/reports/reviews/business-gap-audit-2026-10-29.md), gồm API, giao diện, migration, quyền, kiểm thử và tài liệu.

## Quy tắc triển khai

- Giữ giá/tỷ giá đêm cũ; đêm gia hạn được báo giá hiện hành, quy đổi theo tỷ giá booking đã chốt. Chuyển phòng có hiệu lực từ hôm nay trở đi, giữ đêm đã phục vụ. Không tự thu phí trả sớm; xác nhận chênh lệch và hoàn tiền dư qua luồng hoàn hiện có.
- Night Audit theo ngày lịch/múi giờ khách sạn; chỉ đóng ngày đã kết thúc, không tự nhận/trả/no-show. Doanh thu ghi nhận tách khỏi tiền quỹ. Ngày đã đóng không được sửa lùi; điều chỉnh sau chốt được ghi vào ngày còn mở với dấu vết nguồn cũ.
- Hoa hồng chỉ sửa bằng bản đối soát/điều chỉnh mới; phân bổ tiền phòng và lý do rõ. Giữ lịch sử đã chi, thu hồi phần chi thừa qua phiếu thu có liên kết.
- Thuế/dịch vụ OTA theo hợp đồng provider, không đoán phần chưa hỗ trợ. Ngoại lệ có thao tác đối soát rõ, không bỏ guard/ACK trước khi lưu bền vững.
- Khoản thu SaaS sửa bằng hoàn/đảo đối ứng; không xóa lịch sử, không tự đổi gói.
- Quyền vận hành tạm phải do Manager cấp, có lý do/hạn tối đa 7 ngày và có thể thu hồi. Chỉ hoàn tất nghiệp vụ đang tồn; không mở tạo booking/bán hàng/cấu hình mới; khóa bảo mật tenant vẫn được ưu tiên.
- Dùng lại component/kiểu giao diện; giữ mobile, nháp, retry và thông báo lỗi. Không thêm dependency.

## Các lát triển khai và nghiệm thu

- [x] BIZ-01a: API preview/confirm đổi lưu trú, snapshot giá, version/idempotency và inventory/HK/OTA. Test chuyển phòng, gia hạn, trả sớm, cạnh tranh, sai tenant và bảo toàn đêm cũ.
- [x] BIZ-01b: form xem trước/xác nhận trong booking detail, giữ nháp và trạng thái tiền dư cần hoàn. Test giao diện và responsive.
- [x] BIZ-02a: migration bảng chốt ngày và doanh thu append-only; guard ngày đóng. Test RLS, downgrade bảo toàn lịch sử, ghi lùi và chạy lại.
- [x] BIZ-02b: API preview/close, kiểm việc chưa xử lý, ghi nhận doanh thu không nhân tiền quỹ; báo cáo và UI chốt ngày.
- [x] BIZ-03a: preview/confirm đối soát lại hoa hồng, watermark và phân bổ. Test thay đổi mới lại chặn chi, không sửa lịch sử.
- [x] BIZ-03b: thu hồi hoa hồng chi thừa, phiếu quỹ và UI. Test hoàn một phần, replay và quyền.
- [x] BIZ-04a: chuẩn hóa thuế/dịch vụ được hỗ trợ theo tài liệu Channex; snapshot tiền và review trường hợp chưa rõ.
- [x] BIZ-04b: xử lý review thủ công có booking liên kết, kiểm version/tổng tiền, audit và ACK bền vững; UI và tests.
- [x] BIZ-05a: nhận lỗi/cảnh báo provider, chống trùng và lưu hồ sơ đúng tenant.
- [x] BIZ-05b: danh sách/phân công/resolve/reopen sự cố có lý do và xác minh; UI và tests.
- [x] BIZ-06a: hoàn/đảo thu SaaS với giới hạn và idempotency; số dư và báo cáo Owner/Manager đúng.
- [x] BIZ-06b: UI hoàn tiền SaaS, lịch sử đối ứng và tests.
- [x] BIZ-07a: cấp/thu hồi quyền vận hành tạm, giới hạn API/worker và kiểm lại entitlement. Test hết hạn, khóa tenant và quyền hết hiệu lực.
- [x] BIZ-07b: UI Manager cấp hạn, client hiện trạng thái/cho hoàn tất nhưng khóa tạo mới; tests.
- [x] Tích hợp: API contract/route fixture/i18n; migration một head; toàn suite backend PostgreSQL không skip, frontend tests/lint/build; review và kiểm trình duyệt.

Kết quả: backend 867/867, frontend 299/299, lint/build đạt; migration roundtrip
và trình duyệt đã kiểm chứng. Xem [báo cáo hoàn tất và đề xuất](../docs/reports/reviews/full-p1-business-fixes-2026-10-29.md).

## Phân công và phụ thuộc

- Agent hoa hồng: BIZ-03, migration `0038_commission_review` từ `0037_channel_rate_safety`.
- Agent SaaS: BIZ-06/07, migration `0039_saas_recovery` từ `0038_commission_review`.
- Agent OTA: BIZ-04/05, migration `0040_channel_exceptions` từ `0039_saas_recovery`.
- Agent chính: BIZ-01/02, migration `0041_operational_days` từ `0040_channel_exceptions`, central provider/API/i18n/docs và tích hợp.
- Các migration được hợp nhất theo thứ tự trên trước kiểm thử tổng; agent dùng database kiểm thử riêng mỗi lượt, không dùng database nghiệp vụ.

## Kiểm chứng

Mỗi lát: test mới thất bại trước sửa, test tập trung sau sửa. Backend dùng Python sẵn có và `.tools/run_focused_qa.py`, database `pms_test_*` dùng app role không BYPASSRLS trên private QA port25432. Toàn suite dùng no-skip runner; provider được giả lập cục bộ. Frontend dùng test/lint/build theo `frontend/package.json`.

Các quyền/cấu hình ngoài repository, deployment và tài khoản OTA thật chưa thuộc yêu cầu triển khai này.
