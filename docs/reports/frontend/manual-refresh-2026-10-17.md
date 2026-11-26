# Giảm request tự động ở PMS — 17/10/2026

## Hành vi sau cập nhật

| Dữ liệu | Trước đây | Sau cập nhật |
| --- | --- | --- |
| Workspace | Mỗi 30 giây, khi focus hoặc hiện lại trang | Tải ban đầu khi chọn khách sạn/phiên đăng nhập, sau thao tác lưu, hoặc khi bấm **Tải lại dữ liệu** |
| Thông báo | Mỗi 60 giây và khi focus | Tải ban đầu để hiển thị số chưa đọc, khi mở chuông, đổi bộ lọc, đánh dấu tất cả đã đọc, hoặc bấm **Tải lại** |
| Trạng thái kết nối và lịch sử OTA | Mỗi 8 giây tại trang tích hợp | Tải khi mở trang, sau thao tác cấu hình/gửi yêu cầu, hoặc bấm **Tải lại** |

Nút tải lại workspace xuất hiện phía trên nội dung của các tab PMS, kèm thời điểm cập nhật gần nhất theo múi giờ khách sạn. Các báo cáo phụ thuộc `workspaceRevision` chỉ tải lại sau khi workspace thực sự cập nhật. Nút tải lại OTA dùng chung cho các tab trong trang tích hợp; lịch sử và kết nối vẫn giữ nút tải lại riêng.

Workspace chặn request trùng, không áp dụng phản hồi vào trang đã rời đi, khi đang lưu, có hộp thoại hoặc có biểu mẫu chưa lưu. Thông báo và OTA không tạo timer hay tải lại do cửa sổ trình duyệt được focus. Dữ liệu từ nhân viên khác cần được tải lại chủ động. Luồng worker đồng bộ OTA phía backend vẫn hoạt động như trước.

## Request `/cdn-cgi/rum` trên `pms.xloc.id.vn`

Đây là endpoint Cloudflare Web Analytics. Cloudflare nhận dữ liệu đo hiệu năng ở lớp edge; request này không gọi API nghiệp vụ PMS. Repo không chứa mã nhúng Cloudflare beacon, nên nhiều khả năng script được Cloudflare tự chèn vào HTML.

Để ngừng các request này trên tên miền đang chạy:

1. Mở Cloudflare dashboard → **Web Analytics**.
2. Chọn website tương ứng với `pms.xloc.id.vn` → **Manage site**.
3. Chuyển automatic setup sang **Disable**.
4. Tải mới hoàn toàn trang ứng dụng rồi kiểm tra Network với bộ lọc `rum`.

Chưa thay cấu hình Cloudflare hoặc triển khai lên production trong thay đổi mã nguồn này. Nếu vẫn cần đo hiệu năng nhưng muốn giảm đo các lần chuyển tab SPA, Cloudflare hỗ trợ nhúng script thủ công với `"spa": false`; cần tắt automatic setup trước để tránh nhúng trùng.

Tài liệu chính thức:

- [Endpoint `/cdn-cgi/` do Cloudflare quản lý](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/)
- [Bật/tắt Web Analytics và automatic setup](https://developers.cloudflare.com/web-analytics/get-started/)
- [Tắt phép đo SPA khi nhúng script thủ công](https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/)

## Kiểm tra

- Frontend: 154 test đạt, gồm kiểm tra không polling/focus refresh, chặn request trùng, bảo vệ bản nháp và bỏ qua phản hồi sau khi rời trang.
- Production build thành công; lint không có lỗi, còn các cảnh báo sẵn có ở phần khác.
- Chưa kiểm tra Network trên môi trường production. Sau triển khai, để mỗi tab đứng yên hơn 60 giây để xác nhận không có request lặp tới workspace, notifications hoặc channels; bấm tải lại và kiểm tra dữ liệu mới, đồng thời thử lưu một thay đổi để xác nhận dữ liệu được cập nhật sau thao tác.
