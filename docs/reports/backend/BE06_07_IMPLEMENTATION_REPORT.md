# Báo cáo triển khai BE-06 và BE-07

Ngày: 04/10/2026. Phạm vi: backend PostgreSQL và các màn hình client tương ứng. Giữ khung giao diện PMS hiện tại. Chưa deploy lên Coolify.

| Hạng mục | Kết quả |
| --- | --- |
| BE-06.1 — POS | Lưu/sửa nháp, ghi nhận hóa đơn bán lẻ hoặc vào booking, thu từng phần, hoàn/hủy có đối ứng, tìm kiếm và phân trang hóa đơn cũ qua API. |
| BE-06.2 — Thu chi | Phiếu thu/chi/rút/chuyển quỹ, số dư đầu kỳ, đảo chứng từ; lọc theo kỳ/quỹ tiền mặt hoặc ngân hàng/người thao tác/tiền tệ. |
| BE-07.1 — Buồng phòng | Nhân viên gắn tài khoản, ca làm việc, kế hoạch khách đến/đi/lưu trú/phòng bẩn, giao việc, dọn → gửi kiểm tra → quản lý xác nhận sạch, bảo trì/hỏng và lịch sử. |

## Luồng nghiệp vụ đã nối

POS bán lẻ ghi vào cùng sổ giao dịch với tiền booking và chứng từ thu chi. POS ghi vào booking tạo chi phí trong booking; tiền được thu tại booking, tránh ghi thu hai lần. Nháp được sửa, hóa đơn ghi nhận giữ nguyên dòng dịch vụ và giá tại thời điểm ghi. Hoàn/hủy/đảo thêm dữ liệu đối ứng, giữ chứng từ gốc.

Sổ quỹ tính ở server bằng Decimal: đầu kỳ + thu − chi = cuối kỳ. Tổng tính trên toàn kỳ lọc, độc lập với phân trang. Số dư quỹ hiện tại độc lập với bộ lọc kỳ/người thao tác. Chuyển quỹ có hai dòng bằng nhau, ngược dấu. Mọi khoản chi/hoàn/đảo bị chặn khi quỹ không đủ tiền; hai yêu cầu đồng thời không cùng tiêu một số dư.

Checkout vẫn bị chặn đến khi thanh toán đủ và tự tạo việc dọn trong cùng transaction. Khi cần điều chỉnh booking đã checkout, chủ khách sạn/kế toán dùng phiếu điều chỉnh có lý do: tăng chi phí kèm thu thêm, hoặc giảm chi phí kèm hoàn khoản thu gốc. Booking giữ trạng thái đã quyết toán và lịch sử cũ.

Nhân viên buồng phòng chỉ nhìn thấy và cập nhật công việc được giao qua tài khoản của mình. Dọn xong chuyển phòng sang chờ kiểm tra; chủ khách sạn/lễ tân xác nhận sạch hoặc yêu cầu dọn lại. Ca không được trùng giờ; không ngừng/đổi nhân viên hoặc ca khi còn công việc bị ảnh hưởng. Khi khách mới vào, checkout hoặc cấu hình phòng thay đổi, phiên bản phòng làm công việc cũ mất hiệu lực. Không thể dùng API danh mục phòng để bỏ qua bước kiểm tra.

## Quyền

| Vai trò | Quyền trong BE-06/07 |
| --- | --- |
| Chủ khách sạn | Toàn bộ POS, thu chi, điều chỉnh và điều phối/kiểm tra buồng phòng. |
| Lễ tân | POS và thu/hoàn theo quyền thanh toán; đọc sổ quỹ; quản lý nhân viên/ca, giao việc và xác nhận sạch. |
| Kế toán | POS, thu chi, hủy/đảo chứng từ và điều chỉnh booking đã quyết toán. |
| Buồng phòng | Công việc được giao; bắt đầu dọn và gửi kiểm tra. Không tự xác nhận sạch, không truy cập tiền/quỹ. |

API tiếp tục kiểm tra tenant, membership, CSRF và quyền; bảng mới dùng FORCE RLS và khóa ngoại có tenant. Tác vụ tiền yêu cầu Idempotency-Key; gửi lại cùng ý định không ghi tiền hai lần. Client giữ khóa chờ xác nhận khi mạng hoặc tải lại workspace lỗi.

