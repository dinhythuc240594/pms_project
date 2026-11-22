import DateInput from '../../../../shared/components/DateInput.jsx';
import { formatDate, formatDateTime } from '../../../../shared/lib/date.js';
import { getIntlLocale } from '../../../../shared/i18n/store.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Check, Search, Edit3, X, CheckCircle2, History, RefreshCw, Plus, Trash2, Calculator } from 'lucide-react';
import { usePms } from '../../../pms/data/usePms';
import { FEATURES } from '../../../pms/data/access';
import { money as formatCurrency } from '../../../pms/data/model';
import { getThemeTokens } from '../../theme';
import LegacyOverlay from '../../../pms/components/LegacyOverlay';
import { matchesSubscriptionState, subscriptionState, subscriptionStatusLabels } from '../subscriptionStatus';
import { dateFilterRange, positiveMoneyInput } from './saasBillingForm';
import { planFormInput, registeredRoomCount } from './planForm';
import { enabledPlanFeatures, planRoomLabel } from '../../../../shared/config/pricingPlans';
import { calculatePlanPrice, defaultPricingRules, defaultRegisteredRooms, normalizePricingRules } from '../../../../shared/lib/planPricing.js';
import PlanPricingModal, { planPricePreview, PlanPriceBreakdown } from './PlanPricingModal.jsx';
import './AdminBilling.css';
import OperationalAccess from './OperationalAccess.jsx';

const statusLabels = { active: 'Đang hiệu lực', expired: 'Hết hạn', cancelled: 'Đã hủy' };
const EMPTY_ITEMS = [];
const actionLabels = { created: 'Cấp gói', changed_plan: 'Đổi gói', renewed: 'Gia hạn', updated: 'Cập nhật thuê bao', changed_status: 'Đổi trạng thái' };
const displayDate = value => value ? formatDateTime(value) : 'Không thời hạn';
const localDateTime = value => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function AdminBilling() {
  const { authGeneration } = usePms();
  return <BillingWorkspace key={authGeneration} />;
}

