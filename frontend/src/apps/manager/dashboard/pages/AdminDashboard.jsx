import DateInput from '../../../../shared/components/DateInput.jsx';
import { formatDateTime } from '../../../../shared/lib/date.js';
import { getIntlLocale } from '../../../../shared/i18n/store.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Building2, CheckCircle2, Layers3, PauseCircle, RefreshCw, ScrollText, Users } from 'lucide-react';
import { usePms } from '../../../pms/data/usePms';
import { money } from '../../../pms/data/model';
import { currentMonthRange, dateFilterRange } from '../../billing/pages/saasBillingForm';
import { planDistribution } from '../../../../shared/config/pricingPlans';
import OperationsPanel from '../OperationsPanel';
import './AdminDashboard.css';

const eventLabels = {
  'tenant.created': 'Tạo khách sạn', 'tenant.updated': 'Cập nhật khách sạn',
  'membership.created': 'Cấp tài khoản khách sạn', 'membership.updated': 'Cập nhật quyền tài khoản',
  'guest.created': 'Tạo hồ sơ khách', 'guest.updated': 'Cập nhật hồ sơ khách',
  'reservation.created': 'Tạo đặt phòng', 'reservation.updated': 'Cập nhật đặt phòng',
  'reservation.status': 'Đổi trạng thái đặt phòng', 'reservation.payment': 'Thu tiền đặt phòng',
  'reservation.refund': 'Hoàn tiền', 'reservation.charge': 'Thêm phụ thu', 'reservation.note': 'Thêm ghi chú',
  'plan.created': 'Tạo gói dịch vụ', 'plan.updated': 'Cập nhật gói dịch vụ',
  'subscription.updated': 'Cập nhật thuê bao', 'saas.invoice_created': 'Tạo hóa đơn dịch vụ',
  'saas.payment_recorded': 'Thu tiền dịch vụ', 'saas.invoice_voided': 'Hủy hóa đơn dịch vụ',
};
const displayDate = value => Number.isFinite(Date.parse(value))
  ? formatDateTime(value, 'UTC') + ' UTC'
  : 'Chưa có thời gian';

export default function AdminDashboard() {
  const { authGeneration } = usePms();
  return <DashboardOverview key={authGeneration} />;
}

