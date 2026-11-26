import { useEffect, useId, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Eye, RefreshCw, Search, UsersRound } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import { ROLE_NAMES } from '../../../pms/data/access.js'
import { formatDateTime } from '../../../../shared/lib/date.js'
import { useI18n } from '../../../../shared/i18n/useI18n.js'
import './CustomerAccounts.css'
import CustomerAccountDetails from './CustomerAccountDetails.jsx'

const PAGE_SIZE = 20
const CUSTOMER_ROLES = ['HOTEL_OWNER', 'FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTANT']

export default function CustomerAccounts() {
  const { t, tr } = useI18n()
  const { listCustomerAccounts, tenants, authGeneration, user } = usePms()
  const { searchQuery = '' } = useOutletContext() || {}
  const [params, setParams] = useSearchParams()
  const tenantId = params.get('tenantId') || ''
  const fieldId = useId()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState(''),
    [active, setActive] = useState('')
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState({ key: '', data: null, error: '' })
  const query = (search || searchQuery).trim()
  const [debouncedSearch, setDebouncedSearch] = useState(query)
  const scope = JSON.stringify([authGeneration, user?.id, user?.globalRole])
  const filterKey = JSON.stringify([scope, query, tenantId, role, active])
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 })
  if (pageState.key !== filterKey) setPageState({ key: filterKey, page: 1 })
  const page = pageState.key === filterKey ? pageState.page : 1
  const requestKey = JSON.stringify([filterKey, page, revision])
  const debouncing = query !== debouncedSearch
  const loading = debouncing || result.key !== requestKey
  const data = loading ? null : result.data
  const error = loading ? '' : result.error
  const accounts = data?.users || []
  const totalItems = data?.pagination?.totalItems || 0
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
  const detailedAccount =
    !loading && selectedRecord?.key === requestKey
      ? accounts.find((account) => account.id === selectedRecord.id)
      : null
  if (selectedRecord && !detailedAccount) setSelectedRecord(null)

  useEffect(() => {
    if (query === debouncedSearch) return
    const timer = setTimeout(() => setDebouncedSearch(query), 250)
    return () => clearTimeout(timer)
  }, [query, debouncedSearch])

  useEffect(() => {
    if (debouncing) return
    let cancelled = false
    listCustomerAccounts({ search: query, tenantId, role, active, page, pageSize: PAGE_SIZE })
      .then((response) => {
        if (!cancelled) setResult({ key: requestKey, data: response, error: '' })
      })
      .catch((failure) => {
        if (!cancelled)
          setResult({
            key: requestKey,
            data: null,
            error: failure.message || t('manager.customers.loadError'),
          })
      })
    return () => {
      cancelled = true
    }
  }, [listCustomerAccounts, debouncing, query, tenantId, role, active, page, requestKey, t])

  function changePage(nextPage) {
    setPageState({ key: filterKey, page: nextPage })
  }
  function changeHotel(id) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (id) next.set('tenantId', id)
      else next.delete('tenantId')
      return next
    })
  }

  return (
    <section
      className="manager-panel customer-directory"
      aria-label={t('manager.customers.directory')}
      data-i18n-ignore
    >
      <header className="customer-directory-heading">
        <span className="customer-directory-heading-icon">
          <UsersRound size={20} aria-hidden="true" />
        </span>
        <div>
          <h2>{t('manager.customers.directory')}</h2>
          <p>{t('manager.customers.intro')}</p>
        </div>
        <button
          type="button"
          className="manager-button"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {t('manager.customers.reload')}
        </button>
      </header>
      <div className="customer-directory-filters">
        <label htmlFor={`${fieldId}-search`}>
          {t('manager.customers.searchLabel')}
          <span className="customer-directory-search">
            <Search size={16} aria-hidden="true" />
            <input
              id={`${fieldId}-search`}
              type="search"
              aria-label={t('manager.customers.searchLabel')}
              maxLength={254}
              placeholder={t('manager.customers.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </span>
        </label>
        <label htmlFor={`${fieldId}-hotel`}>
          {t('manager.customers.hotel')}
          <select
            id={`${fieldId}-hotel`}
            aria-label={t('manager.customers.hotel')}
            value={tenantId}
            onChange={(event) => changeHotel(event.target.value)}
          >
            <option value="">{t('manager.customers.allHotels')}</option>
            {tenantId && !tenants.some((hotel) => hotel.id === tenantId) && (
              <option value={tenantId}>{tenantId}</option>
            )}
            {tenants.map((hotel) => (
              <option key={hotel.id} value={hotel.id}>
                {hotel.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${fieldId}-role`}>
          {t('manager.customers.role')}
          <select
            id={`${fieldId}-role`}
            aria-label={t('manager.customers.role')}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="">{t('manager.customers.allRoles')}</option>
            {CUSTOMER_ROLES.map((value) => (
              <option key={value} value={value}>
                {tr(ROLE_NAMES[value])}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${fieldId}-status`}>
          {t('manager.customers.accountStatus')}
          <select
            id={`${fieldId}-status`}
            aria-label={t('manager.customers.accountStatus')}
            value={active}
            onChange={(event) => setActive(event.target.value)}
          >
            <option value="">{t('manager.customers.allStatuses')}</option>
            <option value="true">{t('common.active')}</option>
            <option value="false">{t('common.inactive')}</option>
          </select>
        </label>
      </div>
      <div className="customer-directory-summary" role="status">
        {loading
          ? t('manager.customers.loading')
          : !error
            ? t('manager.customers.results', { count: totalItems })
            : t('manager.customers.loadError')}
      </div>
      <div
        className="manager-table-wrap"
        role="region"
        aria-label={t('manager.customers.table')}
        tabIndex={0}
      >
        <table className="manager-table customer-directory-table" role="table" aria-busy={loading}>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">
                {t('manager.customers.account')}
              </th>
              <th scope="col" role="columnheader">
                {t('manager.customers.memberships')}
              </th>
              <th scope="col" role="columnheader">
                {t('manager.customers.status')}
              </th>
              <th scope="col" role="columnheader">
                {t('manager.customers.createdAt')}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {loading && (
              <tr role="row">
                <td colSpan={4} role="cell" className="customer-directory-empty">
                  {t('manager.customers.loading')}
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr role="row">
                <td colSpan={4} role="cell">
                  <div className="customer-directory-error" role="alert">
                    <p>{error}</p>
                    <button
                      type="button"
                      className="manager-button"
                      onClick={() => setRevision((value) => value + 1)}
                    >
                      {t('common.retry')}
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {!loading && !error && accounts.length === 0 && (
              <tr role="row">
                <td colSpan={4} role="cell" className="customer-directory-empty">
                  <UsersRound size={28} aria-hidden="true" />
                  <p>{t('manager.customers.empty')}</p>
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              accounts.map((account) => (
                <tr role="row" key={account.id}>
                  <td role="cell" data-label={t('manager.customers.account')}>
                    <div className="customer-directory-identity">
                      <span className="customer-directory-avatar" aria-hidden="true">
                        {(account.name || account.email || '?')
                          .trim()
                          .charAt(0)
                          .toLocaleUpperCase()}
                      </span>
                      <div>
                        <strong>{account.name || '—'}</strong>
                        <small>{account.email}</small>
                      </div>
                    </div>
                  </td>
                  <td role="cell" data-label={t('manager.customers.memberships')}>
                    {/* {account.memberships?.length ? <ul className="customer-directory-memberships">{account.memberships.map(membership => <li key={membership.tenantId}><strong>{membership.tenantName}</strong><span className="customer-directory-role">{tr(ROLE_NAMES[membership.role] || membership.role)}</span>{membership.active === false && <small className="customer-directory-revoked">{t('manager.customers.revoked')}</small>}</li>)}</ul> : <span className="customer-directory-muted">{t('manager.customers.noMemberships')}</span>} */}
                    <button
                      type="button"
                      className="manager-button customer-directory-details-button"
                      aria-label={t('manager.customers.detailsFor', {
                        name: account.name || account.email,
                      })}
                      onClick={() => setSelectedRecord({ key: requestKey, id: account.id })}
                    >
                      <Eye size={15} aria-hidden="true" />
                      {t('manager.customers.details')}
                    </button>
                  </td>
                  <td role="cell" data-label={t('manager.customers.status')}>
                    <span
                      className={`customer-directory-status${account.active ? ' is-active' : ''}`}
                    >
                      <span aria-hidden="true" />
                      {account.active ? t('common.active') : t('common.inactive')}
                    </span>
                  </td>
                  <td
                    role="cell"
                    data-label={t('manager.customers.createdAt')}
                    className="customer-directory-date"
                  >
                    {formatDateTime(account.createdAt)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!error && (
        <nav
          className="customer-directory-pagination"
          aria-label={t('manager.customers.pagination')}
        >
          <span>{t('manager.customers.page', { page, total: totalPages })}</span>
          <div>
            <button
              type="button"
              className="manager-button"
              disabled={loading || page <= 1}
              onClick={() => changePage(page - 1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              {t('manager.customers.previous')}
            </button>
            <button
              type="button"
              className="manager-button"
              disabled={loading || page >= totalPages}
              onClick={() => changePage(page + 1)}
            >
              {t('manager.customers.next')}
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
      {detailedAccount && (
        <CustomerAccountDetails account={detailedAccount} onClose={() => setSelectedRecord(null)} />
      )}
    </section>
  )
}
