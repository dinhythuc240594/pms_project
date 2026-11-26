# Báo cáo tiến độ phát triển LOHA PMS

**Người báo cáo:** Lê Trần Xuân Lộc  
**Người nhận:** Nhóm trưởng  
**Ngày báo cáo:** 10/10/2026  
**Kỳ báo cáo:** 03/10/2026 đến hết 09/10/2026, giờ Việt Nam

## 1 Kết quả chính

Trong tuần, em tập trung triển khai backend nghiệp vụ và kết nối các giao diện hiện có với dữ liệu PostgreSQL. Phần việc đã đưa lên `main` bao gồm xác thực và phân quyền theo khách sạn, đặt phòng và thanh toán, POS và sổ quỹ, buồng phòng, báo cáo, kho, chính sách giá, quản trị tài khoản và tính năng. Em cũng bổ sung tích hợp Channex và thông báo trong ứng dụng; riêng kết nối OTA còn cần nghiệm thu với tài khoản nhà cung cấp thật.

Lịch sử Git ghi nhận **19 commit thay đổi và 3 commit merge** trong kỳ, đều có tác giả `Le Tran Xuan Loc`. Các commit đã có trên `main` tại mốc `a57777c` ngày 09/10/2026. Số commit thể hiện lịch sử bàn giao mã, không tương đương số tính năng hoặc số ngày công.

Mốc kế thừa là lần merge nhánh **FE-mynuong** gần nhất, commit `c873066` ngày **21/09/2026**. Giao diện đã có từ trước; phần việc tuần này là tái cấu trúc, cải tiến và nối API, đồng thời bổ sung backend nghiệp vụ. Hai commit ngày 02/10 về cấu trúc frontend và môi trường phân tích là bối cảnh trước kỳ, không tính vào 19 commit trên.

## 2 Các công việc đã thực hiện

### Nền tảng hệ thống và bảo vệ dữ liệu

- Tổ chức backend Flask theo phân hệ, bổ sung PostgreSQL, migration, công cụ chạy database local, kiểm tra kết nối và hướng dẫn Docker/triển khai.
- Nối đăng nhập, đăng xuất, duy trì phiên và chọn khách sạn với API; bổ sung kiểm tra quyền tại máy chủ, CSRF, mật khẩu băm và nhật ký thao tác.
- Áp dụng cách ly dữ liệu theo khách sạn ở database; xử lý lỗi quyền và tránh hiển thị nhầm kết quả khi người dùng chuyển khách sạn.

**Commit tiêu biểu:** `ac83606`, `cf672fe`.

### Đặt phòng và vận hành lễ tân

- Bổ sung API cho khách sạn, loại phòng, phòng, khách hàng, dịch vụ, nguồn đặt phòng và phương thức thanh toán/quỹ.
- Nối luồng đặt nhiều phòng, nhiều khách; báo giá từng đêm, kiểm tra tồn phòng, sửa/hủy booking và nhận/trả phòng. Bổ sung kiểm soát đặt trùng khi có yêu cầu đồng thời.
- Hoàn thiện chi tiết booking gồm khách, dịch vụ/phụ thu, cọc, thanh toán, hoàn tiền, ghi chú và lịch sử. Giá đã chốt được giữ theo booking; thao tác tiền có cơ chế chống ghi trùng khi thử lại.
- Chặn trả phòng khi còn nợ và cập nhật phòng bẩn sau khi trả phòng.

**Commit tiêu biểu:** `ac83606`, `d1db3ef`, `f33c8e3`.

### POS thu chi và buồng phòng

- Triển khai hóa đơn POS, thu từng phần, hoàn/hủy và ghi dịch vụ vào booking; bổ sung phiếu thu, chi, rút, chuyển quỹ, số dư đầu kỳ và đối ứng khi đảo chứng từ.
- Kết nối sổ quỹ với API, bổ sung bộ lọc và kiểm soát số dư để tránh chi âm khi có thao tác đồng thời.
- Bổ sung nhân viên, ca làm, kế hoạch và phân công dọn phòng; luồng dọn, gửi kiểm tra và xác nhận sạch theo quyền. Trả phòng tạo việc dọn trong cùng giao dịch.

**Commit tiêu biểu:** `f33c8e3`, `9f6b22d`.

### Dashboard báo cáo và quản trị dịch vụ

