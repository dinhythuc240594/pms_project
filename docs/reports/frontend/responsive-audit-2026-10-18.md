# Kiểm tra UI và responsive — 18/10/2026

Phạm vi: cải thiện website hiện tại từ điện thoại 320px đến desktop, giữ thương hiệu LOHA, URL, dữ liệu và luồng nghiệp vụ. Chỉ sửa frontend; không thay backend, schema, API, xác thực hoặc quy tắc tính tiền. Phần kiểm tra ban đầu đã có trong commit `b52c3c2`; phần tiếp tục P1/P2 bên dưới chưa commit hoặc push.

## Bằng chứng và giới hạn

- Đã đọc nguồn router, các layout, provider/API client, guard, dialog và các màn hình tiêu biểu. Đây là quan sát nguồn, không phải bằng chứng chạy thực tế.
- Áp dụng `reverse-engineer-anything` theo đúng hướng dẫn dành cho repository có nguồn đầy đủ: dùng công cụ đọc/tìm nguồn thông thường; không cần thiết lập REA hoặc phân tích binary.
- `ui-ux-pro-max` định hướng khả năng truy cập, tương tác chạm và tính nhất quán; `mobile-responsive` yêu cầu giữ hệ CSS/token hiện tại, sửa nguyên nhân tràn và kiểm tra nhiều kích thước.
- Đã bổ sung bằng chứng Chromium/Playwright bên dưới. Kết quả chỉ áp dụng các route, dữ liệu fixture, trạng thái và kích thước đã kiểm tra; không phải chứng nhận toàn bộ website hoặc thiết bị thật.

## Kiến trúc và ranh giới cần giữ

| Thành phần | Nguồn và vai trò |
| --- | --- |
| Runtime | React 19, Vite 8, React Router 7; JavaScript/JSX, CSS thường và inline styles. `frontend/package.json`, `src/main.jsx`. |
| Router | `src/app/App.jsx`: ba phân hệ marketing, PMS và Manager; auth riêng, error boundary/guard dùng chung. |
| State/API | `apps/pms/data/PmsProvider.jsx`: phiên, tenant, workspace, quyền và thao tác API cho cả PMS/Manager. Không tách store trong phạm vi này. |
| Bảo vệ request | `apps/pms/data/api.js`: cookie credentials, CSRF trong bộ nhớ, idempotency cho tiền, bộ đếm request; generation loại kết quả tenant/phiên cũ. |
| Quyền | `shared/components/AccessControl.jsx`, `apps/pms/data/access.js`: guard và link theo quyền; backend vẫn là nơi xác thực quyền. |
| UI dùng lại | `FormDialog`, `LegacyOverlay`, `LohaBrand`, `DomainForms.css`, các layout/header/sidebar và vùng cuộn bảng. Dialog hiện có quản lý focus. |
| Ngôn ngữ | `shared/i18n`: vi/en-US/zh-CN, khóa dịch và bridge cho màn hình cũ. Giữ nguyên dữ liệu người dùng, định dạng tiền và timezone nghiệp vụ. |

API local đi qua Vite proxy `/api` đến Flask ở cổng 5000; bản triển khai có thể dùng `VITE_API_BASE_URL`. Không dùng dữ liệu demo thay cho dữ liệu máy chủ. README frontend có một số giới hạn tính năng cũ: nguồn hiện tại đã có thao tác API cho POS, thu chi, kho, buồng phòng, SaaS billing và Channex; phải giữ các luồng này.

## Bản đồ trang và luồng chính

