# Báo cáo triển khai BE-10 và BE-11

Ngày kiểm chứng: 07/10/2026. Phạm vi: kho, giá nâng cao và tỷ giá trên backend
PostgreSQL cùng các màn hình PMS hiện có. Kiểm thử trên `main`, HEAD `9093f74`
kèm các thay đổi làm việc của đợt sửa này. Chưa triển khai lên Coolify.

| Hạng mục | Đã triển khai |
| --- | --- |
| BE-10 — Danh mục kho | Kho, nhóm hàng, mặt hàng/SKU/đơn vị, nhà cung cấp; tham chiếu theo tenant và quyền kho. |
| BE-10 — Chứng từ | Tồn đầu kỳ một lần, nhập, xuất, chuyển, kiểm kê theo phiên bản tồn và đảo phiếu bằng biến động đối ứng. |
| BE-10 — Đối soát/POS | Sổ biến động bất biến, báo cáo nhập xuất tồn, giá vốn bình quân; định mức POS, hoàn hàng riêng và bù tồn khi hủy hóa đơn. |
| BE-11 — Chính sách giá | Giá cuối tuần/LOS, early bird, last minute và ở N trả M; thứ tự ưu tiên và điều kiện được xử lý tại server. |
| BE-11 — Voucher | Điều kiện ngày/số đêm/tổng tiền, hạn mức sử dụng và ghi nhận lượt dùng nguyên tử cùng booking. |
| BE-11 — VND/USD | Tỷ giá cấu hình, tiền gốc và tiền cơ sở lưu tại giao dịch; hoàn/đảo dùng tỷ giá gốc, báo cáo dùng giá trị đã lưu. |
| Giao diện | Các trang kho, giá, voucher, khuyến mãi, tỷ giá và báo giá/booking dùng API tenant; có tải/lỗi và kiểm tra quyền. |

## Quy tắc nghiệp vụ

Chứng từ kho và biến động đã ghi không sửa hoặc xóa. Tồn đầu kỳ khóa sau lần mở
đầu kỳ hoặc nghiệp vụ kho đầu tiên; sau đó điều chỉnh bằng kiểm kê. Chuyển kho
ghi hai đầu trong cùng transaction và giữ nguyên tổng giá trị. Xuất không làm
âm tồn; kiểm kê dùng phiên bản để từ chối số liệu đã cũ. Ngày chứng từ theo ngày
khách sạn, không trong tương lai hoặc lùi trước chứng từ mới nhất. Số lượng/đơn
giá có bốn chữ số thập phân, giá trị tồn có tám chữ số; đơn vị cuối cùng giữ phần
dư để tránh mất giá trị do làm tròn.

Chỉ dịch vụ có định mức được cấu hình mới tiêu hao kho khi ghi nhận POS. Thiếu
hàng làm cả thao tác ghi hóa đơn và biến động kho rollback. Hoàn tiền không tự
coi là hoàn hàng; trả hàng là thao tác riêng và không vượt lượng đã xuất chưa
trả. Hủy hóa đơn bù theo lượng và giá vốn gốc, kể cả khi danh mục đã ngừng dùng.

Giá theo ngày có ưu tiên cao nhất. Nếu không có giá ngày, chọn một quy tắc đủ
điều kiện theo ưu tiên, rồi chọn một khuyến mãi có giảm giá lớn nhất. Voucher
được chỉ định thay khuyến mãi; không cộng dồn. Báo giá không giữ lượt voucher.
Lượt dùng chỉ tăng khi tạo booking thành công, kể cả voucher giảm bằng không;
hủy booking không trả lại lượt dùng.

Booking và các dòng tiền lưu tiền tệ, tỷ giá và số tiền cơ sở tại thời điểm ghi.
Thay tỷ giá sau đó không định giá lại lịch sử. Sửa liên hệ không tính lại giá;
đổi phòng/ngày của booking CONFIRMED tính lại theo tỷ giá hiện hành, giữ chính
sách voucher gốc và các khoản đã thu, không tiêu thêm lượt voucher. Hoàn/đảo
dùng giá trị đã chốt của dòng gốc; lần hoàn cuối giữ phần giá trị cơ sở còn lại.
Quỹ giữ tiền tệ sau khi có lịch sử và chuyển quỹ không tự đổi tiền tệ.

