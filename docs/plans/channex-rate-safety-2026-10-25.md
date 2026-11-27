# Kế hoạch bảo vệ giá và rate plan Channex

Ngày: 25/10/2026. Trạng thái: **đã triển khai phần sửa mã trên nhánh `codex/channex-rate-safety`; chưa nghiệm thu Channex/OTA thật**.

Cập nhật thực hiện: đã bảo vệ đổi phòng OTA; đóng/đọc lại tồn và giá trước mở;
xác minh mapping khi lưu; preview giá; lưu tiền theo revision; dùng commission OTA
thực tế và chặn chi khi booking còn review. Đã thêm gói chỉ nhận booking bằng
`inboundRatePlanIds`, giữ một gói chính gửi giá cho mỗi hạng phòng. Chưa cần tách
thành hệ thống đa gói outbound hoặc engine định giá theo thị trường.

Bổ sung khi rà soát: các lượt ARI giữ đóng bán nếu còn booking cần đối soát hoặc
revision chưa nhập; không mở lại dựa trên tồn thiếu booking. Bước 0 và nghiệm thu
thật ở bước 8 vẫn cần cấu hình/tài khoản pilot. Các checklist bên dưới là tiêu chí
của kế hoạch gốc; xem báo cáo thực hiện để phân biệt kiểm chứng local và live.

Nguồn đánh giá: [Báo cáo rủi ro](../reports/reviews/channex-rate-safety-2026-10-25.md).

Kế hoạch được lưu riêng theo cấu trúc `docs/plans` hiện có, giữ nguyên kế hoạch và checklist nghiệp vụ cũ trong `tasks/`.

## Mục tiêu và nguyên tắc

Mục tiêu là không tự làm đổi tiền đã chốt với khách, không mở thêm phòng với giá chưa xác minh và không bỏ sót booking từ gói giá chưa hỗ trợ.

- Giữ `days/amount/currency` của booking OTA làm dữ liệu giá đã chốt; bảng giá hiện tại dùng cho lần bán mới.
- Một bên chịu trách nhiệm giá xuất cho mỗi gói. Tách gói chỉ nhận booking khỏi gói PMS được quyền gửi giá.
- Mapping theo mã và quan hệ đã kiểm chứng, không theo tên hay suy đoán gói cha.
- Không lưu nguyên payload/thông tin thẻ để bổ sung truy vết; chỉ lưu các trường nguồn và tiền được cho phép.
- Tái sử dụng DailyRate, bảng liên kết OTA, queue, review, audit và snapshot hiện có.
- Chưa thêm engine định giá theo nhu cầu/thị trường; chưa tự áp toàn bộ LOS/voucher lên OTA.

## Các lát triển khai theo thứ tự

### 0 — Kiểm kê cấu hình thật và chốt phạm vi pilot

**Kết quả:** một bảng kiểm kê property, room, rate ID, parent, sell/rate mode, currency, bên quản lý giá, trạng thái bán, thuế và chương trình OTA. Gắn từng gói với trạng thái “gửi + nhận”, “chỉ nhận” hoặc “chưa hỗ trợ”.

**Nghiệm thu:**

- [ ] Bao phủ các gói đang mở bán của khách sạn pilot, kể cả gói con/khuyến mãi chỉ có ở OTA.
- [ ] Có mẫu booking đã che dữ liệu cá nhân cho từng kiểu tiền/gói thực sự dùng; các điều chưa biết được ghi rõ.
- [ ] Chốt giá nội bộ nào cần áp dụng OTA; phần chưa hỗ trợ có người tiếp nhận booking.

**Kiểm chứng:** đọc catalog và giá lịch Channex, đối chiếu extranet/giá OTA; thao tác chỉ đọc. Không tự đóng/mở gói trong bước kiểm kê.

**Phụ thuộc:** không. **Phạm vi:** checklist pilot và báo cáo đối chiếu, không thay schema.

### 1 — P0: Giữ tiền OTA khi chỉ đổi phòng vật lý