| Khu vực | Route và tác vụ |
| --- | --- |
| Công khai | `/`, `/pricing`, `/blog`, `/contact`: giới thiệu, bảng giá, nội dung, chuẩn bị/sao chép nội dung liên hệ. |
| Đăng nhập | `/id/login`: email/mật khẩu, ghi nhớ phiên, hiện mật khẩu, lỗi và điều hướng theo vai trò hoặc `next` hợp lệ. |
| Lễ tân | `/id/dashboard`, `/id/ari`, `/id/room-diagram`, `/id/rooms`, `/id/reservations`: tổng quan, lịch, phòng, đặt phòng và chi tiết booking. |
| Giá/phòng trống | `/id/gia` và `basic`, `advanced`, `vouchers`, `ari`, `promotions`, `exchange-rates`; `/id/matrix-rate`: giá, khuyến mãi, tồn phòng, khóa phòng. |
| Vận hành | `/id/housekeeping` và `status`, `staff`, `plan`; `/id/inventory` và `in`, `out`, `transfer`, `check`, `stock`. |
| Tiền/báo cáo | `/id/sales`, `/id/cashflow/:tab?`, `/id/commissions`, `/id/reports` và `revenue`, `occupancy`, `source`, `room`, `roomType`, `cancellations`, `nationality`, `discounts`. |
| Cài đặt | `/id/settings?section=…&tab=…`, `/id/users`, `/id/profile`: doanh nghiệp, phòng, dịch vụ, kế toán, kho, kênh, bảo mật, người dùng. `/id/ota` và `/id/ota-history` chuyển vào cài đặt kênh, giữ query. |
| Manager | `/manager/dashboard`, `tenants`, `channex`, `tenants/:tenantId/ota`, `tenants/:tenantId/ota-history`, `billing`, `features`, `users`, `logs`, `profile`. |

Luồng hồi quy ưu tiên: đăng nhập → chọn/đổi tenant → tìm và tạo booking qua availability/quote → xem khách/phòng/giá → phụ thu/thanh toán/hoàn tiền → đổi trạng thái/checkout; giữ chặn checkout còn nợ và trạng thái phòng bẩn. Tiếp theo là chỉnh giá/khóa phòng, chứng từ POS/thu chi/kho, phân công/cập nhật buồng phòng, quản trị khách sạn/gói/tính năng/kênh. Chuyển tenant phải tiếp tục xóa form cũ và bỏ response cũ.

## Quy ước thiết kế

- Giữ Inter/Be Vietnam Pro, xanh LOHA và navigation navy; marketing có nền cream/lime; Manager có token sáng/tối.
- Dùng lại khoảng cách 8/12/16/24/32, border radius và breakpoint đang có; không thêm framework, dependency hoặc thang token song song.
- Nhiều bảng/lịch đã có vùng cuộn ngang độc lập và focus bàn phím. Giữ đủ cột/thao tác quan trọng, tránh ép bảng thành cột quá hẹp.
- Các layout đã có menu mobile, skip link, focus ring, dynamic viewport và reduced-motion ở nhiều nơi; cải thiện phần thiếu dựa trên kết quả thực tế.

## Kế hoạch thay đổi theo ưu tiên

| Mức | Vấn đề/điểm kiểm tra | Thay đổi nhỏ nhất và điều kiện đạt |
| --- | --- | --- |
| P1 | Form dùng chung còn control 40px, chữ 13–14px; nút đóng dialog 36px. | Tăng vùng chạm phù hợp, font input 16px trên thiết bị chạm để tránh zoom khi focus iOS; không đổi validation/submission. |
| P1 | Insets an toàn chưa nhất quán. | Giữ viewport an toàn mặc định của browser, bổ sung padding/inset phòng vệ ở PMS shell/dialog; footer và thao tác vẫn nhìn thấy khi viewport ngắn. |
| P1 | Manager có ô tìm kiếm toàn cục cần xác minh hiển thị ở mobile. | Giữ khả năng tìm kiếm qua mọi breakpoint; không thay thuật toán lọc của màn hình. |
| P1 | Settings có filter select inline 220px + flex sibling, bảng RoleMatrix và grid inline. | Kiểm tra min-content/flex và vùng cuộn ở 320px; sửa shrink/wrap tại component hoặc stylesheet dùng chung khi có lỗi thật. |
| P2 | Tràn chuỗi dài, căn hàng toolbar, bảng/rate matrix và trạng thái trống/lỗi. | Wrap tên/nhãn, cho vùng nội dung co lại; bảng chỉ cuộn trong vùng có tên và truy cập bằng bàn phím. |
| P2 | Font/spacing form liên hệ và độ nhất quán các control. | Dùng hệ chữ/spacing đang có, trạng thái focus rõ và input đủ lớn. |

Đã triển khai từng nhóm: shell/form dùng chung → các lỗi cụ thể có bằng chứng → kiểm tra browser → sửa hồi quy. Không tái cấu trúc provider/router hoặc dựng lại giao diện. Filter `searchable` 220px trong `MasterGrid` chưa có caller bật tính năng đó, nên không sửa CSS cho nhánh chưa dùng.

