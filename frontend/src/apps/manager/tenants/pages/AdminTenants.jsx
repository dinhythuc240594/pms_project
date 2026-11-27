import { formatDateTime } from '../../../../shared/lib/date.js'
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { Building2, Plus, RefreshCw, Search, Users, X } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import LegacyOverlay from '../../../pms/components/LegacyOverlay'
import {
  matchesSubscriptionState,
  subscriptionState,
  subscriptionStatusLabels,
} from '../../billing/subscriptionStatus'
import { phonePattern } from '../../../../shared/lib/phone.js'
import { emailPattern, taxIdPattern } from '../../../../shared/lib/validation.js'
import { VIETNAM_PROVINCES, isVietnamProvince } from '../../../../shared/lib/vietnamProvinces.js'
import { HOTEL_CURRENCIES } from '../../../../shared/lib/currencies.js'
import CustomerAccounts from './CustomerAccounts.jsx'
import CreateHotelDialog from './CreateHotelDialog.jsx'
import OwnerAccountDetails from './OwnerAccountDetails.jsx'
import { hotelDraft, hotelFields, hotelNotesLimit, hotelProfileInput } from './hotelProfileForm.js'
import './AdminTenants.css'

const dateText = (value) => (value ? formatDateTime(value) : '—')
const eventNames = {
  'tenant.created': 'Tạo khách sạn',
  'tenant.updated': 'Cập nhật hồ sơ / trạng thái',
  'membership.created': 'Tạo tài khoản khách sạn',
  'membership.updated': 'Cập nhật quyền tài khoản',
  'subscription.updated': 'Đổi gói / gia hạn',
}
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 120,
  background: 'rgba(9,24,40,.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
}

export default function AdminTenants() {
  const { authGeneration } = usePms()
  return <CustomersWorkspace key={authGeneration} />
}

