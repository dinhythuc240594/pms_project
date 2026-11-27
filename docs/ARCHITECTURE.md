# Cấu trúc LOHA PMS

Ngày cập nhật: 10/10/2026. Giữ các URL, hợp đồng API, schema và luồng nghiệp vụ hiện tại.

## Frontend

```text
frontend/src/
  main.jsx                    # mount React và CSS nền
  app/App.jsx                 # router, provider và ghép các phân hệ
  apps/
    marketing/
      layouts/                # header/footer, navigation và CSS của shell
      Home.jsx, Home.css      # trang chủ và CSS riêng
      Pricing.jsx, Blog.jsx, Contact.jsx
    pms/
      layouts/PmsLayout.jsx
      components/             # Header, Sidebar, UsageInfoModal, LegacyOverlay
      auth/{layouts,pages}/   # trang đăng nhập và khung auth
      data/                   # API client, provider, quyền, model và tests
      reservations/{pages,components}/
      rooms/, housekeeping/, finance/, reports/, ...
    manager/
      layouts/ManagerLayout.jsx
      layouts/ManagerLayout.css
      components/             # ManagerHeader và ManagerSidebar
      dashboard/, tenants/, billing/, users/, ...
  shared/
    components/               # LohaBrand và AccessControl dùng qua các phân hệ
    config/pricingPlans.js    # hai gói và giá tham khảo dùng chung
    styles/loha.css           # màu, typography, logo, button và responsive chung
```

Layout và thành phần riêng của một phân hệ đặt trong `apps/<phân hệ>`. Chỉ đưa vào `shared` khi thực sự có nhiều phân hệ dùng. `App.jsx` giữ nguyên cây route; các màn hình tiếp tục nhận dữ liệu qua `PmsProvider`. Provider này phục vụ phiên đăng nhập, tenant workspace và cả manager nên chưa tách thành các store mới.

Login dùng `LohaBrand` và stylesheet chung, không import CSS trang chủ. CSS header/footer marketing thuộc layout; CSS hình minh họa và các section trang chủ thuộc `Home.css`. Font/scrollbar manager được giới hạn trong `.manager-shell`.

Trang bảng giá và billing dùng chung hai gói trong `pricingPlans.js`; dữ liệu này là giá tham khảo, chưa thay thế billing/feature gating ở backend. Dữ liệu khách sạn, tài khoản và nghiệp vụ được nạp từ API; không có bộ dữ liệu demo hay store local thay thế khi API không hoạt động.

## Backend

```text
backend/
  app.py, manage.py            # entry points web và CLI
  common/                     # CommonMethodView, CommonURL, JSON, lỗi và định dạng
  pms_api/
    __init__.py               # create_app, cấu hình extensions, đăng ký routes
    auth/routes.py            # đăng nhập, phiên và hồ sơ
    admin/routes.py           # tenant, membership và quản trị hệ thống
    catalog/{routes,models}.py # phòng, danh mục, giá và tồn phòng
    bookings/{routes,models}.py # booking, khách, chi phí và thanh toán
    finance/{routes,models}.py # POS, chứng từ và sổ quỹ dùng chung
    housekeeping/{routes,models}.py # nhân viên, ca, nhiệm vụ và kiểm tra phòng
    workspace.py              # endpoint tổng hợp dữ liệu tenant
    core_models.py            # identity/tenant/session/audit dùng chung
    config.py, extensions.py
    model_registry.py         # nạp ORM metadata độc lập với HTTP handlers
    security.py, rls.py        # quyền, transaction context và RLS
    health.py, commands.py
  migrations/                 # giữ nguyên 0001–0004; BE06/07 thêm 0005–0006
  scripts/                    # công cụ quản lý PostgreSQL local
  tests/                      # unit và integration tests
```

Mỗi package nghiệp vụ có `urls.py` khai báo `URL(CommonURL)`, blueprint và đường
dẫn lazy tới handler; `routes.py` chứa các view kế thừa `CommonMethodView`.
App factory đăng ký metadata URL và model trước, handler được import khi route
nhận request. `workspace.py` ghép dữ liệu từ các phân hệ. Nền tảng cấu hình,
database và bảo mật ở root `pms_api` để các package dùng chung. Quy ước viết API
và ví dụ nằm trong [backend/README.md](../backend/README.md#chuẩn-viết-api-dùng-common).

Không thêm repository, service facade hoặc package trống cho tính năng tương lai. Các import cục bộ từ catalog sang booking models giữ nguyên thời điểm thực thi để tránh vòng phụ thuộc. Chỉ tách nghiệp vụ thành service khi có luồng dùng lại cụ thể.

`finance` và booking cùng ghi `LedgerEntry` và khóa quỹ theo tenant/id theo cùng thứ tự; hoàn/đảo phiếu thêm dòng đối ứng thay vì sửa lịch sử. `housekeeping` dùng phiên bản phòng và nhiệm vụ để chặn công việc cũ, phân công theo tài khoản buồng phòng và yêu cầu quản lý xác nhận sạch. Checkout tạo công việc dọn trong cùng transaction. Hợp đồng cụ thể nằm trong [API_CONTRACT.md](../backend/API_CONTRACT.md).

## Các ràng buộc khi phát triển tiếp

- Quyền và cách ly tenant vẫn do backend kiểm tra; UI guard hỗ trợ trải nghiệm.
- Giữ transaction, thứ tự lock, RLS, CSRF và idempotency khi sửa booking/thanh toán.
- Checkout tiếp tục bị chặn khi còn nợ; dữ liệu local không đi theo commit lên Coolify.
- Sửa model cần migration mới; không chỉnh lịch sử migration đã phát hành chỉ vì đổi vị trí file.
- Chức năng chưa có API tiếp tục được đánh dấu xem trước và tắt thao tác lưu.

## Kiểm tra

Frontend: `npm test`, `npm run lint`, `npm run build` tại `frontend`. Backend: `.venv\Scripts\python.exe -m ruff check .` và `.venv\Scripts\python.exe -m unittest discover -s tests -v` tại `backend`.

Integration tests yêu cầu cả `TEST_DATABASE_URL` và `TEST_DATABASE_MIGRATION_URL` trỏ đến một database riêng có tiền tố `pms_test_`. Không dùng `pms_local` hoặc production cho suite thay đổi schema. Hướng dẫn cấu hình/deploy vẫn nằm trong `backend/README.md`.
