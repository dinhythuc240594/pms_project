# Hướng dẫn test Channex staging với LOHA PMS

Cập nhật luồng nhận booking **17/10/2026**: triển khai migration `0024_channel_booking_reviews` cùng API, worker và frontend. Migration giữ receipt/lịch sử cũ, thêm hồ sơ đối soát riêng và dấu hủy cho booking chưa nhập được. Kiểm thử hồi quy dùng PostgreSQL tạm riêng; chưa thay thế nghiệm thu với Channex staging thật.

Cập nhật giao diện Client ngày **14/10/2026**: OTA chỉ nằm trong **Cài đặt hệ thống → Kênh OTA**. Tab **Kênh OTA** quản lý các kết nối Booking.com, Airbnb và kênh được Channex hỗ trợ của khách sạn đang chọn; tab **Kết nối & ghép loại phòng** chứa cấu hình Channex, ánh xạ LOHA và các nút đồng bộ; tab **Lịch sử đồng bộ** theo dõi kết quả. Đường dẫn `/id/ota` và `/id/ota-history` cũ chuyển vào Cài đặt, vẫn giữ tham số quay về Airbnb. Khi nâng phiên bản cần deploy cả backend và frontend; không cần migration mới cho phần chuyển giao diện này.

Ngày đối chiếu: **10/10/2026**. Dành cho trường hợp **đã có tài khoản Channex staging, chưa tạo khách sạn**. Đối chiếu mã nguồn LOHA local nhánh `main`, baseline `a57777c` và thay đổi chưa commit về lưu khóa OTA trong ứng dụng. Cần triển khai cùng migration `0013_channel_credentials` trước khi dùng luồng mới.

Mục tiêu lượt đầu: gửi giá/phòng trống từ LOHA sang Channex; nhận booking mới, sửa và hủy từ Channex về LOHA. Chưa thực hiện cuộc gọi API Channex thật, chưa nhập khóa và chưa chạy certification trong lần chuẩn bị tài liệu này.

## 1. Lộ trình nên dùng

1. Tạo một khách sạn thử USD, một loại phòng và một gói giá trên Channex.
2. Chuẩn bị khách sạn LOHA tương ứng, cũng dùng USD.
3. Tạo API key, lấy ba UUID và cấu hình kết nối LOHA.
4. Chạy worker, kiểm tra gửi giá và tồn phòng trong 7 ngày.
5. Dùng ứng dụng Booking CRS trên Channex để thử tạo/sửa/hủy booking.
6. Sau khi luồng trên đạt, mới thử kênh Booking.com mẫu nếu cần.

Đây là nghiệm thu kết nối cơ bản. Phần certification có tiêu chí riêng ở mục 10.

## 2. Tạo khách sạn staging

