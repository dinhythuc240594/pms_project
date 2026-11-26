# Frontend PMS — API BE01–05

Cấu trúc mã nguồn và trách nhiệm các phân hệ: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

Manager dùng `dd/mm/yyyy` và `dd/mm/yyyy HH:mm` cho ô nhập và hiển thị ngày,
kể cả khi đổi ngôn ngữ. Ô nhập dùng chung `DateInput`, giữ nút chọn lịch và
gửi giá trị ISO cho các API hiện có; ngày giờ giữ múi giờ của từng luồng.
Form hồ sơ khách sạn ẩn tên miền trong phase 1, không xóa giá trị đã lưu.
Client dùng cùng chuẩn ngày và contact. Ô tiền/số lượng kiểm tra chuỗi thập phân
trước khi lưu (không nhận `1e3` hoặc dấu phẩy), giữ độ chính xác theo từng nghiệp
vụ; tỷ giá hỗ trợ 8 số lẻ. Ngày nhập sai chặn cả các nút thao tác ngoài form.

Chạy backend theo `backend/README.md`, sau đó tại `frontend` chạy `npm ci` và `npm run dev`. Mở `/id/login`. Vite chuyển `/api` đến `http://127.0.0.1:5000`.

CI dùng Node `24.18.0` và npm `11.16.0` được khai báo trong `packageManager`.
`frontend/.npmrc` chặn lifecycle scripts khi cài thư viện; `npm run dev`, `npm test`
và `npm run build` vẫn chạy bình thường khi gọi trực tiếp. Không bật lại toàn bộ
scripts để xử lý một dependency mới; cần đọc và duyệt script trước khi thay chính sách.

Đăng nhập bằng tài khoản do backend tạo; frontend không có bộ chọn tài khoản hoặc mật khẩu mặc định. Phiên dùng cookie HttpOnly, request gửi `credentials: include`; CSRF chỉ giữ trong bộ nhớ. Chỉ lựa chọn khách sạn được lưu trong localStorage. Các khoản tiền đang chờ xác nhận giữ UUID chống gửi trùng và SHA256 của nội dung trong sessionStorage; không lưu nội dung tiền, hồ sơ khách, mật khẩu hay token. Không có fallback lưu nghiệp vụ trong trình duyệt.

Khi triển khai frontend riêng API, đặt `VITE_API_BASE_URL=https://api.example.com` lúc build. Đây là địa chỉ API công khai, không phải chuỗi kết nối PostgreSQL. Backend phải cho phép origin frontend và cấu hình cookie theo hướng dẫn triển khai.

## Định dạng mã nguồn

Chạy `npm run format` từ thư mục `frontend` để định dạng bằng Prettier,
hoặc `npm run format:check` để kiểm tra. Cấu hình giữ nháy đơn, không có dấu
chấm phẩy và dùng độ dài dòng 100 ký tự. Thư mục build và kết quả kiểm thử
được loại khỏi phạm vi định dạng.

## Frontend trên Coolify

| Cấu hình               | Giá trị                                                       |
| ---------------------- | ------------------------------------------------------------- |
| Build Pack / Site type | Nixpacks / Static                                             |
| Base Directory         | `/frontend`                                                   |
| Publish Directory      | `/dist`                                                       |
| Install Command        | `npm ci --include=dev --ignore-scripts`                       |
| Build Command          | `npm run build`                                               |
| Start Command          | Để trống; Coolify phục vụ file bằng Nginx                     |
| Node                   | `NIXPACKS_NODE_VERSION=22`, phiên bản thực tế tối thiểu 22.12 |
| Watch Paths            | `frontend/**` hoặc để trống nếu muốn deploy mỗi commit        |

`frontend/nixpacks.toml` khai báo rõ hai phase install/build bằng npm. Coolify
phải dùng Base Directory `/frontend` để đọc file này. Install/Build Command hoặc
`NIXPACKS_INSTALL_CMD`/`NIXPACKS_BUILD_CMD` đã lưu trên Coolify có ưu tiên cao hơn
file trong repo: xóa override để dùng file, hoặc đặt đúng các lệnh trong bảng.

Lỗi `packageManager: "yarn@npm@11.16.0"` là thông báo của Yarn 1 khi nó được gọi
trong dự án npm; không sửa `packageManager`, xóa lockfile hoặc bật lại scripts
để né lỗi. Đổi `npx yarn build` thành `npm run build` và mọi lệnh cài bằng Yarn
thành `npm ci --include=dev --ignore-scripts`, lưu cấu hình rồi Redeploy.
Nginx SPA fallback không gây lỗi cài thư viện này.

