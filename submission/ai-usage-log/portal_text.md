# Nhật ký sử dụng AI – bản dự thảo toàn dự án PMS

Ngày tổng hợp và mốc dữ liệu hiện có: **27/11/2026**. Hồ sơ khai báo việc dùng Codex/AI để hỗ trợ đối chiếu và tích hợp mã nguồn, tổ chức Git, rà soát, kiểm tra và soạn tài liệu. Tài liệu lưu **36 lượt người dùng** nhìn thấy trong chat và 9 query trích riêng từ artifact dự án; các query artifact không phải bản xuất đầy đủ lịch sử chat.

**Trạng thái: bản dự thảo, chưa đủ lịch sử AI toàn dự án, chưa ký xác nhận.** Người dùng sẽ bổ sung các phiên còn thiếu và phần của các thành viên khác, xác nhận công cụ/model, đầu ra đã dùng và cách tự kiểm chứng trước khi nộp bản hoàn chỉnh.

Đợt cập nhật 26–27/11 giữ chatbot/marketing AI vốn có ở repo đích. Kết quả hiện có gồm **100/100 test backend an toàn** (96 trước đó và 4 test fixture mô phỏng), **704/704 test frontend** ở lượt cuối và build thành công. Còn 47 cảnh báo lint, 887 ứng viên i18n thiếu cùng cảnh báo chunk-size/HMR; chưa kiểm chứng PostgreSQL hay provider thật. Thay đổi fixture chỉ nằm trong kiểm thử, không đổi migration production. Đã tạo 65 commit theo phân hệ trên một nhánh theo yêu cầu người dùng; đối chiếu tại nhánh loc/2026-11-26-source-sync-ai-log thay vì hai snapshot local đã được sắp xếp lại. Các kết quả kiểm tra nêu trên áp dụng cho trạng thái hợp nhất, không xác nhận từng commit trung gian đã được kiểm thử riêng. Nhật ký chưa ghi nhận xác minh push.

Nhật ký không tuyên bố phiên AI này tự viết toàn bộ mã nguồn gốc hay hệ thống đã được nghiệm thu hoàn chỉnh. Sinh viên cần rà soát, bổ sung lịch sử và ký xác nhận; nội dung này không phải xác nhận đã nộp lên cổng trường.