Đăng nhập [Channex staging](https://staging.channex.io/), mở **Properties → Create** và tạo cấu hình thử sau:

| Trường | Giá trị đề xuất cho LOHA |
|---|---|
| Tên khách sạn | `Test Property - LOHA` |
| Tiền tệ | **USD** |
| Múi giờ | `Asia/Ho_Chi_Minh` |
| Loại cơ sở | Hotel |
| Liên hệ/địa chỉ nếu được yêu cầu | Thông tin thử nghiệm của bạn |

Đây là dữ liệu mẫu do mình đề xuất; tên trường có thể thay đổi theo giao diện. Tài liệu chính thức cho phép tạo property bằng giao diện rồi ghép thủ công với PMS. [Properties and Groups](https://docs.channex.io/application-documentation/properties-and-groups-management), [PMS Integration Guide](https://docs.channex.io/guides/pms-integration-guide).

Trong **Rooms**, chọn đúng property, tạo:

| Đối tượng | Cấu hình đề xuất |
|---|---|
| Room Type | `Standard` |
| Count of Rooms | `3`, nếu LOHA có ba phòng vật lý thuộc loại Standard |
| Sức chứa | `2` người |
| Rate Plan | `BAR - USD` |
| Rate mode | **Manual** |
| Sell mode | **Per Room** |
| Currency | **USD** |
| Occupancy chính | `2`, không vượt sức chứa loại phòng |

Số lượng phòng phải theo LOHA thực tế. **Room Type là loại phòng**, không phải từng phòng 101/102/103. Giá kiểm thử sẽ gửi từ LOHA; việc tạo rate plan chưa chứng minh giá/tồn từng ngày đã được đồng bộ. [Rooms Management](https://docs.channex.io/application-documentation/rooms-management), [Rate Plans](https://docs.channex.io/api-v.1-documentation/rate-plans-collection).

Adapter hiện chỉ ghép **một rate plan cho mỗi loại phòng LOHA**. Lượt đầu dùng một loại phòng/một rate plan để phù hợp mô hình này; không tạo bốn gói rồi giả định LOHA tự đồng bộ cả bốn. [Ràng buộc mapping trong LOHA](E:/Github/pms-system/backend/pms_api/channels/models.py).

## 3. Chuẩn bị khách sạn LOHA

Đăng nhập tài khoản **Chủ khách sạn**, chọn đúng khách sạn thử.

- Vào **Cài đặt hệ thống → Thông tin Doanh nghiệp → Hồ sơ & Thông tin chung**, đặt **Tiền tệ cơ sở = USD** và **Múi giờ khách sạn = Asia/Ho_Chi_Minh** rồi **Lưu cấu hình** để khớp Channex.
- Kiểm tra loại phòng Standard có sức chứa 2 và số phòng vật lý đúng với Channex.
- Đặt giá cơ bản Standard, ví dụ **100 USD/đêm**. Giá mẫu là lựa chọn cho bài test, không phải yêu cầu cố định của Channex.
- Chọn một khoảng lưu trú trong tương lai, không trùng booking có sẵn; dùng cùng các ngày khi so sánh hai hệ thống.

Nếu đã có lịch sử booking hoặc tài chính, LOHA sẽ chặn đổi tiền tệ. Khi đó dùng một khách sạn thử mới thay vì sửa tiền tệ của dữ liệu đang có. Đổi đơn vị tiền không tự chuyển giá 800.000 VND thành 100 USD; phải nhập lại giá thử phù hợp. [Giới hạn tiền tệ](E:/Github/pms-system/backend/pms_api/catalog/routes.py:117), [Khóa đổi tiền tệ sau phát sinh](E:/Github/pms-system/backend/pms_api/catalog/routes.py:708).

## 4. Tạo API key và lấy ID

Trên Channex mở **Organisation → API Keys → Create new API Key**. Bỏ chọn **Access to all properties**, chọn property thử vừa tạo; lưu khóa ngay vì giao diện chỉ hiển thị một lần. Hướng dẫn chính thức không xác nhận các trường hạn dùng hoặc quyền read/write riêng, nên không cần tìm các trường đó theo tài liệu này. [API Key Access](https://docs.channex.io/application-documentation/api-key-access).

Cần ghi lại:

| Giá trị | Ý nghĩa |
|---|---|
| Channex Property ID | UUID của khách sạn `Test Property - LOHA` |
| Channex Room Type ID | UUID của loại phòng `Standard` |
| Channex Rate Plan ID | UUID của `BAR - USD` thuộc đúng Standard |
| LOHA Tenant ID | Mã khách sạn phía LOHA; dùng cho worker và callback |

Nếu giao diện không hiện ID, dùng Postman hoặc công cụ API cá nhân để **đọc** ba danh mục dưới đây. Base URL staging là `https://staging.channex.io/api/v1`; header xác thực là `user-api-key`, giá trị là khóa của bạn. Lấy `data[].id` của đúng tên và kiểm tra quan hệ property/room type.

```text
GET /properties
GET /room_types?filter[property_id]=PROPERTY_UUID
GET /rate_plans?filter[property_id]=PROPERTY_UUID
```

Các danh mục có phân trang; không giả định kết quả trang đầu chứa mọi property trong tài khoản lớn. [API Reference](https://docs.channex.io/api-v.1-documentation/api-reference), [Properties list](https://docs.channex.io/api-v.1-documentation/hotels-collection/get-list-of-properties-api), [Room types list](https://docs.channex.io/api-v.1-documentation/room-types-collection/get-list-of-room-types-api), [Rate plans list](https://docs.channex.io/api-v.1-documentation/rate-plans-collection/get-list-of-rate-plans-api).

**Không nhầm Property UUID của Channex với Hotel ID dạng số của Booking.com.** Ví dụ `10485037` là ID kênh Booking.com mẫu, không điền nó vào ô Property ID của LOHA.

## 5. Thiết lập kết nối và xác thực LOHA

### Người vận hành: thiết lập chung một lần

Triển khai API và worker cùng code, chạy migration `0013_channel_credentials`, rồi đặt **cùng một** `CHANNEX_ENCRYPTION_KEY` hợp lệ cho cả hai tiến trình. Đây là khóa mã hóa hệ thống, khác API key Channex của từng khách sạn. Tạo khóa Fernet một lần bằng hướng dẫn trong [README backend](E:/Github/pms-system/backend/README.md); lưu trong runtime secret của Coolify và sao lưu riêng với database. Không tạo khóa mới mỗi lần khởi động hoặc thay khóa tùy ý: khóa khác sẽ không đọc được dữ liệu đã lưu.

Nếu có API HTTPS công khai, đặt thêm `CHANNEX_WEBHOOK_BASE_URL`, ví dụ `https://api-staging.example.com`, để worker tự đăng ký webhook. Giá trị phải là HTTPS origin, không có path/query/fragment. Chưa có endpoint công khai thì để trống và dùng poll. Production đọc runtime của Coolify; local đọc hai cấu hình chung này từ `backend/.env`. Khởi động lại cả API và worker sau khi thay cấu hình chung. [Loader cấu hình](E:/Github/pms-system/backend/pms_api/config.py), [Mã hóa khóa tenant](E:/Github/pms-system/backend/pms_api/channels/credentials.py).

Không đưa khóa mã hóa hoặc API key vào biến frontend `VITE_`, Git, ảnh/log hoặc cuộc trò chuyện. Coolify chỉ cần cấu hình chung cho luồng mới, không cần một cặp biến cho mỗi khách sạn.

### Chủ khách sạn: nhập khóa trong ứng dụng

Chọn đúng khách sạn LOHA, mở **Cài đặt hệ thống → Kênh OTA → Kết nối & ghép loại phòng → Thiết lập kết nối**:

1. Môi trường: **Thử nghiệm (Staging)**.
2. Mã khách sạn Channex: Property UUID vừa tạo.
3. Khóa API Channex: nhập khóa được cấp quyền cho property đó.
4. Bật **Cho phép đồng bộ**, bấm **Kiểm tra & lưu**.
5. Sau khi lưu, kiểm tra trạng thái **Đã lưu mã hóa**, thời điểm kiểm tra kết nối và trạng thái webhook. Theo dõi **Lịch sử đồng bộ** nếu webhook còn chờ hoặc lỗi.

Backend kiểm tra quyền quản lý khách sạn và đọc đúng property từ Channex trước khi lưu API key cùng secret webhook được tạo tự động, mã hóa theo tenant/property/môi trường. Khóa không được trả lại cho giao diện; ô API key luôn để trống khi mở lại. Xác minh property chỉ chứng minh quyền đọc property, **chưa chứng minh quyền ghi giá/tồn**; phải chạy bài ARI ở mục 7. [Luồng lưu/xác minh](E:/Github/pms-system/backend/pms_api/channels/routes.py), [Giao diện OTA](E:/Github/pms-system/frontend/src/apps/pms/channel-manager/pages/OTA.jsx).

Khi chỉnh sửa:

- Để trống API key để giữ khóa hiện có của cùng property/môi trường. Nhập khóa mới để thay thế; secret webhook được giữ cho cùng kết nối.
- Đổi property hoặc môi trường phải nhập API key mới và chỉ được thực hiện trước khi có lịch sử tác vụ/booking. Tác vụ đăng ký webhook cũng tính là lịch sử; kiểm tra ID trước khi bật đồng bộ.
- Có thể tạm dừng kết nối mà không gọi Channex hoặc cần đọc khóa mã hóa. Bật lại sẽ kiểm tra quyền đọc property; lỗi xác minh giữ kết nối ở trạng thái tạm dừng. Tạm dừng không đóng bán trên OTA.
- Cấu hình cũ bằng biến theo tenant tiếp tục hoạt động. Để trống giữ nguyên nguồn cũ; nhập lại API key mới chuyển sang lưu mã hóa. Không tự nhập khóa cũ từ môi trường vào database. Các biến cũ vẫn phải có trong môi trường tiến trình API/worker cho đến khi chuyển đổi xong.

Lưu khóa thành công và webhook sẵn sàng là hai trạng thái khác nhau. Web server chỉ xếp tác vụ `setup_webhook`; cần worker xử lý và endpoint HTTPS có thể nhận callback. Secret do backend sinh không cần nhập thủ công hoặc hiển thị lại.

## 6. Ghép loại phòng và chạy worker

Tại **Ghép nối loại phòng → Ghép loại phòng**:

- Loại phòng LOHA: Standard.
- Mã loại phòng Channex: Room Type UUID của Standard.
- Mã gói giá Channex: Rate Plan UUID của BAR - USD.
- Trạng thái: **Đang bật** → **Lưu ghép nối**.

Worker kiểm tra rate plan phải thuộc đúng property/room type, là **manual + per_room**, dùng cùng tiền tệ với LOHA và không kế thừa giá. Lượt thử dùng rate plan độc lập, không có parent hay kế thừa restrictions. Mapping UUID đúng định dạng nhưng sai quan hệ vẫn sẽ lỗi. [Kiểm tra mapping/rate plan](E:/Github/pms-system/backend/pms_api/channels/service.py).

Chạy **một worker cho tenant thử**, dùng cùng Python/runtime với API. Từ thư mục `backend`, lệnh thử nhẹ:

```powershell
python manage.py process-channel-jobs --tenant 'TENANT_ID_CUA_BAN' --watch --interval 15 --limit 1
```

Thay `TENANT_ID_CUA_BAN` bằng mã thật. Trong workspace hiện tại, nếu chưa có Python trong PATH/venv, có thể thay `python` bằng `..\.tools\python314\python.exe`.

`--limit 1` giảm burst lúc smoke test; không phải bộ giới hạn tốc độ hoàn chỉnh. Tài liệu Channex nêu giới hạn mỗi property: 10 request availability và 10 request restrictions mỗi phút. Không chạy nhiều worker hoặc bấm gửi liên tục để thử vượt giới hạn. [Rate limits](https://docs.channex.io/api-v.1-documentation/rate-limits).

Từ migration `0023_channel_ari_pacing`, worker giữ nhịp ARI tối thiểu 7 giây cho mỗi kết nối; sau lỗi tạm thời chờ ít nhất 60 giây hoặc lâu hơn theo lịch thử lại. Nhận booking và ACK vẫn chạy trong khoảng chờ. Cần chạy `python manage.py db upgrade` với code mới trước khi khởi động API/worker mới. Lỗi đang chờ thử lại giữ trong lịch sử nhưng không phát thông báo thất bại; thông báo cũ được giữ nguyên.

Tác vụ đồng bộ được xếp hàng; worker gửi ARI, nhận booking và đăng ký webhook. Riêng **Kiểm tra & lưu** gọi Channex để xác minh property ngay trước khi lưu. Một job thành công không chứng minh toàn bộ chuỗi import/ACK/ARI đã xong: cần đợi các job tiếp theo. Worker hiện còn lên lịch gửi nền 366 ngày, chia nhiều job tối đa 31 ngày, nên lúc vừa bật mapping có thể xuất hiện nhiều tác vụ. [Worker/scheduler](E:/Github/pms-system/backend/pms_api/channels/service.py).

## 7. Kiểm tra giá và tồn phòng trước

Vào **Gửi giá & phòng trống**, chọn 7 ngày tương lai. Ô **Đến trước ngày** không bao gồm ngày kết thúc: từ 01/11/2026 đến trước 08/11/2026 là các đêm 01–07/11.

| Thử nghiệm từ LOHA | Kết quả cần thấy trên Channex |
|---|---|
| Gửi 7 ngày, Standard có 3 phòng trống, giá 100 USD | Inventory hiển thị đúng 3 và 100 ở từng đêm |
| Đổi giá một ngày thành 123 USD | Ngày đó thành 123; các ngày khác giữ nguyên |
| Tạo booking nội bộ chiếm 1 phòng | Tồn các đêm lưu trú giảm từ 3 còn 2 |
| Hủy booking nội bộ vừa tạo | Tồn được trả lại đúng các đêm |
| Bật đóng bán một ngày bằng giá theo ngày | Stop sell bật và availability gửi đi bằng 0 |
| Mở bán lại ngày đó | Stop sell tắt, tồn tính lại từ LOHA |

Thao tác thay đổi giá/booking thực hiện ở màn hình nghiệp vụ LOHA; outbox sẽ xếp tác vụ. Khi cần gửi lại một khoảng để đối soát, dùng nút gửi trong OTA. Theo dõi **Lịch sử đồng bộ** bên LOHA và **Inventory / Property Tasks / Change Log** bên Channex. Không coi dòng “đã thêm vào hàng đợi” là hoàn tất. [Inventory](https://docs.channex.io/application-documentation/inventory-management), [Property Tasks](https://docs.channex.io/application-documentation/property-tasks), [Change Log](https://docs.channex.io/application-documentation/change-log-feature), [Outbox LOHA](E:/Github/pms-system/backend/pms_api/channels/service.py).

## 8. Kiểm tra booking bằng Booking CRS

Trong Channex, mở **Applications**, thêm **Booking CRS** cho property thử. Mở **Bookings → Create**. Lối tạo thủ công này được tài liệu certification mô tả; đây là ứng dụng có API còn beta. [Booking receiving](https://docs.channex.io/api-v.1-documentation/pms-certification-tests#id-11.-booking-receiving), [Booking CRS API](https://docs.channex.io/api-v.1-documentation/booking-crs-api).

Lượt đầu: một phòng Standard, BAR - USD, hai người lớn, một hoặc hai đêm tương lai; không dịch vụ/tax/fee bổ sung, không ghi nhận thu tiền/cọc. Tổng tiền phải bằng tổng giá từng đêm. Đây là bộ dữ liệu đơn giản phù hợp importer hiện tại, không phải giới hạn của Channex.

| Thao tác trên Channex | Kết quả cần kiểm tra tại LOHA |
|---|---|
| Tạo booking mới | Xuất hiện đúng một booking; đúng khách, ngày, loại phòng, tiền và USD |
| Bấm “Nhận đặt phòng” lại | Không tạo thêm booking hoặc chiếm tồn lần nữa |
| Sửa ngày/giá khi booking còn xác nhận, chưa thu tiền | Cập nhật cùng booking; tồn/tiền phản ánh dữ liệu mới |
| Hủy booking | Booking chuyển hủy, trả lại tồn; không tự tạo giao dịch hoàn tiền |
| Worker xử lý ACK | Revision đã lưu không còn chờ nhận; nếu lỗi import thì không ACK |

Worker dùng feed revision, lấy nội dung, lưu booking trước rồi mới ACK qua một job khác. Các thay đổi import cũng xếp job cập nhật ARI; đợi worker chạy tiếp để Channex phản ánh tồn sau sửa/hủy. Poll feed mỗi phút giúp bù webhook bị lỡ; có thể dùng nút **Nhận đặt phòng** để chủ động xếp lượt đọc. [Feed/ACK best practices](https://docs.channex.io/guides/best-practices-guide), [Luồng import/ACK](E:/Github/pms-system/backend/pms_api/channels/service.py).

Trong **Lịch sử đồng bộ → Cần xử lý**, LOHA giữ hồ sơ riêng có phân trang, gồm Booking ID, Revision ID, mã OTA, ngày lưu trú, tiền tệ, loại phòng/gói giá và sức chứa được gửi. Hồ sơ không bị mất khi tác vụ trôi khỏi 50 dòng gần nhất. Không lưu thông tin thẻ, raw message hay thông tin liên hệ khách vào hồ sơ này.

- Booking đã tồn tại trên Channex nhưng hết phòng tại LOHA được giữ ở `needs_review`, không tự gán thêm phòng và không ACK. Tồn dựa trên phòng vật lý đang hoạt động, lịch ở và phòng bị khóa/bảo trì; số lượng khai báo trên Channex không tạo thêm phòng vật lý trong PMS.
- Lỗi nghiệp vụ dừng tự thử lại và chỉ phát thông báo khi hồ sơ lần đầu cần xử lý. Sau khi sửa nguyên nhân, người có quyền `channels.write` dùng **Thử lại** ở đúng hồ sơ/tác vụ. Nút nhận booking hoặc poll feed không tự mở lại các hồ sơ này. Lỗi kết nối tạm thời vẫn dùng backoff có giới hạn.
- Bản hủy được xác minh bằng việc lấy revision từ Channex, kiểm tra đúng property, Booking ID và thời gian revision. Nếu đã nhập thì trả tồn một lần; nếu chưa có booking gốc thì lưu dấu hủy, không tạo đặt phòng giả. Revision cũ đến muộn không thể làm booking sống lại. Hai revision khác ID nhưng cùng thời gian được giữ để đối soát thay vì suy đoán thứ tự từ UUID.
- Chỉ `imported`, `stale` hoặc `cancelled` đã commit mới được ACK. Hồ sơ `needs_review` không phải receipt an toàn để ACK. Một revision mới hơn đã xử lý an toàn có thể kết thúc các hồ sơ cũ của cùng booking bằng receipt `stale`; các lần lỗi cũ vẫn được giữ lại trong hồ sơ đối soát.

API đọc hồ sơ theo tenant: `GET /api/tenants/<tenant_id>/channels/booking-reviews?page=1&pageSize=25`, trả `items` và `pagination`. Snapshot `/channels` có `bookingReviewCount`; thử lại có chủ đích dùng `POST /channels/jobs/<job_id>/retry`. [Booking revision và ACK](https://docs.channex.io/api-v.1-documentation/bookings-collection).

Việc tạo/sửa CRS là bất đồng bộ; phản hồi xong chưa có nghĩa booking đã đọc được ngay. **Đợi booking mới nhập LOHA và job ACK thành công rồi mới sửa; đợi lượt sửa xong rồi mới hủy.** Giữ booking ở trạng thái xác nhận, chưa thu tiền/thêm chi phí: importer LOHA hiện từ chối một số cập nhật booking đã nhận phòng hoặc đã có giao dịch. Extra services, tổng tiền lệch, ngày từng phòng khác nhau cũng có thể bị giữ lỗi. Cờ “OTA đã thu tiền” chưa tạo payment PMS. [Giới hạn LOHA](E:/Github/pms-system/BE12_IMPLEMENTATION_REPORT.md:51).

## 9. Webhook và kênh OTA mẫu

### Webhook tự động của luồng mới

Channex không gọi được URL `127.0.0.1` trên laptop của bạn. Để thử callback, cần một endpoint HTTPS staging công khai trỏ về API, ví dụ:

```text
https://API_STAGING_CUA_BAN/api/channex/webhooks/LOHA_TENANT_ID
```

Với `CHANNEX_WEBHOOK_BASE_URL` đã cấu hình, khi lưu API key mới và bật đồng bộ hoặc bật lại kết nối, LOHA xếp tác vụ **Đăng ký webhook**. Worker tìm callback đúng property/tenant rồi tạo hoặc cập nhật cấu hình của LOHA, dùng sự kiện **booking**, active, `send_data=false` và custom header **X-Channex-Webhook-Secret** ngẫu nhiên đã mã hóa. Secret không trả về trình duyệt, nên không cần chép secret hoặc tự tạo webhook trong Channex. Worker đối chiếu callback trước mỗi lần thử để tránh tạo trùng sau lỗi giao dịch. [Webhook API](https://docs.channex.io/api-v.1-documentation/webhook-collection), [Endpoint LOHA](E:/Github/pms-system/backend/pms_api/channels/routes.py), [Đăng ký callback](E:/Github/pms-system/backend/pms_api/channels/client.py).

Sau khi job thành công, tạo một booking CRS và kiểm tra callback được chấp nhận cùng các job nhận booking/ACK. Trạng thái đăng ký thành công chưa chứng minh Channex gọi được endpoint. Khi job lỗi, xem nguyên nhân trong lịch sử và thử lại sau khi sửa cấu hình/quyền Channex. Nếu hệ thống tìm nhiều webhook trùng callback/property, cần người vận hành xử lý trùng trước khi thử lại.

**Cấu hình cũ:** webhook đã đăng ký thủ công có thể tiếp tục dùng secret môi trường cũ. Nếu cần tạo lại cho luồng cũ, dùng property-level, active, event **booking**, `send_data=false` và custom header trên bằng secret runtime của tenant. Không đăng ký `*`, webhook global hay dùng secret của khách sạn khác. Khi chuyển sang lưu mã hóa, LOHA giữ secret hợp lệ của cùng kết nối và có thể quản lý callback tự động nếu đã bật cấu hình chung.

LOHA nhận `booking`, `booking_new`, `booking_modification`, `booking_cancellation`, `non_acked_booking`, kiểm tra property/secret rồi trả 202 để xếp job. Sự kiện ARI hoặc message không thuộc luồng booking này. Khi chưa có HTTPS callback, vẫn có thể kiểm tra luồng poll/nhận thủ công, nhưng chưa coi phần webhook đã nghiệm thu.

### Booking.com: bước tùy chọn sau CRS

Tài liệu hiện có khách sạn mẫu **10485037, USD** phù hợp lộ trình này. Tạo kênh Booking.com trong Channex, nhập Hotel ID mẫu ở cấu hình **kênh**, ghép cả room và rate rồi kích hoạt. Khi đã có tồn/giá, dùng [trang đặt thử USD](https://secure.booking.com/book.html?hotel_id=10485037&test=1) để tạo booking. Kiểm tra lại tài liệu vào ngày chạy vì các tài khoản mẫu dùng chung và có thể bị gỡ/reset. [Test accounts](https://docs.channex.io/guides/test-account-for-booking.com), [Booking.com mapping](https://docs.channex.io/channel-mapping-guides/booking.com).

Nếu báo “Channel Already Exists”, dùng tài khoản mẫu khác **có tiền tệ phù hợp**, hoặc tự liên hệ Channex để xin slot thử. Các mẫu GBP/EUR không dùng trực tiếp với importer VND/USD hiện tại. Mẫu **12152494 (OTA Pay)** yêu cầu thẻ thật, nên không chọn cho lượt này; **10745030** đang được tài liệu đánh dấu không đặt được. Không cần tài khoản extranet Booking.com cho các mẫu API này.

Airbnb staging có thể kết nối **listing thật**, ảnh hưởng giá/tồn thật; không đưa vào lượt smoke mặc định. [Airbnb testing](https://docs.channex.io/guides/test-accounts-for-airbnb).

## 10. Những việc cần làm trước certification

Certification đánh giá thao tác trong PMS và có live screenshare. Tài liệu yêu cầu full sync 500 ngày bằng hai API call; cần lưu Channex task IDs, queue/giới hạn tốc độ và khai báo khả năng chưa hỗ trợ. [PMS Certification Tests](https://docs.channex.io/api-v.1-documentation/pms-certification-tests).

Đối chiếu LOHA hiện tại:

| Khoảng trống trong code | Hệ quả |
|---|---|
| Full sync nền 366 ngày, chia job 31 ngày | Chưa khớp bài full sync chính thức |
| Client bỏ task ID trong response; lịch sử chỉ hiện job ID LOHA | Chưa đủ bằng chứng task ID để nộp |
| Pacing ARI đã có 7 giây/60 giây, chưa nghiệm thu với Channex thật | Kiểm chứng rate limit và phục hồi khi worker/DB lỗi trước certification |
| Một rate plan/loại phòng | Khai báo mô hình và xác nhận cách áp dụng bài nhiều rate |
| ARI gửi giá và stop sell; chưa gửi min/max stay, CTA/CTD | Không đánh dấu các restriction chưa hỗ trợ là đạt |

Nguồn code: [Client/task response](E:/Github/pms-system/backend/pms_api/channels/client.py), [Job JSON](E:/Github/pms-system/backend/pms_api/channels/routes.py), [Scheduler và retry](E:/Github/pms-system/backend/pms_api/channels/service.py).

Kết luận: có thể chuẩn bị và chạy test staging cơ bản theo các bước trên; **chưa có cơ sở tuyên bố LOHA đã đạt certification hoặc sẵn sàng production**.

## 11. Chẩn đoán nhanh

| Hiện tượng | Kiểm tra trước |
|---|---|
| Hệ thống chưa bật lưu khóa an toàn | Cấu hình `CHANNEX_ENCRYPTION_KEY` hợp lệ, cùng giá trị ở API/worker; đã migrate/restart |
| API key không lưu được | Kiểm tra đúng môi trường, Property UUID và quyền API key; lỗi giữ nguyên khóa cũ |
| Job cứ queued | Worker có chạy, cùng database/code và có cùng khóa mã hóa/cấu hình webhook chưa |
| credential_storage_unavailable | Khóa mã hóa hệ thống thiếu hoặc không đúng định dạng Fernet |
| credentials_unavailable | Khóa mã hóa khác khóa đã dùng, ciphertext hỏng/sai tenant, hoặc khóa cũ thiếu; không tự chuyển sang môi trường |
| Webhook đang dùng poll/chưa đăng ký | Kiểm tra HTTPS origin chung; nhập API key và bật đồng bộ hoặc bật lại để xếp job đăng ký |
| channel_webhook_ambiguous | Có nhiều webhook cùng callback/property; đối soát tại Channex trước khi thử lại |
| channel_webhook_list_too_large | Tài khoản có quá nhiều webhook cho giới hạn danh mục; cần người vận hành kiểm tra |
| provider_rejected | Khóa bị thu hồi/sai phạm vi, UUID không có quyền, payload bị từ chối; kiểm Property Tasks |
| channel_mapping_invalid | Property UUID, Room UUID, Rate UUID có cùng quan hệ không |
| channel_rate_plan_unsupported | Manual + Per Room + cùng tiền tệ + không inherit rate |
| provider_rate_limited | Giảm nhịp gửi, đợi cooldown; tránh nhiều worker cùng property |
| provider_unavailable | Xem log `http_status` hoặc `cause` để phân biệt HTTP 5xx, timeout, DNS, TLS hay kết nối; lỗi này không đồng nghĩa với 429 |
| Booking không xuất hiện | Booking có ở Channex chưa; feed/import/ACK có job lỗi không; đúng mapping/currency/ngày chưa |
| channel_booking_not_found | Bản sửa chưa có booking gốc trong LOHA; đối soát Booking ID. Bản hủy đã xác minh được lưu dấu hủy dù chưa có booking gốc |
| channel_cancellation_unverified | Bản hủy chưa có booking gốc: worker đọc booking hiện tại và revision mới nhất, kiểm tra Booking ID, Property ID, trạng thái hủy và thời gian. Chưa xác minh thì giữ Cần xử lý, không ACK. Lỗi mạng/503 được thử lại có giới hạn |
| room_unavailable | Đủ mapping nhưng không còn phòng vật lý bán được trong khoảng ngày: đã có khách, bị khóa hoặc bảo trì. Kiểm tra Cần xử lý; không tăng số phòng ảo để bỏ qua lỗi |
| invalid_booking_occupancy | Số người vượt sức chứa hoặc dữ liệu số khách không hợp lệ; phòng Standard sức chứa 1 không nhận booking 2 người |
| booking_unmapped | Ghép loại phòng/gói giá chưa đúng; kiểm tra cả hai UUID của đúng property |
| channel_room_type_inactive | Loại phòng LOHA đã ngưng hoạt động |
| channel_room_inactive | Loại phòng không có phòng vật lý đang hoạt động |
| Hủy xong tồn chưa đổi | Đợi job ARI sau import; đối chiếu đúng đêm lưu trú |
| Webhook 401/422 | API/worker dùng cùng khóa mã hóa, secret đã đăng ký khớp backend, đúng property/event/Tenant ID |

Job ID LOHA, Channex task ID, Booking ID và Revision ID là các mã khác nhau. Với mỗi bài test, lưu ngày/giờ, ba UUID mapping, thao tác, kết quả mong đợi, job status/error code và ảnh Inventory/booking hai phía. Không đưa API key, secret hoặc số thẻ vào ảnh/log chia sẻ.

Khi triển khai luồng xác minh hủy, chạy migration `0025_channel_cancel_verify` trước khi khởi động API và worker cùng phiên bản. Migration chỉ thêm mốc `cancellation_verified_at`, không viết lại hay xóa lịch sử. Dấu hủy chưa xác minh không đủ điều kiện biến revision tạo cũ thành `stale` để ACK. Booking cần xử lý chỉ được thử lại theo yêu cầu của người có quyền, sau khi khắc phục; chỉ receipt `imported`, `stale`, `cancelled` đã commit mới cho phép tác vụ ACK riêng.

Kiểm thử HTTP cục bộ: chạy `postman simulation run postman/simulations/channex-booking-import.sim.yaml --port 49123 --no-history --output ndjson`, đặt `CHANNEX_SIMULATION_URL=http://127.0.0.1:49123/channex/api/v1`, rồi chạy `python -m unittest tests.test_channel_http_simulation` trong thư mục backend với hai URL PostgreSQL test cùng database `pms_test_*` (`TEST_DATABASE_URL`, `TEST_DATABASE_MIGRATION_URL`). Fixture từ chối database nghiệp vụ. Bộ giả lập dựa trên [Bookings Collection chính thức](https://docs.channex.io/api-v.1-documentation/bookings-collection#get-booking-by-id), chỉ chứa UUID tổng hợp, hỗ trợ xác minh hủy, sai property và lỗi 503; endpoint ngoài phạm vi trả 501. Chưa đăng nhập Postman nên chưa tải được mock của nhà cung cấp; không dùng dữ liệu hay khóa Channex thật.

## 12. Phạm vi đọc và kiểm chứng

Đã rà soát nội dung văn bản **153/153 mục** trong [chỉ mục chính thức](https://docs.channex.io/llms.txt) tại ngày 10/10/2026; không còn trang lỗi truy xuất hoặc phần văn bản bị cắt chưa xử lý.

| Nhóm tài liệu | Số mục đã đọc |
|---|---|
| API v1, gồm các trang CRUD con | 57 |
| Application UI, Google, channel mapping, app guides | 54 |
| General, FOR OTA, channel API examples, retention/PCI | 38 |
| PMS/best practices và Booking.com/Airbnb test accounts | 4 |
| Tổng | **153** |

[Danh sách URL và trạng thái đọc](E:/Github/pms-system/docs/channex-docs-coverage-2026-10-10.json). Các schema OpenAPI lặp lại được gộp khi đọc; ảnh, video, tệp nhị phân và website ngoài chỉ mục chưa được kiểm tra. FOR OTA/Shopping/Open Channel là luồng làm OTA/booking engine, không phải API PMS mà LOHA đang dùng.

Hướng dẫn là bản đối chiếu tài liệu và source, không phải biên bản chạy sandbox. Trong lượt này chưa tạo property/key trên tài khoản của bạn, chưa bật Booking CRS/kênh, chưa mở public callback, chưa gửi booking hoặc thay đổi ARI Channex.