function CustomersWorkspace() {
  useI18n()
  const [params, setParams] = useSearchParams()
  const activeTab = params.get('tab') === 'customers' ? 'customers' : 'hotels'
  const tabs = [
    { id: 'hotels', label: tUi('manager.customers.tabs.hotels'), Icon: Building2 },
    { id: 'customers', label: tUi('manager.customers.tabs.accounts'), Icon: Users },
  ]
  function selectTab(id) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (id === 'hotels') next.delete('tab')
      else next.set('tab', id)
      return next
    })
  }
  function navigateTabs(event, index) {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus()
    selectTab(tabs[next].id)
  }
  return (
    <div className="customer-workspace">
      <nav className="customer-workspace-tabs" role="tablist" aria-label={tUi('manager.tenants')}>
        {tabs.map(({ id, label, Icon }, index) => (
          <button
            key={id}
            id={`customer-workspace-${id}-tab`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`customer-workspace-${id}-panel`}
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => selectTab(id)}
            onKeyDown={(event) => navigateTabs(event, index)}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
      <section
        id="customer-workspace-hotels-panel"
        role="tabpanel"
        aria-labelledby="customer-workspace-hotels-tab"
        hidden={activeTab !== 'hotels'}
      >
        <HotelsWorkspace />
      </section>
      <section
        id="customer-workspace-customers-panel"
        role="tabpanel"
        aria-labelledby="customer-workspace-customers-tab"
        hidden={activeTab !== 'customers'}
      >
        {activeTab === 'customers' && <CustomerAccounts />}
      </section>
    </div>
  )
}

function HotelsWorkspace() {
  useI18n()
  const { tenants, saveTenant, getTenantSubscription, listPlans, routeAccess } = usePms()
  const { searchQuery = '', setSearchQuery } = useOutletContext() || {}
  const [params] = useSearchParams()
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [planId, setPlanId] = useState('all')
  const [subscriptionFilter, setSubscriptionFilter] = useState('all')
  const [subscriptionData, setSubscriptionData] = useState({
      tenants: null,
      revision: -1,
      rows: {},
      plans: [],
      error: '',
    }),
    [revision, setRevision] = useState(0)
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [dialog, setDialog] = useState(null),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    // shortcut: one subscription request per hotel; batch when hotel counts make loading slow.
    Promise.all([
      listPlans(),
      Promise.all(
        tenants.map(async (row) => [row.id, (await getTenantSubscription(row.id)).subscription]),
      ),
    ])
      .then(([catalog, rows]) => {
        if (!cancelled)
          setSubscriptionData({
            tenants,
            revision,
            rows: Object.fromEntries(rows),
            plans: catalog.plans || [],
            error: '',
          })
      })
      .catch((failure) => {
        if (!cancelled)
          setSubscriptionData({ tenants, revision, rows: {}, plans: [], error: failure.message })
      })
    return () => {
      cancelled = true
    }
  }, [tenants, getTenantSubscription, listPlans, revision])
  const loading = subscriptionData.tenants !== tenants || subscriptionData.revision !== revision
  const subscriptions = loading ? {} : subscriptionData.rows
  const subscriptionsReady = !loading && !subscriptionData.error
  const waitingForFilter = !subscriptionsReady && (planId !== 'all' || subscriptionFilter !== 'all')
  const noticeError = error || (loading ? '' : subscriptionData.error)
  const query = (search || searchQuery).trim().toLocaleLowerCase('vi')
  const rows = waitingForFilter
    ? []
    : tenants.filter(
        (row) =>
          [row.name, row.contactName, row.contactEmail, row.contactPhone, row.city, row.taxId]
            .join(' ')
            .toLocaleLowerCase('vi')
            .includes(query) &&
          (status === 'all' || row.status === status) &&
          (planId === 'all' || subscriptions[row.id]?.planId === planId) &&
          matchesSubscriptionState(subscriptions[row.id], subscriptionFilter),
      )
  function hotelUsersPath(id) {
    const next = new URLSearchParams(params)
    next.set('tab', 'customers')
    next.set('tenantId', id)
    return '?' + next
  }
  function closeDialog() {
    setDialog(null)
  }
  function finishDialog(text) {
    closeDialog()
    setMessage(text)
  }
  async function toggle(row) {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await saveTenant({ id: row.id, status: row.status === 'active' ? 'suspended' : 'active' })
      setMessage('Đã ' + (row.status === 'active' ? 'tạm ngưng ' : 'mở lại ') + row.name + '.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="manager-page manager-customers">
      <div className="manager-page-heading">
        <button
          type="button"
          className="manager-button manager-button-primary"
          onClick={() => {
            setMessage('')
            setDialog({})
          }}
        >
          <Plus size={16} /> {labelUi('Thêm khách sạn')}
        </button>
      </div>
      <div className="customer-stats">
        <div className="manager-panel">
          <small>{labelUi('Khách sạn')}</small>
          <strong>{tenants.length}</strong>
        </div>
        <div className="manager-panel">
          <small>{tUi('common.active')}</small>
          <strong>{tenants.filter((row) => row.status === 'active').length}</strong>
        </div>
        <div className="manager-panel">
          <small>{labelUi('Tạm ngưng')}</small>
          <strong>{tenants.filter((row) => row.status === 'suspended').length}</strong>
        </div>
      </div>
      {noticeError && (
        <div className="customer-error" role="alert">
          {noticeError}{' '}
          <button
            className="manager-button"
            onClick={() => {
              setError('')
              setRevision((value) => value + 1)
            }}
          >
            {tUi('common.retry')}
          </button>
        </div>
      )}
      {message && (
        <p className="customer-success" role="status">
          {labelUi(message)}
        </p>
      )}
      <section className="manager-panel" aria-busy={loading}>
        <div className="customer-filters">
          <label className="customer-search-field">
            {labelUi('Tìm khách sạn')}
            <span className="customer-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder={labelUi('Khách sạn, liên hệ, SĐT, email…')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </span>
          </label>
          <label>
            {labelUi('Trạng thái khách sạn')}
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">{tUi('rooms.all')}</option>
              <option value="active">{tUi('common.active')}</option>
              <option value="suspended">{labelUi('Tạm ngưng')}</option>
            </select>
          </label>
          <label>
            {tUi('header.plan')}
            <select
              value={planId}
              disabled={!subscriptionsReady}
              onChange={(event) => setPlanId(event.target.value)}
            >
              <option value="all">{tUi('rooms.all')}</option>
              {subscriptionData.plans.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.deleted ? ' ' + labelUi('(đã xóa khỏi danh sách bán)') : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labelUi('Trạng thái thuê bao')}
            <select
              value={subscriptionFilter}
              disabled={!subscriptionsReady}
              onChange={(event) => setSubscriptionFilter(event.target.value)}
            >
              <option value="all">{tUi('rooms.all')}</option>
              {Object.entries(subscriptionStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {labelUi(label)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="manager-button"
            disabled={loading || busy}
            onClick={() => {
              setError('')
              setRevision((value) => value + 1)
            }}
          >
            <RefreshCw size={16} aria-hidden="true" /> {labelUi('Tải lại thuê bao')}
          </button>
          <span role="status">
            {waitingForFilter
              ? loading
                ? labelUi('Đang tải thuê bao…')
                : labelUi('Chưa tải được thuê bao')
              : `${rows.length} kết quả`}
          </span>
        </div>
        <div
          className="manager-table-wrap"
          role="region"
          aria-label={labelUi('Danh sách khách hàng')}
          tabIndex={0}
        >
          <table className="manager-table customer-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                {[
                  'Khách sạn',
                  'Đầu mối liên hệ',
                  'Gói dịch vụ / Thuê bao',
                  'Trạng thái khách sạn',
                  'Thao tác',
                ].map((label) => (
                  <th key={label} scope="col" role="columnheader">
                    {labelUi(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {waitingForFilter ? (
                <tr role="row">
                  <td colSpan={5} className="customer-empty" role="status">
                    {loading
                      ? labelUi('Đang tải thuê bao để áp dụng bộ lọc…')
                      : labelUi('Chưa thể lọc thuê bao. Vui lòng tải lại dữ liệu.')}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const subscription = subscriptions[row.id]
                  const state = subscriptionsReady ? subscriptionState(subscription) : null
                  const subscriptionAction = !subscriptionsReady
                    ? 'Gói dịch vụ'
                    : !subscription
                      ? 'Cấp gói'
                      : subscription.planCode === 'FREE'
                        ? 'Đổi gói'
                        : 'Gia hạn'
                  return (
                    <tr key={row.id} role="row">
                      <td role="cell">
                        <strong>{row.name}</strong>
                        <small>
                          {[row.city, (row.rooms || 0) + ' phòng'].filter(Boolean).join(' · ')}
                        </small>
                      </td>
                      <td role="cell" data-label={labelUi('Đầu mối liên hệ')}>
                        <strong>{row.contactName || labelUi('Chưa có liên hệ')}</strong>
                        <small>{row.contactEmail || '—'}</small>
                        <small>{row.contactPhone || '—'}</small>
                      </td>
                      <td role="cell" data-label={labelUi('Gói dịch vụ / Thuê bao')}>
                        {loading ? (
                          tUi('common.loading')
                        ) : subscriptionData.error ? (
                          labelUi('Chưa tải được')
                        ) : (
                          <>
                            {subscription?.planName || labelUi('Chưa cấp gói')}
                            <small>
                              <span className={'customer-subscription-status ' + state}>
                                {subscriptionStatusLabels[state]}
                              </span>
                            </small>
                            {subscription && <small>{subscription.roomCount} phòng đăng ký</small>}
                            <small>
                              {subscription?.endDate
                                ? 'Hạn sử dụng ' + dateText(subscription.endDate)
                                : subscription
                                  ? tUi('usage.noExpiry')
                                  : ''}
                            </small>
                          </>
                        )}
                      </td>
                      <td role="cell" data-label={labelUi('Trạng thái khách sạn')}>
                        <span className={'customer-status ' + row.status}>
                          {row.status === 'active' ? tUi('common.active') : labelUi('Tạm ngưng')}
                        </span>
                      </td>
                      <td role="cell">
                        <div className="customer-actions">
                          <button className="manager-button" onClick={() => setDialog(row)}>
                            {labelUi('Hồ sơ')}
                          </button>
                          <Link
                            className="manager-button"
                            to={hotelUsersPath(row.id)}
                            onClick={() => setSearchQuery?.('')}
                            aria-label={tUi('manager.customers.manageUsersFor', {
                              hotel: row.name,
                            })}
                          >
                            <Users size={15} aria-hidden="true" />
                            {tUi('manager.customers.manageUsers')}
                          </Link>
                          {routeAccess('/manager/tenants/' + encodeURIComponent(row.id) + '/ota')
                            .allowed && (
                            <Link
                              className="manager-button"
                              to={'/manager/tenants/' + encodeURIComponent(row.id) + '/ota'}
                              aria-label={'OTA của ' + row.name}
                            >
                              OTA
                            </Link>
                          )}
                          <Link
                            className="manager-button"
                            to={'/manager/billing?tenant=' + encodeURIComponent(row.id)}
                            aria-label={subscriptionAction + ' cho ' + row.name}
                          >
                            {subscriptionAction}
                          </Link>
                          <button
                            className="manager-button"
                            disabled={busy}
                            onClick={() => toggle(row)}
                          >
                            {row.status === 'active' ? labelUi('Tạm ngưng') : labelUi('Mở lại')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {!waitingForFilter && !rows.length && (
          <p className="customer-empty" role="status">
            {tenants.length
              ? labelUi('Không có khách hàng khớp bộ lọc.')
              : labelUi('Chưa có khách sạn. Thêm khách sạn để bắt đầu.')}
          </p>
        )}
      </section>
      {dialog &&
        (dialog.id ? (
          <CustomerDialog
            key={dialog.id}
            customer={dialog}
            onClose={closeDialog}
            onSaved={finishDialog}
          />
        ) : (
          <CreateHotelDialog onClose={closeDialog} onSaved={finishDialog} />
        ))}
    </div>
  )
}

function CustomerDialog({ customer, onClose, onSaved }) {
  useI18n()
  const { saveTenant, getCustomerHistory, routeAccess } = usePms()
  const [tab, setTab] = useState('profile'),
    [draft, setDraft] = useState(() => hotelDraft(customer))
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const saving = useRef(false)
  const [panel, setPanel] = useState({ key: '', history: null, error: '' }),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(1)
  const loadKey = tab + ':' + page + ':' + revision
  const loading = tab !== 'profile' && panel.key !== loadKey
  const history = loading ? null : panel.history
  const panelError = error || (loading || tab === 'profile' ? '' : panel.error)
  useEffect(() => {
    if (tab === 'profile') return
    let cancelled = false
    const load = getCustomerHistory(customer.id, page)
    load
      .then((data) => {
        if (!cancelled)
          setPanel({ key: loadKey, history: tab === 'history' ? data : null, error: '' })
      })
      .catch((failure) => {
        if (!cancelled) setPanel({ key: loadKey, history: null, error: failure.message })
      })
    return () => {
      cancelled = true
    }
  }, [customer.id, tab, loadKey, page, getCustomerHistory])
  const close = () => {
    if (!busy) onClose()
  }
  async function saveProfile(event) {
    event.preventDefault()
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      await saveTenant({ id: customer.id, ...hotelProfileInput(draft, customer.city) })
      onSaved('Đã lưu hồ sơ khách hàng.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <LegacyOverlay title={'Hồ sơ ' + customer.name} onClose={close} style={overlayStyle}>
      <div className="customer-dialog">
        <div className="customer-dialog-head">
          <div>
            {/* <span className="manager-eyebrow">{labelUi("Khách hàng SaaS")}</span> */}
            <h2>{customer.name}</h2>
          </div>
          <button
            type="button"
            className="manager-icon-button"
            aria-label={labelUi('Đóng hồ sơ khách hàng')}
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="customer-tabs" aria-label={labelUi('Nội dung hồ sơ')}>
          {[
            ['profile', 'Hồ sơ'],
            ['history', 'Lịch sử'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              disabled={busy}
              onClick={() => {
                setTab(key)
                setError('')
                setMessage('')
              }}
            >
              {labelUi(label)}
            </button>
          ))}
        </nav>
        <div className="customer-dialog-body">
          {panelError && (
            <p className="customer-error" role="alert">
              {labelUi(panelError)}
              {tab !== 'profile' && (
                <button
                  type="button"
                  className="manager-button"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  {tUi('common.reload')}
                </button>
              )}
            </p>
          )}
          {message && (
            <p className="customer-success" role="status">
              {labelUi(message)}
            </p>
          )}
          {tab === 'profile' && (
            <form id="customer-profile-form" onSubmit={saveProfile}>
              <fieldset disabled={busy} className="customer-fieldset">
                <div className="customer-form-grid">
                  {Object.entries(hotelFields).map(([key, [label, maxLength]]) => (
                    <label key={key}>
                      {labelUi(label)}
                      {key === 'currency' ? (
                        <select
                          required
                          disabled
                          value={draft.currency}
                          onChange={(event) =>
                            setDraft((value) => ({ ...value, currency: event.target.value }))
                          }
                          aria-describedby="customer-currency-hint"
                        >
                          {HOTEL_CURRENCIES.map(({ code, label }) => (
                            <option key={code} value={code}>
                              {labelUi(label)}
                            </option>
                          ))}
                        </select>
                      ) : key === 'city' ? (
                        <select
                          value={draft.city}
                          onChange={(event) =>
                            setDraft((value) => ({ ...value, city: event.target.value }))
                          }
                        >
                          <option value="">{labelUi('Chọn tỉnh / thành phố')}</option>
                          {customer.city && !isVietnamProvince(customer.city) && (
                            <option value={customer.city}>{customer.city}</option>
                          )}
                          {VIETNAM_PROVINCES.map((province) => (
                            <option key={province.code} value={province.name}>
                              {province.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={
                            key === 'contactEmail'
                              ? 'email'
                              : key === 'contactPhone'
                                ? 'tel'
                                : 'text'
                          }
                          required={key === 'name'}
                          maxLength={maxLength}
                          value={draft[key]}
                          inputMode={key === 'taxId' ? 'numeric' : undefined}
                          pattern={
                            key === 'contactPhone'
                              ? phonePattern
                              : key === 'contactEmail'
                                ? emailPattern
                                : key === 'taxId'
                                  ? taxIdPattern
                                  : key === 'name'
                                    ? '.*\\S.*'
                                    : undefined
                          }
                          title={
                            key === 'contactPhone'
                              ? labelUi(
                                  'Số điện thoại cần từ 7 đến 15 chữ số, có thể có dấu + ở đầu và dấu phân cách.',
                                )
                              : key === 'taxId'
                                ? labelUi(
                                    'Mã số thuế chỉ gồm chữ số, có thể thêm dấu - và 3 chữ số chi nhánh.',
                                  )
                                : undefined
                          }
                          onChange={(event) => {
                            if (key === 'contactPhone' && /[^0-9+ .()-]/.test(event.target.value))
                              return
                            setDraft((value) => ({ ...value, [key]: event.target.value }))
                          }}
                        />
                      )}
                    </label>
                  ))}
                </div>
                <p id="customer-currency-hint" className="customer-hint">
                  {labelUi('Tiền tệ được thiết lập khi tạo khách sạn.')}
                </p>
                <label>
                  {labelUi('Ghi chú chăm sóc khách hàng')}
                  <textarea
                    rows={3}
                    maxLength={hotelNotesLimit}
                    value={draft.customerNotes}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, customerNotes: event.target.value }))
                    }
                  />
                </label>
                <p className="customer-hint">
                  {labelUi('Ghi chú này chỉ dành cho quản trị hệ thống.')}
                </p>
                <section className="customer-owner">
                  <h3>{labelUi('Tài khoản quản lý khách sạn')}</h3>
                  {customer.owner ? (
                    <OwnerAccountDetails account={customer.owner} />
                  ) : (
                    <p className="customer-hint">
                      {labelUi('Chưa có thông tin tài khoản quản lý khách sạn.')}
                    </p>
                  )}
                </section>
              </fieldset>
            </form>
          )}
          {tab === 'history' && (
            <>
              {loading ? (
                <p role="status">{labelUi('Đang tải lịch sử…')}</p>
              ) : history?.auditLogs.length ? (
                <ol className="customer-history">
                  {history.auditLogs.map((row) => (
                    <li key={row.id}>
                      <strong>{eventNames[row.event] || labelUi('Thao tác hệ thống')}</strong>
                      <span>
                        {row.userName || labelUi('Hệ thống')} · {dateText(row.createdAt)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                !panelError && <p role="status">{labelUi('Chưa có thao tác được ghi nhận.')}</p>
              )}
              {history && (
                <div className="customer-pagination">
                  <button
                    className="manager-button"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    {labelUi('Trước')}
                  </button>
                  <span>
                    {labelUi('Trang')} {page} · {history.pagination.totalItems} thao tác
                  </span>
                  <button
                    className="manager-button"
                    disabled={loading || page * 20 >= history.pagination.totalItems}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Sau
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="customer-dialog-footer">
          {routeAccess('/manager/tenants/' + encodeURIComponent(customer.id) + '/ota').allowed && (
            <Link
              className="manager-button"
              to={'/manager/tenants/' + encodeURIComponent(customer.id) + '/ota'}
            >
              OTA
            </Link>
          )}
          <Link
            className="manager-button"
            to={'/manager/billing?tenant=' + encodeURIComponent(customer.id)}
          >
            {tUi('manager.billing')}
          </Link>
          <Link className="manager-button" to="/manager/features">
            {tUi('manager.features')}
          </Link>
          <button type="button" className="manager-button" disabled={busy} onClick={close}>
            {tUi('common.close')}
          </button>
          {tab === 'profile' && (
            <button
              type="submit"
              form="customer-profile-form"
              className="manager-button manager-button-primary"
              disabled={busy}
            >
              {busy ? tUi('common.saving') : tUi('profile.save')}
            </button>
          )}
        </div>
      </div>
    </LegacyOverlay>
  )
}