Quyết định sau review: không bật `viewport-fit=cover` toàn cục trong đợt này. Tùy chọn đó mở rộng nội dung vào vùng notch ở mọi shell và overlay, nên chỉ bật sau khi có kiểm tra/đệm đầy đủ cho marketing, auth, Manager và booking panels. Hiện giữ cách browser mặc định bảo vệ viewport; CSS `env(safe-area-inset-*)` tại các bề mặt đã sửa là phòng vệ bổ sung, không phải bằng chứng kiểm tra thiết bị thật.

## File và hành vi đã thay đổi

Các đường dẫn dưới đây tính từ `frontend/src/`:

| File | Thay đổi |
| --- | --- |
| `apps/pms/layouts/PmsLayout.css` | Gutter 12px trên điện thoại/16px desktop; reload và nhóm cài đặt đủ vùng chạm; focus cho vùng bảng; input 16px/control 44px trên pointer thô; padding safe-area phòng vệ. |
| `apps/pms/components/DomainForms.css` | Label co/wrap được, giữ flex-basis 140px; form input và nút tối thiểu 44px, input 1rem. |
| `apps/pms/components/FormDialog.css` | Chiều rộng/chiều cao tính cả safe-area, overscroll có giới hạn, padding mobile-first, nút đóng 44px; giữ native dialog và vòng đời focus hiện có. |
| `apps/pms/settings/pages/Settings.jsx` | Input/nút dễ chạm; switch có vùng chạm 44px nhưng giữ hình 36×20px; bảng quyền và catalog có vùng cuộn được đặt tên/focus; bảng quyền giữ đủ cột. |
| `apps/pms/reports/pages/Reports.css` | Input ngày/bộ lọc 16px và tối thiểu 44px; nút export tối thiểu 44px. |
| `apps/manager/components/ManagerHeader.jsx`, `apps/manager/layouts/ManagerLayout.css` | Search hiển thị thành hàng riêng trên điện thoại; thứ tự bàn phím khớp thứ tự hiển thị; giữ xử lý filter cũ; 16px/44px trên thiết bị chạm. |
| `apps/marketing/Contact.css` | Input/textarea 16px, giữ label, validation và thao tác chuẩn bị/sao chép nội dung. |
| `shared/i18n/LanguageSwitcher.jsx`, `shared/i18n/LanguageSwitcher.css` | Focus item khi mở, mũi tên/Home/End, Escape trả focus, Tab/Shift+Tab ra khỏi menu, đóng khi blur; giữ chọn bằng click và trạng thái radio; focus rõ và option tối thiểu 44px. |

Menu ngôn ngữ đã có `role=menu/menuitemradio`, vì vậy bổ sung hành vi bàn phím tương ứng thay vì đổi kiểu control. Cách mở/focus và di chuyển/thoát dựa trên [WAI APG Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) và [Menu and Menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/). Tìm kiếm trong UI/UX Pro Max trả về hướng dẫn Focus States: giữ focus indicator nhìn thấy được.

## Kiểm tra thực tế

