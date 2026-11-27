# QA2-01 — Unit Test và Build Frontend, vòng 2

Ngày kiểm tra: 21/10/2026 (Asia/Ho_Chi_Minh). Commit: `accc668f71897191cbc98b1388c21ba01d15edb3`.

## Kết luận

Unit test: **171 pass, 0 fail, 0 skip, 0 cancelled, 0 todo**. Lint: **0 lỗi, 32 cảnh báo**, exit 0. Production build: **đạt**, exit 0. Typecheck: **chưa được thiết lập**, không được coi là đạt. Chưa tái hiện lỗi chức năng hoặc lỗi giao diện mới; kết quả này không xác nhận hợp đồng API thật hoặc mọi luồng trình duyệt.

Chỉ tạo báo cáo này; không sửa source, package.json, lockfile; không push, merge hoặc triển khai. `node_modules/` và `dist/` là sản phẩm local được gitignore.

## 1. Mã nguồn và cấu hình đã xác minh

- `frontend/` có source thực tế: 225 file trong `src/`, gồm 97 file JSX và 30 file `*.test.js`; có `index.html`, `public/`, Vite config và npm lockfile v3.
- Framework: React/React DOM **19.2.8**, React Router DOM **7.18.3**, Vite **8.2.2**, `@vitejs/plugin-react` **6.1.1**. Có Recharts, Lucide và Framer Motion.
- Test runner: Node tích hợp (`node:test`, `node:assert/strict`), script `node --test --test-isolation=none`; không có Jest/Vitest config. Provider test dùng Vite SSR và React `renderToString`.
- Lint: Oxlint **1.80.0**, cấu hình `frontend/.oxlintrc.json`, quét `src` và `vite.config.js`; không tự sửa.
- Build: `vite build`, ghi `frontend/dist/`, `emptyOutDir: true`; ngưỡng cảnh báo chunk 2.000 kB. Proxy `/api` tới `127.0.0.1:5000` chỉ thuộc dev server.
- Source JS/JSX; không tìm thấy `tsconfig*`, script `typecheck`, hoặc dependency TypeScript. Có `@types/react` không đồng nghĩa đã kiểm tra kiểu. Vite build không thay thế typecheck.
- Tài liệu đã đối chiếu: `frontend/README.md`, `docs/reports/frontend/client-frontend-test-and-gaps-2026-10-15.md`; đọc package.json, lockfile, cấu hình lint/build, các import và các điểm có khả năng I/O của test.

## 2. Dependencies và an toàn thực thi

Môi trường: Linux, Node **v26.12.0**, npm **12.2.1**. Node đáp ứng `engines.node >=22.12.0`; chưa kiểm chứng lại trên Node 22 dùng khi triển khai.

Ban đầu không có `frontend/node_modules/`: `npm ls --depth=0` báo `ELSPROBLEMS`, thiếu toàn bộ 12 dependencies trực tiếp. Đây là dependencies chưa cài trong worktree, không phải bằng chứng package.json thiếu khai báo.

Cài tại `frontend/` bằng `npm ci --include=dev --ignore-scripts --no-audit --no-fund`: exit 0, thêm 72 packages. Dùng đúng lockfile, giữ dev/optional dependencies cần cho binary Linux; tắt lifecycle scripts, audit và fund. Chỉ tải package từ registry npm, không truy cập PMS production. Lint/build/test chạy được sau cài nên không cần bật lại install scripts. `npm ls --depth=0` sau cài exit 0; package.json và lockfile không có diff.

Các lệnh test đã được kiểm tra trước khi chạy:

- `api.test.js` truyền fetcher giả vào `createApiClient`; POST/PATCH/DELETE chỉ nhận `Response` giả, journal/storage dùng Map trong bộ nhớ. `https://api.example.test/` chỉ là chuỗi được assert, không gửi HTTP.
- `PmsProvider.test.js` tạo Vite server với `configFile: false`, `middlewareMode: true`, HMR tắt, không gọi `listen`; chỉ SSR. React effects gọi `/api/auth/session` không chạy khi `renderToString`; server đóng trong `finally`.
- Workspace dùng fixture demo, callback refresh giả, DOM/storage/print preview giả. Test i18n đọc source bằng `readFileSync`/`readdirSync` và phục hồi globals sau ca thử. Các kiểm tra còn lại kiểm tra hàm/payload/trình bày, không gọi backend/provider ngoài.
- Không chạy script trong `frontend/output/playwright/`, không chạy backend, dev/preview server, browser với API thật hoặc thao tác OTA. Các script này không thuộc bộ unit test đã chạy.
- Build chỉ biên dịch asset, cấu hình hiện tại không có plugin deploy hoặc hook gọi API. Không có file `.env*` trong thư mục frontend tại thời điểm kiểm tra. Không chạy lệnh có khả năng ghi dữ liệu nghiệp vụ nên không phát sinh bước xin phê duyệt API thật.

