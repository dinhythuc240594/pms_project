# Biên bản đồng bộ nguồn PMS ngày 27/11/2026

Đợt đồng bộ 26–27/11/2026 cập nhật `pms_project` theo mã nguồn hiện có trong `pms-system`, thay cho việc chỉ chuyển các gói workflow cũ. Giữ tên PMS, phần giới thiệu dự án và các chức năng chatbot/marketing AI đã có ở repo đích.

## Mốc đối chiếu

| Nội dung | Giá trị |
| --- | --- |
| Nguồn | `pms-system`, nhánh `main`, commit `ea0398ffab5049a684170d68900bff4cc5e04325` |
| Nền repo đích | `63d453b515bd4a2bfe209a336331de4b9e69694e` |
| Nhánh cập nhật | `loc/2026-11-26-source-sync-ai-log` |
| Repo nhận | [dinhythuc240594/pms_project](https://github.com/dinhythuc240594/pms_project) |

Nguồn sạch trước và sau đối chiếu; toàn bộ 794 hash file nguồn được kiểm tra lại và không thay đổi. Không chỉnh sửa hoặc commit vào repo nguồn.

## Phạm vi chuyển mã

- 984 file nguồn được xét ban đầu; loại 190 file đầu ra Graphify, browser/Playwright và cấu hình workspace Postman riêng của máy.
- 794 file hợp lệ: trước đồng bộ có 282 file mới, 339 file khác byte và 173 file giống byte so với repo đích.
- Chép 619 file (282 mới, 337 thay đổi); README và `.gitignore` được ghép thủ công.
- Sau ghép có 762 file giống byte nguồn và 32 file khác nguồn có chủ đích.
- Giữ đủ 70 file chỉ có ở repo đích. Trong nhóm này cập nhật fixture `frontend/src/apps/pms/chatbot/Chatbot.test.js` theo context chọn khách sạn mới và hai README AI để bỏ hướng dẫn thiếu core đã lỗi thời; giữ riêng kết quả kiểm chứng lịch sử.

Số file so sánh theo byte khác số đường dẫn trong Git diff vì Git chuẩn hóa xuống dòng và có những thay đổi trước đó đã tồn tại ở repo đích. Các số này không đại diện số tính năng mới hoặc tác giả mã ban đầu.

Không chuyển `.env`, khóa/mật khẩu, dependency cài đặt, cluster database, cache, log hoặc tệp kiểm chứng tạm vào commit. Các báo cáo cũ có sẵn trong nguồn được giữ nguyên ngày và phạm vi; chúng không phải kết quả kiểm tra mới của đợt này.

## Các điểm ghép thủ công

| Phần | Lý do |
| --- | --- |
| Backend AI | Giữ đăng ký route/model/CLI, cấu hình và quyền cho chatbot/marketing; giữ hỗ trợ liên hệ SMTP từ nguồn. |
| Frontend AI | Ghép route, điều hướng, provider, API, locale và fixture; giữ kiểm tra quyền và chọn khách sạn. |
| Pillow | Khôi phục dependency cần cho marketing, pin `12.0.0` với hash wheel từ [metadata chính thức PyPI](https://pypi.org/pypi/Pillow/12.0.0/json). |
| Ruff | Dùng target `py314` phù hợp CI/Docker và cú pháp của các file repo đích được giữ lại. |
| Kiểm thử frontend | Cập nhật bảy file kiểm thử theo định dạng tiền USD và màn hình chi tiết membership hiện tại; không đổi hành vi ứng dụng để khớp kỳ vọng cũ. |
| Fixture database | Core migration chạy trước installer schema AI đã đăng ký; bảo vệ bằng cấu hình testing và kiểm tra lỗi. Chỉ thay đổi hỗ trợ kiểm thử, không đổi migration production. |
| Tài liệu và ignore | Giữ giới thiệu PMS, cập nhật hướng dẫn theo nguồn mới và bỏ các kiểu ignore từng che Markdown/kiểm thử; loại thêm đầu ra máy cục bộ. |

Danh sách 32 đường dẫn, hash nguồn/đích và 65 commit module nằm trong [manifest đồng bộ](source-sync-2026-11-27.json). Các file kiểm thử mới bổ sung kiểm tra tích hợp AI và helper schema. Lịch sử dùng một nhánh chung, chia theo module; không dùng commit rỗng hoặc sửa ngày để thể hiện đóng góp.

## Kết quả kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Frontend | 704 đạt, 0 lỗi, 0 bỏ qua ở lần chạy cuối. |
| Build frontend | Thành công; còn cảnh báo chunk lớn hơn 500 KB. |
| Backend cô lập | 100 đạt: 62 kiểm tra nền, 22 marketing, 12 chatbot và 4 fixture schema mô phỏng. |
| Ruff | 0 phát hiện. |
| Oxlint | 0 lỗi, 47 cảnh báo. |
| i18n audit | Chạy thành công; 887/4.581 ứng viên chưa có trong catalog. |
| Alembic | 50 revision duy nhất, không thiếu cha, một head `0045_room_type_details`; kiểm tra SQL offline. |
| Bảo toàn nguồn | Nguồn không đổi; file binary đã stage/commit giữ đúng byte. |

Các kết quả kiểm thử áp dụng cho **cây làm việc đã ghép đầy đủ**, không phải xác nhận từng commit trung gian đã chạy độc lập. Backend dùng provider mô phỏng, chặn kết nối ngoài và database SQLite cô lập ở những bài AI; không chạy toàn bộ bộ kiểm thử PostgreSQL. Log chi tiết nằm ngoài Git trong thư mục kiểm chứng cục bộ.

Chưa chạy PostgreSQL thật, migration/restore thật, SMTP, Channex/provider AI thật, Docker hoặc nghiệm thu bằng trình duyệt. Cảnh báo HMR do cổng đang bận xuất hiện trong kiểm thử nhưng không làm lần chạy cuối thất bại. Cần kiểm chứng các phần này ở môi trường riêng trước khi vận hành.

## Hồ sơ nộp học phần

[Nhật ký AI](../../submission/ai-usage-log/ai_usage_log.md) tổng hợp 36 lượt người dùng thấy trong lịch sử chat và ghi riêng 9 query artifact. PDF/ZIP là **bản dự thảo chưa đầy đủ lịch sử AI toàn dự án, chưa ký xác nhận**; còn cần lịch sử các phiên khác, thông tin học phần/nhóm và phần tự rà soát của sinh viên. Chưa nộp lên cổng trường.

Đợt này tích hợp mã sẵn có và ghi nhận sự hỗ trợ của AI trong đối chiếu, tổ chức Git, kiểm tra và tài liệu. Số commit hoặc tên tác giả Git không chứng minh ai tự viết từng dòng hay số ngày làm việc.