- Thay dữ liệu minh họa trên Dashboard bằng dữ liệu máy chủ; sửa quyền xem của lễ tân và cách đếm khách đang ở đến khi trả phòng thực tế.
- Bổ sung báo cáo phân biệt tiền phòng dự kiến, doanh thu đã ghi nhận, thực thu, ADR, cọc/nợ và đối soát sổ quỹ; kiểm tra kỳ báo cáo và xử lý tiền chính xác.
- Nối quản trị hai gói FREE/PRO, cấp/đổi/gia hạn thuê bao và lịch sử. API kiểm tra thời hạn, tính năng và giới hạn phòng/tài khoản.
- Bổ sung quản trị tài khoản nội bộ, thu hồi phiên khi khóa/đổi quyền; bật/tắt tính năng toàn hệ thống và cấp riêng/dùng thử có hạn cho khách sạn. Owner xem tính năng hiệu lực và lọc nhật ký của khách sạn mình.
- Xử lý bảy nhóm lỗi P1 của báo cáo và thuê bao, gồm cách ly lịch sử, quota, gia hạn, kết nối màn hình quản trị và số liệu Dashboard.

**Commit tiêu biểu:** `f33c8e3`, `b04df22`, `6cf8455`.

### Kho và chính sách giá

- Bổ sung kho, mặt hàng, nhà cung cấp; chứng từ tồn đầu kỳ, nhập, xuất, chuyển, kiểm kê và đảo phiếu; báo cáo nhập xuất tồn và giá vốn bình quân.
- Liên kết định mức tiêu hao POS với tồn kho, xử lý hoàn/hủy và kiểm soát âm tồn.
- Triển khai giá cuối tuần, điều kiện theo độ dài lưu trú, đặt sớm/cận ngày, voucher và khuyến mãi; lưu giá và tỷ giá theo giao dịch.
- Hoàn thiện màn hình giá theo ngày, khóa bán và khóa phòng; lưới giá cho phép chọn nhiều ô để cập nhật hàng loạt, có kiểm tra khoảng ngày.

**Commit tiêu biểu:** `9f6b22d`, `39de278`, `f460300`.

### OTA và thông báo trong ứng dụng

- Bổ sung adapter Channex, cấu hình theo khách sạn và ghép loại phòng/gói giá; hàng đợi đồng bộ, worker, thử lại có giới hạn và lịch sử lỗi.
- Triển khai xử lý booking OTA mới/sửa/hủy, xác thực webhook và chống nhận trùng. Chỉ xác nhận đã nhận bản sửa đổi với Channex sau khi giao dịch database thành công.
- Nối màn hình cấu hình OTA và lịch sử với API. Giao diện phân biệt yêu cầu đang xếp hàng với đồng bộ thành công.
- Bổ sung chuông thông báo, số chưa đọc, đánh dấu đã đọc, phân trang và cấu hình vai trò nhận thông báo theo sự kiện.

**Trạng thái:** Đã có mã tích hợp và kiểm thử với provider giả lập; còn nghiệm thu Channex staging thật trước khi xác nhận vận hành OTA.

**Commit tiêu biểu:** `9093f74`, `39de278`, `1d45fb1`.

### Giao diện build và tài liệu bàn giao

- Tách rõ khu vực marketing, PMS và manager; đưa layout/component về đúng phân hệ và loại bỏ phần trùng lặp.
- Cải tiến trang giới thiệu, bảng giá, blog, liên hệ, đăng nhập, các màn hình quản trị, đặt phòng và sơ đồ phòng trên nền giao diện LOHA đã có.
- Bổ sung lockfile để cài dependency nhất quán, cập nhật hướng dẫn build, HTML đầu vào và favicon.
- Cập nhật hợp đồng API, tài liệu kiến trúc, báo cáo triển khai/kiểm thử và checklist nghiệm thu; bổ sung báo cáo học phần quản lý dự án và sườn thuyết trình quản lý rủi ro của nhóm.

**Commit tiêu biểu:** `ca91cad`, `e2f4229`, `cf672fe`, `d0be899`, `1ebcc0e`, `9c27368`, `4ca53ed`; tài liệu học phần tại `b04df22`, `6cf8455`.

## 3 Bằng chứng kiểm thử đã ghi nhận

