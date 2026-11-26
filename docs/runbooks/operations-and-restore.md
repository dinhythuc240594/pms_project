# Kiểm tra vận hành và phục hồi

Màn hình **Manager → Tổng quan → Tình trạng vận hành** và API
`GET /api/admin/operations` dành cho `SYSTEM_MANAGER`/`SUPER_ADMIN`. Đây là ảnh chụp
tại thời điểm tải; chọn **Tải lại vận hành** sau khi xử lý. Không có API key,
URL database, nội dung booking hoặc thông tin khách trong kết quả. API chỉ trả
heartbeat của tác vụ; queue OTA, booking cần kiểm tra và tồn/giá chờ gửi thuộc
phạm vi PMS của từng khách sạn.

## Tác vụ nền không phản hồi hoặc hàng đợi tăng

1. Kiểm tra `/api/ready` trả `200`; nếu lỗi, xem log migration/database trước.
   `/api/health` chỉ xác nhận API còn chạy; `/api/ready` không xác nhận worker.
2. Kiểm tra service thường trực chạy đúng phiên bản và cùng database với API:
   `python manage.py process-channel-jobs --watch --interval 15 --limit 10`;
   `python manage.py process-housekeeping-plans --actor-email <email quản trị đang hoạt động> --watch --interval 900`.
3. Worker quá hạn khi heartbeat cũ hơn `max(120 giây, 3 × interval)`. Một worker
   chạy tất cả khách sạn hoặc nhiều worker `--tenant` phải phủ đủ các khách sạn
   cần tác vụ. Với buồng phòng, `uncoveredTenantCount` đối chiếu khách sạn đang
   hoạt động; với OTA chỉ đối chiếu phạm vi worker đã báo heartbeat, không đọc
   cấu hình kết nối riêng của khách sạn. `lastSuccessAt`
   là vòng quét hoàn tất gần nhất, không chứng minh mọi job đã đồng bộ thành công.
4. Nếu worker phản hồi nhưng đồng bộ chưa hoàn tất, người có quyền PMS được
   chủ khách sạn cấp mở kết nối OTA của đúng khách sạn để xem lịch sử job,
   booking cần kiểm tra, mã lỗi và retry phù hợp. API quản trị SaaS không cung
   cấp các dữ liệu này và vai trò quản trị hệ thống không thay thế quyền PMS.
5. Booking cần kiểm tra không được ACK tự động. Người trực PMS đối chiếu phòng,
   ngày, giá và thanh toán với OTA trước khi thử lại. Lỗi quyền/khóa/mapping cần
   người quản trị kết nối xử lý; lỗi database hoặc queue không giảm cần kỹ thuật
   vận hành kiểm tra log theo `tenant/job/revision`.

Đề xuất công cụ giám sát gọi API có xác thực và cảnh báo khi worker bắt buộc quá
hạn hai lần liên tiếp. Theo dõi tuổi queue trong phạm vi khách sạn đã được cấp
quyền theo mục tiêu đồng bộ đã thống nhất.
Code cung cấp tín hiệu và màn hình xem; không tự cấu hình cảnh báo ngoài hệ thống.
Vòng quét rất dài có thể vượt ngưỡng heartbeat; đo thời gian vòng thực tế trước
khi tăng số khách sạn/giới hạn mỗi lượt.

## Diễn tập phục hồi trên database riêng

Người vận hành cần chọn RPO/RTO, lịch backup, nơi lưu và người chịu trách nhiệm.
Repository không chứng minh backup trên Coolify đang bật. Lưu khóa mã hóa
Channex theo quy trình bí mật riêng; dump không thay thế việc phục hồi khóa đó.

Dùng **bản sao backup tin cậy**, định dạng `pg_dump -Fc`, và PostgreSQL local
cùng phiên bản hoặc mới hơn nguồn. Archive có thể chứa SQL, chỉ phục hồi khi
đã xác định nguồn. Script không thay đổi backup production; chỉ chấp nhận
admin URL loopback trỏ database `postgres`, không có query override.

```powershell
# Đặt RESTORE_DATABASE_ADMIN_URL qua môi trường/secret manager của phiên shell.
# Không đưa giá trị thật vào Git, tham số lệnh hay ảnh chụp màn hình.
python backend/scripts/verify_restore.py --dump C:/backups/pms-approved.dump
```

Script tạo `pms_restore_test_<UUID>` cùng hai role riêng, restore với
`--no-owner --no-acl`, rồi kiểm tra bằng runtime không superuser/BYPASSRLS:
schema khớp code, runtime không sở hữu bảng, RLS bắt buộc trên bảng quan trọng,
không có dữ liệu tenant khi thiếu context và không có phòng đang hoạt động
trùng thời gian. Chỉ database/role vừa tạo được xóa khi hoàn tất. Cần
`pg_restore` trên `PATH`; database có sẵn không được chọn làm đích.

Truyền `--expected-counts manifest.json` để đối chiếu số dòng với manifest ghi
cùng thời điểm backup. JSON có dạng `{"reservations":42,"payments":18}`; chỉ
hỗ trợ các bảng được báo trong `tableCounts`. Không có manifest thì kết quả
không chứng minh backup đầy đủ so với nguồn. Dump schema cũ cần diễn tập nâng
cấp riêng; script không tự nâng cấp để che lệch phiên bản.