**Kết quả:** booking OTA đổi phòng cùng hạng, cùng ngày giữ nguyên giá đêm/tỷ giá/nguồn. Nhận diện bằng liên kết `ChannelBooking`, không chỉ dấu trong snapshot có thể đã mất.

**Nghiệm thu:**

- [ ] Đổi 101 → 102 cùng hạng không đổi tổng, giá từng đêm, exchange snapshot hay nguồn; vẫn kiểm tồn/phòng và capacity.
- [ ] Đổi ngày/hạng chưa hỗ trợ bị chặn với hướng xử lý rõ, không tự báo giá lại âm thầm.
- [ ] Booking trực tiếp giữ hành vi hiện có; thao tác lặp lại không tạo sai tiền/tồn.

**Kiểm chứng:** regression API trên database tạm, giá OTA 900.000 + 1.200.000 khác giá PMS 1.000.000/đêm; cả phòng trống và phòng xung đột; booking đã thu tiền và booking trực tiếp.

**Phụ thuộc:** không cần chờ hỗ trợ nhiều gói. **File dự kiến:** `backend/pms_api/bookings/routes.py`, một module test tích hợp tập trung. Nếu cần UI giải thích thao tác bị chặn, tách thành thay đổi nhỏ cùng contract.

### 2 — P0: Không mở/tăng tồn khi giá đích chưa xác minh

**Kết quả:** ghi lại một quy trình cho xuất giá/tồn có thể thất bại từng phần. Phân biệt giảm/đóng bán với tăng/mở bán; xử lý riêng kết quả chắc chắn và timeout chưa rõ kết quả.

**Nghiệm thu:**

- [ ] Có bảng chuyển trạng thái cho từng lỗi trước/sau request, timeout và crash; bao phủ cả đường publication và đường service còn lại.
- [ ] Không mở/tăng tồn khi bước giá/restrictions bắt buộc chưa xác minh; giảm/đóng tồn không bị chặn bởi lỗi giá không liên quan.
- [ ] Retry không phát lại một snapshot cũ để mở bán sau khi cấu hình/mapping/tồn đã đổi; lịch sử chỉ rõ phần gửi chưa hoàn tất.

**Kiểm chứng:** chạy ứng dụng với upstream HTTP giả lập: thành công toàn phần, availability thành công/rate lỗi, rate thành công/availability lỗi, timeout đã nhận/chưa nhận, worker crash và đổi mapping trong lúc chạy. Sau đó nghiệm thu staging có đọc lại giá/tồn.

**Phụ thuộc:** bước 0 cho contract đọc lại/cấu hình pilot. **File dự kiến:** `channels/publication.py`, `channels/service.py`, test publication, mock/scenario HTTP hiện có. Chỉ thêm trạng thái dữ liệu nếu cơ chế job/range hiện tại không đủ; migration khi cần là một lát riêng.

**Lưu ý thiết kế:** chỉ đảo thứ tự hai request không đủ để chứng minh an toàn mọi trường hợp. Giá cũ, trạng thái stop-sell, gói kế thừa và kết quả không rõ phải được xét.

### Checkpoint A — Cổng bảo vệ cốt lõi

- [ ] Hai vấn đề P0 có regression test tái hiện trước sửa và đạt sau sửa.
- [ ] Không phát sinh thay đổi booking/tồn/tiền ở khách sạn vận hành trong lúc kiểm thử.
- [ ] Thất bại từng phần hiển thị đúng và không bị hiểu là đã đóng bán.

### 3 — P1: Xác minh mapping ngay lúc lưu

**Kết quả:** API từ chối mã sai property/phòng, mode/currency chưa hỗ trợ trước khi báo mapping đã lưu thành công; vẫn giữ kiểm tra trước lúc xuất vì Channex có thể đổi sau đó.

**Nghiệm thu:**

