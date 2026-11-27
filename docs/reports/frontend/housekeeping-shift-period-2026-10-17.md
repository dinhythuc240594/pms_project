# Tạo ca cho 1 ngày, 7 ngày hoặc 1 tháng — 17/10/2026

Modal **Thêm ca làm việc** có ba lựa chọn thời gian. Chọn nhân viên, ngày bắt đầu, giờ làm, ghi chú và trạng thái một lần để tạo cùng ca cho các ngày liên tiếp. Form hiển thị ngay số ca và khoảng ngày thực tế trước khi lưu.

- **1 ngày**: chỉ tạo ca cho ngày bắt đầu; đây là mặc định.
- **7 ngày**: tạo ca cho ngày bắt đầu và sáu ngày tiếp theo.
- **1 tháng**: tính theo lịch từ ngày bắt đầu đến trước ngày tương ứng tháng sau; nếu ngày tương ứng không tồn tại thì chốt mốc tháng sau về ngày cuối tháng. Ví dụ 17/10/2026–16/11/2026 tạo 31 ca; 31/01/2026–27/02/2026 tạo 28 ca. Khoảng ngày cụ thể luôn được hiển thị trên form.

Lưu gửi một request chung đến `POST /housekeeping/shifts` với `period: day|week|month`. Backend dùng các kiểm tra nhân viên, giờ làm, trùng ca và phân quyền hiện có. Mọi ca trong đợt dùng cùng giao dịch và khóa tenant. Nếu một ngày trùng ca đang hoạt động, cả đợt rollback; thông báo chỉ rõ ngày trùng và modal giữ dữ liệu để chỉnh. Workspace chỉ tải lại sau khi request chung thành công.

API tạo một ngày vẫn trả một ca như trước. Tạo 7 ngày hoặc 1 tháng trả tổng số ca, ngày đầu/cuối và các ca đã tạo. Sửa ca vẫn chỉ sửa ca được chọn, không có tùy chọn lặp; không cần migration. Giao diện có bản dịch VI/EN/ZH.

Kiểm tra:

- 162 tests frontend đạt; build thành công, lint phân hệ buồng phòng đạt.
- 6 tests backend mới về tính ngày, cuối tháng, năm nhuận, giới hạn ngày, phản hồi tương thích và lỗi trùng ca đạt.
- Toàn bộ backend suite chạy 115 tests, kết quả OK, 54 mục bỏ qua theo điều kiện môi trường. Ruff check/format các file mới và chỉnh sửa đạt.
- Đã bổ sung test PostgreSQL cho tạo ca hàng loạt, rollback cả ca và log, phân quyền, sửa một ca và hai request đồng thời. Nhóm này chưa chạy vì chưa cấu hình database test riêng.
- Chưa kiểm thử tương tác trực tiếp trong trình duyệt hoặc deploy. Cần triển khai cả frontend và backend để dùng lựa chọn mới.
