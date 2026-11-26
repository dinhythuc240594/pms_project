# Hoàn thiện BIZ-01–07 (P1) — 29/10/2026

Nhánh: `full-p1-business-fixes-2026-10-29`, tách từ báo cáo `f8cf4d9`.
Mã nguồn chức năng tại `2df43b8`, bản sửa OTA và kiểm thử cuối tại `c3392cd`.
Phạm vi theo [báo cáo rà soát nghiệp vụ](business-gap-audit-2026-10-29.md).
Người dùng đã chọn bộ quy tắc mặc định: giữ giá đêm cũ, báo giá đêm mới,
không tự phạt trả sớm, chốt ngày theo khách sạn và Manager cấp vận hành tạm có hạn.

## Kết quả triển khai

| Mục | Nghiệp vụ đã bổ sung | Cách kiểm tra trên giao diện |
| --- | --- | --- |
| BIZ-01 | Preview/xác nhận chuyển phòng, gia hạn và trả sớm sau check-in; kiểm version, chống gửi trùng, tồn phòng và buồng phòng. Giữ đêm đã phục vụ và tỷ giá booking; đêm mới/hạng mới báo giá hiện hành. | Chi tiết booking đang ở → Chuyển phòng / đổi ngày lưu trú. |
| BIZ-02 | Night Audit đóng ngày, ghi nhận doanh thu bất biến và khóa ghi lùi ở PostgreSQL. Điều chỉnh vào ngày mở; không tạo lại tiền thu/quỹ. Báo cáo có chỉ tiêu doanh thu đã chốt riêng. | Báo cáo → Đối soát ngày → Kiểm toán đêm / chốt ngày. |
| BIZ-03 | Đối soát lại hoa hồng, phân bổ phí/giảm giá vào tiền phòng, lưu cơ sở/lý do/người duyệt; thu hồi khoản đã chi thừa qua phiếu thu liên kết. | Cài đặt → Kế toán & Thanh toán → Quản lý Hoa hồng. |
| BIZ-04 | Nhập thuế đã gồm/chưa gồm và dịch vụ được hỗ trợ; lưu tiền gốc/provider commission. Ngoại lệ có luồng đối chiếu, liên kết booking PMS và xác nhận có bằng chứng trước ACK. | Cài đặt → Channex & Kênh OTA → Lịch sử đồng bộ → Đặt phòng cần xử lý. |
| BIZ-05 | Nhận lỗi/cảnh báo kênh, chống trùng, phân công, xác nhận đã kiểm tra/khắc phục và mở lại sự cố. | Cùng trang lịch sử đồng bộ → Sự cố và cảnh báo từ kênh bán. |
| BIZ-06 | Hoàn/đảo thu SaaS một phần hoặc toàn bộ, không vượt khoản thu gốc. Hóa đơn, tổng thực thu, lịch sử và tài liệu Owner cùng dùng số thu ròng. | Manager → Gói cước & hóa đơn → Chi tiết / Thu tiền → Hoàn/đảo khoản thu. |
| BIZ-07 | Manager cấp/thu hồi quyền vận hành tạm tối đa 7 ngày cho thuê bao hết hạn. API, worker và UI giới hạn thao tác hoàn tất; không mở tạo booking trực tiếp, bán hàng hay cấu hình. | Manager → Gói cước & hóa đơn → Vận hành tạm; PMS hiện banner phạm vi/hạn. |

Không thêm dependency. API contract, route fixture và nhãn VI/EN/ZH của các luồng
đổi lưu trú, chốt ngày và thông báo vận hành tạm đã được cập nhật.

## Quy tắc tiền và quyền

- Đổi lưu trú có hiệu lực hôm nay, giữ số phòng và toàn bộ đêm đã phục vụ.
  Phòng chuyển đến phải sạch, còn trống và đủ sức chứa. Phòng cũ được chuyển
  bẩn/tạo việc dọn. Gia hạn quá ngày trả bổ sung các đêm thiếu đúng một lần.
  Hoàn tiền dư trước khi xác nhận; trả sớm hôm nay phải hết số dư theo tổng mới.
  Booking OTA cần xác nhận thay đổi nội bộ và tạo sự cố để đối chiếu trên kênh.
- Lần Night Audit đầu chọn ngày bắt đầu sổ doanh thu, không ghi lại ngày trước đó.
  Sau đó chốt liên tiếp từng ngày đã kết thúc theo múi giờ khách sạn. Khách đến/đi
  chưa xử lý hoặc review OTA còn mở chặn chốt. Sổ doanh thu tách khỏi tiền quỹ và
  doanh thu hóa đơn checkout; không cộng các chỉ tiêu này lại với nhau.