## 3. Lệnh và kết quả

Các lệnh npm thực thi từ thư mục `frontend/` của worktree hiện tại. Thời gian dưới đây do công cụ tự báo, chỉ mang tính tham khảo trên máy QA.

| Lệnh | Exit code | Pass / fail / skip | Kết quả |
| --- | --- | --- | --- |
| `node --version` | 0 | Không áp dụng | v26.12.0 |
| `npm --version` | 0 | Không áp dụng | 12.2.1 |
| `npm ls --depth=0` trước cài | 1 | Không áp dụng | ELSPROBLEMS, 12 dependencies chưa cài |
| `npm ci --include=dev --ignore-scripts --no-audit --no-fund` | 0 | Không áp dụng | Thêm 72 packages, khoảng 3 giây |
| `npm ls --depth=0` sau cài | 0 | Không áp dụng | Đủ 12 dependencies trực tiếp |
| `npm test` | 0 | **171 / 0 / 0** | 0 cancelled/todo; 602,98 ms |
| `npm run lint` | 0 | Không áp dụng | 32 cảnh báo, 0 lỗi |
| `npm run typecheck` | 1 | Không áp dụng | `Missing script: "typecheck"`; chưa thực hiện kiểm tra kiểu |
| `npm run build` | 0 | Không áp dụng | 2.012 modules, build 338 ms |

Typecheck được gọi lại riêng để xác nhận exit code 1 sau lượt kiểm tra gộp; không thêm script hoặc cài compiler ngoài lockfile.

Trích kết quả test:

```text
ℹ tests 171
ℹ suites 0
ℹ pass 171
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 602.981775
```

Trích kết quả build:

```text
npm notice run pms-system@0.0.0 build
npm notice run vite build
vite v8.2.2 building client environment for production...
transforming...
✓ 2012 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                               0.73 kB │ gzip:   0.40 kB
dist/assets/index-DeY_5Agl.css              298.27 kB │ gzip:  46.79 kB
dist/assets/rolldown-runtime-CbXtAM7H.js      0.58 kB │ gzip:   0.36 kB
dist/assets/modules-CKZYeMQL.js               3.56 kB │ gzip:   1.57 kB
dist/assets/vendor-DPB5TGof.js              255.00 kB │ gzip:  81.40 kB
dist/assets/index-C5zCHf4d.js             1,297.41 kB │ gzip: 343.54 kB

✓ built in 338ms
```

## 4. Đối chiếu vòng 1

Ticket cung cấp mốc **170 frontend tests pass**; lần này runner ghi nhận **171 pass**, tăng 1 về tổng số, không fail/skip. Tìm `170` trong các Markdown của repo không thấy báo cáo vòng 1 tương ứng; không có log, danh sách ca hoặc commit baseline để chứng minh chính xác ca nào được thêm/xóa hay 170 ca cũ giữ nguyên.

Báo cáo `docs/reports/frontend/client-frontend-test-and-gaps-2026-10-15.md`, mục 4, ghi **139 pass**, gắn với mốc `26e45ae`, nên là mốc lịch sử khác. Không thay mốc 170 của ticket bằng 139, không cộng các lượt chạy.

Ca `PMS context exposes the system request used by manager operations` hiện pass; `PmsProvider.jsx:186` có xuất `requestSystem`. Lịch sử có commit `69f5023` bổ sung sửa lỗi này, nhưng chưa đủ căn cứ khẳng định đây chính là chênh lệch với mốc 170.

## 5. Phát hiện, bằng chứng và hướng xử lý