Baseline trước thay đổi: **165 tests đạt**, lint có warning hiện có, build đạt. Sau thay đổi:

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` | 165 đạt, không thất bại. |
| `npm run lint` | Exit 0; 34 warning cũ, không thêm warning tại LanguageSwitcher. |
| `npm run build` | Exit 0; đã chạy lại sau phần chỉnh marketing và phần tiếp tục P1/P2. |
| `npm run i18n:audit` | Exit 0; báo 4 mục thiếu đã tồn tại trong file buồng phòng/kênh không sửa ở đợt này. |
| Typecheck | Không có script typecheck hoặc TypeScript config; không chạy. |
| Layout PMS | 43 route × 7 độ rộng = 301 lượt đo; 0 lỗi document/main overflow, 0 lỗi trang/runtime, 0 fixture endpoint thiếu. |
| Tương tác PMS | 56 kiểm tra đạt: navigation, filter/search, mở chi tiết/tạo booking, sửa catalog, cuộn bảng/quyền bằng bàn phím, focus dialog, ARI và dialog kho. |
| Manager | 70 lượt đo; không lỗi runtime/endpoint ngoài fixture; kiểm tra search lọc/xóa, menu/account Escape và mô phỏng chữ 200%. |
| Công khai/auth | 48 lượt đo; kiểm tra navigation, bảng giá, blog, login lỗi giả lập/hiện mật khẩu/Tab, ngôn ngữ và reduced-motion; 0 page error. |
| Bàn phím ngôn ngữ | 10 trường hợp đạt: login ở 7 độ rộng, marketing compact 390/1440, menu lồng trong account PMS 390. Kiểm tra mở/di chuyển/chọn, Escape, Tab/Shift+Tab, click ngoài, focus, 44px và không tràn. |

Ma trận chính: **320, 375, 390, 430, 768, 1024, 1440px**, Chrome cài trên Windows qua Playwright. API trả fixture có kiểm soát; các kiểm tra PMS không phát sinh request ghi. Đây là kiểm tra UI và hành vi trình duyệt, không thay cho tích hợp Flask/PostgreSQL hoặc giao dịch tiền thật.

Kiểm tra ngôn ngữ đã **đỏ trước sửa** (Enter mở menu nhưng focus vẫn ở trigger), **xanh sau sửa**; khi cố tình làm hỏng ArrowDown chỉ trong response của browser kiểm tra, assert bắt được lỗi. Không thay đổi nguồn để thử mutation. Escape ở menu ngôn ngữ trên điện thoại giữ nguyên account panel cha.

Bằng chứng trong `frontend/output/playwright/`: `responsive-2026-10-18/pms-report.json`, `pms-interactions.json`, `manager-qa.json`, `public-qa.json`, ảnh 320/1440; `language-keyboard-2026-10-18/report.json` và `login-320-keyboard.png`. Script QA local được giữ trong `.tools/qa/` (đã được repository ignore).

## Giới hạn còn lại

- Chưa chạy Safari/WebKit hoặc thiết bị Android/iOS thật. Cần xác nhận iOS Safari/Android Chrome, bàn phím ảo, xoay ngang, pinch zoom và safe-area trên máy thật.
- Header marketing chồng chữ/logo khi mô phỏng chữ 200% ở 320px đã được sửa trong `b52c3c2`; lần kiểm tra tiếp tục xác nhận không chồng hình và anchor không bị header che. Tên trong hình minh họa sản phẩm ở trang chủ vẫn có ellipsis; đây là nội dung preview, không phải thao tác nghiệp vụ bị mất.
- Giữ 34 lint warning và 4 mục i18n có sẵn ngoài phạm vi sửa UI này; một số màn hình cũ vẫn dùng inline styles và CSS override.
- Không kiểm tra thao tác ghi với backend thật, tất cả tổ hợp dữ liệu/quyền/locale, hoặc toàn bộ trạng thái lỗi/nội dung cực dài. Đợt tiếp tục đã bổ sung lỗi chuỗi dài 240 ký tự trong dialog và danh mục kho; route/data/business logic không được sửa.
- Build vẫn tải eager bundle lớn hiện có; đợt sửa này không đo hoặc tuyên bố tăng tốc độ tải trang. Chia tải theo route là cơ hội tối ưu riêng cần đo trước/sau.

## Tiếp tục theo ưu tiên P1/P2 — 18/10/2026, sau `b52c3c2`

Đối chiếu mã hiện tại trước khi sửa: phần lớn các mục trong kế hoạch đã được triển khai trong commit trước. Đợt tiếp tục giữ nguyên các sửa đó, kiểm tra phần thiếu bằng Chrome và chỉ bổ sung CSS cho lỗi tái hiện được.

| Ưu tiên | Trạng thái sau đợt tiếp tục |
| --- | --- |
| P1 — Form/control dùng chung | Giữ control PMS và nút đóng dialog 44px. Bổ sung Manager trên `pointer: coarse`: input/select/textarea tối thiểu 44px và chữ 16px, icon button 44×44px, nút thao tác và link trong menu tài khoản tối thiểu 44px. Kiểm tra cả 7 độ rộng với cảm ứng, thêm form hồ sơ khách sạn ở 320/768px. |
| P1 — Viewport thấp/insets | Sửa menu tài khoản Manager tràn ở 320×320 và 667×375 bằng vùng cuộn độc lập, giới hạn trong viewport thấp. Kiểm tra thêm 844×390, Escape, khả năng focus thao tác cuối; dialog PMS/hồ sơ khách sạn ở viewport thấp cuộn tới nút lưu được. Giữ CSS safe-area phòng vệ đã có và quyết định chưa bật `viewport-fit=cover`; xác nhận notch/bàn phím ảo trên thiết bị thật còn mở. |
| P1 — Search Manager | Giữ khả năng tìm kiếm trên điện thoại. Bộ hồi quy xác nhận lọc/xóa bộ lọc vẫn hoạt động; mở rộng kích thước control cho tablet cảm ứng. |
| P1 — Settings | Kiểm tra bảng quyền ở 7 độ rộng: giữ đủ 5 cột, không tràn toàn trang, cuộn bằng ArrowRight khi bảng rộng hơn vùng hiển thị. Filter `searchable` 220px của `MasterGrid` vẫn chưa có caller, không thêm sửa cho nhánh chưa dùng. |
| P2 — Chuỗi dài/trạng thái lỗi | Sửa `overflow-wrap: anywhere` cho `.domain-error` và `.pms-form-dialog-error`. Thông báo lỗi 240 ký tự không khoảng trắng trước sửa làm dialog rộng 1.588px tại viewport 320px; sau sửa nội dung cuộn dọc, không tràn ngang. Giữ dữ liệu form và focus trả về nút mở khi đóng dialog. |
| P2 — Liên hệ/font/spacing | Giữ form liên hệ 16px và hệ spacing hiện có. Chạy lại trang công khai/auth ở 7 độ rộng, landscape, chữ 200%, menu, ngôn ngữ và reduced-motion; không phát hiện lỗi mới cần sửa. |

Phạm vi thay đổi sản phẩm: `apps/manager/layouts/ManagerLayout.css`, `apps/pms/components/DomainForms.css`, `apps/pms/components/FormDialog.css`. Không thêm dependency hoặc thay handler nghiệp vụ.

### Bằng chứng bổ sung

- Hồi quy lỗi đã đỏ trước sửa: control Manager ở 768/1024/1440px cảm ứng có nút 40px, ô tìm 42px/chữ 13px; menu tài khoản ở 320×320 có đáy 426px; lỗi dài trong dialog có `clientWidth=294`, `scrollWidth=1588`.
- Bộ `manager-qa.cjs priority`: **42/42 kiểm tra đạt**, gồm cảm ứng, viewport thấp, dialog, bảng quyền, bàn phím và lỗi dài; kết quả lưu trong `frontend/output/playwright/responsive-2026-10-18/manager-priority.json`, cùng ảnh `priority-*.png`. Lỗi ghi thử được trả từ fixture 503, không chuyển tới backend thật; trước khi kiểm tra form bên dưới, đóng thông báo lỗi chung bằng Escape.
- Bộ hồi quy Manager: 70 lượt đo, không lỗi tràn, runtime hoặc endpoint ngoài fixture. Trang công khai/auth: 48 lượt đo, 6 trường hợp chữ 200%, không page error; header/anchor marketing đã qua assert hình học. Kết quả thô lần chạy lại ở `.tools/qa/responsive-priority/{manager,public}/` (local, được ignore); tổng hợp lưu tại `frontend/output/playwright/responsive-2026-10-18/priority-regression-summary.json`.
- `npm test`: 165 đạt, 0 thất bại/skip. `npm run lint`: exit 0, giữ 34 warning có sẵn. `npm run build`: exit 0. `npm run i18n:audit`: exit 0, giữ 4 mục thiếu có sẵn.
- Hai script QA có thể tìm Playwright qua Node resolution/`NODE_PATH`, không còn gắn đường dẫn tài khoản máy cũ. `MANAGER_QA_URL`/`PUBLIC_QA_URL` chọn server local, `RESPONSIVE_QA_OUTPUT` chọn thư mục bằng chứng để không ghi đè lần kiểm tra cũ. Không tự cài thêm package.

Phần còn lại cần môi trường khác: Safari/WebKit, iOS/Android thật, bàn phím ảo và safe-area thực tế. Ma trận 43 route PMS/301 lượt đo thuộc đợt ban đầu; đợt tiếp tục chỉ chạy lại các bề mặt PMS bị ảnh hưởng, không tuyên bố đã chạy lại toàn bộ ma trận đó.