Ghi ngày diễn tập, checksum backup, phiên bản code/PostgreSQL, thời điểm backup
cuối, kết quả, thời gian thực tế và người xác nhận. Sau kiểm tra tự động, UAT
booking/tiền của hai khách sạn và đăng nhập vào môi trường phục hồi cô lập.
Không khởi động worker OTA với khóa thật trên bản phục hồi trước khi có kế
hoạch tránh gửi trùng hoặc gửi tồn/giá cũ lên OTA thật.

## Vận hành các luồng P1 bổ sung

Trước khi mở phiên bản 29/10/2026, sao lưu và diễn tập nâng cấp trên bản sao tin
cậy. Áp `0038_commission_review` → `0039_saas_recovery` →
`0040_channel_exceptions` → `0041_operational_days` bằng cấu hình migration của
môi trường đích; chạy `db-check`, `/api/ready` và cập nhật worker cùng phiên bản.
Các migration không xóa dữ liệu cũ; downgrade từ chối khi đã có lịch sử mới.

- **Chuyển phòng/gia hạn/trả sớm:** mở chi tiết booking đang ở, chọn luồng thay
  đổi lưu trú, xem chênh lệch và ghi lý do. Giữ nguyên số phòng; đêm mới/hạng mới
  báo giá hiện hành với tỷ giá booking đã chốt. Hoàn tiền dư trước khi xác nhận;
  trả sớm hôm nay phải hết số dư. Với booking OTA, xác nhận thay đổi nội bộ,
  đối chiếu lại trên kênh và xử lý sự cố được tạo. Hệ thống không tự sửa booking
  của provider.
- **Night Audit:** ở Báo cáo → Đối soát ngày, dùng phần Kiểm toán đêm/chốt ngày.
  Chọn ngày bắt đầu sổ doanh thu ở lần đầu, đối chiếu và xác nhận trước khi khóa;
  doanh thu trước ngày bắt đầu không được ghi lại. Sau đó chốt liên tiếp từng
  ngày đã kết thúc theo múi giờ khách sạn. Xử lý khách đến/đi và review OTA còn
  tồn trước. Doanh thu đã chốt tách khỏi thu/chi quỹ; điều chỉnh sau chốt vào ngày
  mở, không sửa đêm cũ hay ghi lùi tiền. Nút Lưu xác nhận đối soát cũ vẫn chỉ lưu
  ảnh chụp kiểm tra.
- **Hoa hồng:** ở Cài đặt → Kế toán → Hoa hồng, đối soát booking bị treo, phân bổ
  phí/giảm giá vào tiền phòng và lưu lý do. Giữ lịch sử chi cũ; nếu chi thừa,
  ghi thu hồi khi đã nhận tiền thực tế. Mở phiếu liên kết để kiểm quỹ/đối ứng.
  Điều chỉnh mới hoặc review OTA mới yêu cầu đối soát lại.
- **OTA:** theo dõi booking cần kiểm tra và sự cố ở lịch sử đồng bộ. Lỗi thuế/
  dịch vụ chưa được hỗ trợ phải được đối chiếu, liên kết đúng booking PMS, số
  tiền, ngày/phòng và lý do trước khi hoàn tất. ACK chỉ được xếp hàng sau hồ sơ
  xử lý đã lưu. Phân công sự cố cho người có quyền, kiểm kết quả trên kênh rồi
  xác nhận xử lý; có thể mở lại kèm lý do. Không coi nút resolve là bằng chứng
  provider đã nhận đúng tồn/giá.
- **SaaS:** Manager mở khoản thu hóa đơn để ghi hoàn/đảo có lý do, trong giới
  hạn phần chưa hoàn. Xác minh việc hoàn thực tế riêng; thao tác chỉ ghi sổ.
  Hóa đơn Owner và tổng thực thu cùng tính phần đã hoàn, không tự gia hạn gói.
  Nếu thuê bao hết hạn còn nghiệp vụ tồn, Manager cấp quyền vận hành tạm tối
  đa 7 ngày có lý do. Quyền này chỉ cho hoàn tất nghiệp vụ hiện có; tạo booking,
  bán hàng và cấu hình vẫn khóa. Theo dõi hạn hoặc thu hồi khi xong. Khách sạn
  bị đình chỉ/gói bị tắt không được mở lại bằng quyền này.

Kiểm thử booking, tiền và quyền bằng dữ liệu của môi trường nghiệm thu trước
khi dùng thật. Channex thật cần kiểm xác thực webhook, thuế/dịch vụ, revision và
ACK của kênh pilot; mô phỏng cục bộ không thay thế nghiệm thu provider.

## Cổng CI

Workflow `.github/workflows/ci.yml` chạy lint, suite Python trên PostgreSQL 18
thật với hai role riêng, và frontend lint/test/build. Password được tạo ngẫu
nhiên theo job và che log; không dùng secret production. Bootstrap chỉ tạo/xóa
database/role UUID do chính lần chạy sinh ra. `scripts/run_ci_tests.py` từ chối
thiếu URL test và thất bại nếu bất kỳ test nào bị skip.

Quản trị repository cần đặt hai job `backend`/`frontend` thành required checks
trong branch protection. Workflow không tự bật cấu hình đó và không tự deploy.
Sau deploy, xác nhận `/api/ready`, vòng quét worker thành công và smoke test
nghiệp vụ trước khi cho sử dụng phiên bản mới.
