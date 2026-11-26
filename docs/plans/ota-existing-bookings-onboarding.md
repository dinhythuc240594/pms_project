# OTA: nhập booking cũ và đối chiếu tồn

Phạm vi: mục 11–12 và mục 2 của audit 19/10/2026. Các bản sửa 1/4/6 được giữ nguyên.

## Hợp đồng

- Test migration tạo fixture ở schema `0023` rồi upgrade HEAD; không hạ schema có lịch sử đêm và không bỏ guard bảo vệ lịch sử.
- CI khởi động HTTP simulator hiện có trên loopback, chờ sẵn sàng, truyền URL và dọn process. Cổng bắt buộc vẫn từ chối test skip.
- Kết nối PMS có checkpoint đối chiếu tồn và revision riêng. Migration `0031` để mọi kết nối chưa xác nhận, gồm các kết nối đã có.
- Tải booking cũ chỉ dùng capability `attributes.actions` do Channex trả về. Kênh phải thuộc đúng một property đã liên kết PMS, đang bật và đã ghép nối.
- Yêu cầu trở thành job `load_bookings`; worker gọi endpoint cố định `POST /channels/{id}/execute/load_future_reservations`. Các yêu cầu trùng cùng đích ghép nối dùng lại job; lỗi được thử lại thủ công.
- Ghi claim trước remote POST. Timeout, phản hồi không rõ hoặc worker chết không tự lặp POST; trạng thái lỗi giữ chặn gửi tồn.
- Thành công chỉ là đã yêu cầu Channex tải nền. Không suy ra nhập xong từ HTTP thành công hoặc feed trống.
- Người có quyền `channels.write` xác nhận đã nhập đủ booking tương lai và đối chiếu tồn với OTA. Xác nhận dùng revision hiện tại, không còn load/import revision/ACK đang chờ hoặc booking cần đối soát. Poll feed chung không chặn xác nhận thủ công để tránh tự khóa khi queue đầy.
- Chặn ARI qua API, lịch tự động và worker cho đến khi xác nhận. Giữ khoảng tồn chưa gửi; nhận booking, ACK và đóng bán vẫn hoạt động.
- Tải lại, reconnect/kích hoạt hoặc thay đổi ghép nối trong LOHA làm mất checkpoint. Đổi tên, xoay API key cùng property và thay đổi booking thông thường không tự làm mất checkpoint.
- Khi đang gửi ARI, thao tác làm mất checkpoint phải chờ lượt gửi kết thúc. Chặn tồn được lưu trước remote mutation để còn hiệu lực khi timeout hoặc process dừng.

## API/UI

- Snapshot `/channels` có `connection.inventoryReconciledAt` và `onboarding` gồm revision, thời điểm xác nhận, số tác vụ booking, số review và yêu cầu load mới nhất từng kênh.
- Kênh remote có `supportsLoadFutureReservations`.
- `POST /channels/remote/{channelId}/load_bookings` nhận revision kênh và `confirm: true`; trả job, HTTP 202. Luồng quản trị property dùng cùng action và chỉ áp dụng property đã liên kết PMS.
- `POST /channels/onboarding/reconcile` nhận revision onboarding và `confirm: true`; trả trạng thái mới. UI cần checkbox xác nhận rõ, hỗ trợ chỉ xem và chống xác nhận từ màn hình cũ.
- UI dùng chung PMS/manager, ba ngôn ngữ hiện có, có hướng dẫn nhập thủ công với kênh không hỗ trợ.

## Nguồn và giới hạn

[Channel API](https://docs.channex.io/api-v.1-documentation/channel-api) định nghĩa capability actions. [Airbnb onboarding](https://docs.channex.io/channel-api-examples/airbnb#7.-load-the-existing-reservations) mô tả tải nền và tùy chọn tải mọi listing đã ghép.

Checkpoint chỉ chặn yêu cầu giá/tồn do PMS phát sinh. Channex có thể tự đồng bộ dữ liệu đã lưu khi kích hoạt/ghép kênh; cần kiểm tra tồn đang có trên Channex/extranet trước thao tác. Không đổi quyền ghi OTA, dữ liệu tiền hoặc tự giải quyết booking cần đối soát.

Khi triển khai: dừng worker cũ, chạy migration, cập nhật API/frontend/worker cùng phiên bản, chạy worker mới để nhận booking trong khi ARI bị chặn, rồi xác nhận đối chiếu trên UI. Chưa thực hiện deployment hoặc gọi OTA thật trong lượt sửa.