Tenant RLS/FORCE RLS, khóa ngoại có tenant, role/feature gating, CSRF, audit,
Decimal và idempotency tiếp tục áp dụng. Checkout vẫn chặn booking còn nợ.

## Kiểm chứng đã thực hiện

- **216/216 kiểm thử backend đạt, không bỏ qua**, toàn suite cuối chạy trong
  169,844 giây bằng Python 3.14.0 và PostgreSQL 18.6 trên cluster thử riêng.
  `scripts/run_domain_tests.py` tạo `pms_test_<UUID>` với runtime hạn chế;
  đã xác nhận không còn database tạm của suite sau khi kết thúc.
- Trong suite có **36 kiểm thử trực tiếp BE-10/11**: số học Decimal/giá vốn,
  chứng từ và POS nguyên tử, cạnh tranh xuất/kiểm kê, RLS/tenant/quyền/gói,
  voucher cuối cùng đồng thời, ưu tiên giá, lịch sử tỷ giá/hoàn/đảo và báo cáo.
- Kiểm thử toàn bộ migration tới `0011_notifications`, readiness, quyền runtime
  không DDL và vòng hạ cấp về base rồi nâng cấp lại đều đạt. Vòng schema dùng
  database thử đã làm trống dữ liệu nghiệp vụ; cơ chế từ chối hạ cấp khi có
  cấu hình hoặc lịch sử giá/tiền vẫn được giữ nguyên.
- **34/34 kiểm thử frontend đạt**; lint `src`/`vite.config.js` và production
  build đạt. Lint còn cảnh báo nguồn hiện có; không phải lỗi chặn build.
- **12/12 kiểm thử thông báo đạt** khi chạy riêng trong 12,735 giây và được
  chạy lại trong toàn suite cuối. Bao gồm đổi trạng thái phòng qua danh mục và
  tạo phòng sạch mới không phát thông báo đã dọn; đã tái hiện lỗi trước sửa.
- Ruff check và format check đạt cho backend chính (`pms_api`, `migrations`,
  `tests`, `scripts`, `app.py`, `manage.py`, `gunicorn_conf.py`): 89 file đúng định dạng. Prototype giữ
  riêng không thuộc phạm vi backend được hỗ trợ.
- Rà soát độc lập phần thông báo, RLS/migration, cập nhật trạng thái phòng và
  điều chỉnh tài chính đã hoàn tất; lỗi phát thông báo dọn khi tạo phòng sạch
  mới được sửa và có hồi quy.

## Kiểm thử trình duyệt đã thực hiện

Chạy trên localhost với database fixture riêng, tài khoản owner và dữ liệu giả:

- Đăng nhập và tải lại toàn trang vẫn giữ phiên. Tạo kho **Kho QA** trong
  Settings; tải lại giữ kho. Tạo mặt hàng **QA-WATER**, đơn vị Chai, giá vốn
  5.000 và giá bán 10.000.
- Ghi tồn đầu kỳ **10 × 5.000** thành công. Chi tiết phiếu hiển thị lượng 10,
  giá trị 50.000; mở đầu kỳ khóa sau khi ghi. Báo cáo tồn hiển thị tồn hiện tại
  và cuối kỳ 10, giá trị 50.000 cùng lịch sử chứng từ.
- Lưu quy tắc cuối tuần **+10% thứ Bảy/Chủ Nhật**. Báo giá phòng 101 cho
  **10–12/10/2026** là 110 mỗi đêm, tổng 220 từ giá cơ bản 100; tạo booking
  thành công với tổng 220.