- Hoa hồng giữ settlement và phiếu đã chi gốc. Bản đối soát mới lưu phần phí/giảm
  giá thuộc tiền phòng; hoàn cho khách không bị trừ hai lần. Điều chỉnh hoặc quyết
  định OTA mới làm cơ sở cũ hết hiệu lực và yêu cầu đối soát lại trước khi chi.
- Thuế/dịch vụ OTA chưa rõ, tiền OTA thu hộ trong `collected_taxes`, phí hủy và
  hủy booking có khoản thuế/dịch vụ/phí đã ghi, cập nhật chạm ngày đã khóa được
  giữ ở review. Luồng xử lý thủ công kiểm lại
  revision gốc, khách sạn, version, trạng thái, ngày/phòng, tiền tệ và tổng tiền;
  không ép ACK để bỏ qua tồn/tiền. Chưa tự tạo khoản tiền thu từ dữ liệu provider.
- Thu hồi hoa hồng và hoàn/đảo SaaS chỉ ghi nhận khoản tiền thực tế đã xác minh;
  hệ thống không tự chuyển tiền ngân hàng. Hoàn SaaS không tự đổi/gia hạn thuê bao.
- Vận hành tạm gắn đúng thuê bao/gói/hạn cũ; gia hạn hoặc đổi gói làm quyết định cũ
  mất hiệu lực. Đình chỉ khách sạn, tắt tính năng, role và membership vẫn được kiểm
  tra. Quyền hệ thống không tự cấp quyền PMS tài chính của khách sạn.

## Kiểm chứng

Các suite dùng PostgreSQL thật trên database `pms_test_*` riêng, runtime không
superuser/BYPASSRLS; provider được giả lập trên localhost. Không dùng database
nghiệp vụ hoặc tài khoản Channex thật.

| Kiểm tra | Kết quả |
| --- | --- |
| Frontend toàn suite | 299/299 đạt, 0 bỏ qua. |
| Frontend build | Đạt; còn cảnh báo chunk lớn hơn 500 kB. |
| Frontend lint | Đạt, còn 44 cảnh báo React; không hạ cấu hình hay tắt rule. |
| Backend Ruff và `git diff --check` | Đạt. |
| Backend toàn suite bắt buộc | 867/867 đạt, 0 bỏ qua/lỗi. Chia 3 DB độc lập (306 + 313 + 248), cùng `RequiredTestRunner`; kiểm kê cùng toàn bộ danh mục test. |
| Night Audit bổ sung | 7/7 đạt: khóa ngày, RLS, append-only, từ chối downgrade có lịch sử, ngày bắt đầu sổ, quyền, replay và không nhân tiền quỹ. |
| Migration roundtrip trên DB riêng | `0041` → `0037` → head đạt; 16 snapshot lõi giữ nguyên, 9 bảng P1 có FORCE RLS/policy, `db-check` và `/api/ready` đạt. |
| Giao diện Night Audit / đổi lưu trú | 9/9 đạt: nháp, retry, chặn gửi song song, dữ liệu trả muộn và đổi khách sạn/session. |
| Quyền client | 36/36 đạt, gồm phạm vi vận hành tạm và thông báo từ chối tạo mới. |

Trong các lượt tổng có lần mô phỏng HTTP không hoàn tất reset hoặc ACK vẫn ở
trạng thái chờ; chưa tái hiện khi chạy riêng 4 bài ARI và 3 bài booking/ACK.
Không thay timeout, retry hoặc assertion để bỏ qua lỗi. Nhóm liên quan được chạy
lại nguyên vẹn trên database mới; chưa kết luận nguyên nhân gián đoạn cục bộ.

Kiểm tra trình duyệt bằng dữ liệu giả:

- Chuyển phòng 101 → 102 và gia hạn một đêm: tổng 300 → 400, đã thu giữ 50,
  số dư 350; đêm đã ở vẫn là phòng 101/giá 100, các đêm tiếp theo đúng phòng 102.
- Chốt ngày hôm trước: doanh thu 100, sổ quỹ giữ nguyên 240; màn hình hiển thị
  ngày đã khóa và ngày bắt đầu sổ doanh thu.
- Đối soát khoản giảm tiền phòng 10: hoa hồng 20 → 19, giữ tỷ lệ gốc 10%.
- Tiếp nhận và xử lý sự cố OTA giả: yêu cầu xác nhận đã kiểm tra, hồ sơ rời danh
  sách cần xử lý sau lưu, lịch sử vẫn còn.
- Hoàn SaaS 10 trên khoản thu 40 của hóa đơn 100: thu ròng 30, còn lại 70;
  khoản thu gốc và đối ứng cùng hiện trong lịch sử.
- Cấp hạn tạm một ngày cho khách sạn đã hết hạn: PMS hiện banner, từ chối mở
  tạo booking mới bằng thông báo đúng phạm vi quyền.
