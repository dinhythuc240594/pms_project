# P1 — triển khai theo báo cáo REA 18/10/2026

Yêu cầu: triển khai nhóm P1 của `docs/reports/reviews/rea-next-improvements-2026-10-18.md`.

| Phần | Kết quả cần đạt | Kiểm chứng |
| --- | --- | --- |
| OTA | Booking vẫn commit khi queue đầy, có dirty range bền vững để đồng bộ lại; giảm thời gian giữ tenant lock khi publish ARI, giữ thứ tự và cooldown. | Queue đầy, crash/retry, provider chậm + giao dịch lễ tân đồng thời, pause không mở bán lại. |
| Booking | Phiên sửa cũ nhận 409, không ghi đè booking hoặc hồ sơ khách dùng chung. | Hai phiên, thiếu/sai version, OTA cập nhật và client gửi đúng version bản nháp. |
| Vận hành | CI PostgreSQL thật, fail khi thiếu test bắt buộc; theo dõi worker/queue; công cụ xác minh restore riêng. | Migration, RLS, test runner, quyền endpoint operations, heartbeat stale, restore database tạm. |
| Đối soát | Preview theo ngày khách sạn, lưu xác nhận có người/thời điểm/snapshot, chống xác nhận preview cũ và gửi trùng. | Tenant/quyền/CSRF, Decimal, timezone, thay đổi sau preview, immutable snapshot. |
| Lưu trú | Chuyển phòng/gia hạn sau check-in có báo giá và xác nhận, giữ các đêm đã qua và audit/tồn/buồng phòng/OTA. | Chờ người dùng chốt giá cho phần đêm thay đổi; không tự chọn chính sách tiền. |

Giữ refresh thủ công, RLS, chống đặt trùng, snapshot giá, sổ tiền bất biến và chặn checkout còn nợ. Đối soát ban đầu không tự ghi tiền hoặc khóa kỳ. Không thêm dependency, không deploy hoặc thay đổi database nghiệp vụ.

Thực hiện từng lát bằng test tái hiện trước; dùng database `pms_test_*` mới theo từng lượt. Frontend chạy `npm test`, `npm run lint`, `npm run build`; UI mới kiểm tra responsive và tương tác trong browser.