## Kiểm chứng

- **102/102 tests backend đạt, không bỏ qua**, chạy trên database PostgreSQL tạm `pms_test_<UUID>` với role runtime hạn chế; database tạm được dọn sau suite.
- **29/29 tests frontend đạt**; `npm run build` thành công.
- Ruff đạt trong phạm vi backend BE-06/07. Lint frontend không có lỗi chặn; còn cảnh báo React/import trong dự án. Ruff toàn backend chưa sạch ở các file ngoài phạm vi BE-06/07 (`admin`, `core_models`, `reports`, migration subscription).
- Kiểm thử tiền: Decimal/tiền tệ, idempotency, rollback, tenant A/B, bất biến lịch sử, hoàn/đảo, số dư đầu-cuối, hai khoản chi hoặc điều chỉnh đồng thời.
- Kiểm thử buồng phòng: phân quyền đúng người, ca trùng giờ, stale revision, checkout nguyên tử, kế hoạch không tạo trùng, công việc cũ không làm sạch phòng của lượt khách mới, chống bỏ qua inspection qua POST/PATCH danh mục.
- Kiểm thử trên browser bằng database fixture riêng: nháp POS → ghi nhận → thu 40 → hoàn 5; chi 10 → đảo chi; số dư về 35 và còn đủ lịch sử. Nhân viên/ca → giao phòng 101 → tài khoản buồng phòng gửi kiểm tra → chủ khách sạn xác nhận sạch; lịch sử và trạng thái phòng cập nhật. Tìm kiếm hóa đơn không khớp trả danh sách trống; tìm lại theo tên khách đọc đúng chi tiết qua API.
- Workspace chỉ tải 100 dòng tài chính gần nhất. Hóa đơn cũ vẫn tìm được qua API phân trang và chi tiết; tuần tự hóa danh sách dùng 5 SELECT cho cả trang, không tăng theo số hóa đơn. Ca/công việc được tải theo ngày chọn.
- `/api/ready` local đã trả 200. Kết quả local không xác nhận cấu hình hoặc deploy trên Coolify.

Chạy lại suite trên cluster local đã được thiết lập:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts/run_domain_tests.py
```

Hợp đồng endpoint/payload: [backend/API_CONTRACT.md](../../../backend/API_CONTRACT.md).

## Migration và Coolify

Thêm `0005_finance` và `0006_housekeeping`, giữ các migration cũ. Sau khi deploy code mới vào container backend, dùng biến môi trường Coolify của backend và chạy:

```sh
python manage.py db upgrade
```

Sau đó kiểm tra `/api/ready` trả 200. Lệnh áp dụng đến head hiện tại của repository. Dữ liệu và DATABASE_URL local không đi theo commit; cấu hình Coolify vẫn đọc DATABASE_URL/DATABASE_MIGRATION_URL tại runtime. Không cần thêm biến database vào frontend. Chi tiết: [backend/README.md](../../../backend/README.md).

## Giới hạn còn lại

- Chưa triển khai/deploy hoặc nghiệm thu trên Coolify/Cloudflare Tunnel trong nhiệm vụ này.
- Mỗi tenant dùng một tiền tệ VND hoặc USD; chưa có chuyển đổi tỷ giá.
- Ca làm việc trong một ngày; chưa có ca qua đêm.
- Kế hoạch ngày được tạo bằng nút trên giao diện; checkout tự tạo việc. Chưa có scheduler tạo kế hoạch hằng ngày.
- POS dùng danh mục dịch vụ; tiêu hao tồn kho thuộc BE-10. Xuất Excel/in chứng từ chưa triển khai.
- Lịch sử buồng phòng trên workspace hiển thị 100 sự kiện gần nhất; dữ liệu cũ vẫn lưu trong database. Chưa có endpoint lịch sử dài hạn phân trang.
- Sổ quỹ đã phân trang đầu ra nhưng phép tổng hợp hiện đọc các dòng phù hợp trong server; cần chuyển sang SQL aggregation khi dữ liệu lớn. Các giới hạn này không thay đổi số dư hoặc xóa lịch sử.
