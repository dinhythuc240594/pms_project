# Trang lỗi LOHA

Đồng bộ màu, thương hiệu và cách điều hướng với LOHA PMS. Dùng thành phần chung
cho 401, 403, 404, 500 và 503; các phản hồi 502/504 được trình bày như gián đoạn
dịch vụ 503. Thông báo lỗi mạng được đổi thành hướng dẫn dễ hiểu.

- 403: dùng trong luồng chặn quyền, có nút về không gian làm việc và đổi tài khoản.
- 404: đường dẫn không tồn tại được giữ nguyên, có nút quay lại/trang chủ;
  có cả nhánh bên trong PMS, Manager và đường dẫn ngoài hệ thống.
- 500: lỗi khi render trang được chặn bởi boundary của router, có thể thử lại.
- 503: lỗi tải phiên/dữ liệu có nút tải lại qua API. Nút thử lại không tự gửi lại
  giao dịch ghi dữ liệu. Phiên hết hiệu lực trở về đăng nhập.
- 401: thành phần thông báo phiên hết hiệu lực; luồng guard thông thường vẫn
  chuyển về đăng nhập và giữ đường dẫn cần quay lại.

`frontend/public/50x.html` và `404.html` là HTML độc lập, không cần React, ảnh hoặc
font bên ngoài. Build sao chép cả hai sang `dist`. Trang 50x dùng nhãn 5xx để
phù hợp nhiều lỗi máy chủ mà không đổi mã HTTP do Nginx trả về.

Với cấu hình Nginx frontend hiện có trên Coolify, giữ:

```nginx
location / {
    root /usr/share/nginx/html;
    index index.html;
    try_files $uri $uri/ /index.html;
}

error_page 404 /404.html;
location = /404.html {
    root /usr/share/nginx/html;
    internal;
}

error_page 500 502 503 504 /50x.html;
location = /50x.html {
    root /usr/share/nginx/html;
    internal;
}
```

Đã kiểm tra thực tế 403 desktop/320px, 404 với URL không tồn tại, 503 khi API
thử nghiệm ngừng phản hồi và nút thử lại khi API phục hồi. Trang 50x/404 tĩnh đã
mở trên trình duyệt; 50x kiểm tra ở 320px và nút tải lại hoạt động. Build chứa cả
hai file. Kiểm thử phân loại lỗi bao gồm 401/403/404/500/503/502/504 và giữ các
lỗi nhập liệu/xung đột ở dạng thông báo.

Chưa triển khai hoặc kiểm tra cấu hình Nginx trên Coolify trong đợt làm này.
Các trang tĩnh cần web server còn phục vụ được; lỗi do Cloudflare/Tunnel không
tới được origin vẫn do hạ tầng đó hiển thị. SPA catch-all là giao diện 404 trong
ứng dụng, không tự thay mã HTTP 200 của file `index.html` thành 404.