| Mã | Mức độ / trạng thái | Bằng chứng | Nguyên nhân nghi ngờ / tác động | Hướng xử lý đề xuất |
| --- | --- | --- | --- | --- |
| FE-QA-01 | P2 — Thiếu cổng typecheck | package.json thiếu script/compiler; không có tsconfig; lệnh exit 1 | JS/JSX chưa thiết lập kiểm tra kiểu; build xanh không phát hiện mọi sai kiểu props/payload | Thống nhất cách dùng checkJs/JSDoc hoặc TypeScript và thêm lệnh CI riêng trong ticket sửa source |
| FE-QA-02 | P2 — Nợ lint, chưa xác nhận lỗi runtime | 32 warnings, log đầy đủ ở phụ lục | Effect cập nhật state, dependency thiếu, ref trong render/cleanup, memoization có thể gây render dư hoặc stale closure; đây là cảnh báo tĩnh | Ưu tiên provider, booking và thu chi; tái hiện bằng test lifecycle với API giả trước khi sửa |
| FE-QA-03 | P2 — Khoảng trống kiểm thử giao diện/lifecycle | 30 file test; provider chỉ SSR một Probe assert `typeof requestSystem`; không có DOM runner/coverage script trong package.json | SSR không chạy useEffect; test hàm không chứng minh hành vi click, responsive, focus, lỗi/chậm và đổi tenant trong UI | Thêm component tests có mock API cho chuyển tenant khi request đang chạy, quote chậm, giữ bản nháp và retry tiền; browser test trên fixture local được duyệt |
| FE-QA-04 | P2 — Hợp đồng API chưa được kiểm chứng trong lượt này | api.test.js dùng fetcher giả; ca provider không phát request | Payload giả có thể khác schema backend; chưa có bằng chứng mismatch API mới | Kiểm tra contract với schema/fixture backend và test tích hợp local riêng sau khi xác minh không dùng production |
| FE-QA-05 | P3 — Tài liệu frontend lỗi thời | README còn ghi billing/feature thương mại, người dùng toàn hệ thống chưa triển khai; source provider có `savePlan`, `saveTenantSubscription`, `setGlobalFeature`, và test form billing/users/features | README mô tả giai đoạn BE01–05 cũ, dễ làm sai phạm vi QA | Đồng bộ README với source và trạng thái nghiệm thu; có code không đồng nghĩa chức năng đã nghiệm thu |
| FE-QA-06 | P3 — Baseline thiếu bằng chứng | Không tìm được báo cáo 170 trong Markdown repo | Không thể so sánh từng ca với vòng 1 | Lưu commit, runtime, danh sách ca và log gốc của vòng 1 để đối chiếu |

Không đo tỷ lệ line/branch coverage trong lượt này; không suy ra coverage đầy đủ từ 171 test. `workspace.test.js` có 16 khai báo test kiểm tra fixture demo (README xác nhận provider runtime không dùng workspace cũ), vì vậy tổng test pass không đồng nghĩa mọi luồng runtime được bao phủ. Không thực hiện kiểm tra giao diện trực quan mới, nên không khẳng định responsive hoặc UI không có lỗi.

Bundle entry JS khoảng 1.297,41 kB (gzip 343,54 kB), CSS 298,27 kB (gzip 46,79 kB). Không vượt ngưỡng cảnh báo cấu hình 2.000 kB; chưa đo tải thực tế, không phân loại là lỗi hiệu năng đã tái hiện.

## 6. Phụ lục cảnh báo lint

Log bên dưới giữ nguyên thông báo công cụ để truy vết file/dòng; exit code toàn lệnh là 0. Các đường dẫn tương đối tính từ `frontend/`.

