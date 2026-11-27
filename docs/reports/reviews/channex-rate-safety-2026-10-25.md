# Báo cáo an toàn giá và rate plan Channex

Đây là ảnh chụp đánh giá **trước khi sửa**. Các phần mã đã được xử lý trên nhánh
`codex/channex-rate-safety`; xem [báo cáo thực hiện](channex-rate-safety-fixes-2026-10-25.md)
để biết kết quả và các bước nghiệm thu thật còn lại.

Ngày kiểm tra: **25/10/2026, giờ Việt Nam**. Phạm vi: source hiện tại, các kiểm tra cục bộ và tài liệu Channex. Đây là báo cáo đánh giá và đề xuất; chưa thay đổi nghiệp vụ, dữ liệu khách sạn hoặc cấu hình bán phòng.

## 1. Kết luận để quyết định

**PMS có thể nhận booking có giá từng đêm khác nhau mà không cần tự xây một hệ thống định giá theo thị trường.** Khi nhập booking, hệ thống đang dùng tiền Channex trả về, không thay bằng giá cơ bản PMS.

Tuy nhiên, **chưa đủ cơ sở để xác nhận an toàn cho mọi gói giá Channex/OTA đang bán**. Bốn điểm cần ưu tiên:

1. Sửa phòng/ngày của booking OTA trong PMS có thể làm mất giá OTA và tính lại theo giá nội bộ.
2. Gửi tồn phòng và gửi giá là hai thao tác riêng; tồn có thể đã mở trong khi giá mới chưa gửi được.
3. Một hạng phòng hiện chỉ ghép được một rate plan. Gói con hoặc gói khác chưa ghép có thể tạo booking phải xử lý thủ công.
4. Thuế và hoa hồng thực tế từ OTA chưa được đối soát đầy đủ; tiền phòng đúng chưa chứng minh tiền phải thu/tiền OTA chuyển về đúng.

**Chưa kiểm tra tài khoản vận hành và chưa xác định bất kỳ khoản thất thoát hay nghĩa vụ bù tiền thực tế nào.** Rủi ro trong báo cáo là khả năng từ luồng xử lý và điều kiện phát sinh, không phải kết luận khách sạn đã bị thiệt hại.

Kế hoạch chi tiết: [Kế hoạch xử lý](../../plans/channex-rate-safety-2026-10-25.md).

## 2. Hiểu đúng “giá cứng” và “giá biến động”

Ba chuyện khác nhau đang dễ bị gọi chung là giá biến động:

| Khái niệm | Ví dụ | Hiện trạng PMS |
| --- | --- | --- |
| Giá khác theo ngày | Thứ Sáu 1 triệu, thứ Bảy 1,2 triệu | Đã có giá theo ngày, có thể gửi Channex |
| Gói giá/cách tính khác | Không hoàn tiền, có ăn sáng, theo số khách, giá kế thừa | Chỉ quản lý gửi giá cho một gói manual/per-room mỗi hạng phòng |
| Tự điều chỉnh theo nhu cầu thị trường | Tăng giá khi công suất cao hoặc sát ngày | Chưa thấy engine định giá theo thị trường trong phạm vi đã đọc |

