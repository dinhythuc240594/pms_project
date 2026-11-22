import { formatDateTime } from '../../../../shared/lib/date.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import { usePms } from '../../../pms/data/usePms';
import { ROLE_NAMES } from '../../../pms/data/access.js';
import LegacyOverlay from '../../../pms/components/LegacyOverlay';
import { matchesSubscriptionState, subscriptionState, subscriptionStatusLabels } from '../../billing/subscriptionStatus';
import { phoneInput, phonePattern } from '../../../../shared/lib/phone.js';
import { emailInput, emailPattern, taxIdInput, taxIdPattern } from '../../../../shared/lib/validation.js';
import { VIETNAM_PROVINCES, isVietnamProvince } from '../../../../shared/lib/vietnamProvinces.js';
import { HOTEL_CURRENCIES, isHotelCurrency } from '../../../../shared/lib/currencies.js';
import './AdminTenants.css';

const fields = [['name', 'Tên khách sạn', 160], ['currency', 'Tiền tệ khách sạn', 3], ['contactName', 'Người liên hệ', 160], ['contactEmail', 'Email liên hệ', 254], ['contactPhone', 'Điện thoại / Zalo', 40], ['address', 'Địa chỉ', 500], ['city', 'Tỉnh / Thành phố', 160], ['taxId', 'Mã số thuế', 40]];
const dateText = value => value ? formatDateTime(value) : '—';
const eventNames = { 'tenant.created': 'Tạo khách sạn', 'tenant.updated': 'Cập nhật hồ sơ / trạng thái', 'membership.created': 'Tạo tài khoản khách sạn', 'membership.updated': 'Cập nhật quyền tài khoản', 'subscription.updated': 'Đổi gói / gia hạn' };
const overlayStyle = { position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(9,24,40,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 };

export default function AdminTenants() {
  const { authGeneration } = usePms();
  return <CustomersWorkspace key={authGeneration} />;
}

function CustomersWorkspace() {
  useI18n();
  const { tenants, saveTenant, getTenantSubscription, listPlans, routeAccess } = usePms();
  const { searchQuery = '' } = useOutletContext() || {};
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all'), [planId, setPlanId] = useState('all');
  const [subscriptionFilter, setSubscriptionFilter] = useState('all');
  const [subscriptionData, setSubscriptionData] = useState({ tenants: null, revision: -1, rows: {}, plans: [], error: '' }), [revision, setRevision] = useState(0);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [dialog, setDialog] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // shortcut: one subscription request per hotel; batch when hotel counts make loading slow.
    Promise.all([listPlans(), Promise.all(tenants.map(async row => [row.id, (await getTenantSubscription(row.id)).subscription]))])
      .then(([catalog, rows]) => { if (!cancelled) setSubscriptionData({ tenants, revision, rows: Object.fromEntries(rows), plans: catalog.plans || [], error: '' }); })
      .catch(failure => { if (!cancelled) setSubscriptionData({ tenants, revision, rows: {}, plans: [], error: failure.message }); });
    return () => { cancelled = true; };
  }, [tenants, getTenantSubscription, listPlans, revision]);
  const loading = subscriptionData.tenants !== tenants || subscriptionData.revision !== revision;
  const subscriptions = loading ? {} : subscriptionData.rows;
  const subscriptionsReady = !loading && !subscriptionData.error;
  const waitingForFilter = !subscriptionsReady && (planId !== 'all' || subscriptionFilter !== 'all');
  const noticeError = error || (loading ? '' : subscriptionData.error);
  const query = (search || searchQuery).trim().toLocaleLowerCase('vi');
  const rows = waitingForFilter ? [] : tenants.filter(row => [row.name, row.contactName, row.contactEmail, row.contactPhone, row.city, row.taxId].join(' ').toLocaleLowerCase('vi').includes(query) && (status === 'all' || row.status === status) && (planId === 'all' || subscriptions[row.id]?.planId === planId) && matchesSubscriptionState(subscriptions[row.id], subscriptionFilter));
  async function toggle(row) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await saveTenant({ id: row.id, status: row.status === 'active' ? 'suspended' : 'active' }); setMessage('Đã ' + (row.status === 'active' ? 'tạm ngưng ' : 'mở lại ') + row.name + '.'); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <div className="manager-page manager-customers">
    <div className="manager-page-heading"><div><span className="manager-eyebrow">{labelUi("Khách hàng SaaS")}</span><h2>{labelUi("Khách sạn & khách hàng")}</h2><p>{labelUi("Hồ sơ liên hệ, tài khoản và dịch vụ đang sử dụng.")}</p></div><button type="button" className="manager-button manager-button-primary" onClick={() => { setMessage(''); setDialog({}); }}><Plus size={16} />{" "}{labelUi("Thêm khách sạn")}</button></div>
    <div className="customer-stats"><div className="manager-panel"><small>{labelUi("Khách sạn")}</small><strong>{tenants.length}</strong></div><div className="manager-panel"><small>{tUi("common.active")}</small><strong>{tenants.filter(row => row.status === 'active').length}</strong></div><div className="manager-panel"><small>{labelUi("Tạm ngưng")}</small><strong>{tenants.filter(row => row.status === 'suspended').length}</strong></div></div>
    {noticeError && <div className="customer-error" role="alert">{noticeError} <button className="manager-button" onClick={() => { setError(''); setRevision(value => value + 1); }}>{tUi("common.retry")}</button></div>}{message && <p className="customer-success" role="status">{labelUi(message)}</p>}
    <section className="manager-panel" aria-busy={loading}>
      <div className="customer-filters">
        <label className="customer-search-field">{labelUi("Tìm khách hàng")}<span className="customer-search"><Search size={16} aria-hidden="true" /><input type="search" placeholder={labelUi("Khách sạn, liên hệ, SĐT, email…")} value={search} onChange={event => setSearch(event.target.value)} /></span></label>
        <label>{labelUi("Trạng thái khách sạn")}<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">{tUi("rooms.all")}</option><option value="active">{tUi("common.active")}</option><option value="suspended">{labelUi("Tạm ngưng")}</option></select></label>
        <label>{tUi("header.plan")}<select value={planId} disabled={!subscriptionsReady} onChange={event => setPlanId(event.target.value)}><option value="all">{tUi("rooms.all")}</option>{subscriptionData.plans.map(item => <option key={item.id} value={item.id}>{item.name}{item.deleted ? " " + labelUi("(đã xóa khỏi danh sách bán)") : ''}</option>)}</select></label>
        <label>{labelUi("Trạng thái thuê bao")}<select value={subscriptionFilter} disabled={!subscriptionsReady} onChange={event => setSubscriptionFilter(event.target.value)}><option value="all">{tUi("rooms.all")}</option>{Object.entries(subscriptionStatusLabels).map(([value, label]) => <option key={value} value={value}>{labelUi(label)}</option>)}</select></label>
        <button type="button" className="manager-button" disabled={loading || busy} onClick={() => { setError(''); setRevision(value => value + 1); }}><RefreshCw size={16} aria-hidden="true" />{" "}{labelUi("Tải lại thuê bao")}</button>
        <span role="status">{waitingForFilter ? loading ? labelUi("Đang tải thuê bao…") : labelUi("Chưa tải được thuê bao") : `${rows.length} kết quả`}</span>
      </div>
      <div className="manager-table-wrap" role="region" aria-label={labelUi("Danh sách khách hàng")} tabIndex={0}>
        <table className="manager-table customer-table" role="table">
          <thead role="rowgroup"><tr role="row">{['Khách sạn', 'Đầu mối liên hệ', 'Gói dịch vụ / Thuê bao', 'Trạng thái khách sạn', 'Thao tác'].map(label => <th key={label} scope="col" role="columnheader">{labelUi(label)}</th>)}</tr></thead>
          <tbody role="rowgroup">{waitingForFilter ? <tr role="row"><td colSpan={5} className="customer-empty" role="status">{loading ? labelUi("Đang tải thuê bao để áp dụng bộ lọc…") : labelUi("Chưa thể lọc thuê bao. Vui lòng tải lại dữ liệu.")}</td></tr> : rows.map(row => {
            const subscription = subscriptions[row.id];
            const state = subscriptionsReady ? subscriptionState(subscription) : null;
            const subscriptionAction = !subscriptionsReady ? 'Gói dịch vụ' : !subscription ? 'Cấp gói' : subscription.planCode === 'FREE' ? 'Đổi gói' : 'Gia hạn';
            return <tr key={row.id} role="row">
              <td role="cell"><strong>{row.name}</strong><small>{[row.city, (row.rooms || 0) + ' phòng'].filter(Boolean).join(' · ')}</small></td>
              <td role="cell" data-label={labelUi('Đầu mối liên hệ')}><strong>{row.contactName || labelUi("Chưa có liên hệ")}</strong><small>{row.contactEmail || '—'}</small><small>{row.contactPhone || '—'}</small></td>
              <td role="cell" data-label={labelUi('Gói dịch vụ / Thuê bao')}>{loading ? tUi("common.loading") : subscriptionData.error ? labelUi("Chưa tải được") : <>{subscription?.planName || labelUi("Chưa cấp gói")}<small><span className={'customer-subscription-status ' + state}>{subscriptionStatusLabels[state]}</span></small>{subscription && <small>{subscription.roomCount} phòng đăng ký</small>}<small>{subscription?.endDate ? 'Hạn sử dụng ' + dateText(subscription.endDate) : subscription ? tUi("usage.noExpiry") : ''}</small></>}</td>
              <td role="cell" data-label={labelUi('Trạng thái khách sạn')}><span className={'customer-status ' + row.status}>{row.status === 'active' ? tUi("common.active") : labelUi("Tạm ngưng")}</span></td>
              <td role="cell"><div className="customer-actions"><button className="manager-button" onClick={() => setDialog(row)}>{labelUi("Hồ sơ")}</button>{routeAccess('/manager/tenants/' + encodeURIComponent(row.id) + '/ota').allowed && <Link className="manager-button" to={'/manager/tenants/' + encodeURIComponent(row.id) + '/ota'} aria-label={'OTA của ' + row.name}>OTA</Link>}<Link className="manager-button" to={'/manager/billing?tenant=' + encodeURIComponent(row.id)} aria-label={subscriptionAction + ' cho ' + row.name}>{subscriptionAction}</Link><button className="manager-button" disabled={busy} onClick={() => toggle(row)}>{row.status === 'active' ? labelUi("Tạm ngưng") : labelUi("Mở lại")}</button></div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!waitingForFilter && !rows.length && <p className="customer-empty" role="status">{tenants.length ? labelUi("Không có khách hàng khớp bộ lọc.") : labelUi("Chưa có khách sạn. Thêm khách sạn để bắt đầu.")}</p>}
    </section>
    {dialog && <CustomerDialog key={dialog.id || 'new'} customer={dialog} onClose={() => setDialog(null)} onSaved={text => { setDialog(null); setMessage(text); }} />}
  </div>;
}

function CustomerDialog({ customer, onClose, onSaved }) {
  useI18n();
  const { saveTenant, getCustomerHistory, searchCustomerAccounts, routeAccess } = usePms();
  const [tab, setTab] = useState('profile'), [draft, setDraft] = useState({ ...Object.fromEntries(fields.map(([key]) => [key, customer[key] || ''])), currency: customer.currency || 'VND', customerNotes: customer.customerNotes || '', ownerName: '', ownerEmail: '', ownerPassword: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const saving = useRef(false);
  const [panel, setPanel] = useState({ key: '', history: null, error: '' }), [revision, setRevision] = useState(0), [page, setPage] = useState(1);
  const [accountMode, setAccountMode] = useState('new'), [accountSearch, setAccountSearch] = useState(''), [selectedAccount, setSelectedAccount] = useState(null);
  const [accountResults, setAccountResults] = useState({ query: '', revision: 0, users: [], error: '' }), [accountRevision, setAccountRevision] = useState(0);
  const accountQuery = accountSearch.trim();
  const searchingAccounts = accountMode === 'existing' && accountQuery.length >= 2 && (accountResults.query !== accountQuery || accountResults.revision !== accountRevision);
  const accountUsers = searchingAccounts || accountResults.query !== accountQuery ? [] : accountResults.users;
  const loadKey = tab + ':' + page + ':' + revision;
  const loading = tab !== 'profile' && panel.key !== loadKey;
  const history = loading ? null : panel.history;
  const panelError = error || (loading || tab === 'profile' ? '' : panel.error);
  useEffect(() => {
    if (!customer.id || tab === 'profile') return;
    let cancelled = false;
    const load = getCustomerHistory(customer.id, page);
    load.then(data => { if (!cancelled) setPanel({ key: loadKey, history: tab === 'history' ? data : null, error: '' }); })
      .catch(failure => { if (!cancelled) setPanel({ key: loadKey, history: null, error: failure.message }); });
    return () => { cancelled = true; };
  }, [customer.id, tab, loadKey, page, getCustomerHistory]);
  useEffect(() => {
    if (customer.id || accountMode !== 'existing' || accountQuery.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCustomerAccounts(accountQuery)
        .then(data => { if (!cancelled) setAccountResults({ query: accountQuery, revision: accountRevision, users: data.users || [], error: '' }); })
        .catch(failure => { if (!cancelled) setAccountResults({ query: accountQuery, revision: accountRevision, users: [], error: failure.message }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [customer.id, accountMode, accountQuery, accountRevision, searchCustomerAccounts]);
  function changeAccountMode(mode) {
    setAccountMode(mode); setSelectedAccount(null); setAccountSearch(''); setError('');
    setAccountResults({ query: '', revision: 0, users: [], error: '' });
    setDraft(value => ({ ...value, ownerPassword: '' }));
  }
  const close = () => { if (!busy) onClose(); };
  async function saveProfile(event) {
    event.preventDefault(); if (saving.current) return;
    saving.current = true;
    setBusy(true); setError('');
    try {
      const { ownerName, ownerEmail, ownerPassword, currency, ...profile } = draft;
      profile.name = profile.name.trim();
      if (!profile.name) throw new Error('Vui lòng nhập tên khách sạn.');
      profile.contactPhone = phoneInput(profile.contactPhone);
      profile.contactEmail = profile.contactEmail.trim() ? emailInput(profile.contactEmail) : '';
      profile.taxId = taxIdInput(profile.taxId);
      profile.city = profile.city.trim();
      if (profile.city && !isVietnamProvince(profile.city) && profile.city !== customer.city) throw new Error('Vui lòng chọn tỉnh / thành phố hợp lệ.');
      let owner = {};
      if (!customer.id) {
        if (!isHotelCurrency(currency)) throw new Error('Tiền tệ không được hỗ trợ.');
        profile.currency = currency;
        if (!profile.contactName.trim()) delete profile.contactName;
        if (!profile.contactEmail.trim()) delete profile.contactEmail;
        if (accountMode === 'existing') {
          if (!selectedAccount || selectedAccount.active !== true) throw new Error('Vui lòng tìm và chọn tài khoản quản lý khách sạn.');
          owner = { ownerUserId: selectedAccount.id };
        } else {
          if (!ownerName.trim()) throw new Error('Vui lòng nhập họ tên Owner.');
          if (ownerPassword.length < 12 || ownerPassword.length > 128) throw new Error('Mật khẩu cần từ 12 đến 128 ký tự.');
          owner = { ownerName: ownerName.trim(), ownerEmail: emailInput(ownerEmail), ownerPassword };
        }
      }
      await saveTenant(customer.id ? { id: customer.id, ...profile } : { ...profile, ...owner });
      onSaved(customer.id ? 'Đã lưu hồ sơ khách hàng.' : accountMode === 'existing' ? 'Đã tạo khách sạn và gán tài khoản quản lý đã chọn. Cấp gói tại Gói cước & hóa đơn để bắt đầu.' : 'Đã tạo khách sạn và tài khoản Owner. Cấp gói tại Gói cước & hóa đơn để bắt đầu.');
    } catch (failure) { setError(failure.message); } finally { saving.current = false; setBusy(false); }
  }
  return <LegacyOverlay title={customer.id ? 'Hồ sơ ' + customer.name : labelUi("Thêm khách sạn")} onClose={close} style={overlayStyle}><div className="customer-dialog">
    <div className="customer-dialog-head"><div><span className="manager-eyebrow">{labelUi("Khách hàng SaaS")}</span><h2>{customer.id ? customer.name : labelUi("Thêm khách sạn")}</h2></div><button type="button" className="manager-icon-button" aria-label={labelUi("Đóng hồ sơ khách hàng")} disabled={busy} onClick={close}><X size={18} /></button></div>
    {customer.id && <nav className="customer-tabs" aria-label={labelUi("Nội dung hồ sơ")}>{[['profile', 'Hồ sơ'], ['history', 'Lịch sử']].map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} disabled={busy} onClick={() => { setTab(key); setError(''); setMessage(''); }}>{labelUi(label)}</button>)}</nav>}
    <div className="customer-dialog-body">{panelError && <p className="customer-error" role="alert">{labelUi(panelError)}{tab !== 'profile' && <button type="button" className="manager-button" onClick={() => setRevision(value => value + 1)}>{tUi("common.reload")}</button>}</p>}{message && <p className="customer-success" role="status">{labelUi(message)}</p>}
      {tab === 'profile' && <form id="customer-profile-form" onSubmit={saveProfile}>
        <fieldset disabled={busy} className="customer-fieldset">
          <div className="customer-form-grid">{fields.map(([key, label, maxLength]) => <label key={key}>{labelUi(label)}
            {key === 'currency' ? <select required disabled={Boolean(customer.id)} value={draft.currency} onChange={event => setDraft(value => ({ ...value, currency: event.target.value }))} aria-describedby="customer-currency-hint">
              {HOTEL_CURRENCIES.map(({ code, label }) => <option key={code} value={code}>{labelUi(label)}</option>)}
            </select> : key === 'city' ? <select value={draft.city} onChange={event => setDraft(value => ({ ...value, city: event.target.value }))}>
              <option value="">{labelUi('Chọn tỉnh / thành phố')}</option>
              {customer.city && !isVietnamProvince(customer.city) && <option value={customer.city}>{customer.city}</option>}
              {VIETNAM_PROVINCES.map(province => <option key={province.code} value={province.name}>{province.name}</option>)}
            </select> : <input type={key === 'contactEmail' ? 'email' : key === 'contactPhone' ? 'tel' : 'text'} required={key === 'name'} maxLength={maxLength} value={draft[key]}
              inputMode={key === 'taxId' ? 'numeric' : undefined}
              pattern={key === 'contactPhone' ? phonePattern : key === 'contactEmail' ? emailPattern : key === 'taxId' ? taxIdPattern : key === 'name' ? '.*\\S.*' : undefined}
              title={key === 'contactPhone' ? labelUi('Số điện thoại cần từ 7 đến 15 chữ số, có thể có dấu + ở đầu và dấu phân cách.') : key === 'taxId' ? labelUi('Mã số thuế chỉ gồm chữ số, có thể thêm dấu - và 3 chữ số chi nhánh.') : undefined}
              onChange={event => { if (key === 'contactPhone' && /[^0-9+ .()-]/.test(event.target.value)) return; setDraft(value => ({ ...value, [key]: event.target.value })); }} />}
          </label>)}</div>
          <p id="customer-currency-hint" className="customer-hint">{labelUi(customer.id ? 'Tiền tệ được thiết lập khi tạo khách sạn.' : 'Chọn cùng loại tiền tệ với khách sạn trên các kênh bán phòng.')}</p>
          <label>{labelUi('Ghi chú chăm sóc khách hàng')}<textarea rows={3} maxLength={4000} value={draft.customerNotes} onChange={event => setDraft(value => ({ ...value, customerNotes: event.target.value }))} /></label>
          <p className="customer-hint">{labelUi('Ghi chú này chỉ dành cho quản trị hệ thống.')}</p>
          <section className="customer-owner">
            <h3>{labelUi('Tài khoản quản lý khách sạn')}</h3>
            {customer.id ? customer.owner ? <OwnerAccountDetails account={customer.owner} /> : <p className="customer-hint">{labelUi('Chưa có thông tin tài khoản quản lý khách sạn.')}</p> : <>
              <fieldset className="customer-account-modes">
                <legend>{labelUi('Chọn tài khoản quản lý')}</legend>
                <label><input type="radio" name="owner-account-mode" value="existing" checked={accountMode === 'existing'} onChange={() => changeAccountMode('existing')} />{labelUi('Đã có tài khoản')}</label>
                <label><input type="radio" name="owner-account-mode" value="new" checked={accountMode === 'new'} onChange={() => changeAccountMode('new')} />{labelUi('Chưa có tài khoản')}</label>
              </fieldset>
              <p className="customer-hint">{labelUi('Email đăng nhập và thông tin liên hệ có thể khác nhau.')}</p>
              {accountMode === 'new' ? <div className="customer-form-grid">
                <label>{labelUi('Họ tên Owner')}<input required pattern=".*\S.*" maxLength={160} value={draft.ownerName} onChange={event => setDraft(value => ({ ...value, ownerName: event.target.value }))} /></label>
                <label>{labelUi('Email đăng nhập Owner')}<input required type="email" pattern={emailPattern} maxLength={254} autoComplete="off" value={draft.ownerEmail} onChange={event => setDraft(value => ({ ...value, ownerEmail: event.target.value }))} /></label>
                <label>{labelUi('Mật khẩu Owner')}<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={draft.ownerPassword} onChange={event => setDraft(value => ({ ...value, ownerPassword: event.target.value }))} /></label>
              </div> : <div className="customer-account-picker">
                <label>{labelUi('Tìm tài khoản theo tên hoặc email')}<input type="search" maxLength={254} autoComplete="off" value={accountSearch} aria-describedby="customer-account-search-hint" onChange={event => { setAccountSearch(event.target.value); setSelectedAccount(null); setError(''); }} /></label>
                <p id="customer-account-search-hint" className="customer-hint">{labelUi('Nhập ít nhất 2 ký tự để tìm tài khoản đang hoạt động. Tài khoản được chọn sẽ có quyền chủ khách sạn.')}</p>
                {searchingAccounts ? <p role="status">{labelUi('Đang tìm tài khoản…')}</p> : accountQuery.length >= 2 && accountResults.query === accountQuery && <>
                  {accountResults.error ? <p className="customer-error" role="alert">{accountResults.error} <button type="button" className="manager-button" onClick={() => setAccountRevision(value => value + 1)}>{tUi('common.retry')}</button></p> : accountUsers.length ? <ul className="customer-account-results" aria-label={labelUi('Kết quả tìm tài khoản')}>
                    {accountUsers.map(account => <li key={account.id}><button type="button" className="customer-account-option" aria-pressed={selectedAccount?.id === account.id} onClick={() => { setSelectedAccount(account); setError(''); }}><strong>{account.name}</strong><span>{account.email}</span><small>{selectedAccount?.id === account.id ? labelUi('Đã chọn') : labelUi('Chọn tài khoản')}</small></button></li>)}
                  </ul> : <p role="status">{labelUi('Không tìm thấy tài khoản phù hợp. Thử tên hoặc email khác, hoặc chọn Chưa có tài khoản.')}</p>}
                </>}
                {selectedAccount && <OwnerAccountDetails account={selectedAccount} />}
              </div>}
            </>}
          </section>
        </fieldset>
      </form>}
      {tab === 'history' && <>{loading ? <p role="status">{labelUi("Đang tải lịch sử…")}</p> : history?.auditLogs.length ? <ol className="customer-history">{history.auditLogs.map(row => <li key={row.id}><strong>{eventNames[row.event] || labelUi("Thao tác hệ thống")}</strong><span>{row.userName || labelUi("Hệ thống")} · {dateText(row.createdAt)}</span></li>)}</ol> : !panelError && <p role="status">{labelUi("Chưa có thao tác được ghi nhận.")}</p>}{history && <div className="customer-pagination"><button className="manager-button" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>{labelUi("Trước")}</button><span>{labelUi("Trang")}{" "}{page} · {history.pagination.totalItems} thao tác</span><button className="manager-button" disabled={loading || page * 20 >= history.pagination.totalItems} onClick={() => setPage(value => value + 1)}>Sau</button></div>}</>}
    </div>
    <div className="customer-dialog-footer">{customer.id && <>{routeAccess('/manager/tenants/' + encodeURIComponent(customer.id) + '/ota').allowed && <Link className="manager-button" to={'/manager/tenants/' + encodeURIComponent(customer.id) + '/ota'}>OTA</Link>}<Link className="manager-button" to={'/manager/billing?tenant=' + encodeURIComponent(customer.id)}>{tUi("manager.billing")}</Link><Link className="manager-button" to="/manager/features">{tUi("manager.features")}</Link></>}<button type="button" className="manager-button" disabled={busy} onClick={close}>{tUi("common.close")}</button>{tab === 'profile' && <button type="submit" form="customer-profile-form" className="manager-button manager-button-primary" disabled={busy}>{busy ? tUi("common.saving") : customer.id ? tUi("profile.save") : labelUi("Tạo khách sạn")}</button>}</div>
  </div></LegacyOverlay>;
}

function OwnerAccountDetails({ account }) {
  return <section className="customer-account-details" aria-label={labelUi('Chi tiết tài khoản quản lý khách sạn')}>
    <h4>{labelUi('Chi tiết tài khoản quản lý khách sạn')}</h4>
    <dl>
      <div><dt>{labelUi('Họ tên')}</dt><dd>{account.name}</dd></div>
      <div><dt>{labelUi('Email đăng nhập')}</dt><dd>{account.email}</dd></div>
      <div><dt>{labelUi('Mã tài khoản')}</dt><dd>{account.id}</dd></div>
      <div><dt>{labelUi('Trạng thái')}</dt><dd>{account.active ? tUi('common.active') : labelUi('Đã khóa')}</dd></div>
      <div><dt>{labelUi('Ngày tạo tài khoản')}</dt><dd>{dateText(account.createdAt)}</dd></div>
      <div><dt>{labelUi('Vai trò tại khách sạn')}</dt><dd>{labelUi('Chủ khách sạn (Owner)')}</dd></div>
    </dl>
    {account.memberships && <><h5>{labelUi('Khách sạn đã tham gia')}</h5>{account.memberships.length ? <ul>{account.memberships.map(membership => <li key={membership.tenantId}><strong>{membership.tenantName || membership.tenantId}</strong><span>{labelUi(ROLE_NAMES[membership.role] || membership.role)} · {membership.active ? tUi('common.active') : labelUi('Tạm ngưng')}</span></li>)}</ul> : <p className="customer-hint">{labelUi('Chưa tham gia khách sạn nào.')}</p>}</>}
  </section>;
}