- Kiểm tra các bề rộng 320/375/414/768/1024/1280/1440 px: không tràn ngang trang.
  Không có lỗi JavaScript trong các luồng kiểm tra cuối. Các form giữ lý do,
  xác nhận, trạng thái chờ và thông báo lỗi.

Rà soát chéo đã bắt và sửa việc phản hồi muộn làm lộ bản xem trước sang khách
sạn khác, hoàn tất yêu cầu cũ đóng form mới và Night Audit giữ nháp/trạng thái chờ
sau đổi phạm vi. Có kiểm thử tái hiện cho các trường hợp này.

Rà soát cuối độc lập đã phát hiện ca OTA hủy booking chưa check-in có thuế/dịch vụ
đã ghi: hủy tự động có thể làm Night Audit ghi doanh thu chưa cung cấp. Ca này
được chuyển sang review trước khi sửa trạng thái/tồn hoặc ACK, giữ nguyên các
khoản gốc để người dùng xử lý tiền rõ ràng. Có kiểm thử hồi quy cho việc giữ
booking/charges, hồ sơ review, không ACK và không ghi doanh thu sai.
Các phạm vi lưu trú/chốt ngày/tiền/hoa hồng và SaaS/quyền client không phát hiện
thêm P1. Kiểm tra bổ sung chuyển hạng/phòng qua nhiều lần trong hai ngày giữ đúng
giá lịch sử và tồn từng hạng.

Ảnh kiểm chứng dùng toàn bộ dữ liệu giả:
[lịch sử đêm sau chuyển phòng](assets/full-p1-2026-10-29/stay-change-mobile.png),
[Night Audit đã khóa](assets/full-p1-2026-10-29/night-audit-locked.png),
[hoàn thu SaaS](assets/full-p1-2026-10-29/saas-refund.png).

## Migration và vận hành

Chuỗi một head:
`0037_channel_rate_safety` → `0038_commission_review` → `0039_saas_recovery` →
`0040_channel_exceptions` → `0041_operational_days`.

Các bảng mới có FORCE RLS; bảng quyết định/đối ứng/ngày đã chốt là append-only.
Downgrade từ chối bỏ dữ liệu nghiệp vụ mới. Trước khi triển khai, diễn tập trên
bản sao backup, áp `python manage.py db upgrade`, chạy `db-check` và `/api/ready`,
cập nhật API/worker cùng phiên bản rồi mới mở frontend. Xem
[runbook](../../runbooks/operations-and-restore.md) và
[API contract](../../../backend/API_CONTRACT.md#p1-business-completion--29102026).
Chưa áp các migration này vào database nghiệp vụ, chưa deploy hoặc nghiệm thu
Channex thật.

## Đề xuất tiếp theo

1. Chọn một kênh/khách sạn pilot để nghiệm thu thuế, dịch vụ, thu hộ, sửa/hủy và
   thứ tự revision/ACK thật. Các cấu trúc chưa hỗ trợ tiếp tục đi qua review.
2. Chốt người trực, hạn xử lý và cách báo động cho review/sự cố OTA tồn lâu;
   đo tuổi queue và kết quả thực tế trên kênh.
3. Chọn ngày bắt đầu Night Audit và đối chiếu số dư/sổ cũ trước lần chốt đầu,
   ghi người chịu trách nhiệm đối chiếu và phục hồi.
4. Bổ sung nhắc sắp hết hạn thuê bao và theo dõi quyết định vận hành tạm; giữ
   việc cấp hạn là quyết định có người chịu trách nhiệm.
5. Nếu pilot cần trả từng phòng độc lập hoặc đổi lưu trú có hiệu lực trong
   tương lai, tách thành luồng mới với đối chiếu tồn và tiền riêng.
6. Đo tốc độ báo cáo/chốt ngày trên dữ liệu pilot và xử lý cảnh báo React/bundle
   theo phạm vi riêng. Chưa có kiểm thử tải lớn hay SLO vận hành được chốt.
7. Bổ sung mã lỗi/tình trạng worker vào thông báo thất bại của kiểm thử HTTP và
   kiểm tra sẵn sàng của mock để truy vết gián đoạn mô phỏng dễ hơn.

Các P2 và 12 đề xuất SUG trong [báo cáo gốc](business-gap-audit-2026-10-29.md)
vẫn là backlog riêng. Bốn skill dùng để đối chiếu là `saas-multi-tenant`,
`webhook-integration`, `postgresql-best-practices` và `senior-fullstack`.
Hợp đồng OTA tham chiếu [Bookings Collection](https://docs.channex.io/api-v.1-documentation/bookings-collection)
và [Webhook Collection](https://docs.channex.io/api-v.1-documentation/webhook-collection).