Channex tách `sell_mode` (theo phòng/theo số khách) với `rate_mode` (manual, derived, auto, cascade). Manual vẫn có thể nhận giá khác nhau từng ngày; nó không có nghĩa giá phải bất biến. [Tài liệu Rate Plans](https://docs.channex.io/api-v.1-documentation/rate-plans-collection).

Booking có `days`, `amount`, `currency` và mã phòng/gói giá. Tài liệu còn mô tả `meta.parent_rate_plan_id` cho một số trường hợp gói kế thừa/occupancy. Không nên tự suy rằng mã gói con sẽ luôn bằng mã gói cha. [Tài liệu Bookings](https://docs.channex.io/api-v.1-documentation/bookings-collection).

Ví dụ minh họa: PMS có giá cơ bản 1.000.000đ/đêm; OTA xác nhận hai đêm 900.000đ và 1.200.000đ. Tiền phòng của booking đó phải giữ 2.100.000đ. Không được lấy 1.000.000đ × 2 để ghi lại booking chỉ vì bảng giá PMS khác OTA.

## 3. Các lớp bảo vệ đã có

| Bảo vệ | Bằng chứng trong source | Ý nghĩa và giới hạn |
| --- | --- | --- |
| Lọc loại gói có thể gửi giá | `backend/pms_api/channels/service.py:251` | Chỉ nhận `per_room`, `manual`, cùng tiền tệ tenant và không `inherit_rate` |
| Kiểm lại catalog trước gửi | `backend/pms_api/channels/service.py:490`, `:553` | Xác minh property, phòng và quan hệ phòng–gói; đổi mode/currency trên Channex có thể bị chặn khi gửi tiếp |
| Chặn giá mở bán không dương | `backend/pms_api/channels/service.py:577` | Không gửi giá 0 để mở bán; không chặn được mọi giá dương nhưng nhập quá thấp |
| Ghép booking theo cặp mã chính xác | `backend/pms_api/channels/importer.py:430` | Theo tenant + remote room + remote rate; không tự ghép bằng tên hoặc đoán gói gần giống |
| Giữ giá OTA và kiểm tổng tiền | `backend/pms_api/channels/importer.py:94`, `:532`, `:583` | Đủ từng đêm; tổng đêm khớp tổng phòng và booking; ghi trực tiếp các giá đó vào đêm lưu trú |
| Giữ booking lỗi để kiểm tra | `backend/pms_api/channels/importer.py:379`; `backend/pms_api/channels/service.py:702` | Booking chưa xử lý được không được ACK thành công |
| Bảo vệ mapping đã dùng | `backend/pms_api/channels/routes.py:458` | Không đổi tùy tiện mã đã nhận booking/có thể đã xuất dữ liệu |
| Đối chiếu tồn trước mở xuất ARI | `backend/pms_api/channels/service.py:479` | Có cổng đối chiếu booking/tồn khi đưa khách sạn vào đồng bộ |
| OTA thu tiền không biến thành tiền đã nhận | `backend/pms_api/channels/importer.py:533` | Lưu bên thu tiền vào metadata, không tự tạo payment PMS |

Giao diện cũng lọc gói đúng phòng và loại được hỗ trợ: `frontend/src/apps/pms/channel-manager/catalog.js:1`, `pages/OTA.jsx:137`. Manager tạo gói manual/per-room; gói phức tạp có giới hạn chỉ xem: `backend/pms_api/admin/channex_remote.py:622`, `:663`.

Đây là các bảo vệ có thật; không nên báo lại lỗi gửi giá 0 đã được sửa như một lỗi hiện hành. Các tài liệu ngày 19–20/10 có một số kết luận cũ, nên báo cáo này đối chiếu lại source.

## 4. Rủi ro cụ thể

### R1 — P0: Sửa phòng/ngày có thể tính lại tiền booking OTA

**Mức chứng minh: xác nhận đường đi trong source; chưa tái hiện bằng request trên database.**

`EditReservationView` coi thay đổi số phòng hoặc ngày là thay đổi lưu trú (`backend/pms_api/bookings/routes.py:798`). Sau đó gọi `quote_stay` (`:820`), xóa/thay các đêm lưu trú và thay `pricing_snapshot` (`:835`, `:853`). Chỉ thông tin commission được giữ; dấu nguồn `channel` không được giữ trong phép gán này. Không thấy nhánh riêng nhận diện booking OTA bằng liên kết `ChannelBooking`.

Điều này áp dụng cả đổi từ phòng 101 sang 102 cùng hạng, cùng ngày, trước check-in. Nếu giá OTA khác bảng giá nội bộ và không bị điều kiện khác chặn, tiền phòng sẽ được tính lại. Ví dụ 2.100.000đ phía trên có thể thành 2.000.000đ. Chiều chênh lệch có thể tăng hoặc giảm. Bảo vệ không giảm tổng xuống dưới tiền đã thu vẫn có, nhưng không bảo vệ toàn bộ hợp đồng giá OTA.

**Cách sửa nhỏ nhất:** dùng liên kết OTA bền vững; đổi phòng vật lý cùng hạng/cùng ngày phải giữ giá đêm, tỷ giá và nguồn. Đổi hạng/ngày cần thao tác đối soát rõ ràng. Trước khi có luồng đó, chặn thao tác chưa hỗ trợ với thông báo cụ thể.

### R2 — P0: Phòng trống đã mở nhưng giá mới chưa cập nhật

**Mức chứng minh: thứ tự gọi trong source và ca kiểm thử đã có; chưa kiểm tra trạng thái OTA thật.**

`backend/pms_api/channels/publication.py:126` gửi availability trước, rồi `:127` gửi restrictions/rate. Đường gửi trong `service.py:664` có cùng thứ tự. Hai request không phải một giao dịch nguyên tử. Nếu request thứ nhất thành công, request thứ hai lỗi hoặc không rõ kết quả, tồn ở Channex có thể đã thay đổi trong khi giá cũ còn hiệu lực.

Job báo lỗi và retry không đồng nghĩa cửa bán đã đóng. Mức thiệt hại phụ thuộc giá cũ, stop-sell cũ và tình trạng OTA tại thời điểm đó. Test hiện có mô tả lỗi ở bước thứ hai: `backend/tests/test_channels_integration.py:648`.

**Cách xử lý:** thiết kế riêng nhánh mở/tăng tồn và nhánh đóng/giảm tồn; không coi đảo thứ tự hai request là giải pháp đủ cho mọi trường hợp. Trước khi mở thêm phòng cần kiểm giá/trạng thái đích, theo dõi phần đã gửi và xử lý timeout không rõ kết quả. Kiểm thử crash/retry để tránh tự mở lại dữ liệu cũ.

### R3 — P1: Một phòng chưa quản lý được nhiều gói giá

`ChannelMapping` có unique theo hạng phòng nội bộ, remote room và remote rate (`backend/pms_api/channels/models.py:46`). Không thể biểu diễn đầy đủ cùng một hạng phòng có Standard + Non-refundable + Breakfast bằng các mapping độc lập hiện tại.

Nếu booking về một cặp mã chưa ghép, importer trả `booking_unmapped`. Nó không tự lấy giá cứng thay thế. Tuy nhiên, booking ở OTA có thể đã được xác nhận: **không ACK không phải hủy booking hay xóa nghĩa vụ phục vụ khách**. Cần có người xử lý hàng đợi kịp thời.

Tài liệu mô tả metadata về gói cha nhưng importer chưa đọc metadata đó. Không thêm fallback về cha chỉ dựa trên tên hoặc một mã chưa kiểm chứng; phải xác minh quan hệ và cho phép nhận booking một cách rõ ràng.

**Cách xử lý:** kiểm kê gói thật trước. Chỉ tách mapping phòng và mapping rate plan khi cần nhiều gói; tách quyền nhận booking với quyền gửi giá. Gói con có thể được nhận theo mapping đã xác minh mà PMS không cần tự tính lại công thức giá của gói đó.

### R4 — P1: Giá nội bộ và giá gửi OTA có thể khác nhau dù mapping đúng

PMS đã có quy tắc ngày trong tuần/LOS, đặt sớm/sát ngày, ở N trả M và voucher: `backend/pms_api/pricing/models.py:16`, `engine.py:160`. Báo giá trực tiếp lấy DailyRate/base rồi áp engine (`backend/pms_api/catalog/routes.py:415`). ARI chỉ lấy DailyRate hoặc base (`backend/pms_api/channels/service.py:581`).

Ví dụ không có ghi đè theo ngày: base 1.000.000đ, rule cuối tuần +20% → PMS có thể báo 1.200.000đ, nhưng ARI vẫn gửi 1.000.000đ. Đây là hai chính sách tính giá khác nhau; README đã ghi giới hạn (`backend/README.md:435`).

**Cách xử lý:** hiển thị rõ giá nào áp dụng trực tiếp/OTA; preview giá thực sự gửi từng ngày. Nếu cần tăng cuối tuần trên OTA, có thể dùng DailyRate hiện có trước. Không tự chuyển LOS/voucher/khuyến mãi thành một giá đêm chung vì chúng phụ thuộc từng booking.

### R5 — P1: Thuế, hoa hồng và số tiền cần đối soát chưa đầy đủ

`normalize` không giữ/diễn giải `ota_commission`, thuế từng phòng hay thuế OTA đã thu (`backend/pms_api/channels/importer.py:94`). Hoa hồng booking nhập lấy từ nguồn OTA nội bộ có tên khớp và đang hoạt động (`:543`); phần đối soát tính theo phần trăm snapshot đó (`backend/pms_api/finance/commissions.py:313`).

Tài liệu booking có trường về hoa hồng và thuế, nhưng ý nghĩa gross/net và khoản nào đã thu cần kiểm chứng theo OTA và payload thật. Tổng đêm khớp tổng booking chỉ chứng minh phép cộng của phần tiền được nhận, không chứng minh đã tách đủ thuế, tiền khách trả và tiền OTA sẽ chuyển.

Kiểm tra tổng hợp cục bộ cho thấy thêm `ota_commission` và một dòng thuế vào payload không thay đổi kết quả chuẩn hóa. Đây là bằng chứng trường bị bỏ qua, không phải bằng chứng mẫu đó là giao dịch Channex thực tế hay thuế đã bị tính sai một khoản cụ thể.

**Cách xử lý:** chốt hợp đồng gross/net, thuế bao gồm/chưa gồm, commission và bên thu tiền. Trước khi tự động hỗ trợ đầy đủ, đánh dấu cần đối soát các trường hợp tài chính chưa hiểu; không cộng lại thuế đã nằm trong tiền phòng, không biến cờ OTA thu tiền thành payment thật.

### R6 — P2: Lưu mapping và truy vết chưa đủ rõ

- API lưu mapping kiểm UUID/local room/lịch sử nhưng chưa kiểm catalog tại thời điểm lưu (`backend/pms_api/channels/routes.py:431`). Worker kiểm lại trước gửi, nên cần phân biệt “đã lưu” với “đã xác minh/gửi thành công”.
- Snapshot booking đã nhận có provider/booking ID/bên thu tiền nhưng chưa giữ đủ mã room/rate và breakdown theo revision để truy nguyên một chênh lệch (`backend/pms_api/channels/importer.py:533`).
- Chưa thấy ngưỡng giá tối thiểu/chênh lệch bất thường hoặc đọc lại giá đích sau gửi trong luồng đã kiểm tra. Giá dương nhưng nhập quá thấp vẫn có thể hợp lệ về mặt kỹ thuật.

## 5. Việc vận hành nên làm trước khi mở rộng

1. Kiểm kê từng property → room → rate plan, gói cha/con, currency, kiểu tính theo khách, thuế và chương trình giảm giá OTA; đánh dấu gói đang mở bán và gói nào PMS chưa nhận được.
2. Trong lúc chưa sửa R1, hạn chế sửa phòng/ngày booking OTA qua luồng chỉnh booking chung; nếu cần xử lý, so tiền trước/sau và đối chiếu OTA.
3. Dùng giá theo ngày đã có cho gói manual/per-room đã xác minh; tránh hiểu rằng rule nội bộ tự sang OTA.
4. Theo dõi booking `needs_review`, `booking_unmapped` và lỗi gửi giá; phân công người xử lý. Booking lỗi nhập vẫn có thể là cam kết thật với khách.
5. Nếu cần ngừng bán khẩn cấp, kiểm đóng ở mức tồn phòng và xác minh kết quả trên kênh. Channex cảnh báo stop-sell ở gói cha có thể không đóng hết gói con/khuyến mãi; hướng dẫn dùng availability bằng 0 ở cấp phòng. [Hướng dẫn đóng bán](https://help.channex.io/en/articles/16439719-stop-sell-and-derived-rates-why-a-closed-property-can-still-take-bookings).

**Không tự tắt kết nối như một cách đóng bán:** README hiện nêu tắt kết nối chỉ dừng worker, không tự đóng OTA. Báo cáo này chưa thao tác đóng/mở bán nào.

## 6. Kiểm chứng đã thực hiện và giới hạn

| Kiểm tra | Kết quả | Phạm vi chứng minh |
| --- | --- | --- |
| Backend: `test_pricing_values` + `ChannelOccupancyValidationTests` | 4 test đạt; lệnh cuối exit 0 | Phân bổ giảm giá, ưu đãi ở N trả M và kiểm tra occupancy cơ bản |
| Frontend: `catalog.test.js` + `presentation.test.js` | 9 test đạt; exit 0 | Lọc gói, khóa target đã dùng, tiền/currency hiển thị và trường catalog bất biến |
| Assert trực tiếp `normalize` | Giữ 110 + 160 = 270; tổng 280 bị chặn | Giá đêm biến đổi không bị thay bằng base price; không gọi database/Channex |
| Assert metadata tiền | Xác nhận đầu ra không đổi khi thêm commission/thuế | Trường bổ sung bị bỏ qua trong bước chuẩn hóa |
| Assert `supported_rate_plan` | Gói chuẩn được nhận; 6 cấu hình chưa hỗ trợ bị chặn | per-person, derived, auto, cascade, currency khác, inherit-rate |
| Test `LinkedChannexTools` | Không chạy được do thiếu `jsdom` | Chưa xác nhận module giao diện này; chưa cài thêm package |

Một lệnh backend ban đầu chỉ định nhầm tên lớp test không tồn tại; đã chạy lại lớp đúng và đạt. Không tính lỗi chọn test này là lỗi sản phẩm. Các test tích hợp PostgreSQL, lỗi gửi dở dang và sửa booking OTA mới được đọc, chưa chạy lại trong lần đánh giá này.

Không đăng nhập Channex/OTA thật; không đọc database vận hành; chưa kiểm tra giá khách nhìn thấy, voucher OTA đang bật, trạng thái thanh toán thực tế hoặc số tiền bồi hoàn. Orbit không phân giải được tên miền trong môi trường hiện tại; dùng trực tiếp tài liệu Channex chính thức để đối chiếu. Không tạo/push tài nguyên Postman hoặc gọi API có tác dụng thay đổi dữ liệu.

Tra cứu graphify được dùng để tìm điểm vào; graph hiện có thiên về frontend/thiết kế, nên mọi kết luận nghiệp vụ ở trên đều đối chiếu lại source hiện hành.

## 7. Quyết định đề xuất

Ưu tiên **bảo vệ giá booking và quy trình xuất giá trước**, sau đó thêm khả năng nhận nhiều rate plan theo nhu cầu khách sạn thực. Chưa cần xây engine tự định giá theo thị trường để giải quyết vấn đề mapping này.

Chỉ xem pilot đã qua cổng nghiệm thu khi kiểm được chuỗi: **giá PMS dự kiến → payload gửi → giá Channex lưu → giá OTA hiển thị → booking trả về → công nợ/đối soát**, gồm trường hợp lỗi giữa chừng. Chênh lệch do khuyến mãi/thuế/currency phải có giải thích; không bắt mọi số tiền trên các màn hình bằng nhau một cách máy móc.