Commit `frontend/package-lock.json` cùng `package.json` để build dùng đúng phiên
bản đã kiểm tra. Sau khi pull thay đổi này, sửa hoặc xóa biến build
`NIXPACKS_INSTALL_CMD` cũ đang xóa lockfile và chạy `npx yarn install
--ignore-engines`; nếu giữ biến, đặt nó bằng `npm ci --include=dev --ignore-scripts`. Không trộn
Yarn và npm trong cùng pipeline. Các thay đổi trong repo không tự xóa override
đã lưu trên Coolify. Thay Build Command đang là `npx yarn build` bằng
`npm run build`; nếu có biến `NIXPACKS_BUILD_CMD`, sửa tương tự hoặc xóa nó.
Watch Paths tính theo đường dẫn file trong repository;
`src/pages/**` không bao phủ `frontend/src/apps/**` hiện tại.

Giữ SPA fallback `try_files $uri $uri/ /index.html;` trong Nginx. Cấu hình này chỉ
phục vụ frontend: nếu API dùng domain riêng, `VITE_API_BASE_URL` phải bật Build
Variable và trỏ tới backend; nếu dùng cùng domain, cần route `/api` tới backend
ở proxy. Vite proxy local không được mang vào bản static production.

Tham khảo [Coolify Nixpacks](https://coolify.io/docs/applications/builds/nixpacks/deploy),
[Watch Paths](https://coolify.io/docs/applications/deployments/automatic-deployments)
và [biến môi trường](https://coolify.io/docs/applications/configuration/environment-variables).

Kiểm chứng 09/10/2026: đồng bộ lockfile không đổi phiên bản package; cài sạch từ
cache npm trên Windows mất khoảng 9.6 giây, lệnh build khoảng 1.4 giây. Đây không
phải số đo thời gian deploy trên VPS. Log Coolify được cung cấp dừng ở tải
`nginx:alpine`, chưa có debug log đủ để xác định nguyên nhân lần deploy 54 phút.

## Các luồng đã nối máy chủ

- Đặt phòng nhiều phòng và nhiều khách; kiểm tra khả dụng và báo giá từng đêm từ API. Giá chốt được giữ trên booking.
- Check-in, hủy và check-out; chỉ được trả phòng khi số dư bằng 0. Check-out đánh dấu toàn bộ phòng trong booking là bẩn.
- Chi tiết booking có khách, dịch vụ/phụ thu, giá từng đêm, thanh toán/hoàn tiền, ghi chú và lịch sử. Kế toán được ghi thanh toán, hoàn tiền và phụ thu theo quyền máy chủ.
- Phòng, Tape Chart, dashboard và công suất tính mọi phòng của booking nhiều phòng. Phòng/loại phòng đã ngưng hoạt động không được chọn mới.
- Settings: loại phòng/phòng vật lý, dịch vụ/nhóm, nguồn đặt phòng, bữa ăn, loại giường, đơn vị, phương thức thanh toán/quỹ và cấu hình khách sạn.
- Settings → Phòng & Loại giường → Cấu hình tầng / khu vực: gán hoặc xóa vị trí cho từng phòng, có gợi ý giá trị đã dùng. Danh sách phòng và sơ đồ lọc theo tầng/khu vực đã cấu hình; phòng chưa gán có nhóm riêng. Ví dụ `1001` thuộc tầng `10`, `A101` thuộc khu `Villa-A`. Sau migration `0032_room_locations`, phòng cũ chưa có vị trí; ID và liên kết booking được giữ nguyên.
- Người dùng khách sạn: tạo hoặc gán tài khoản, vai trò và trạng thái membership. Tài khoản đã có chỉ sửa quyền tại khách sạn; frontend không sửa danh tính toàn hệ thống.
- Hồ sơ khách CRUD; giá từng đêm, stop sell, khóa phòng theo khoảng ngày và MatrixRate dùng dữ liệu API.
- Quản trị: danh sách khách sạn, tạo khách sạn cùng chủ và tạm ngưng/mở lại. Hồ sơ quản trị đọc tài khoản thật, đổi mật khẩu dùng API.
- Nhật ký hệ thống: hiển thị IPv4/IPv6, loại địa chỉ và nguồn kết nối do backend ghi nhận; tìm kiếm, lọc loại IP và xuất CSV/JSON trong tối đa 200 sự kiện đã tải. Thống kê IP chỉ áp dụng cho các sự kiện này. Nhật ký cũ hoặc tác vụ nền thiếu IP được đánh dấu chưa ghi nhận; chưa có tra cứu vị trí hoặc nhà mạng. Backend cần migration `0044_audit_ip`; cấu hình `TRUSTED_PROXY_COUNT` theo đúng số proxy phía trước API.
- Thu chi đọc ledger thanh toán/hoàn tiền từ booking. Đây chưa phải sổ quỹ nâng cao BE06; số dư đầu kỳ, rút/chuyển quỹ và phiếu thu/chi riêng đang tắt.

Quyền dựa vào vai trò và membership. Gói thương mại, quota và feature gating BE09 chưa triển khai; không khởi tạo gói Trial/Basic/Pro trong provider. Khách sạn tạm ngưng vẫn cho đọc theo API nhưng chặn ghi. Tenant đổi sẽ xóa form và loại bỏ kết quả request của tenant cũ.

Khi ghi thành công nhưng tải lại workspace lỗi, giao diện vẫn báo đã lưu và giữ mã kết quả; cảnh báo đồng bộ hiển thị riêng. Tải lại dữ liệu không gửi lại thao tác ghi. Tạo/sửa booking, đổi trạng thái, ghi chú và các giao dịch tiền dùng intent ổn định; thử lại sau mất phản hồi hoặc reload dùng cùng mã để server trả kết quả đã ghi. Intent đã xác nhận chỉ được giải phóng sau lượt tải workspace thành công, còn kết quả chưa rõ vẫn giữ mã cũ. sessionStorage chỉ lưu fingerprint, intent và metadata kết quả, không lưu nội dung biểu mẫu hoặc token đăng nhập.

## Giới hạn hiện tại

Giữ giao diện các màn hình chưa có backend để xem cấu trúc, nhưng các thao tác ghi bị tắt và có thông báo: POS, kho/mua hàng, OTA, voucher/khuyến mãi, kế hoạch/nhân sự buồng phòng, billing/feature thương mại và người dùng nội bộ toàn hệ thống. Bảo mật nâng cao/2FA được ẩn khỏi cài đặt client. Giờ theo booking, số người lớn/trẻ em/em bé và FOC chưa có schema; các điều khiển hiển thị nhưng không chỉnh sửa.

Giá và tiền trên booking dùng tiền tệ đã chốt; ledger và báo cáo doanh thu có bộ lọc tiền tệ để tránh cộng lẫn các loại tiền. Không triển khai quy đổi ngoại tệ.

Biểu đồ và danh sách minh họa còn lại phía dưới dashboard được đánh dấu xem trước. Báo cáo doanh thu hiện là doanh thu phòng dự kiến theo nightly snapshot, chưa là báo cáo kế toán hợp nhất.

## Kiểm tra

`npm test`, `npm run lint`, `npm run build`. Các test API kiểm tra cookie/CSRF, lỗi 403, tenant scope, quyền không phụ thuộc gói và chống gửi trùng qua reload. Test model kiểm tra mọi phòng của booking, maintenance và khoảng ngày liền kề. Các test workspace cũ chỉ kiểm tra fixture demo, không được provider runtime sử dụng.

Kiểm tra tích hợp local: tạo hai phòng/hai khách → cọc → check-in → phụ thu → chặn trả phòng khi còn nợ → thanh toán đủ → check-out → phòng bẩn → reload; chuyển tenant để kiểm tra cách ly dữ liệu. Dữ liệu kiểm tra thuộc PostgreSQL local.

## Bundle theo route

Marketing, đăng nhập, PMS và Manager tải layout/trang qua `lazyRoute` khi route
được mở. Guard kiểm tra phiên/quyền trước khi render module được bảo vệ. Màn
hình chờ dùng `Suspense`; khi chuyển trang, sidebar/header vẫn hiển thị. Kho,
báo cáo và từng trang Manager có chunk riêng, chỉ tải khi được mở.

Nếu chunk JS/CSS cũ không còn sau deploy, ứng dụng tải lại nguyên URL tối đa
một lần cho mỗi URL trong phiên tab. Khi offline, storage bị chặn, hoặc có bản
nháp/yêu cầu ghi đang chờ, ứng dụng hiển thị lỗi và nút thử lại. Nút này tải lại
trang qua draft guard; lỗi render thông thường dùng màn hình 500 và thử lại tại
chỗ. Giữ `index.html` luôn được xác thực lại và để asset bị thiếu trả về 404:

```nginx
location = /index.html {
    add_header Cache-Control "no-cache" always;
}
location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
location / {
    try_files $uri $uri/ /index.html;
}
```

Đo production bundle từ thư mục `frontend`:

```sh
BUNDLE_ANALYZE=1 npm run build
npm run bundle:measure -- --check --out /tmp/pms-bundle.json
```

Lệnh đo cộng kích thước JS/CSS nén riêng từng file (gzip mức 9, Brotli mức 11)
trong đồ thị import tĩnh của entry cùng layout/trang được mở. `--check` kiểm tra
module Manager/kho/báo cáo không lọt vào login, marketing và dashboard PMS.
File chẩn đoán `.vite/chunk-modules.json` chỉ sinh khi bật `BUNDLE_ANALYZE`;
không chứa nội dung mã nguồn. Số đo trước/sau và giới hạn phép đo:
[báo cáo bundle](../docs/reports/frontend/route-bundles-2026-10-22.md).