function DashboardOverview() {
  useI18n();
  const { tenants, workspace, user, getManagerOverview, listPlans } = usePms();
  const [rangeDraft, setRangeDraft] = useState(currentMonthRange);
  const [range, setRange] = useState(() => dateFilterRange(rangeDraft.start, rangeDraft.through));
  const [revision, setRevision] = useState(0), [filterError, setFilterError] = useState('');
  const [data, setData] = useState({ range: null, revision: -1, overview: null, plans: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getManagerOverview(range.start, range.end), listPlans()])
      .then(([overview, catalog]) => { if (!cancelled) setData({ range, revision, overview, plans: catalog.plans || [], error: '' }); })
      .catch(error => { if (!cancelled) setData({ range, revision, overview: null, plans: [], error: error.message }); });
    return () => { cancelled = true; };
  }, [range, revision, getManagerOverview, listPlans]);
  const current = data.range === range && data.revision === revision;
  const loading = !current;
  const overview = current ? data.overview : null;
  const applyRange = event => {
    event.preventDefault(); setFilterError('');
    try { setRange(dateFilterRange(rangeDraft.start, rangeDraft.through)); }
    catch (error) { setFilterError(error.message); }
  };
  const recentTenants = tenants.slice(-5).reverse();
  const recentEvents = (workspace.auditLogs || []).slice(0, 5);
  const stats = overview ? [
    { label: 'Tổng khách sạn', count: overview.tenants.total, detail: 'Trong hệ thống', Icon: Building2, className: 'dashboard-stat-total' },
    { label: 'Đang hoạt động', count: overview.tenants.active, detail: 'Khách sạn đang mở', Icon: CheckCircle2 },
    { label: 'Tạm ngưng', count: overview.tenants.suspended, detail: 'Khách sạn đang bị khóa', Icon: PauseCircle },
    { label: 'Tài khoản hoạt động', count: overview.users.active, detail: 'Tài khoản đang được kích hoạt', Icon: Users },
  ] : [];

  return <div className="manager-page dashboard-page">
    <div className="manager-page-heading dashboard-heading">
      <div><p className="manager-eyebrow">{labelUi("Không gian điều hành")}</p><h2>{tUi("manager.overview")}</h2><p>{labelUi("Theo dõi khách sạn, gói dịch vụ và thanh toán phần mềm.")}</p></div>
      <Link to="/manager/billing" className="manager-button manager-button-primary">{labelUi("Quản lý thanh toán")}{" "}<ArrowUpRight size={16} aria-hidden="true" /></Link>
    </div>

    <OperationsPanel />

    <form className="manager-panel dashboard-date-filters" onSubmit={applyRange}>
      <div className="dashboard-filter-copy"><strong>{labelUi("Kỳ báo cáo thanh toán")}</strong><p>{labelUi("Theo ngày tạo hóa đơn và ngày ghi nhận khoản thu, múi giờ UTC.")}</p></div>
      <div className="dashboard-filter-controls">
        <label>{labelUi("Từ ngày (UTC)")}<DateInput required value={rangeDraft.start} onChange={start => setRangeDraft(previous => ({ ...previous, start }))} /></label>
        <label>{labelUi("Đến hết ngày (UTC)")}<DateInput required min={rangeDraft.start || undefined} value={rangeDraft.through} onChange={through => setRangeDraft(previous => ({ ...previous, through }))} /></label>
        <div className="dashboard-filter-actions"><button type="submit" className="manager-button">{labelUi("Xem báo cáo")}</button><button type="button" className="manager-button" disabled={loading} aria-label={labelUi("Tải lại tổng quan")} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /></button></div>
      </div>
      {filterError && <p className="dashboard-filter-error" role="alert">{filterError}</p>}
    </form>

    {loading ? <div className="manager-panel dashboard-empty" role="status" aria-busy="true">{labelUi("Đang tải tổng quan…")}</div> : data.error ? <div className="manager-panel dashboard-overview-error"><p role="alert">Không tải được tổng quan: {data.error}</p><button type="button" className="manager-button" onClick={() => setRevision(value => value + 1)}>{tUi("common.retry")}</button></div> : overview && <>
      <dl className="manager-panel dashboard-stats">{stats.map(({ label, count, detail, Icon, className = '' }) => <div key={label} className={`dashboard-stat ${className}`}><dt className="dashboard-stat-top"><span>{labelUi(label)}</span><Icon size={19} aria-hidden="true" /></dt><dd className="dashboard-stat-value">{count.toLocaleString(getIntlLocale())}</dd><dd className="dashboard-stat-detail">{labelUi(detail)}</dd></div>)}</dl>

      <section className="manager-panel dashboard-finance" aria-labelledby="dashboard-finance-title">
        <div className="dashboard-panel-heading"><div><h3 id="dashboard-finance-title">{labelUi("Thanh toán dịch vụ theo tiền tệ")}</h3><p>{labelUi("Hóa đơn và khoản thu theo kỳ đã chọn. Công nợ hiện tại bao gồm tất cả các kỳ.")}</p></div><Link to="/manager/billing" className="dashboard-text-link">{labelUi("Xem hóa đơn")}{" "}<ArrowUpRight size={15} aria-hidden="true" /></Link></div>
        <div className="manager-table-wrap" role="region" aria-label={labelUi("Tổng hợp tiền dịch vụ")} tabIndex={0}><table className="dashboard-finance-table"><thead><tr>{['Tiền tệ', 'Đã lập hóa đơn trong kỳ', 'Đã thu trong kỳ', 'Công nợ hiện tại', 'Quá hạn hiện tại'].map(label => <th key={label} scope="col">{labelUi(label)}</th>)}</tr></thead><tbody>{overview.currencies.map(row => <tr key={row.currency}><th scope="row">{row.currency}</th><td>{money(row.invoiced, row.currency)}</td><td>{money(row.received, row.currency)}</td><td>{money(row.outstanding, row.currency)}</td><td>{money(row.overdue, row.currency)}</td></tr>)}{!overview.currencies.length && <tr><td colSpan={5}>{labelUi("Chưa có hóa đơn hoặc khoản thu.")}</td></tr>}</tbody></table></div>
      </section>

      <div className="dashboard-overview-grid">
        <section className="manager-panel dashboard-tenants" aria-labelledby="dashboard-tenants-title">
          <div className="dashboard-panel-heading"><div><h3 id="dashboard-tenants-title">{labelUi("Khách sạn mới nhất")}</h3><p>{overview.tenants.total} khách sạn trong hệ thống</p></div><Building2 size={19} aria-hidden="true" /></div>
          {!recentTenants.length ? <p className="dashboard-empty" role="status">{labelUi("Chưa có khách sạn. Mở Quản lý khách sạn để bắt đầu.")}</p> : <ul className="dashboard-tenant-list">{recentTenants.map(tenant => <li key={tenant.id}><span className="dashboard-tenant-avatar" aria-hidden="true">{tenant.name?.trim().charAt(0).toUpperCase() || 'K'}</span><div className="dashboard-tenant-name"><strong>{tenant.name}</strong><span>{tenant.id}</span></div><span className={`dashboard-status ${tenant.status === 'active' ? 'dashboard-status-active' : ''}`}>{tenant.status === 'active' ? labelUi("Hoạt động") : tenant.status === 'suspended' ? labelUi("Tạm ngưng") : tenant.status || labelUi("Chưa xác định")}</span><Link to={`/manager/billing?tenant=${encodeURIComponent(tenant.id)}`} className="dashboard-text-link" aria-label={`Gói dịch vụ của ${tenant.name}`}>{tUi("header.plan")}{' '}<ArrowUpRight size={14} aria-hidden="true" /></Link></li>)}</ul>}
          <Link to="/manager/tenants" className="dashboard-panel-footer">{labelUi("Xem tất cả khách sạn")}{" "}<ArrowRight size={16} aria-hidden="true" /></Link>
        </section>

        <section className="manager-panel dashboard-plans" aria-labelledby="dashboard-plans-title">
          <div className="dashboard-panel-heading"><div><h3 id="dashboard-plans-title">{labelUi("Phân phối gói")}</h3><p>{labelUi("Gói đang hiệu lực của khách sạn")}</p></div><Layers3 size={19} aria-hidden="true" /></div>
          <div className="dashboard-plan-content">{planDistribution(overview.plans, data.plans).map(({ code, count, name }) => {
            return <div className={`dashboard-plan-row dashboard-plan-${code.toLowerCase()}`} key={code}><div><span><strong>{code}</strong><small>{name}</small></span><b>{count.toLocaleString(getIntlLocale())} <small>{tUi("common.hotelLower")}</small></b></div><meter min="0" max={overview.tenants.total || 1} value={count} aria-label={`${name}: ${count} trên ${overview.tenants.total} khách sạn`}>{count}/{overview.tenants.total}</meter></div>;
          })}<div className="dashboard-unassigned"><span>{labelUi("Chưa có gói hiệu lực")}</span><strong>{overview.plans.unassigned.toLocaleString(getIntlLocale())}</strong></div><p className="dashboard-plan-note">{labelUi("Loại trừ thuê bao chưa bắt đầu, hết hạn, đã hủy hoặc gói ngừng cung cấp.")}</p></div>
          <Link to="/manager/billing" className="dashboard-panel-footer">{labelUi("Quản lý gói dịch vụ")}{" "}<ArrowRight size={16} aria-hidden="true" /></Link>
        </section>
      </div>

      <section className="manager-panel dashboard-payments" aria-labelledby="dashboard-payments-title">
        <div className="dashboard-panel-heading"><div><h3 id="dashboard-payments-title">{labelUi("Khoản thu gần đây")}</h3><p>{labelUi("Các khoản thanh toán được ghi nhận trong kỳ báo cáo")}</p></div><Link to="/manager/billing" className="dashboard-text-link">{labelUi("Quản lý thanh toán")}{" "}<ArrowUpRight size={15} aria-hidden="true" /></Link></div>
        {!overview.recentPayments.length ? <p className="dashboard-empty" role="status">{labelUi("Chưa có khoản thu trong kỳ.")}</p> : <ul className="dashboard-payment-list">{overview.recentPayments.map((payment, index) => <li key={payment.id || `${payment.invoiceNumber}:${payment.createdAt}:${index}`}><div><strong>{payment.tenantName}</strong><p>{payment.invoiceNumber}</p></div><strong>{money(payment.amount, payment.currency)}</strong><time dateTime={payment.createdAt}>{displayDate(payment.createdAt)}</time></li>)}</ul>}
      </section>
    </>}

    {user?.globalRole === 'SUPER_ADMIN' && <section className="manager-panel dashboard-audit" aria-labelledby="dashboard-audit-title">
      <div className="dashboard-panel-heading"><div><h3 id="dashboard-audit-title">{labelUi("Nhật ký gần đây")}</h3><p>{labelUi("Các sự kiện được ghi nhận trên hệ thống")}</p></div><Link to="/manager/logs" className="dashboard-text-link">{labelUi("Xem nhật ký")}{" "}<ArrowUpRight size={15} aria-hidden="true" /></Link></div>
      {!recentEvents.length ? <p className="dashboard-empty" role="status">{labelUi("Chưa có sự kiện được ghi nhận.")}</p> : <ul className="dashboard-audit-list">{recentEvents.map(log => <li key={log.id}><span className="dashboard-audit-icon"><ScrollText size={16} aria-hidden="true" /></span><div><strong>{eventLabels[log.event] || log.event || labelUi("Sự kiện hệ thống")}</strong><p>{log.tenantId ? tenants.find(tenant => tenant.id === log.tenantId)?.name || log.tenantId : labelUi("Toàn hệ thống")}</p></div><time dateTime={log.createdAt || undefined}>{displayDate(log.createdAt)}</time></li>)}</ul>}
    </section>}
  </div>;
}