| Mốc trong tài liệu | Backend đạt | Frontend đạt | Nguồn |
| --- | ---: | ---: | --- |
| 03/10 | 73/73 | 29/29 | [BE01_05_IMPLEMENTATION_REPORT.md](../../BE01_05_IMPLEMENTATION_REPORT.md) |
| 04/10 | 102/102 | 29/29 | [BE06_07_IMPLEMENTATION_REPORT.md](../../BE06_07_IMPLEMENTATION_REPORT.md) |
| 05/10 | 139/139 | 30/30 | [BE08_09_P1_FIX_REPORT.md](../../BE08_09_P1_FIX_REPORT.md) |
| 07/10 | 216/216 | 34/34 | [BE10_11_IMPLEMENTATION_REPORT.md](../../BE10_11_IMPLEMENTATION_REPORT.md), [BE12_IMPLEMENTATION_REPORT.md](../../BE12_IMPLEMENTATION_REPORT.md) |
| 09/10 phần Manager và Owner | 235 tests | 42 tests | [tasks/manager-owner.md](../../tasks/manager-owner.md) |

Các số trên là kết quả từng lần kiểm thử được ghi trong tài liệu, **không cộng dồn**. Hai báo cáo ngày 07/10 sử dụng cùng một lần chạy 216 tests backend. Tài liệu ngày 09/10 còn ghi chạy đạt regression migration của module tính năng sau suite chính; không cộng riêng vào 235 để suy ra tổng mới.

Các báo cáo cũng ghi nhận kiểm thử PostgreSQL bằng database riêng, kiểm tra cách ly khách sạn và quyền, migration, thao tác đồng thời, tiền và hoàn/đảo giao dịch; frontend có kiểm tra mã, build và một số luồng trình duyệt. Mốc 235/42 gắn với phần Manager/Owner, trước các commit OTA và giá phòng cuối ngày 09/10; cần chạy lại bộ kiểm tra trên phiên bản cuối trước khi nghiệm thu toàn bộ.

## 4 Phần còn lại và giới hạn cần báo cáo

- **OTA:** Cần khóa, property và mapping Channex staging thật để nghiệm thu gửi giá/tồn và nhận booking mới/sửa/hủy. Giá gửi OTA hiện chưa chuyển đầy đủ chính sách LOS, voucher và khuyến mãi.
- **Kho và giá:** Đã có API, giao diện và kiểm thử tự động; cần hoàn tất kiểm tra thủ công toàn chu trình nhập/xuất/chuyển/kiểm kê, voucher, tỷ giá và hoàn tiền theo checklist.
- **Triển khai:** Chưa có bằng chứng nghiệm thu production/Coolify trong các mốc trên. Tài liệu Manager/Owner ghi migration mới chưa áp dụng vào database nghiệp vụ local/Coolify tại lần nghiệm thu đó; cần kiểm tra và nâng schema trên môi trường đích.
- **Tài chính và báo cáo:** Billing ghi nhận gia hạn thủ công, chưa có cổng thanh toán tự động. Báo cáo doanh thu theo hóa đơn chốt/trả phòng, chưa có Night Audit để ghi nhận theo từng đêm; cọc/nợ là số dư hiện tại. Tỷ giá VND/USD được nhập thủ công.
- **Phạm vi khác:** Ca buồng phòng qua đêm, email, mobile, API đối tác, 2FA và một số chức năng hồ sơ/xuất dữ liệu còn chưa hoàn thiện. Một số README còn mô tả giới hạn cũ, cần cập nhật theo mã hiện tại.

## 5 Ưu tiên đề xuất cho đợt tiếp theo

1. Chạy lại tests, lint và build tại phiên bản cuối; kiểm tra schema môi trường demo, rồi kiểm thử chéo luồng đặt phòng → cọc → nhận phòng → dịch vụ → thanh toán → trả phòng → dọn phòng.
2. Hoàn tất nghiệm thu thủ công kho/giá; thống nhất định nghĩa báo cáo với nhóm trưởng và cập nhật tài liệu còn lệch với mã nguồn.
3. Chuẩn bị tài khoản Channex staging để nghiệm thu OTA; sau đó thực hiện checklist triển khai, migration và kiểm tra môi trường đích trước khi xác nhận sẵn sàng sử dụng.

## 6 Lời trình bày ngắn trong cuộc họp

Trong tuần từ ngày 3 đến ngày 9 tháng 10, sau mốc merge nhánh FE-mynuong, em chủ yếu làm backend nghiệp vụ và nối giao diện hiện có với API thật. Em đã bổ sung luồng đăng nhập, phân quyền theo khách sạn, đặt nhiều phòng, cọc, thanh toán và trả phòng; đồng thời triển khai POS, thu chi, buồng phòng, kho và chính sách giá.

