import React, { Suspense } from 'react';
import { createBrowserRouter, createRoutesFromElements, RouterProvider, Route, Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { RouteGuard, LayoutGuard, AccessDialog } from '../shared/components/AccessControl';
import LohaErrorPage from '../shared/components/LohaErrorPage';
import RouteErrorBoundary from '../shared/components/RouteErrorBoundary';
import LegacyI18nBridge from '../shared/i18n/LegacyI18nBridge';
import { DraftGuardProvider, DraftRouteGuard } from '../shared/drafts/DraftGuardProvider';
import { clientOtaSettingsPath } from '../apps/pms/channel-manager/clientChannelOperations';
import { PmsProvider } from '../apps/pms/data/PmsProvider';
import { lazyRoute } from '../shared/lib/lazyRoute.js';
import LohaLoading from '../shared/components/LohaLoading';
import { t, useI18n } from '../shared/i18n/useI18n.js';

// ==========================================
// THƯ MỤC LAYOUTS
// Các Layout bọc ngoài (Wrapper) để tái sử dụng giao diện
// ==========================================
const MarketingLayout = lazyRoute(() => import('../apps/marketing/layouts/MarketingLayout'));
const PmsLayout = lazyRoute(() => import('../apps/pms/layouts/PmsLayout'));
const AuthLayout = lazyRoute(() => import('../apps/pms/auth/layouts/AuthLayout'));
const ManagerLayout = lazyRoute(() => import('../apps/manager/layouts/ManagerLayout'));

// ==========================================
// THƯ MỤC PAGES / MARKETING
// Các trang dành cho khách vãng lai
// ==========================================
const Home = lazyRoute(() => import('../apps/marketing/Home'));
const Pricing = lazyRoute(() => import('../apps/marketing/Pricing'));
const Blog = lazyRoute(() => import('../apps/marketing/Blog'));
const Contact = lazyRoute(() => import('../apps/marketing/Contact'));

// ==========================================
// THƯ MỤC PAGES / APP (PMS)
// Các trang dành cho quản trị viên 
// ==========================================
const Login = lazyRoute(() => import('../apps/pms/auth/pages/Login'));
const Dashboard = lazyRoute(() => import('../apps/pms/dashboard/pages/Dashboard'));
const ARI = lazyRoute(() => import('../apps/pms/rates-inventory/pages/ARI'));
const RoomDiagram = lazyRoute(() => import('../apps/pms/rooms/pages/RoomDiagram'));
const Reservations = lazyRoute(() => import('../apps/pms/reservations/pages/Reservations'));
const Rooms = lazyRoute(() => import('../apps/pms/rooms/pages/Rooms'));
const Settings = lazyRoute(() => import('../apps/pms/settings/pages/Settings'));
const Profile = lazyRoute(() => import('../apps/pms/profile/pages/Profile'));
const MatrixRate = lazyRoute(() => import('../apps/pms/rates-inventory/pages/MatrixRate'));
const Cashflow = lazyRoute(() => import('../apps/pms/finance/pages/Cashflow'));
const Commissions = lazyRoute(() => import('../apps/pms/finance/pages/Commissions'));
const Rates = lazyRoute(() => import('../apps/pms/rates-inventory/pages/Rates'));
const Vouchers = lazyRoute(() => import('../apps/pms/rates-inventory/pages/Vouchers'));
const RatesARI = lazyRoute(() => import('../apps/pms/rates-inventory/pages/RatesARI'));
const Promotions = lazyRoute(() => import('../apps/pms/rates-inventory/pages/Promotions'));
const ExchangeRates = lazyRoute(() => import('../apps/pms/rates-inventory/pages/ExchangeRates'));
const Housekeeping = lazyRoute(() => import('../apps/pms/housekeeping/pages/Housekeeping'));
const HousekeepingStaff = lazyRoute(() => import('../apps/pms/housekeeping/pages/HousekeepingStaff'));
const HousekeepingPlan = lazyRoute(() => import('../apps/pms/housekeeping/pages/HousekeepingPlan'));
const InventoryIn = lazyRoute(() => import('../apps/pms/inventory/pages/InventoryIn'));
const InventoryOut = lazyRoute(() => import('../apps/pms/inventory/pages/InventoryOut'));
const InventoryTransfer = lazyRoute(() => import('../apps/pms/inventory/pages/InventoryTransfer'));
const InventoryCheck = lazyRoute(() => import('../apps/pms/inventory/pages/InventoryCheck'));
const InventoryStock = lazyRoute(() => import('../apps/pms/inventory/pages/InventoryStock'));
const Sales = lazyRoute(() => import('../apps/pms/finance/pages/Sales'));
const UserManagement = lazyRoute(() => import('../apps/pms/user-management/pages/UserManagement'));
const Reports = lazyRoute(() => import('../apps/pms/reports/pages/Reports'));
const DayReconciliation = lazyRoute(() => import('../apps/pms/reconciliation/DayReconciliation'));

// ==========================================
// THƯ MỤC PAGES / QUẢN LÝ (MANAGER)
// ==========================================
const AdminDashboard = lazyRoute(() => import('../apps/manager/dashboard/pages/AdminDashboard'));
const AdminTenants = lazyRoute(() => import('../apps/manager/tenants/pages/AdminTenants'));
const ManagerOTA = lazyRoute(() => import('../apps/manager/tenants/pages/ManagerOTA'));
const ManagerChannex = lazyRoute(() => import('../apps/manager/channex/pages/ManagerChannex'));
const AdminBilling = lazyRoute(() => import('../apps/manager/billing/pages/AdminBilling'));
const AdminFeatures = lazyRoute(() => import('../apps/manager/features/pages/AdminFeatures'));
const AdminUsers = lazyRoute(() => import('../apps/manager/users/pages/AdminUsers'));
const AdminLogs = lazyRoute(() => import('../apps/manager/logs/pages/AdminLogs'));
const AdminProfile = lazyRoute(() => import('../apps/manager/profile/pages/AdminProfile'));

/**
 * COMPONENT: App
 * Mục đích: Quản lý toàn bộ định tuyến (Routing) của ứng dụng.
 * Dev lưu ý:
 * - Nhánh `/` dành cho Marketing Site.
 * - Nhánh `/id/` mô phỏng Subdomain cho App (id.domain).
 */
function OtaSettingsRedirect({ history = false }) {
  const { search } = useLocation();
  return <Navigate to={clientOtaSettingsPath(search, history ? 'history' : 'channels')} replace />;
}

// A nested boundary keeps the active shell visible while its page loads.
// Forward the outlet context used by Manager pages for their theme.
function RouteContent() {
  const context = useOutletContext();
  useI18n();
  return <RouteErrorBoundary fullPage={false}>
    <Suspense fallback={<LohaLoading message={t('common.loading')} />}>
      <Outlet context={context} />
    </Suspense>
  </RouteErrorBoundary>;
}

function AppContent() {
  useI18n();
  return <>
    <DraftRouteGuard />
    <RouteErrorBoundary><Suspense fallback={<LohaLoading fullPage message={t('common.loading')} />}><Outlet /></Suspense></RouteErrorBoundary>
    <AccessDialog />
    <LegacyI18nBridge />
  </>;
}

// oxlint-disable-next-line react/only-export-components -- Share the actual route tree with integration tests.
export const appRoutes = createRoutesFromElements(
  <Route element={<AppContent />}>
    {/* ---------------------------------------------------------
    PHÂN VÙNG 1: MARKETING (DOMAIN CHÍNH)
    Sử dụng MarketingLayout (Header, Footer chuẩn doanh nghiệp)
    --------------------------------------------------------- */}
    <Route path="/" element={<MarketingLayout />}>
      <Route element={<RouteContent />}>
        <Route index element={<Home />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="blog" element={<Blog />} />
        <Route path="contact" element={<Contact />} />
      </Route>
    </Route>

    {/* ---------------------------------------------------------
    PHÂN VÙNG 2: AUTHENTICATION (ĐĂNG NHẬP)
    Sử dụng AuthLayout (Giao diện tối giản chỉ có Form)
    --------------------------------------------------------- */}
    <Route path="/id" element={<AuthLayout />}>
      <Route element={<RouteContent />}>
        <Route path="login" element={<Login />} />
      </Route>
    </Route>

    {/* ---------------------------------------------------------
    PHÂN VÙNG 3: APP PMS (HỆ THỐNG QUẢN TRỊ KHÁCH SẠN)
    Sử dụng PmsLayout (Có Sidebar và Top Header)
    --------------------------------------------------------- */}
    <Route path="/id" element={<LayoutGuard><PmsLayout /></LayoutGuard>}>
      <Route element={<RouteGuard />}>
        <Route element={<RouteContent />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="room-diagram" element={<RoomDiagram />} />
          <Route path="ari" element={<ARI />} />
          <Route path="rooms" element={<Rooms />} />
          <Route path="reservations" element={<Reservations />} />
          <Route path="settings" element={<Settings />} />
          <Route path="profile" element={<Profile />} />
          <Route path="matrix-rate" element={<MatrixRate />} />
          <Route path="cashflow" element={<Cashflow />} />
          <Route path="cashflow/:tab" element={<Cashflow />} />
          <Route path="commissions" element={<Commissions />} />
          <Route path="gia" element={<Rates />} />
          <Route path="gia/vouchers" element={<Vouchers />} />
          <Route path="gia/ari" element={<RatesARI />} />
          <Route path="gia/promotions" element={<Promotions />} />
          <Route path="gia/exchange-rates" element={<ExchangeRates />} />
          <Route path="gia/:tab" element={<Rates />} />
          <Route path="housekeeping/status" element={<Housekeeping />} />
          <Route path="housekeeping/staff" element={<HousekeepingStaff />} />
          <Route path="housekeeping/plan" element={<HousekeepingPlan />} />
          <Route path="housekeeping" element={<Housekeeping />} />
          <Route path="housekeeping/:tab" element={<Housekeeping />} />
          <Route path="inventory/in" element={<InventoryIn />} />
          <Route path="inventory" element={<Navigate to="/id/inventory/in" replace />} />
          <Route path="inventory/out" element={<InventoryOut />} />
          <Route path="inventory/transfer" element={<InventoryTransfer />} />
          <Route path="inventory/check" element={<InventoryCheck />} />
          <Route path="inventory/stock" element={<InventoryStock />} />
          <Route path="sales" element={<Sales />} />
          <Route path="users" element={<UserManagement />} />
          <Route path="ota" element={<OtaSettingsRedirect />} />
          <Route path="ota-history" element={<OtaSettingsRedirect history />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reports/reconciliation" element={<DayReconciliation />} />
          <Route path="reports/revenue" element={<Reports />} />
          <Route path="reports/occupancy" element={<Reports />} />
          {['source', 'room', 'roomType', 'cancellations', 'nationality', 'discounts'].map(report => <Route key={report} path={`reports/${report}`} element={<Reports />} />)}

          {/* Tự động chuyển hướng (Redirect) nếu user truy cập thẳng `/id` */}
          <Route index element={<Navigate to="/id/dashboard" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<LohaErrorPage status={404} />} />
    </Route>

    {/* ---------------------------------------------------------
    PHÂN VÙNG 4: QUẢN LÝ (AGENCY/RESELLER / BACKOFFICE HQ)
    Sử dụng ManagerLayout (Dark Forest Green Sidebar & Electric Lime Accent)
    --------------------------------------------------------- */}
    <Route path="/manager" element={<LayoutGuard manager><ManagerLayout /></LayoutGuard>}>
      <Route element={<RouteGuard />}>
        <Route element={<RouteContent />}>
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="tenants" element={<AdminTenants />} />
          <Route path="channex" element={<ManagerChannex />} />
          <Route path="tenants/:tenantId/ota" element={<ManagerOTA />} />
          <Route path="tenants/:tenantId/ota-history" element={<ManagerOTA history />} />
          <Route path="billing" element={<AdminBilling />} />
          <Route path="features" element={<AdminFeatures />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="logs" element={<AdminLogs />} />
          <Route path="profile" element={<AdminProfile />} />
          <Route index element={<Navigate to="/manager/dashboard" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<LohaErrorPage status={404} />} />
    </Route>

    {/* ---------------------------------------------------------
    CATCH-ALL (Lỗi 404)
    Giữ đường dẫn và hiển thị trang không tìm thấy
    --------------------------------------------------------- */}
    <Route path="*" element={<LohaErrorPage status={404} fullPage />} />
  </Route>
);

// A data router provides blockers for links, query/hash changes and history
// navigation. Lazily create it once so StrictMode does not attach it twice.
let router;
function App() {
  router ??= createBrowserRouter(appRoutes);
  return <DraftGuardProvider><PmsProvider><RouterProvider router={router} /></PmsProvider></DraftGuardProvider>;
}

export default App;