- [ ] UUID hợp lệ nhưng sai quan hệ bị từ chối; tên giống nhau không làm mapping hợp lệ.
- [ ] Catalog tạm lỗi không cho xác nhận mapping mới; vẫn cho yêu cầu đóng bán target cũ theo luồng an toàn hiện có.
- [ ] Mapping đã dùng giữ khóa identity và lịch sử; thay đổi mode/currency sau lưu bị phát hiện khi gửi.

**Kiểm chứng:** API integration với catalog giả lập, test quyền tenant và test dropdown hiện có.

**Phụ thuộc:** phạm vi hỗ trợ từ bước 0. **File dự kiến:** `channels/routes.py`, helper catalog hiện có nếu cần, `test_channel_catalog.py`, `test_channel_mapping_lifecycle.py`.

### 4 — P1: Preview đúng giá thực sự gửi OTA

**Kết quả:** người vận hành thấy ngày, nguồn base/daily, giá gửi, currency, room/rate ID và trạng thái đóng/mở. Nêu rõ rule/LOS/voucher nội bộ nào không áp dụng OTA.

**Nghiệm thu:**

- [ ] Ví dụ base 1 triệu + rule cuối tuần 20% nhưng không DailyRate hiển thị đúng giá OTA 1 triệu và phạm vi rule.
- [ ] Ghi đè theo ngày hiển thị đúng giá sẽ gửi, không nhầm với giá mặc định của catalog Channex.
- [ ] Preview dùng cùng cách dựng dữ liệu với publication và không có tác dụng ghi/gửi giá.

**Kiểm chứng:** contract API, một test nguồn base/daily và kiểm tra giao diện; không thêm một engine tính giá thứ hai cho preview.

**Phụ thuộc:** bước 3; nếu cần đọc giá đích thì dùng contract đã xác minh ở bước 0. **Phạm vi:** API preview và giao diện OTA; chia hai lát nếu vượt khoảng 5 file.

### 5 — P1: Phân loại tiền OTA trước khi tự động đối soát

**Kết quả:** thống nhất room gross/net, thuế bao gồm/chưa gồm/đã thu, commission thực tế, bên thu và tiền khách sạn dự kiến nhận cho từng payload được hỗ trợ.

**Nghiệm thu:**

- [ ] Dựa trên tài liệu chính thức và mẫu payload thật đã che dữ liệu cá nhân; thiếu dữ liệu hiển thị chưa biết, không mặc định bằng 0.
- [ ] Không cộng trùng thuế; commission OTA khác cấu hình nội bộ được nêu rõ; cờ OTA thu tiền không tạo payment.
- [ ] Trường hợp chưa hiểu đi vào review có lý do cụ thể, không được gắn nhãn đã đối soát.

**Kiểm chứng:** bộ fixture cho thuế đã gồm/chưa gồm/OTA đã thu, commission khác cấu hình, currency khác và rounding. So tổng tiền phòng, tiền khách còn phải trả và tiền OTA chuyển như ba số khác nhau có công thức rõ.

**Phụ thuộc:** bước 0. **Phạm vi:** đầu tiên contract + phân loại importer + test, chưa sửa toàn bộ finance. Phần lưu schema và áp vào đối soát tách thành bước 6.

### 6 — P1: Lưu nguồn tiền và nối đối soát theo contract đã chốt

**Kết quả:** giữ các mã nguồn và thành phần tiền cần truy nguyên; finance dùng snapshot đã xác minh hoặc yêu cầu xử lý rõ khi chưa đủ dữ liệu.

**Nghiệm thu:**

- [ ] Truy được property/room/rate/revision liên quan đến giá đã nhận mà không lưu thông tin thẻ/payload tùy ý.
- [ ] Booking cũ không bị tự đổi tiền hoặc backfill bằng số phỏng đoán; trạng thái chưa xác minh vẫn nhìn thấy được.
- [ ] Sửa/hủy/retry revision giữ lịch sử và không tạo thu/hoàn tiền ngoài ý muốn.

**Kiểm chứng:** migration trên database tạm nếu cần; regression importer và commission; kiểm dữ liệu trả API không chứa thông tin nhạy cảm.

