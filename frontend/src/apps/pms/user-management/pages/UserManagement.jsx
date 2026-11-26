import { formatDateTime } from '../../../../shared/lib/date.js'
import { emailPattern, emailInput } from '../../../../shared/lib/validation.js'
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import React, { useEffect, useRef, useState } from 'react'
import { usePms } from '../../data/usePms'
import { FEATURES, ROLE_NAMES } from '../../data/access'
import { isFeatureVisible } from '../../../../shared/config/featureVisibility.js'
import { useInventoryQuery } from '../../inventory/useInventoryQuery'
import FormDialog from '../../components/FormDialog'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  History,
  Layers,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react'
import './UserManagement.css'

const ROLES = ['HOTEL_OWNER', 'FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTANT']
const blankDraft = () => ({
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: 'FRONT_DESK',
  active: true,
  existingAccount: false,
})
const auditLabels = {
  'membership.created': 'Thêm người dùng',
  'membership.updated': 'Cập nhật quyền người dùng',
  'feature_override.upserted': 'Cấp tính năng',
  'feature_override.deleted': 'Gỡ cấp tính năng',
}

function permissions(pms) {
  const { user, tenantId, access } = pms
  const membership = user?.memberships?.find(
    (item) => item.tenantId === tenantId && item.active === true,
  )
  const owner =
    user?.globalRole === 'USER' && user.active !== false && membership?.role === 'HOTEL_OWNER'
  const view = owner && access?.('users.view', undefined, false)?.allowed === true
  return { view, write: view && access?.('users.write')?.allowed === true }
}

export default function UserManagement() {
  const pms = usePms()
  const membership = pms.user?.memberships?.find((item) => item.tenantId === pms.tenantId)
  const { view, write } = permissions(pms)
  const scope = [
    pms.tenantId,
    pms.user?.id,
    pms.authGeneration,
    pms.user?.globalRole,
    pms.user?.active,
    membership?.role,
    membership?.active,
    view,
    write,
  ].join(':')
  return <UserManagementContent key={scope} />
}

