# Tạo và phân công buồng phòng nhiều ngày — 17/10/2026

Form **Tạo tự động** trong kế hoạch buồng phòng cho phép:

- Chọn ngày bắt đầu và kết thúc, bao gồm cả hai ngày, tối đa 31 ngày mỗi lần.
- Bấm từng ngày để bỏ qua ngày không làm việc; có nút chọn/bỏ chọn tất cả.
- Chọn nhiều nhân viên đang hoạt động bằng checkbox, kèm chọn/bỏ chọn tất cả.
- Mở từng ngày trong **Ca và phòng theo ngày** để chọn phòng và ca riêng cho từng nhân viên. Mặc định là **Theo nhu cầu tự động** và **Tự động chọn ca sớm nhất**; có thể chọn ca cụ thể hoặc **Không gắn ca**.
- Khi chọn phòng cụ thể, có nút chọn/bỏ chọn tất cả và áp dụng cùng lựa chọn phòng cho mọi ngày đã chọn. Mỗi ngày cần từ 1 đến 500 phòng khả dụng.
- Xem ngay số ngày và nhân viên đã chọn. Form yêu cầu ít nhất một ngày và một nhân viên; không cho gửi khi khoảng ngày không hợp lệ.

Một lần bấm lưu gửi một request `{dates,staffIds,dayPlans?}` rồi cập nhật workspace, thay vì gửi từng ngày hoặc từng công việc từ trình duyệt. `dayPlans` chỉ chứa lựa chọn riêng của các ngày có thay đổi; không gửi ca của nhân viên hoặc ngày đã bỏ chọn. Server kiểm tra toàn bộ nhân viên, phòng và ca trước khi tạo việc, rồi xử lý trong cùng giao dịch. API cũ `{date}` vẫn tương thích; không cần migration.

Ca trong tuần đang hiển thị được dùng lại. Nếu khoảng ngày nằm ngoài dữ liệu đã có, form tải ca chung theo khoảng ngày, có debounce và hủy request cũ khi đổi khoảng/đóng modal, không polling hoặc gọi riêng từng ngày. Lỗi tải ca có nút thử lại; chặn gửi nếu ca hoặc phòng đã chọn không còn hợp lệ.

## Quy tắc phân chia

- Chế độ **Theo nhu cầu tự động** giữ quy tắc khách đến, khách rời, lưu trú và phòng bẩn đang có.
- Chế độ **Chọn phòng thực hiện** giới hạn cả tạo việc và phân công vào danh sách phòng của ngày đó. Nếu chưa có việc tương ứng thì tạo việc dọn kể cả phòng sạch hoặc không có đặt phòng. Không tạo thêm cho phòng đã có công việc thuộc phiên bản phòng hiện tại trong ngày, kể cả công việc đã đóng. Ý định bổ sung có khóa riêng theo ngày, phòng và phiên bản phòng để chạy lại không tạo trùng.
- Phân công các việc `pending` chưa có nhân viên trong những ngày được chọn, gồm cả việc đã tạo trước đó.
- Ưu tiên nhân viên có ít công việc đang mở trong ngày nhất. Khi bằng nhau, xét tải tích lũy trên các ngày đã chọn rồi thứ tự danh sách nhân viên để luân phiên.
- Nếu nhân viên chọn ca cụ thể, gắn đúng ca đó. **Không gắn ca** giữ `shiftId = null` dù có ca đang hoạt động. Chỉ khi để tự động, gắn ca có giờ bắt đầu sớm nhất nếu có. Ca phải thuộc đúng nhân viên, khách sạn, ngày và đang hoạt động; sai một lựa chọn sẽ từ chối cả batch. Đây là chia theo số việc, không phải ước tính thời lượng dọn.
- Giữ nguyên việc đã giao, đang dọn, chờ kiểm tra, hoàn tất hoặc đã hủy. Bỏ qua phòng bảo trì, chờ kiểm tra, đã ngừng hoặc công việc thuộc phiên bản phòng cũ.
- Ghi lịch sử phân công và tăng phiên bản công việc. Khóa tenant hiện có bảo vệ khi hai yêu cầu tạo chạy đồng thời. Chạy lại không đổi các phân công đã có.
- Batch trả số lượng tạo mới, phân công và tổng kết từng ngày; không trả toàn bộ danh sách công việc. Sau lưu, lịch chuyển đến ngày đầu tiên đã chọn; các ngày khác được xem bằng điều hướng tuần.

## Kiểm tra

- Frontend: 159 tests đạt, production build thành công; lint phân hệ buồng phòng không có cảnh báo/lỗi. Các test mới kiểm tra khoảng tải ca, giữ lựa chọn không gắn ca, phòng theo ngày và loại bỏ ngày/nhân viên đã bỏ chọn khỏi payload.
- Backend: 15 tests buồng phòng về validation và thuật toán phân công đạt. Toàn bộ suite chạy 109 tests, kết quả OK, 53 mục bỏ qua theo điều kiện môi trường.
- Ruff check đạt cho các file backend thay đổi; định dạng Python đã kiểm tra.
- Đã thêm test PostgreSQL cho nhiều ngày không liên tục, ca đúng ngày/nhân viên, chọn ca muộn/không gắn ca, tạo việc cho phòng sạch, giới hạn phòng theo ngày, giữ công việc đã đóng, chạy lại, rollback cả batch, phòng/ca/nhân viên không hợp lệ, phân quyền và hai yêu cầu đồng thời. Nhóm tích hợp chưa chạy vì chưa cấu hình PostgreSQL kiểm thử riêng (`TEST_DATABASE_URL` và `TEST_DATABASE_MIGRATION_URL`).
- Chưa triển khai; cần triển khai cả frontend và backend để dùng payload mới. Chưa kiểm thử giao diện trực tiếp trong trình duyệt.