- Chuông báo hiện một booking mới; đánh dấu đã đọc đưa số chưa đọc về 0 và
  lưu trạng thái đã đọc. Lưới cấu hình vai trò nhận thông báo của owner tải được.

Trong lần kiểm tra, form tồn đầu kỳ bị trắng do dùng `crypto.randomUUID` tách
khỏi đối tượng làm initializer. Đã sửa cả ba initializer của form/chi tiết/
trả hàng POS; mở lại form, ghi phiếu, xem chi tiết và báo cáo qua trình duyệt
đều đạt sau sửa. Kiểm thử frontend và build được chạy lại thành công.

Đây là kiểm tra luồng cơ bản đã nêu, chưa phải nghiệm thu thủ công đầy đủ cho
nhập/xuất/chuyển/kiểm kê, voucher/khuyến mãi/tỷ giá/hoàn tiền. Checklist còn lại:
[tasks/be10-be11.md](../../../tasks/be10-be11.md).

## Hồi quy và dữ liệu kiểm thử

Suite ban đầu trước đợt sửa có 179 kiểm thử, một lỗi thất bại và năm lỗi chạy:
dữ liệu mẫu tài chính thiếu các trường tỷ giá bắt buộc; phép thử hạ cấp schema
dùng lịch sử giá từ fixture trước đó; điều chỉnh booking tham chiếu biến tỷ giá
sai vị trí. Đã sửa dữ liệu mẫu, cô lập phép thử schema và sửa điều chỉnh.
Các khẳng định kiểm thử được giữ nguyên, đồng thời hồi quy điều chỉnh USD xác
nhận tiền cơ sở của charge/payment/refund đối ứng khớp nhau.

## Migration và chạy lại

BE-10/11 thêm `0008_inventory` → `0009_pricing`. Dữ liệu tài chính cũ được điền
tiền cơ sở bằng tiền gốc, tỷ giá 1; không tự tạo lịch sử tỷ giá không biết. Đợt
BE-12 nối tiếp bằng `0010_channels` → `0011_notifications`; lệnh upgrade luôn
đi tới head hiện tại. Hạ cấp từ chối làm mất cấu hình/lịch sử đã phát sinh.

Trên môi trường local có Python 3.14 và cluster riêng đã cấu hình:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts/run_domain_tests.py
```

Runtime QA portable của lần này nằm trong `.tools/` được Git ignore, dùng port
25432; không thay `.env` hoặc database local của người dùng. Không đưa thông tin
kết nối local vào bản triển khai. Khi triển khai riêng, dùng tài khoản migrator
của môi trường đó để chạy `python manage.py db upgrade`, rồi kiểm tra
`/api/ready` theo [backend/README.md](../../../backend/README.md).

## Phạm vi còn lại

- Chưa có nghiệm thu Coolify, backup/restore hoặc dữ liệu thật trong lần kiểm
  chứng này. Checkpoint trước sử dụng thật còn mở.
- Chỉ hỗ trợ VND/USD; tỷ giá cấu hình thủ công, không có nguồn tỷ giá tự động
  hoặc nghiệp vụ đổi tiền giữa quỹ. Giao dịch cũ không tự được quy đổi lại.
- Kho dùng giá vốn bình quân; ngày ghi phải theo trình tự. Chưa có kế toán kho
  FIFO/lô/hạn sử dụng hoặc kỳ kế toán riêng trong hợp đồng hiện tại.
- Voucher/khuyến mãi dùng một chính sách giảm giá mỗi booking; hạn mức theo
  voucher, không tự phục hồi sau hủy. Không có cơ chế cộng dồn tùy ý.
- Channex thuộc BE-12 và cần nghiệm thu sandbox với property/mapping/khóa thật.
  BE-10/11 không gọi OTA trong kiểm thử. Email/mobile/API đối tác còn phạm vi
  riêng; không xem là hoàn thành từ các API kho/giá hiện có.

Payload và định nghĩa chính xác: [backend/API_CONTRACT.md](../../../backend/API_CONTRACT.md).