Ở phần quản trị, em đã nối quản lý gói, gia hạn, tài khoản và tính năng với database, sửa các lỗi P1 của Dashboard và thuê bao. Em cũng bổ sung báo cáo doanh thu, đối soát sổ quỹ, chuông thông báo và phần tích hợp Channex có hàng đợi cùng lịch sử đồng bộ.

Git ghi nhận 19 commit thay đổi trong tuần. Các tài liệu nghiệm thu ghi nhận mốc 235 tests backend và 42 tests frontend đạt cho phần Manager/Owner ngày 9 tháng 10. Sau các cập nhật OTA và giá phòng cuối ngày, em đề xuất chạy lại bộ kiểm tra và demo chéo luồng chính. Phần còn cần chốt là nghiệm thu Channex với tài khoản staging thật, kiểm tra đầy đủ kho và giá, rồi xác nhận triển khai trên môi trường đích.

## 7 Phụ lục lịch sử commit trong kỳ

Bảng ghi theo ngày commit; mô tả dựa trên nội dung thay đổi, không chỉ theo tiêu đề commit.

| Ngày | Commit | Nội dung bàn giao |
| --- | --- | --- |
| 03/10 | `119768a` | Quyền truy cập, workspace demo, báo cáo khoảng trống và cải tiến các màn hình PMS/manager. |
| 03/10 | `ac83606` | Nền backend Flask/PostgreSQL, xác thực, danh mục, đặt phòng, migration, tests và nối frontend với API. |
| 03/10 | `d1db3ef` | Hoàn thiện booking detail, kiểm tra danh mục, giá và bổ sung kiểm thử. |
| 04/10 | `ca91cad` | Cải tiến website giới thiệu, bảng giá, blog, liên hệ và tài liệu ưu tiên backend/client. |
| 04/10 | `e2f4229` | Cải tiến bố cục đăng nhập và khu vực xác thực/marketing. |
| 04/10 | `cf672fe` | Chia backend theo module; sắp xếp lại frontend marketing/PMS/manager và loại bỏ phần trùng. |
| 05/10 | `f33c8e3` | POS, sổ quỹ, buồng phòng, báo cáo và thuê bao cùng API, migration, giao diện và tests. |
| 05/10 | `00eac7f` | Sửa đóng khối JSX điều kiện trong Dashboard. |
| 05/10 | `b04df22` | Sửa P1 báo cáo/thuê bao/quota/quyền; cập nhật tests và báo cáo học phần. |
| 05/10 | `d0be899` | Cải tiến giao diện Dashboard, khách sạn, billing và layout manager. |
| 06/10 | `1ebcc0e` | Cải tiến giao diện PMS, Dashboard, đặt phòng, sơ đồ phòng và các thành phần dùng chung. |
| 07/10 | `9f6b22d` | Kho, giá nâng cao, voucher, tỷ giá; liên kết POS, API, giao diện và kiểm thử. |
| 07/10 | `9093f74` | Tích hợp Channex, hàng đợi/worker, thông báo trong ứng dụng và giao diện liên quan. |
| 07/10 | `39de278` | Củng cố đồng bộ Channex, thông báo và các hồi quy liên quan kho/giá. |
| 09/10 | `6cf8455` | API và giao diện Manager/Owner cho tài khoản, tính năng, cấp riêng/dùng thử; migration và tests. |
| 09/10 | `9c27368` | Theo dõi package-lock.json, cập nhật gitignore và hướng dẫn frontend. |
| 09/10 | `1d45fb1` | Hoàn thiện màn hình cấu hình Channex, mapping, tác vụ và lịch sử đồng bộ. |
| 09/10 | `f460300` | Hoàn thiện các trang giá/phòng trống và cập nhật nhiều ô trên lưới giá. |
| 09/10 | `4ca53ed` | Cập nhật HTML đầu vào và favicon frontend. |

Ba commit merge `ab8e84f`, `b22f9a6`, `a57777c` cùng ngày 09/10 dùng để hợp nhất lịch sử `main`, không tính thành ba tính năng riêng. Ngày 08/10 không có commit trong phạm vi đã xét; lịch sử này không phản ánh các công việc chưa commit.