```text
npm notice run pms-system@0.0.0 lint
npm notice run oxlint src vite.config.js
src/apps/pms/reports/pages/Reports.jsx:35:5: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/reservations/components/BookingDetailPanel.jsx:34:17: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/rooms/pages/Rooms.jsx:5:10: warning eslint(no-unused-vars): Identifier 'Search' is imported but never used. help: Consider removing this import.
src/apps/pms/reservations/components/BookingTabs.jsx:15:40: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/dashboard/pages/Dashboard.jsx:20:5: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/data/PmsProvider.jsx:100:28: warning react(preserve-manual-memoization): Existing memoization could not be preserved help: React Compiler has skipped optimizing this component because the existing manual memoization could not be preserved. This dependency may be mutated later, which could cause the value to change unexpectedly
src/apps/pms/data/PmsProvider.jsx:94:23: warning react(preserve-manual-memoization): Existing memoization could not be preserved help: React Compiler could not prove that this useMemo/useCallback remains memoized. Fix related React Compiler errors inside the callback first. If manual memoization is not required for semantics, remove it; otherwise restructure the callback to avoid values that invalidate memoization
src/apps/pms/data/PmsProvider.jsx:133:273: warning react(preserve-manual-memoization): Existing memoization could not be preserved help: React Compiler has skipped optimizing this component because the existing manual memoization could not be preserved. This dependency may be mutated later, which could cause the value to change unexpectedly
src/apps/pms/data/PmsProvider.jsx:133:24: warning react(preserve-manual-memoization): Existing memoization could not be preserved help: React Compiler could not prove that this useMemo/useCallback remains memoized. Fix related React Compiler errors inside the callback first. If manual memoization is not required for semantics, remove it; otherwise restructure the callback to avoid values that invalidate memoization
src/apps/pms/data/PmsProvider.jsx:35:18: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/data/PmsProvider.jsx:49:53: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/data/PmsProvider.jsx:56:18: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/data/PmsProvider.jsx:35:18: warning react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency: 'restoreSession' help: Either include it or remove the dependency array.
src/apps/pms/data/PmsProvider.jsx:49:169: warning react-hooks(exhaustive-deps): React Hook useEffect has missing dependencies: 'user', 'refresh', and 'scope' help: Either include it or remove the dependency array.
src/apps/pms/data/PmsProvider.jsx:56:18: warning react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency: 'loadAdmin' help: Either include it or remove the dependency array.
src/apps/pms/data/PmsProvider.jsx:71:445: warning react-hooks(exhaustive-deps): React Hook useCallback has unnecessary dependency: user.id help: Either include it or remove the dependency array.
src/apps/pms/data/PmsProvider.jsx:71:445: warning react-hooks(exhaustive-deps): React Hook useCallback has unnecessary dependency: tenantId help: Either include it or remove the dependency array.
src/apps/pms/reservations/components/BookingModal.jsx:21:22: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/reservations/components/BookingModal.jsx:24:5: warning react-hooks(exhaustive-deps): React Hook useEffect has missing dependencies: 'quote', 'form.rooms', and 'form.rooms.length' help: Either include it or remove the dependency array.
src/apps/manager/features/pages/AdminFeatures.jsx:93:5: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/manager/billing/pages/AdminBilling.jsx:75:43: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/settings/pages/Settings.jsx:8:8: warning eslint(no-unused-vars): Identifier 'LegacyOverlay' is imported but never used. help: Consider removing this import.
src/apps/pms/settings/pages/Settings.jsx:505:10: warning eslint(no-unused-vars): Function 'ExchangeRates' is declared but never used. help: Consider removing this declaration.
src/apps/pms/finance/pages/Sales.jsx:24:22: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/finance/pages/Sales.jsx:25:5: warning react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency: 'p' help: Either include it or remove the dependency array.
src/apps/pms/finance/pages/Cashflow.jsx:35:10: warning react(refs): Cannot access refs during render help: React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected
src/apps/pms/finance/pages/Cashflow.jsx:44:5: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/finance/pages/Cashflow.jsx:49:5: warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
src/apps/pms/finance/pages/Cashflow.jsx:44:66: warning react-hooks(exhaustive-deps): React Hook useEffect has missing dependencies: 'settings.timezone', and 'settings.currency' help: Either include it or remove the dependency array.
src/apps/pms/finance/pages/Cashflow.jsx:57:22: warning react-hooks(exhaustive-deps): The ref's value `.current` is accessed directly in the effect cleanup function. help: The ref value will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by react, copy it to a variable inside the effect and use that variable in the cleanup function.
src/apps/pms/finance/pages/Cashflow.jsx:62:7: warning react-hooks(exhaustive-deps): React Hook useEffect has a complex expression in the dependency array. help: Extract the expression to a separate variable so it can be statically checked.
src/apps/pms/finance/pages/Cashflow.jsx:60:9: warning react-hooks(exhaustive-deps): React Hook useEffect has a missing dependency: 'form' help: Either include it or remove the dependency array.
```

Log tạm trên máy QA: `/tmp/pms-qa2-01/test.log`, `/tmp/pms-qa2-01/lint.log`, `/tmp/pms-qa2-01/build.log` (không được commit; các tổng kết và log lint/build đã trích trong báo cáo này).