function BillingWorkspace() {
  const { apiText } = useI18n();
  const { searchQuery: globalSearch, isDarkMode, theme } = useOutletContext() || {};
  const t = theme || getThemeTokens(isDarkMode);
  const { user, tenants, listPlans, savePlan, deletePlan, getTenantSubscription, saveTenantSubscription } = usePms();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('tenant');
  const openedSubscriptionId = useRef(null);
  const [data, setData] = useState({ tenants: null, revision: -1, plans: [], subscriptions: [], error: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [billingCycle, setBillingCycle] = useState('month'), [search, setSearch] = useState(''), [statusFilter, setStatusFilter] = useState('ALL');
  const [editingPlan, setEditingPlan] = useState(null), [editingTenant, setEditingTenant] = useState(null), [draft, setDraft] = useState(null);
  const [deletingPlan, setDeletingPlan] = useState(null);
  const [pricingEditor, setPricingEditor] = useState(null);
  const [operationalTenant, setOperationalTenant] = useState(null);
  const canManagePlans = user?.globalRole === 'SUPER_ADMIN';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const current = data.tenants === tenants && data.revision === revision && data.listPlans === listPlans && data.getTenantSubscription === getTenantSubscription;
  const loading = !current;
  const loadError = current ? data.error : '';
  const plans = current && !loadError ? data.plans : EMPTY_ITEMS;
  const subscriptions = current && !loadError ? data.subscriptions : EMPTY_ITEMS;
  const featureLabels = Object.fromEntries(Object.entries(data.featureLabels || {}).map(([code, label]) => [code, apiText(label)]));

  useEffect(() => {
    let cancelled = false;
    Promise.all([listPlans(), Promise.all(tenants.map(async tenant => ({ tenant, ...await getTenantSubscription(tenant.id) })))])
      .then(([result, rows]) => { if (!cancelled) { setError(''); setData({ tenants, revision, listPlans, getTenantSubscription, plans: result.plans || [], featureLabels: result.featureLabels || {}, subscriptions: rows, error: '' }); } })
      .catch(err => { if (!cancelled) { setError(''); setData({ tenants, revision, listPlans, getTenantSubscription, plans: [], subscriptions: [], error: err.message }); } });
    return () => { cancelled = true; };
  }, [listPlans, getTenantSubscription, tenants, revision]);

  const selectedRow = subscriptions.find(row => row.tenant.id === selectedId);
  const openSubscription = useCallback(row => {
    setError(''); setMessage(''); setEditingTenant(row.tenant);
    const plan = plans.find(item => item.id === row.subscription?.planId) || plans.find(item => item.code === 'FREE' && !item.deleted && item.active);
    setDraft({ planId: plan?.id || '', roomCount: row.subscription?.roomCount ?? defaultRegisteredRooms(plan), status: row.subscription?.status || 'active', startDate: localDateTime(row.subscription?.startDate), endDate: localDateTime(row.subscription?.endDate), originalStartDate: row.subscription?.startDate || null, originalEndDate: row.subscription?.endDate || null, currency: plan?.currency || 'VND', cycle: 'monthly' });
  }, [plans]);
  useEffect(() => {
    if (!selectedId) { openedSubscriptionId.current = null; return; }
    if (loading || loadError || busy || !selectedRow || openedSubscriptionId.current === selectedId) return;
    openedSubscriptionId.current = selectedId;
    if (editingTenant?.id !== selectedId) openSubscription(selectedRow);
  }, [selectedId, loading, loadError, busy, selectedRow, editingTenant, openSubscription]);
  const closeSubscription = () => { if (!busy) { setEditingTenant(null); setDraft(null); setSearchParams({}); } };

  const handleSavePlan = async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await savePlan(planFormInput(editingPlan));
      const [result, rows] = await Promise.all([listPlans(), Promise.all(tenants.map(async tenant => ({ tenant, ...await getTenantSubscription(tenant.id) })))]);
      setData({ tenants, revision, listPlans, getTenantSubscription, plans: result.plans || [], featureLabels: result.featureLabels || {}, subscriptions: rows, error: '' }); setEditingPlan(null); setMessage('Đã lưu gói cước. Trang bảng giá sẽ lấy tên, giá và tính năng mới.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const handleArchivePlan = async () => {
    if (busy || !deletingPlan) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await deletePlan(deletingPlan.id);
      setDeletingPlan(null); setRevision(value => value + 1);
      setMessage('Đã xóa gói khỏi danh sách bán và bảng giá. Thuê bao, hóa đơn và lịch sử hiện có được giữ lại.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const handleSavePricing = async rules => {
    if (pricingEditor.local) {
      setEditingPlan(plan => ({ ...plan, pricingRules: rules }));
    } else {
      await savePlan({ id: pricingEditor.plan.id, pricingRules: rules });
      const result = await listPlans();
      setData(value => ({ ...value, plans: result.plans || [], featureLabels: result.featureLabels || value.featureLabels }));
      setMessage('Đã lưu điều kiện tính giá. Tiền gia hạn được tính theo cấu hình mới.');
    }
    setPricingEditor(null);
  };
  const handleRestorePlan = async plan => {
    if (busy) return;
    if (!plan.code) { setError(''); setMessage(''); setEditingPlan({ ...plan, originalCode: null, code: '', restoring: true }); return; }
    setBusy(true); setError(''); setMessage('');
    try { await savePlan({ id: plan.id, deleted: false }); setRevision(value => value + 1); setMessage('Đã khôi phục gói.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const handleSaveSubscription = async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const input = { planId: draft.planId, roomCount: registeredRoomCount(draft.roomCount, plans.find(plan => plan.id === draft.planId)?.maxRooms), status: draft.status, endDate: draft.endDate === localDateTime(draft.originalEndDate) ? draft.originalEndDate : draft.endDate ? new Date(draft.endDate).toISOString() : null, currency: draft.currency, cycle: draft.cycle };
      if (plans.find(plan => plan.id === draft.planId)?.code === 'FREE') input.endDate = null;
      if (draft.startDate) input.startDate = draft.startDate === localDateTime(draft.originalStartDate) ? draft.originalStartDate : new Date(draft.startDate).toISOString();
      input.amount = calculatePlanPrice(plans.find(plan => plan.id === draft.planId), input.roomCount, draft.cycle).amount;
      if (input.endDate && Date.parse(input.endDate) <= Date.parse(input.startDate || draft.originalStartDate || new Date().toISOString())) throw new Error('Hạn gói phải sau ngày bắt đầu.');
      if (input.status === 'active' && plans.find(plan => plan.id === draft.planId)?.code !== 'FREE' && (!input.endDate || Date.parse(input.endDate) <= Date.now())) throw new Error('Gói đang hoạt động cần hạn trong tương lai.');
      await saveTenantSubscription(editingTenant.id, input);
      const result = await getTenantSubscription(editingTenant.id);
      setData(value => ({ ...value, subscriptions: value.subscriptions.map(row => row.tenant.id === editingTenant.id ? { ...row, ...result } : row) }));
      setDraft(value => ({ ...value, roomCount: result.subscription?.roomCount ?? value.roomCount, startDate: localDateTime(result.subscription?.startDate), endDate: localDateTime(result.subscription?.endDate), originalStartDate: result.subscription?.startDate || null, originalEndDate: result.subscription?.endDate || null }));
      setMessage('Đã lưu thuê bao và lịch sử trên máy chủ.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const effectiveSearch = (search || globalSearch || '').toLowerCase();
  const renewalPreview = draft ? planPricePreview(plans.find(plan => plan.id === draft.planId), draft.roomCount, draft.cycle) : null;
  const filteredSubscriptions = subscriptions.filter(row => (row.tenant.name + ' ' + (row.subscription?.planName || '')).toLowerCase().includes(effectiveSearch) && matchesSubscriptionState(row.subscription, statusFilter));
  const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${t.border}`, backgroundColor: t.bgInput, color: t.textPrimary, fontSize: '14px' };
  const buttonStyle = { padding: '9px 14px', borderRadius: '10px', border: `1px solid ${t.border}`, backgroundColor: t.bgInput, color: t.textPrimary, cursor: 'pointer', fontWeight: '600', minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 };
  const primaryButton = { ...buttonStyle, backgroundColor: t.primary, color: '#fff', border: 0 };
  const cell = { padding: '14px 16px', borderBottom: `1px solid ${t.borderSubtle}`, color: t.textPrimary };
  const modalStyle = { position: 'fixed', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: t.bgModalBackdrop, backdropFilter: 'blur(5px)', padding: '20px' };
  const modalCard = { backgroundColor: t.bgSurface, borderRadius: '16px', width: '100%', maxWidth: '720px', maxHeight: '90vh', overflowY: 'auto', padding: '24px', boxShadow: t.cardShadow, border: `1px solid ${t.border}` };
  const notice = <>{(error || loadError) && <p role="alert" style={{ color: t.danger }}>{error || loadError}</p>}{message && <p role="status" style={{ color: t.success }}>{message}</p>}</>;
  return <div className="manager-page manager-billing" style={{ fontFamily: t.fontFamily }}>
    <header className="manager-page-heading">
      <div>
        <span className="manager-eyebrow">{labelUi("Dịch vụ & thanh toán")}</span>
        <h1>{labelUi("Gói cước & thanh toán")}</h1>
        <p>{labelUi("Quản lý hóa đơn dịch vụ, thu tiền và thuê bao của từng khách sạn.")}</p>
      </div>
      <span className="manager-billing-page-badge">{loading || loadError ? tUi("header.plan") : `${plans.filter(plan => !plan.deleted).length} gói dịch vụ`}</span>
    </header>
    {!editingPlan && !editingTenant && !deletingPlan && !pricingEditor && notice}
    {!editingPlan && !editingTenant && !deletingPlan && !pricingEditor && (error || loadError) && <button onClick={() => setRevision(value => value + 1)} disabled={loading} style={buttonStyle}>{tUi("system.reloadData")}</button>}
    {loading && <p role="status">{labelUi("Đang tải gói cước và thuê bao…")}</p>}
    <SaasInvoices tenants={tenants} theme={t} />
      <div>
        <div className="manager-billing-section-heading">
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '650', color: t.textPrimary, margin: 0, letterSpacing: '-0.02em' }}>
              Gói cước dịch vụ
            </h2>
            <p style={{ fontSize: '13px', color: t.textSecondary, margin: '4px 0 0 0' }}>
              Tạo gói, chỉnh giá và tính năng; bảng giá công khai sử dụng cùng cấu hình. Mỗi khách sạn đăng ký số phòng riêng.
            </p>
          </div>

          <div className="manager-billing-section-actions">
            <div className="manager-billing-cycle" role="group" aria-label={labelUi("Chu kỳ hiển thị giá")}>
              <button type="button" aria-pressed={billingCycle === 'month'} onClick={() => setBillingCycle('month')}>{labelUi("Theo tháng")}</button>
              <button type="button" aria-pressed={billingCycle === 'year'} onClick={() => setBillingCycle('year')}>{labelUi("Theo năm")}</button>
            </div>
            {canManagePlans && <button type="button" className="manager-button manager-button-primary" disabled={busy || loading || Boolean(loadError)} onClick={() => { setError(''); setMessage(''); setEditingPlan({ code: '', name: '', price: '0', priceYear: '0', currency: 'VND', maxRooms: '', maxUsers: '', pricingRules: defaultPricingRules(), features: Object.fromEntries(FEATURES.map(feature => [feature.code, false])), active: true }); }}><Plus size={16} aria-hidden="true"/>{" "}{labelUi("Tạo gói mới")}</button>}
          </div>
        </div>

        {!loading && !loadError && !plans.length && <p role="status" style={{ color: t.textSecondary }}>{labelUi("Chưa có gói dịch vụ. Quản trị viên có thể tạo gói mới.")}</p>}
        <div className="manager-billing-plans">
          {plans.map((plan) => {
            const isPro = plan.code === 'PRO';
            const currentPrice = billingCycle === 'month' ? plan.price : plan.priceYear;
            const cycleSuffix = billingCycle === 'month' ? '/ tháng' : '/ năm';

            return (
              <div
                key={plan.id}
                className={`manager-panel manager-billing-plan${isPro ? ' manager-billing-plan-pro' : ''}`}
                style={{
                  backgroundColor: t.bgSurface,
                  border: `1px solid ${t.border}`,
                  boxShadow: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  position: 'relative',
                  transition: 'all 0.25s ease'
                }}
              >
                {/* Header Badge */}
                <div>
                  <div className="manager-billing-plan-heading">
                    <span 
                      style={{
                        padding: '4px 12px',
                        borderRadius: '10px',
                        fontSize: '11.5px',
                        fontWeight: '800',
                        backgroundColor: isPro ? t.aquaBg : t.bgInput,
                        color: isPro ? t.aquaText : t.textSecondary,
                        border: isPro ? `1px solid ${t.aquaBorder}` : `1px solid ${t.border}`
                      }}
                    >
                      {plan.code || tUi("common.unsetCode")}
                    </span>

                    <div style={{ fontSize: '12px', color: t.textSecondary, fontWeight: '700' }}>
                      {subscriptions.filter(row => row.subscription?.planId === plan.id).length} cơ sở được cấp gói
                    </div>
                  </div>

                  <h3 style={{ fontSize: '20px', fontWeight: '650', color: t.textPrimary, margin: '0 0 6px 0' }}>
                    {plan.name}
                  </h3>
                  <p style={{ fontSize: '13px', color: t.textSecondary, margin: '0 0 20px 0', lineHeight: '1.45' }}>
                    Quyền và giới hạn được áp dụng tại từng khách sạn.
                  </p>

                  {/* Price display */}
                  <div style={{ padding: '16px 0', borderTop: `1px solid ${t.borderSubtle}`, borderBottom: `1px solid ${t.borderSubtle}`, marginBottom: '20px' }}>
                    <div className="manager-billing-plan-price">
                      <span className="manager-billing-price" style={{ fontSize: '28px', fontWeight: '800', color: isPro ? t.primary : t.textPrimary, letterSpacing: '-0.03em' }}>
                        {formatCurrency(currentPrice, plan.currency)}
                      </span>
                      <span style={{ fontSize: '13px', color: t.textSecondary, fontWeight: '600' }}>
                        {Number(currentPrice) > 0 ? cycleSuffix : labelUi("(Miễn phí)")}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: t.textMuted, marginTop: '4px' }}>
                      {planRoomLabel(plan)} • {plan.maxUsers === null ? labelUi("Không giới hạn tài khoản") : `Tối đa ${plan.maxUsers} tài khoản`}
                    </div>
                    <div style={{ fontSize: 12, color: t.textSecondary, marginTop: 8 }}>{labelUi('Giá cơ bản cho')} {normalizePricingRules(plan.pricingRules).baseRooms} {labelUi('phòng')}</div>
                  </div>

                  {/* Features List */}
                  <div className="manager-billing-features">
                    <div style={{ fontSize: '12px', fontWeight: '800', color: t.textPrimary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>
                      Tính năng bao gồm:
                    </div>

                    {enabledPlanFeatures(plan, featureLabels).map(({ code, name }) => (
                      <div key={code} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <div 
                          style={{
                            width: '18px',
                            height: '18px',
                            borderRadius: '50%',
                            backgroundColor: isPro ? '#EFF6FF' : '#F1F5F9',
                            color: isPro ? t.primary : '#64748B',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            marginTop: '2px'
                          }}
                        >
                          <Check size={12} strokeWidth={3} />
                        </div>
                        <span style={{ fontSize: '13px', color: t.textPrimary, fontWeight: '500', lineHeight: '1.4' }}>
                          {name}
                        </span>
                      </div>
                    ))}


                  </div>
                </div>

                {/* Footer Action Button */}
                <div className="manager-plan-actions" style={{ paddingTop: '16px', borderTop: `1px solid ${t.borderSubtle}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', color: isPro ? t.primary : t.textMuted, fontWeight: '700' }}>
                    {plan.deleted ? labelUi("Đã xóa khỏi danh sách bán") : plan.active ? labelUi("Đang cung cấp") : labelUi("Ngừng cung cấp")}
                  </span>

                  <button
                    className={`manager-button${isPro ? ' manager-button-primary' : ''}`}
                    disabled={busy || !canManagePlans || plan.deleted} onClick={() => { setError(''); setEditingPlan({ ...plan, originalCode: plan.code, code: plan.code || '' }); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 16px',
                      borderRadius: '12px',
                      border: isPro ? 'none' : `1px solid ${t.border}`,
                      backgroundColor: isPro ? t.primary : t.bgInput,
                      color: isPro ? '#FFFFFF' : t.textPrimary,
                      fontSize: '12px',
                      fontWeight: '800',
                      cursor: 'pointer',
                      boxShadow: 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <Edit3 size={13} />
                    <span>{labelUi("Sửa gói cước")}</span>
                  </button>
                  {canManagePlans && <button type="button" className="manager-button" disabled={busy || plan.deleted} onClick={() => { setError(''); setMessage(''); setPricingEditor({ plan, local: false }); }}><Calculator size={14} aria-hidden="true"/> {labelUi('Điều kiện tính giá')}</button>}
                  {canManagePlans && (plan.deleted ? <button type="button" className="manager-button" disabled={busy} onClick={() => handleRestorePlan(plan)}><RefreshCw size={14} aria-hidden="true"/>{" "}{labelUi("Khôi phục")}</button> : <button type="button" className="manager-button" disabled={busy} onClick={() => { setError(''); setMessage(''); setDeletingPlan(plan); }}><Trash2 size={14} aria-hidden="true"/>{" "}{labelUi("Xóa gói")}</button>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>


    <dl className="manager-panel manager-billing-stats">
      {[['Khách sạn có thuê bao', subscriptions.filter(row => row.subscription).length], ['Đang hiệu lực', subscriptions.filter(row => matchesSubscriptionState(row.subscription, 'active')).length], ['Chưa hiệu lực / hết hạn / hủy', subscriptions.filter(row => row.subscription && !matchesSubscriptionState(row.subscription, 'active')).length]].map(([label, value]) => <div key={label}><dt>{labelUi(label)}</dt><dd>{loading || loadError ? '—' : value}</dd></div>)}
    </dl>
    <section className="manager-panel manager-billing-subscriptions" style={{ backgroundColor: t.bgSurface, borderRadius: '16px', border: `1px solid ${t.border}`, boxShadow: 'none', overflow: 'hidden' }}>
      <div className="manager-billing-table-heading" style={{ padding: '18px 20px', borderBottom: `1px solid ${t.borderSubtle}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '800', color: t.textPrimary, margin: 0 }}>Thuê bao & gia hạn ({filteredSubscriptions.length})</h2>
        <div className="manager-billing-filters">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: t.textSecondary }}><Search size={16}/><input aria-label={labelUi("Tìm khách sạn hoặc gói cước")} placeholder={labelUi("Tìm khách sạn, gói cước…")} value={search} onChange={event => setSearch(event.target.value)} style={inputStyle}/></label>
          <select aria-label={labelUi("Trạng thái thuê bao")} value={statusFilter} onChange={event => setStatusFilter(event.target.value)} style={inputStyle}><option value="ALL">{tUi("common.allStatuses")}</option>{Object.entries(subscriptionStatusLabels).map(([value, label]) => <option key={value} value={value}>{labelUi(label)}</option>)}</select>
        </div>
      </div>
      <p style={{ padding: '0 24px', color: t.textSecondary, fontSize: 12 }}>{labelUi("Số tiền trong lịch sử thuê bao là ghi chú khi cấp/gia hạn gói. Các khoản thu thực tế được ghi nhận tại Hóa đơn dịch vụ SaaS.")}</p>
      <div className="manager-table-wrap" role="region" aria-label={labelUi("Danh sách thuê bao khách sạn")} tabIndex={0} style={{ overflowX: 'auto' }}><table className="manager-table" style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}><thead><tr style={{ backgroundColor: t.bgInput }}>{['Khách sạn', 'Gói cước', 'Phòng đăng ký', 'Trạng thái', 'Hạn sử dụng', 'Thao tác'].map(label => <th key={label} scope="col" style={cell}>{labelUi(label)}</th>)}</tr></thead><tbody>
        {filteredSubscriptions.map(row => {
          const state = subscriptionState(row.subscription);
          return <tr key={row.tenant.id}><td style={cell}>{row.tenant.name}</td><td style={cell}>{row.subscription?.planName || labelUi("Chưa cấp gói")}</td><td style={cell}>{row.subscription?.roomCount ?? '—'}</td><td style={cell}><span className={`manager-subscription-status ${state}`}>{subscriptionStatusLabels[state] || labelUi("Trạng thái chưa xác định")}</span>{row.subscription?.operationalAccess?.active && <p>{labelUi('Vận hành tạm đến')} {displayDate(row.subscription.operationalAccess.until)}</p>}</td><td style={cell}>{row.subscription ? displayDate(row.subscription.endDate) : '—'}</td><td style={cell}><div className="manager-invoice-actions"><button disabled={busy || loading} onClick={() => openSubscription(row)} style={buttonStyle}><RefreshCw size={13}/>{" "}{labelUi("Đổi gói / Gia hạn")}</button>{row.subscription && <button type="button" className="manager-button" disabled={busy || loading} onClick={() => setOperationalTenant(row.tenant)}>{labelUi('Vận hành tạm')}</button>}</div></td></tr>;
        })}
        {loading && <tr><td colSpan={6} style={cell}>{labelUi("Đang tải thuê bao…")}</td></tr>}
        {loadError && <tr><td colSpan={6} style={cell}>{labelUi("Không tải được thuê bao. Hãy tải lại dữ liệu.")}</td></tr>}
        {!loading && !loadError && !filteredSubscriptions.length && <tr><td colSpan={6} style={cell}>{labelUi("Không có khách sạn phù hợp.")}</td></tr>}
      </tbody></table></div>
    </section>
    {operationalTenant && <OperationalAccess key={operationalTenant.id} tenant={operationalTenant} onClose={() => setOperationalTenant(null)} onSaved={() => setRevision(value => value + 1)} />}
    {deletingPlan && <LegacyOverlay title={labelUi("Xóa gói khỏi danh sách bán")} onClose={() => { if (!busy) setDeletingPlan(null); }} style={modalStyle}><div className="manager-billing-dialog" style={modalCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ color: t.textPrimary, fontSize: 18 }}>{labelUi("Xóa gói")}{" "}{deletingPlan.name}?</h2><button type="button" aria-label={labelUi("Đóng xác nhận xóa gói")} disabled={busy} onClick={() => setDeletingPlan(null)} style={buttonStyle}><X size={18}/></button></div>
      {notice}<p style={{ color: t.textSecondary, fontSize: 14, lineHeight: 1.6 }}>{labelUi("Gói sẽ biến mất khỏi bảng giá và không được cấp cho khách sạn mới. Thuê bao đang sử dụng, hóa đơn và lịch sử được giữ lại. Bạn có thể khôi phục gói sau.")}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}><button type="button" disabled={busy} onClick={() => setDeletingPlan(null)} style={buttonStyle}>{tUi("common.cancel")}</button><button type="button" disabled={busy} onClick={handleArchivePlan} style={{ ...primaryButton, backgroundColor: t.danger }}>{busy ? labelUi("Đang xóa…") : labelUi("Xóa khỏi danh sách bán")}</button></div>
    </div></LegacyOverlay>}
    {editingPlan && <LegacyOverlay title={editingPlan.restoring ? labelUi("Khôi phục gói") : editingPlan.id ? labelUi("Sửa gói cước") : labelUi("Tạo gói mới")} onClose={() => { if (!busy) setEditingPlan(null); }} style={modalStyle}><div className="manager-billing-dialog" style={modalCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 id="plan-edit-title" style={{ color: t.textPrimary, fontSize: 18 }}>{editingPlan.restoring ? `Khôi phục gói: ${editingPlan.name}` : editingPlan.id ? `Cập nhật gói: ${editingPlan.name}` : labelUi("Tạo gói mới")}</h2><button type="button" aria-label={labelUi("Đóng sửa gói")} disabled={busy} onClick={() => setEditingPlan(null)} style={buttonStyle}><X size={18}/></button></div>{notice}
      <form onSubmit={handleSavePlan} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ color: t.textPrimary, fontSize: 13 }}>{labelUi("Mã gói")}<input aria-label={labelUi("Mã gói")} required readOnly={Boolean(editingPlan.id && editingPlan.originalCode)} disabled={busy} maxLength={12} pattern="[A-Z][A-Z0-9_]{0,11}" value={editingPlan.code || ''} onChange={event => setEditingPlan(plan => ({ ...plan, code: event.target.value.toUpperCase() }))} style={inputStyle}/><small style={{ color: t.textSecondary }}>{editingPlan.id && editingPlan.originalCode ? labelUi("Mã định danh được giữ nguyên sau khi tạo.") : labelUi("Ví dụ: BUSINESS. Tối đa 12 ký tự chữ in hoa, số và dấu gạch dưới; sau khi lưu mã được giữ nguyên.")}</small></label>
        <label style={{ color: t.textPrimary, fontSize: 13 }}>{labelUi("Tên gói")}<input aria-label={labelUi("Tên gói")} required disabled={busy} maxLength={100} value={editingPlan.name} onChange={event => setEditingPlan(plan => ({ ...plan, name: event.target.value }))} style={inputStyle}/></label>
        {[['price', 'Giá tháng', 'text'], ['priceYear', 'Giá năm', 'text'], ['currency', 'Tiền tệ', 'text'], ['maxRooms', 'Trần số phòng của gói (trống = theo số phòng đăng ký)', 'number'], ['maxUsers', 'Giới hạn tài khoản (trống = không giới hạn)', 'number']].map(([key, label, type]) => <label key={key} style={{ color: t.textPrimary, fontSize: 13 }}>{labelUi(label)}<input aria-label={labelUi(label)} disabled={busy} type={type} min={1} max={1000000} step={1} inputMode={key.startsWith('price') ? 'decimal' : undefined} pattern={key.startsWith('price') ? '[0-9]{1,15}([.][0-9]{1,4})?' : key === 'currency' ? '[A-Za-z]{3}' : undefined} maxLength={key === 'currency' ? 3 : key.startsWith('price') ? 20 : undefined} required={key === 'price' || key === 'priceYear' || key === 'currency'} value={editingPlan[key] ?? ''} onChange={event => setEditingPlan(plan => ({ ...plan, [key]: event.target.value }))} style={inputStyle}/></label>)}
        <p style={{ color: t.textSecondary, fontSize: 12, margin: 0 }}>{labelUi("Giá dùng dấu chấm cho phần thập phân. Số phòng thực tế được nhập riêng khi cấp thuê bao; trần của gói là mức đăng ký tối đa.")}</p>
        <div className="manager-plan-pricing-summary"><span>{labelUi('Số phòng cơ bản')}: <strong>{normalizePricingRules(editingPlan.pricingRules).baseRooms}</strong></span><button type="button" className="manager-button" disabled={busy} onClick={() => setPricingEditor({ plan: editingPlan, local: true })}><Calculator size={16} aria-hidden="true"/> {labelUi('Điều kiện tính giá')}</button></div>
        <label style={{ color: t.textPrimary }}><input type="checkbox" disabled={busy} checked={editingPlan.active} onChange={event => setEditingPlan(plan => ({ ...plan, active: event.target.checked }))}/>{" "}{labelUi("Gói đang hoạt động")}</label>
        <p style={{ color: t.textSecondary, fontSize: 12, margin: 0 }}>{labelUi("Tắt mục này chặn ghi dữ liệu của khách sạn đang dùng gói. Để chỉ ngừng bán và giữ thuê bao cũ, dùng Xóa gói.")}</p>
        <fieldset className="manager-plan-feature-fields" disabled={busy} style={{ border: `1px solid ${t.border}`, borderRadius: 12, color: t.textPrimary }}><legend>{labelUi("Tính năng của gói")}</legend><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>{FEATURES.map(feature => <label key={feature.code}><input type="checkbox" checked={editingPlan.features?.[feature.code] === true} onChange={event => setEditingPlan(plan => ({ ...plan, features: { ...plan.features, [feature.code]: event.target.checked } }))}/> {featureLabels[feature.code] || feature.name}</label>)}</div></fieldset>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}><button type="button" disabled={busy} onClick={() => setEditingPlan(null)} style={buttonStyle}>{tUi("common.cancel")}</button><button type="submit" disabled={busy} style={primaryButton}>{busy ? tUi("common.saving") : editingPlan.restoring ? labelUi("Khôi phục gói") : editingPlan.id ? tUi("common.saveChanges") : labelUi("Tạo gói")}</button></div>
      </form>
    </div></LegacyOverlay>}
    {editingTenant && draft && <LegacyOverlay title={labelUi("Quản lý thuê bao")} onClose={closeSubscription} style={modalStyle}><div className="manager-billing-dialog" style={modalCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 id="subscription-edit-title" style={{ color: t.textPrimary, fontSize: 18 }}>Thuê bao: {editingTenant.name}</h2><button type="button" aria-label={labelUi("Đóng thuê bao")} disabled={busy} onClick={closeSubscription} style={buttonStyle}><X size={18}/></button></div>{notice}
      <form onSubmit={handleSaveSubscription} style={{ display: 'grid', gap: 16 }}>
        <label style={{ color: t.textPrimary }}>{labelUi("Gói cước")}<select aria-label={labelUi("Gói cước thuê bao")} required value={draft.planId} onChange={event => setDraft(value => ({ ...value, planId: event.target.value, currency: plans.find(plan => plan.id === event.target.value)?.currency || value.currency, endDate: plans.find(plan => plan.id === event.target.value)?.code === 'FREE' ? '' : value.endDate }))} style={inputStyle}><option value="">{labelUi("Chọn gói")}</option>{plans.filter(plan => !plan.deleted || plan.id === subscriptions.find(row => row.tenant.id === editingTenant.id)?.subscription?.planId).map(plan => <option key={plan.id} value={plan.id}>{plan.name}{plan.deleted ? " " + labelUi("(đã xóa, chỉ gia hạn thuê bao hiện có)") : !plan.active ? " " + labelUi("(ngừng cung cấp)") : ''}</option>)}</select></label>
        <label style={{ color: t.textPrimary }}>{labelUi("Số phòng đăng ký")}<input aria-label={labelUi("Số phòng đăng ký")} required type="number" min="1" step="1" max={plans.find(plan => plan.id === draft.planId)?.maxRooms ?? 1000000} value={draft.roomCount} onChange={event => setDraft(value => ({ ...value, roomCount: event.target.value }))} style={inputStyle}/><small style={{ color: t.textSecondary }}>{labelUi('Số phòng đăng ký mới mặc định theo số phòng cơ bản của gói (15 phòng).')} {plans.find(plan => plan.id === draft.planId)?.maxRooms != null ? `Gói cho phép tối đa ${plans.find(plan => plan.id === draft.planId).maxRooms} phòng.` : ''}</small></label>
        <label style={{ color: t.textPrimary }}>{tUi("common.status")}<select aria-label={labelUi("Trạng thái thuê bao cần lưu")} value={draft.status} onChange={event => setDraft(value => ({ ...value, status: event.target.value }))} style={inputStyle}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{labelUi(label)}</option>)}</select></label>
        <p style={{ color: t.textSecondary, fontSize: 12, margin: 0 }}>Ngày giờ theo múi giờ thiết bị: {timezone}. Gói khác FREE đang hiệu lực cần có hạn sử dụng trong tương lai.</p>
        {[['startDate', 'Bắt đầu kỳ'], ['endDate', 'Hạn sử dụng mới']].map(([key, label]) => <label key={key} style={{ color: t.textPrimary }}>{labelUi(label)}<DateInput aria-label={labelUi(label)} type="datetime-local" min={key === 'endDate' ? draft.startDate || undefined : undefined} value={draft[key]} required={key === 'endDate' && draft.status === 'active' && plans.find(plan => plan.id === draft.planId)?.code !== 'FREE'} onChange={next => setDraft(value => ({ ...value, [key]: next }))} style={inputStyle}/></label>)}
        <label style={{ color: t.textPrimary }}>{labelUi("Chu kỳ")}<select aria-label={labelUi("Chu kỳ thuê bao")} value={draft.cycle} onChange={event => setDraft(value => ({ ...value, cycle: event.target.value }))} style={inputStyle}><option value="monthly">{labelUi("Theo tháng")}</option><option value="yearly">{labelUi("Theo năm")}</option></select></label>
        <label style={{ color: t.textPrimary }}>{labelUi('Số tiền gia hạn tự động')}<input aria-label={labelUi("Số tiền gia hạn")} type="text" readOnly value={renewalPreview?.quote?.amount ?? ''} style={inputStyle}/><small style={{ color: t.textSecondary }}>{labelUi('Tự tính theo gói cước, số phòng và chu kỳ đã chọn. Khoản thu thực tế được ghi nhận tại hóa đơn dịch vụ SaaS.')}</small></label>
        {renewalPreview?.error ? <p role="status" style={{ color: t.danger }}>{labelUi(renewalPreview.error)}</p> : <PlanPriceBreakdown quote={renewalPreview?.quote} currency={draft.currency}/>}
        <label style={{ color: t.textPrimary }}>{tUi("common.currency")}<input aria-label={labelUi("Tiền tệ gia hạn")} readOnly value={draft.currency} style={inputStyle}/></label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}><button type="button" disabled={busy} onClick={closeSubscription} style={buttonStyle}>{tUi("common.close")}</button><button type="submit" disabled={busy || !draft.planId || !renewalPreview?.quote} style={primaryButton}><CheckCircle2 size={14}/> {busy ? tUi("common.saving") : labelUi("Lưu thuê bao / Gia hạn")}</button></div>
      </form>
      <h3 style={{ color: t.textPrimary, marginTop: 24, fontSize: 15 }}><History size={16}/>{" "}{labelUi("Lịch sử thay đổi")}</h3><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}><thead><tr>{['Thời điểm', 'Thao tác / Gói', 'Phòng đăng ký', 'Hạn mới', 'Số tiền', 'Người thao tác'].map(label => <th key={label} scope="col" style={cell}>{labelUi(label)}</th>)}</tr></thead><tbody>{(subscriptions.find(row => row.tenant.id === editingTenant.id)?.history || []).map(row => <tr key={row.id}><td style={cell}>{displayDate(row.createdAt || row.effectiveDate)}</td><td style={cell}>{actionLabels[row.action] || labelUi("Cập nhật thuê bao")}<br/>{row.planName}<br/>{statusLabels[row.status] || ''}</td><td style={cell}>{row.roomCount ?? '—'}</td><td style={cell}>{displayDate(row.endDate)}</td><td style={cell}>{row.amount === null ? '—' : formatCurrency(row.amount, row.currency)}</td><td style={cell}>{row.actorName || row.actorId || '—'}</td></tr>)}</tbody></table>{!(subscriptions.find(row => row.tenant.id === editingTenant.id)?.history || []).length && <p style={{ color: t.textSecondary }}>{labelUi("Chưa có lịch sử thay đổi.")}</p>}</div>
    </div></LegacyOverlay>}
    {pricingEditor && <PlanPricingModal plan={pricingEditor.plan} local={pricingEditor.local} theme={t} onClose={() => setPricingEditor(null)} onSave={handleSavePricing}/>}
  </div>;
}

const invoiceStatusLabels = { unpaid: 'Chưa thanh toán', partial: 'Thanh toán một phần', paid: 'Đã thanh toán', void: 'Đã hủy' };
const invoiceDay = value => value ? formatDate(value) : '—';
const displayPaymentDate = value => value ? formatDateTime(value, 'UTC') + ' UTC' : '—';

function SaasInvoices({ tenants, theme: t }) {
  useI18n();
  const { listSaasInvoices, createSaasInvoice, recordSaasPayment, refundSaasPayment, voidSaasInvoice } = usePms();
  const [filterDraft, setFilterDraft] = useState({ tenantId: '', status: '', start: '', through: '' });
  const [filters, setFilters] = useState({ page: 1, pageSize: 20 });
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({ filters: null, revision: -1, result: null, error: '' });
  const [dialog, setDialog] = useState(null), [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const intent = useRef(null), submitting = useRef(false);
  useEffect(() => {
    let cancelled = false;
    listSaasInvoices(filters)
      .then(result => { if (!cancelled) setData({ filters, revision, result, error: '' }); })
      .catch(err => { if (!cancelled) setData({ filters, revision, result: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [listSaasInvoices, filters, revision]);
  const current = data.filters === filters && data.revision === revision;
  const loading = !current;
  const result = current ? data.result : null;
  const invoices = result?.invoices || [];
  const pagination = result?.pagination || { page: filters.page, pageSize: filters.pageSize, totalItems: 0 };
  const pages = Math.max(1, Math.ceil(pagination.totalItems / pagination.pageSize));
  const close = () => { if (!submitting.current) { setDialog(null); setError(''); } };
  const open = (mode, invoice, payment) => {
    setError(''); setMessage(''); intent.current = crypto.randomUUID();
    setDialog({ mode, invoice, payment });
    setDraft(mode === 'create' ? { tenantId: filterDraft.tenantId, description: '', amount: '', currency: 'VND', dueDate: '' } : mode === 'payment' ? { amount: invoice.balance, method: 'bank', reference: '', note: '' } : mode === 'refund' ? { amount: payment.refundable ?? payment.amount, reason: '' } : { reason: '' });
  };
  const changeDraft = (key, value) => { setDraft(previous => ({ ...previous, [key]: value })); intent.current = crypto.randomUUID(); };
  const applyFilters = event => {
    event.preventDefault(); setError('');
    try { setFilters({ tenantId: filterDraft.tenantId, status: filterDraft.status, ...dateFilterRange(filterDraft.start, filterDraft.through), page: 1, pageSize: 20 }); }
    catch (err) { setError(err.message); }
  };
  const save = async event => {
    event.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    try {
      let response;
      if (dialog.mode === 'create') {
        response = await createSaasInvoice({ tenantId: draft.tenantId, description: draft.description.trim(), amount: positiveMoneyInput(draft.amount), currency: draft.currency, ...(draft.dueDate ? { dueDate: draft.dueDate } : {}) }, intent.current);
        setMessage('Đã tạo hóa đơn dịch vụ.');
      } else if (dialog.mode === 'payment') {
        response = await recordSaasPayment(dialog.invoice.id, { amount: positiveMoneyInput(draft.amount), method: draft.method, reference: draft.reference.trim(), note: draft.note.trim() }, intent.current);
        setMessage('Đã ghi nhận khoản thanh toán.');
      } else if (dialog.mode === 'refund') {
        response = await refundSaasPayment(dialog.invoice.id, dialog.payment.id, { amount: positiveMoneyInput(draft.amount), reason: draft.reason.trim() }, intent.current);
        setMessage('Đã ghi nhận hoàn/đảo khoản thu.');
      } else {
        response = await voidSaasInvoice(dialog.invoice.id, draft.reason.trim());
        setMessage('Đã hủy hóa đơn chưa thanh toán.');
      }
      const saved = response?.invoice || (response?.id ? response : null);
      setDialog(saved ? { mode: 'detail', invoice: saved } : null);
      setRevision(value => value + 1);
    } catch (err) { setError(err.message); }
    finally { submitting.current = false; setBusy(false); }
  };
  const invoice = dialog?.invoice;
  const status = row => <span className={`manager-invoice-status manager-invoice-status-${row.status}`}>{invoiceStatusLabels[row.status] || row.status}</span>;
  const notice = <>{error && <p className="manager-invoice-error" role="alert">{error}</p>}{message && <p className="manager-invoice-success" role="status">{message}</p>}</>;
  const filterChange = (key, value) => setFilterDraft(previous => ({ ...previous, [key]: value }));
  return <section className="manager-panel manager-invoices" aria-labelledby="manager-invoices-title" aria-busy={loading}>
    <div className="manager-billing-table-heading manager-invoice-heading">
      <div><h2 id="manager-invoices-title">{labelUi("Hóa đơn dịch vụ SaaS")}</h2><p>{labelUi("Hóa đơn và khoản thu cho dịch vụ phần mềm của từng khách sạn.")}</p></div>
      <button type="button" className="manager-button manager-button-primary" disabled={busy || !tenants.length} onClick={() => open('create')}>{labelUi("Tạo hóa đơn")}</button>
    </div>
    <form className="manager-invoice-filters" onSubmit={applyFilters}>
      <label>{labelUi("Khách sạn")}<select value={filterDraft.tenantId} onChange={event => filterChange('tenantId', event.target.value)}><option value="">{labelUi("Tất cả khách sạn")}</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
      <label>{tUi("common.status")}<select value={filterDraft.status} onChange={event => filterChange('status', event.target.value)}><option value="">{tUi("common.allStatuses")}</option>{Object.entries(invoiceStatusLabels).map(([value, label]) => <option key={value} value={value}>{labelUi(label)}</option>)}</select></label>
      <label>{labelUi("Tạo từ ngày (UTC)")}<DateInput value={filterDraft.start} onChange={value => filterChange('start', value)} /></label>
      <label>{labelUi("Đến hết ngày (UTC)")}<DateInput min={filterDraft.start || undefined} value={filterDraft.through} onChange={value => filterChange('through', value)} /></label>
      <div className="manager-invoice-filter-actions"><button type="submit" className="manager-button" disabled={busy}>{labelUi("Lọc hóa đơn")}</button><button type="button" className="manager-button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)} aria-label={labelUi("Tải lại hóa đơn")}><RefreshCw size={16} aria-hidden="true" /></button></div>
    </form>
    {!dialog && notice}
    {loading ? <p className="manager-invoice-state" role="status">{labelUi("Đang tải hóa đơn…")}</p> : data.error ? <div className="manager-invoice-state"><p role="alert">Không tải được hóa đơn: {data.error}</p><button type="button" className="manager-button" onClick={() => setRevision(value => value + 1)}>{tUi("common.retry")}</button></div> : <>
      <div className="manager-table-wrap" role="region" aria-label={labelUi("Danh sách hóa đơn dịch vụ")} tabIndex={0}>
        <table className="manager-table manager-invoice-table"><thead><tr>{['Hóa đơn / Khách sạn', 'Nội dung', 'Tổng tiền', 'Đã thu', 'Còn lại', 'Hạn thanh toán', 'Trạng thái', 'Thao tác'].map(label => <th key={label} scope="col">{labelUi(label)}</th>)}</tr></thead><tbody>
          {invoices.map(row => <tr key={row.id}><td><strong>{row.number}</strong><span className="manager-invoice-secondary">{row.tenantName || row.tenantId}</span></td><td className="manager-invoice-description">{row.description}</td><td>{formatCurrency(row.amount, row.currency)}</td><td>{formatCurrency(row.paid, row.currency)}</td><td>{formatCurrency(row.balance, row.currency)}</td><td>{invoiceDay(row.dueDate)}</td><td>{status(row)}</td><td><button type="button" className="manager-button" onClick={() => open('detail', row)}>{labelUi("Chi tiết / Thu tiền")}</button></td></tr>)}
          {!invoices.length && <tr><td colSpan={8}>{labelUi("Chưa có hóa đơn phù hợp với bộ lọc.")}</td></tr>}
        </tbody></table>
      </div>
      <div className="manager-invoice-pagination"><span>{pagination.totalItems.toLocaleString(getIntlLocale())} hóa đơn · Trang {pagination.page}/{pages}</span><div><button type="button" className="manager-button" disabled={filters.page <= 1} onClick={() => setFilters(previous => ({ ...previous, page: previous.page - 1 }))}>{labelUi("Trước")}</button><button type="button" className="manager-button" disabled={filters.page >= pages} onClick={() => setFilters(previous => ({ ...previous, page: previous.page + 1 }))}>Sau</button></div></div>
    </>}
    {dialog && <LegacyOverlay title={dialog.mode === 'create' ? labelUi("Tạo hóa đơn dịch vụ") : `Hóa đơn ${invoice.number}`} onClose={close} style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: t.bgModalBackdrop, padding: 20 }}>
      <div className="manager-billing-dialog manager-invoice-dialog">
        <div className="manager-invoice-dialog-heading"><h2>{dialog.mode === 'create' ? labelUi("Tạo hóa đơn dịch vụ") : `Hóa đơn ${invoice.number}`}</h2><button type="button" className="manager-button" aria-label={labelUi("Đóng hóa đơn")} disabled={busy} onClick={close}><X size={18} aria-hidden="true" /></button></div>
        {notice}
        {invoice && <><p>{invoice.tenantName || invoice.tenantId}</p><p className="manager-invoice-description">{invoice.description}</p><dl className="manager-invoice-summary"><div><dt>{labelUi("Tổng tiền")}</dt><dd>{formatCurrency(invoice.amount, invoice.currency)}</dd></div><div><dt>{labelUi("Đã thu")}</dt><dd>{formatCurrency(invoice.paid, invoice.currency)}</dd></div><div><dt>{labelUi("Còn lại")}</dt><dd>{formatCurrency(invoice.balance, invoice.currency)}</dd></div><div><dt>{labelUi("Hạn thanh toán")}</dt><dd>{invoiceDay(invoice.dueDate)}</dd></div></dl>{status(invoice)}</>}
        {dialog.mode === 'detail' && <>
          <div className="manager-invoice-actions">{['unpaid', 'partial'].includes(invoice.status) && <button type="button" className="manager-button manager-button-primary" onClick={() => open('payment', invoice)}>{labelUi("Ghi nhận thanh toán")}</button>}{invoice.status === 'unpaid' && <button type="button" className="manager-button" onClick={() => open('void', invoice)}>{labelUi("Hủy hóa đơn")}</button>}</div>
          <h3>{labelUi("Lịch sử thanh toán")}</h3>
          {(invoice.payments || []).length ? <ul className="manager-invoice-payments">{invoice.payments.map(payment => <li key={payment.id}><div><strong>{formatCurrency(payment.amount, invoice.currency)}</strong><time dateTime={payment.createdAt}>{displayPaymentDate(payment.createdAt)}</time></div><p>{payment.method === 'bank' ? labelUi("Chuyển khoản") : labelUi("Tiền mặt")}{payment.reference ? ` · ${payment.reference}` : ''}</p>{payment.note && <p>{payment.note}</p>}{payment.refunded && Number(payment.refunded) > 0 && <p>{labelUi('Đã hoàn/đảo')}: {formatCurrency(payment.refunded, invoice.currency)}</p>}{invoice.status !== 'void' && Number(payment.refundable ?? payment.amount) > 0 && <button type="button" className="manager-button" onClick={() => open('refund', invoice, payment)}>{labelUi('Hoàn/đảo khoản thu')}</button>}</li>)}</ul> : <p className="manager-invoice-secondary">{labelUi("Chưa có khoản thanh toán.")}</p>}
          {invoice.refunds?.length > 0 && <><h3>{labelUi('Lịch sử hoàn/đảo thu')}</h3><ul className="manager-invoice-payments">{invoice.refunds.map(refund => <li key={refund.id}><div><strong>−{formatCurrency(refund.amount, invoice.currency)}</strong><time dateTime={refund.createdAt}>{displayPaymentDate(refund.createdAt)}</time></div><p>{refund.reason}</p><small>{labelUi('Khoản thu gốc')}: {refund.paymentId}</small></li>)}</ul></>}
          {invoice.status === 'void' && invoice.voidReason && <p>Lý do hủy: {invoice.voidReason}</p>}
        </>}
        {dialog.mode !== 'detail' && <form className="manager-invoice-form" onSubmit={save}>
          <fieldset disabled={busy}>
            {dialog.mode === 'create' && <><label>{labelUi("Khách sạn")}<select required value={draft.tenantId} onChange={event => changeDraft('tenantId', event.target.value)}><option value="">{labelUi("Chọn khách sạn")}</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label><label>{labelUi("Nội dung dịch vụ")}<textarea required maxLength={500} rows={3} value={draft.description} onChange={event => changeDraft('description', event.target.value)} /></label></>}
            {dialog.mode !== 'void' && <label>Số tiền ({dialog.mode === 'create' ? draft.currency : invoice.currency})<input required inputMode="decimal" type="text" maxLength={20} pattern="[0-9]{1,15}([.][0-9]{1,4})?" value={draft.amount} onChange={event => changeDraft('amount', event.target.value)} /><small>{labelUi("Dùng dấu chấm cho phần thập phân, tối đa 4 chữ số.")}</small></label>}
            {dialog.mode === 'create' && <div className="manager-invoice-form-row"><label>{tUi("common.currency")}<select value={draft.currency} onChange={event => changeDraft('currency', event.target.value)}><option value="VND">VND</option><option value="USD">USD</option></select></label><label>{labelUi("Hạn thanh toán")}<DateInput value={draft.dueDate} onChange={value => changeDraft('dueDate', value)} /></label></div>}
            {dialog.mode === 'payment' && <><label>{labelUi("Hình thức thu")}<select value={draft.method} onChange={event => changeDraft('method', event.target.value)}><option value="bank">{labelUi("Chuyển khoản")}</option><option value="cash">{labelUi("Tiền mặt")}</option></select></label><label>{labelUi("Mã tham chiếu")}<input maxLength={160} value={draft.reference} onChange={event => changeDraft('reference', event.target.value)} /></label><label>{tUi("common.notes")}<textarea maxLength={1000} rows={2} value={draft.note} onChange={event => changeDraft('note', event.target.value)} /></label><p>{labelUi("Máy chủ kiểm tra số tiền còn lại trước khi ghi nhận. Khi có lỗi kết nối, bấm ghi nhận lại để thử cùng khoản thu.")}</p></>}
            {dialog.mode === 'refund' && <><p>{labelUi('Ghi nhận hoàn tiền hoặc sửa sai khoản thu đã xác minh. Thao tác này không tự chuyển tiền qua ngân hàng và không thay đổi thuê bao.')} {labelUi('Khoản thu gốc')}: {dialog.payment.id}</p><label>{labelUi('Lý do hoàn/đảo thu')}<textarea required maxLength={1000} rows={3} value={draft.reason} onChange={event => changeDraft('reason', event.target.value)} /></label></>}
            {dialog.mode === 'void' && <><p>{labelUi("Chỉ hủy được hóa đơn không còn tiền đã thu sau hoàn/đảo. Mọi giao dịch được giữ trong lịch sử.")}</p><label>{labelUi("Lý do hủy")}<textarea required maxLength={1000} rows={3} value={draft.reason} onChange={event => changeDraft('reason', event.target.value)} /></label></>}
          </fieldset>
          <div className="manager-invoice-actions"><button type="button" className="manager-button" disabled={busy} onClick={invoice ? () => open('detail', invoice) : close}>{invoice ? tUi("errors.back") : tUi("common.cancel")}</button><button type="submit" className="manager-button manager-button-primary" disabled={busy}>{busy ? tUi("common.saving") : dialog.mode === 'create' ? labelUi("Tạo hóa đơn") : dialog.mode === 'payment' ? labelUi("Ghi nhận thanh toán") : dialog.mode === 'refund' ? labelUi('Xác nhận hoàn/đảo thu') : labelUi("Xác nhận hủy hóa đơn")}</button></div>
        </form>}
      </div>
    </LegacyOverlay>}
  </section>;
}