**Phụ thuộc:** bước 5. **File dự kiến:** importer, snapshot/model khi cần, migration khi cần, finance commission và test tương ứng; chia tiếp nếu cần trên 5 file.

### Checkpoint B — Giá và tiền có thể truy nguyên

- [ ] Mapping mới được xác minh; preview giải thích giá gửi.
- [ ] Payload tài chính chưa hỗ trợ được phân loại rõ và có người xử lý.
- [ ] Pilot đối chiếu được từ giá nguồn tới tiền booking và số phải thu, không suy từ mỗi tổng phòng.

### 7 — P1 theo nhu cầu: Nhận nhiều rate plan cho cùng hạng phòng

**Kết quả:** tách ghép phòng với ghép gói; một hạng phòng có thể nhận booking của nhiều gói đã xác minh, trong khi chỉ gói được chỉ định mới nhận giá từ PMS.

**Nghiệm thu:**

- [ ] Standard/Non-refundable/Breakfast của cùng phòng không nhân đôi tồn.
- [ ] Booking gói con được ghép theo mã/quan hệ đã cho phép và giữ giá OTA; gói lạ vẫn review, không đoán bằng tên.
- [ ] Migration giữ mapping và lịch sử cũ; restriction và quyền gửi giá từng gói được khai báo rõ.

**Kiểm chứng:** bắt đầu schema/backfill tách riêng; sau đó importer + test; cuối cùng cấu hình UI và publication. Đây là ba lát phụ thuộc nhau, không triển khai một đợt lớn.

**Phụ thuộc:** bước 0, 1, 3 và contract bước 5 nếu gói có dịch vụ/thuế. **Điều kiện làm:** khách sạn pilot thực sự bán các gói này. Không buộc xây engine dynamic revenue.

### 8 — Nghiệm thu staging rồi mở rộng có kiểm soát

**Kết quả:** chứng minh toàn chuỗi trên một hạng phòng, một gói manual/per-room trước, thêm gói khác sau khi được hỗ trợ.

**Nghiệm thu:**

- [ ] Hai đêm giá khác nhau: preview → payload → Channex → OTA → booking PMS đúng với chính sách thuế/discount đã biết.
- [ ] Booking mới/sửa/hủy/gửi trùng, chuyển phòng cùng hạng, gói chưa ghép, currency khác và lỗi request thứ hai có kết quả đúng.
- [ ] Diễn tập đóng bán đã kiểm kết quả trên kênh; có người xử lý review, lỗi gửi, timeout và tiêu chí dừng pilot.

**Kiểm chứng:** bằng chứng đã che dữ liệu cá nhân gồm ID, ngày, giá, currency, revision, trạng thái gửi/đọc lại và screenshot OTA khi phù hợp. Test local/mock đạt chưa thay thế nghiệm thu này.

**Phụ thuộc:** checkpoint A; B cho trường hợp tài chính phức tạp; bước 7 nếu pilot nhiều gói. Triển khai/đóng mở bán thật là công việc tiếp theo, không phải hành động đã thực hiện trong báo cáo.

## Những quyết định cần chốt trước phần triển khai liên quan

1. Các gói đang bán thực tế là manual theo ngày, derived hay theo số khách? Có gói con chỉ tồn tại ở OTA không?
2. PMS hay công cụ khác chịu trách nhiệm gửi giá từng gói? Có cho sửa giá trực tiếp ở Channex không?
3. Weekend/LOS/promotion nội bộ nào cần áp dụng OTA, và giảm giá nào do OTA tự quản?
4. Khi đổi ngày/hạng booking OTA, cần sửa tại OTA trước hay có quy trình chấp thuận chênh lệch tại PMS?
5. Quy ước thuế/commission và ai theo dõi hàng đợi review trong khách sạn pilot?

Đây là đầu vào cho các lát tương ứng, không ngăn việc triển khai regression và bảo vệ giữ giá cùng hạng ở bước 1. Chưa chốt quy ước thì không tự suy diễn công thức tiền.