function UserManagementContent() {
  useI18n()
  const pms = usePms()
  const {
    users: accounts = [],
    tenantId,
    saveTenantUser,
    tenant,
    user,
    loading,
    workspaceLoading,
    loadError,
    retry,
  } = pms
  const { view: canView, write: canManage } = permissions(pms)
  const [activeTab, setActiveTab] = useState('list')
  const [event, setEvent] = useState('')
  const [actor, setActor] = useState('')
  const [page, setPage] = useState(1)
  const auditQuery = new URLSearchParams({
    page: String(page),
    pageSize: '25',
    ...(event && { event }),
    ...(actor && { userId: actor }),
  })
  const history = useInventoryQuery(
    canView && activeTab === 'history' ? `/audit?${auditQuery}` : null,
  )
  const featureAccess = useInventoryQuery(
    canView && activeTab === 'features' ? '/feature-overrides' : null,
  )
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [draft, setDraft] = useState(blankDraft)
  const [editorOpen, setEditorOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const mounted = useRef(true)
  const mayWrite = useRef(canManage)
  useEffect(() => {
    mayWrite.current = canManage
  }, [canManage])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const hotelUsers = accounts.flatMap((account) => {
    const membership = account.memberships?.find((item) => item.tenantId === tenantId)
    return membership
      ? [{ ...account, role: membership.role, active: membership.active !== false }]
      : []
  })
  const users = hotelUsers.filter(
    (account) =>
      `${account.name || ''} ${account.email || ''}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (!roleFilter || account.role === roleFilter) &&
      (!statusFilter || (statusFilter === 'active') === account.active),
  )
  const activeCount = hotelUsers.filter((account) => account.active).length

  async function save(input) {
    if (saving.current) return
    setError('')
    setSaved(false)
    if (!mayWrite.current) {
      setError(tUi('users.ownerOnly'))
      return
    }
    if (
      input.id === user.id ||
      (!input.id &&
        input.existingAccount &&
        input.email.trim().toLowerCase() === user.email?.toLowerCase())
    ) {
      setError(tUi('users.selfLocked'))
      return
    }
    if (input.id && !hotelUsers.some((account) => account.id === input.id)) {
      setError(tUi('users.accountUnavailable'))
      return
    }
    saving.current = true
    setBusy(true)
    try {
      if (!ROLES.includes(input.role)) throw new Error(tUi('users.invalidRole'))
      if (!input.id) {
        input = { ...input, email: emailInput(input.email) }
        if (!input.existingAccount) {
          input.name = input.name.trim()
          if (!input.name || input.name.length > 160) throw new Error(tUi('users.invalidName'))
          if (!input.password || input.password.length < 12 || input.password.length > 128)
            throw new Error(tUi('users.invalidPassword'))
          if (input.password !== input.confirmPassword)
            throw new Error(tUi('users.passwordMismatch'))
        }
      }
      await saveTenantUser(input)
      if (!mounted.current || !mayWrite.current) return
      setSaved(true)
      setDraft(blankDraft())
      setEditorOpen(false)
    } catch (err) {
      if (mounted.current && mayWrite.current) setError(err.message)
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }

  function openEditor(input = blankDraft()) {
    if (!mayWrite.current || saving.current || input.id === user?.id) return
    setDraft({ ...input })
    setError('')
    setSaved(false)
    setEditorOpen(true)
  }
  function closeEditor() {
    if (saving.current) return
    setEditorOpen(false)
    setDraft(blankDraft())
    setError('')
  }

  return (
    <div className="owner-users-page">
      {canView && (
        <header className="owner-users-heading">
          <button
            type="button"
            className="owner-users-button owner-users-button--primary"
            disabled={busy || !canManage || loading || workspaceLoading || Boolean(loadError)}
            onClick={() => openEditor()}
          >
            <Plus size={17} aria-hidden="true" />
            {tUi('users.addAccount')}
          </button>
        </header>
      )}

      {loading || workspaceLoading ? (
        <div className="owner-users-card owner-users-empty" role="status">
          {tUi('common.loading')}
        </div>
      ) : !canView ? (
        <div className="owner-users-card owner-users-empty">
          <LockKeyhole size={28} aria-hidden="true" />
          <h2>{tUi('users.ownerOnlyTitle')}</h2>
          <p>{tUi('users.ownerOnly')}</p>
        </div>
      ) : (
        <>
          {loadError && (
            <div className="owner-users-notice owner-users-notice--error" role="alert">
              <span>{loadError}</span>
              <button type="button" className="owner-users-button" onClick={retry}>
                {tUi('common.retry')}
              </button>
            </div>
          )}
          {error && !editorOpen && (
            <p className="owner-users-notice owner-users-notice--error" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="owner-users-notice owner-users-notice--success" role="status">
              <Check size={17} aria-hidden="true" />
              {tUi('users.saved')}
            </p>
          )}
          {!canManage && (
            <p className="owner-users-notice" role="status">
              <LockKeyhole size={17} aria-hidden="true" />
              {tUi('users.readOnly')}
            </p>
          )}
          <nav className="owner-users-tabs" aria-label={tUi('nav.users')}>
            {[
              ['list', UsersRound, 'users.listTab'],
              ['history', History, 'users.historyTab'],
              ['features', Layers, 'users.featuresTab'],
            ].map(([tab, Icon, label]) => (
              <button
                key={tab}
                type="button"
                aria-pressed={activeTab === tab}
                disabled={busy}
                onClick={() => setActiveTab(tab)}
              >
                <Icon size={17} aria-hidden="true" />
                {tUi(label)}
              </button>
            ))}
          </nav>

          {activeTab === 'list' && (
            <>
              <div className="owner-users-summary">
                <div>
                  <span>{tUi('users.totalAccounts')}</span>
                  <strong>{hotelUsers.length}</strong>
                </div>
                <div>
                  <span>{tUi('users.activeAccounts')}</span>
                  <strong>{activeCount}</strong>
                </div>
                <div>
                  <span>{tUi('users.inactiveAccounts')}</span>
                  <strong>{hotelUsers.length - activeCount}</strong>
                </div>
              </div>
              <section className="owner-users-card" aria-labelledby="owner-users-list-title">
                <div className="owner-users-section-heading">
                  <div>
                    <h2 id="owner-users-list-title">{tUi('users.listTab')}</h2>
                    <p data-i18n-ignore>{tenant?.name}</p>
                  </div>
                  <span className="owner-users-result-count">
                    {tUi('users.resultCount', { count: users.length, total: hotelUsers.length })}
                  </span>
                </div>
                <div className="owner-users-filters">
                  <label className="owner-users-search">
                    <Search size={18} aria-hidden="true" />
                    <input
                      type="search"
                      aria-label={labelUi('Tìm người dùng khách sạn')}
                      placeholder={tUi('users.searchPlaceholder')}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label={tUi('users.roleFilter')}
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  >
                    <option value="">{tUi('users.allRoles')}</option>
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {labelUi(ROLE_NAMES[role])}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={tUi('users.statusFilter')}
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">{tUi('common.allStatuses')}</option>
                    <option value="active">{tUi('common.active')}</option>
                    <option value="inactive">{tUi('users.accessRevoked')}</option>
                  </select>
                </div>
                <div className="owner-users-table-scroll">
                  <table className="owner-users-table owner-users-table--accounts" role="table">
                    <thead role="rowgroup">
                      <tr role="row">
                        <th scope="col" role="columnheader">
                          {tUi('users.account')}
                        </th>
                        <th scope="col" role="columnheader">
                          {labelUi('Vai trò')}
                        </th>
                        <th scope="col" role="columnheader">
                          {tUi('common.status')}
                        </th>
                        <th scope="col" role="columnheader">
                          {tUi('common.actions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      {users.map((account) => {
                        const self = account.id === user.id
                        return (
                          <tr key={account.id} role="row">
                            <td role="cell" data-label={tUi('users.account')}>
                              <div className="owner-users-account">
                                <span
                                  className="owner-users-avatar"
                                  aria-hidden="true"
                                  data-i18n-ignore
                                >
                                  {(account.name || account.email || '?')
                                    .trim()
                                    .slice(0, 1)
                                    .toUpperCase()}
                                </span>
                                <div>
                                  <div className="owner-users-name">
                                    <strong data-i18n-ignore>
                                      {account.name || account.email}
                                    </strong>
                                    {self && (
                                      <span className="owner-users-self">{tUi('users.you')}</span>
                                    )}
                                  </div>
                                  <span className="owner-users-email" data-i18n-ignore>
                                    {account.email}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td role="cell" data-label={labelUi('Vai trò')}>
                              <span
                                className={`owner-users-role ${account.role === 'HOTEL_OWNER' ? 'owner-users-role--owner' : ''}`}
                              >
                                {account.role === 'HOTEL_OWNER' && (
                                  <ShieldCheck size={14} aria-hidden="true" />
                                )}
                                {labelUi(ROLE_NAMES[account.role] || account.role)}
                              </span>
                            </td>
                            <td role="cell" data-label={tUi('common.status')}>
                              <span
                                className={`owner-users-status ${account.active ? 'owner-users-status--active' : ''}`}
                              >
                                <span aria-hidden="true" />
                                {account.active ? tUi('common.active') : tUi('users.accessRevoked')}
                              </span>
                            </td>
                            <td role="cell" data-label={tUi('common.actions')}>
                              {self ? (
                                <span className="owner-users-self-lock">
                                  <LockKeyhole size={15} aria-hidden="true" />
                                  {tUi('users.selfProtected')}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="owner-users-button owner-users-button--small"
                                  aria-label={tUi('users.permissionsFor', { email: account.email })}
                                  disabled={busy || !canManage || Boolean(loadError)}
                                  onClick={() => openEditor(account)}
                                >
                                  <SlidersHorizontal size={15} aria-hidden="true" />
                                  {tUi('users.permissions')}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {!users.length && (
                  <div className="owner-users-empty">
                    <UsersRound size={28} aria-hidden="true" />
                    <h3>{tUi(hotelUsers.length ? 'users.noMatches' : 'users.noAccounts')}</h3>
                    <p>
                      {tUi(hotelUsers.length ? 'users.adjustFilters' : 'users.addFirstAccount')}
                    </p>
                    {hotelUsers.length > 0 && (
                      <button
                        type="button"
                        className="owner-users-button"
                        onClick={() => {
                          setQuery('')
                          setRoleFilter('')
                          setStatusFilter('')
                        }}
                      >
                        {tUi('users.clearFilters')}
                      </button>
                    )}
                  </div>
                )}
                <p className="owner-users-table-note">
                  <LockKeyhole size={15} aria-hidden="true" />
                  {tUi('users.selfLocked')}
                </p>
              </section>
            </>
          )}

          {editorOpen && canManage && (
            <FormDialog
              title={draft.id ? tUi('users.editPermissions') : tUi('users.addAccount')}
              busy={busy}
              error={error}
              onClose={closeEditor}
            >
              <form
                className="owner-users-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  save(draft)
                }}
              >
                <fieldset disabled={busy} data-workspace-draft>
                  {draft.id ? (
                    <div className="owner-users-edit-account">
                      <span className="owner-users-avatar" aria-hidden="true" data-i18n-ignore>
                        {(draft.name || draft.email).trim().slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <strong data-i18n-ignore>{draft.name || draft.email}</strong>
                        <span data-i18n-ignore>{draft.email}</span>
                        <p>{tUi('users.editHint')}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <label className="owner-users-existing">
                        <input
                          type="checkbox"
                          checked={draft.existingAccount}
                          onChange={(event) =>
                            setDraft({ ...blankDraft(), existingAccount: event.target.checked })
                          }
                        />
                        <span>
                          <strong>{tUi('users.existingAccount')}</strong>
                          <small>{tUi('users.existingAccountHint')}</small>
                        </span>
                      </label>
                      {!draft.existingAccount && (
                        <label htmlFor="user-name">
                          {tUi('common.fullName')} *
                          <input
                            id="user-name"
                            required
                            pattern=".*\S.*"
                            maxLength={160}
                            autoComplete="name"
                            type="text"
                            value={draft.name}
                            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                          />
                        </label>
                      )}
                      <label htmlFor="user-email">
                        {tUi('common.email')} *
                        <input
                          id="user-email"
                          required
                          pattern={emailPattern}
                          maxLength={254}
                          autoComplete="email"
                          type="email"
                          value={draft.email}
                          onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                        />
                      </label>
                      {!draft.existingAccount && (
                        <>
                          <div className="owner-users-password-fields">
                            <label htmlFor="user-password">
                              {tUi('auth.password')} *
                              <input
                                id="user-password"
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={12}
                                maxLength={128}
                                value={draft.password}
                                onChange={(e) =>
                                  setDraft((d) => ({ ...d, password: e.target.value }))
                                }
                              />
                            </label>
                            <label htmlFor="user-confirm-password">
                              {tUi('profile.confirmPassword')} *
                              <input
                                id="user-confirm-password"
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={12}
                                maxLength={128}
                                value={draft.confirmPassword}
                                onChange={(e) =>
                                  setDraft((d) => ({ ...d, confirmPassword: e.target.value }))
                                }
                              />
                            </label>
                          </div>
                          <p className="owner-users-form-hint">{tUi('users.passwordHint')}</p>
                        </>
                      )}
                    </>
                  )}
                  <label htmlFor="user-role">
                    {labelUi('Vai trò')}
                    <select
                      id="user-role"
                      aria-label={labelUi('Vai trò người dùng')}
                      value={draft.role}
                      onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {labelUi(ROLE_NAMES[role])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="owner-users-role-guide">
                    <ShieldCheck size={19} aria-hidden="true" />
                    <div>
                      <strong>{tUi('users.roleScope')}</strong>
                      <p>{tUi(`users.roleDescription.${draft.role}`)}</p>
                      <small>{tUi('users.roleScopeHint')}</small>
                    </div>
                  </div>
                  <label className="owner-users-activation" htmlFor="activateNow">
                    <input
                      type="checkbox"
                      id="activateNow"
                      checked={draft.active}
                      onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
                    />
                    <span>
                      <strong>{tUi('users.allowAccess')}</strong>
                      <small>{tUi('users.allowAccessHint')}</small>
                    </span>
                  </label>
                  <div className="owner-users-form-actions">
                    <button
                      type="button"
                      className="owner-users-button"
                      disabled={busy}
                      onClick={closeEditor}
                    >
                      {tUi('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      className="owner-users-button owner-users-button--primary"
                      disabled={busy}
                    >
                      {busy
                        ? tUi('common.saving')
                        : draft.id
                          ? tUi('users.savePermissions')
                          : tUi('users.addAccount')}
                    </button>
                  </div>
                </fieldset>
              </form>
            </FormDialog>
          )}

          {activeTab === 'history' && (
            <section className="owner-users-card">
              <div className="owner-users-section-heading">
                <div>
                  <h2>{tUi('users.historyTab')}</h2>
                  <p data-i18n-ignore>{tenant?.name}</p>
                </div>
                <button
                  type="button"
                  className="owner-users-button"
                  disabled={history.loading}
                  onClick={history.refresh}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  {tUi('common.reset')}
                </button>
              </div>
              <div className="owner-users-filters owner-users-audit-filters">
                <label htmlFor="audit-event">
                  {tUi('common.actions')}
                  <select
                    id="audit-event"
                    value={event}
                    onChange={(e) => {
                      setEvent(e.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="">{labelUi('Tất cả hoạt động')}</option>
                    {Object.entries(auditLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {labelUi(label)}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="audit-actor">
                  {labelUi('Người thực hiện')}
                  <select
                    id="audit-actor"
                    value={actor}
                    onChange={(e) => {
                      setActor(e.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="">{labelUi('Tất cả người dùng')}</option>
                    {hotelUsers.map((account) => (
                      <option key={account.id} value={account.id} data-i18n-ignore>
                        {account.name} ({account.email})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {history.loading && (
                <p className="owner-users-empty" role="status">
                  {labelUi('Đang tải nhật ký…')}
                </p>
              )}
              {history.error && (
                <div className="owner-users-empty" role="alert">
                  <p>{history.error}</p>
                  <button type="button" className="owner-users-button" onClick={history.refresh}>
                    {tUi('common.retry')}
                  </button>
                </div>
              )}
              {history.data && (
                <>
                  <div className="owner-users-table-scroll">
                    <table className="owner-users-table">
                      <thead>
                        <tr>
                          <th>{tUi('common.time')}</th>
                          <th>{labelUi('Người thực hiện')}</th>
                          <th>{tUi('common.actions')}</th>
                          <th>{labelUi('Đối tượng')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.data.auditLogs.map((log) => (
                          <tr key={log.id}>
                            <td>
                              {formatDateTime(
                                log.createdAt,
                                tenant?.timezone || 'Asia/Ho_Chi_Minh',
                              )}
                            </td>
                            <td data-i18n-ignore>
                              {log.userName || log.userId || labelUi('Hệ thống')}
                            </td>
                            <td>
                              {auditLabels[log.event] ? labelUi(auditLabels[log.event]) : log.event}
                            </td>
                            <td>
                              {log.entityType === 'user'
                                ? labelUi('Người dùng')
                                : log.entityType === 'feature'
                                  ? tUi('manager.features')
                                  : log.entityType}{' '}
                              · <span data-i18n-ignore>{log.entityId}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!history.data.auditLogs.length && (
                    <p className="owner-users-empty">
                      {labelUi('Không có hoạt động khớp bộ lọc.')}
                    </p>
                  )}
                  <div className="owner-users-pagination">
                    <span>
                      {tUi('users.activityPage', {
                        count: history.data.pagination.totalItems,
                        page,
                      })}
                    </span>
                    <div>
                      <button
                        type="button"
                        className="owner-users-button"
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                        {labelUi('Trang trước')}
                      </button>
                      <button
                        type="button"
                        className="owner-users-button"
                        disabled={page * 25 >= history.data.pagination.totalItems}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        {labelUi('Trang sau')}
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {activeTab === 'features' && (
            <section className="owner-users-card">
              <div className="owner-users-section-heading">
                <div>
                  <h2>{tUi('users.featuresTab')}</h2>
                  <p>
                    {labelUi(
                      'Trạng thái hiện tại được tính từ gói, quyền cấp riêng và cấu hình hệ thống. Liên hệ quản trị viên để thay đổi.',
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className="owner-users-button"
                  disabled={featureAccess.loading}
                  onClick={featureAccess.refresh}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  {tUi('common.reset')}
                </button>
              </div>
              {featureAccess.loading && (
                <p className="owner-users-empty" role="status">
                  {labelUi('Đang tải tính năng…')}
                </p>
              )}
              {featureAccess.error && (
                <div className="owner-users-empty" role="alert">
                  <p>{featureAccess.error}</p>
                  <button
                    type="button"
                    className="owner-users-button"
                    onClick={featureAccess.refresh}
                  >
                    {tUi('common.retry')}
                  </button>
                </div>
              )}
              {featureAccess.data && (
                <div className="owner-users-table-scroll">
                  <table className="owner-users-table">
                    <thead>
                      <tr>
                        <th>{tUi('manager.features')}</th>
                        <th>{labelUi('Trạng thái thao tác')}</th>
                        <th>{labelUi('Quyền cấp riêng')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(featureAccess.data.features)
                        .filter(([code]) => isFeatureVisible(code))
                        .map(([code, enabled]) => {
                          const grant = featureAccess.data.featureOverrides[code]
                          return (
                            <tr key={code}>
                              <td>
                                {labelUi(
                                  FEATURES.find((feature) => feature.code === code)?.name || code,
                                )}
                              </td>
                              <td>
                                <span
                                  className={`owner-users-status ${enabled ? 'owner-users-status--active' : ''}`}
                                >
                                  <span aria-hidden="true" />
                                  {enabled ? labelUi('Đang bật') : labelUi('Đang khóa')}
                                </span>
                              </td>
                              <td>
                                {grant ? (
                                  <>
                                    {grant.isTrial ? labelUi('Dùng thử') : labelUi('Cấp riêng')} ·{' '}
                                    {grant.enabled ? tUi('common.on') : tUi('common.off')}
                                    {grant.expiresAt && (
                                      <>
                                        {' '}
                                        ·{' '}
                                        {tUi('users.grantExpires', {
                                          date: formatDateTime(
                                            grant.expiresAt,
                                            tenant?.timezone || 'Asia/Ho_Chi_Minh',
                                          ),
                                        })}
                                      </>
                                    )}
                                    {grant.notes && (
                                      <div className="owner-users-form-hint" data-i18n-ignore>
                                        {grant.notes}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  labelUi('Theo gói và hệ thống')
                                )}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
