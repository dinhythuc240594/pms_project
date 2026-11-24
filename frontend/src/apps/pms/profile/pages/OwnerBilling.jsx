import { useEffect, useState } from 'react'
import { Download, Printer, RefreshCw, X } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n/useI18n.js'
import { getIntlLocale } from '../../../../shared/i18n/store.js'
import { usePms } from '../../data/usePms.js'
import { money } from '../../data/model.js'
import LegacyOverlay from '../../components/LegacyOverlay.jsx'
import {
  billingDate,
  historyActionLabel,
  invoiceStatusLabel,
  paymentMethodLabel,
  subscriptionStatusLabel,
} from './billingDisplay.js'
import { downloadBillingDocument, openBillingDocument } from './billingDocument.js'
import './OwnerBilling.css'

function useBillingResource(loader, parameter) {
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState(null)
  useEffect(() => {
    let current = true
    Promise.resolve()
      .then(() => loader(parameter))
      .then((result) => {
        if (current) setData({ loader, parameter, revision, result, error: '' })
      })
      .catch((error) => {
        if (current) setData({ loader, parameter, revision, result: null, error: error.message })
      })
    return () => {
      current = false
    }
  }, [loader, parameter, revision])
  const current =
    data?.loader === loader && data?.parameter === parameter && data?.revision === revision
  return {
    loading: !current,
    result: current ? data.result : null,
    error: current ? data.error : '',
    retry: () => setRevision((value) => value + 1),
  }
}

function ResourceState({ resource }) {
  const { t } = useI18n()
  if (resource.loading)
    return (
      <p className="pms-billing-state" role="status">
        {t('common.loading')}
      </p>
    )
  if (resource.error)
    return (
      <div className="pms-billing-state">
        <p className="pms-profile-feedback is-error" role="alert">
          {resource.error}
        </p>
        <button type="button" className="pms-profile-button" onClick={resource.retry}>
          {t('common.retry')}
        </button>
      </div>
    )
  return null
}

function Pagination({ pagination, page, onPage, label }) {
  const { t } = useI18n()
  const pages = Math.max(1, Math.ceil(pagination.totalItems / pagination.pageSize))
  return (
    <nav className="pms-billing-pagination" aria-label={label}>
      <p>
        {t('billing.pagination', {
          total: pagination.totalItems.toLocaleString(getIntlLocale()),
          page: pagination.page,
          pages,
        })}
      </p>
      <div>
        <button
          type="button"
          className="pms-profile-button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {t('billing.previous')}
        </button>
        <button
          type="button"
          className="pms-profile-button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          {t('billing.next')}
        </button>
      </div>
    </nav>
  )
}

function InvoiceAmounts({ invoice }) {
  const { t } = useI18n()
  return (
    <dl className="pms-billing-totals">
      {['amount', 'paid', 'balance'].map((key) => (
        <div key={key}>
          <dt>{t(`billing.${key}`)}</dt>
          <dd>{money(invoice[key], invoice.currency)}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function OwnerBilling() {
  const { t } = useI18n()
  const { getOwnBilling, settings } = usePms()
  const resource = useBillingResource(getOwnBilling)
  const subscription = resource.result?.subscription
  const timezone = settings?.timezone || 'Asia/Ho_Chi_Minh'
  const [invoiceId, setInvoiceId] = useState(null)
  return (
    <div className="pms-billing">
      <section aria-labelledby="pms-billing-title" aria-busy={resource.loading}>
        <div className="pms-profile-section-heading">
          <div>
            <h2 id="pms-billing-title">{t('billing.title')}</h2>
            <p>{t('billing.intro')}</p>
          </div>
          <button
            type="button"
            className="pms-profile-button"
            disabled={resource.loading}
            onClick={resource.retry}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {t('common.reload')}
          </button>
        </div>
        <ResourceState resource={resource} />
        {resource.result && (
          <>
            <div className="pms-billing-subscription">
              <div className="pms-billing-subscription-heading">
                <div>
                  <p>{t('billing.currentPlan')}</p>
                  <h3>{subscription?.planName || t('billing.noSubscription')}</h3>
                </div>
                <span className="pms-billing-status">{subscriptionStatusLabel(subscription)}</span>
              </div>
              {subscription && (
                <dl className="pms-billing-details">
                  <div>
                    <dt>{t('billing.planCode')}</dt>
                    <dd>{subscription.planCode || '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('billing.registeredRooms')}</dt>
                    <dd>{subscription.roomCount ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('billing.startDate')}</dt>
                    <dd>{billingDate(subscription.startDate, timezone)}</dd>
                  </div>
                  <div>
                    <dt>{t('billing.endDate')}</dt>
                    <dd>
                      {subscription.endDate
                        ? billingDate(subscription.endDate, timezone)
                        : t('billing.noExpiry')}
                    </dd>
                  </div>
                </dl>
              )}
              {subscription?.operationalAccess?.active && (
                <p role="status" className="pms-billing-notice">
                  {t('billing.operationalAccess', {
                    until: billingDate(subscription.operationalAccess.until, timezone),
                  })}
                  <br />
                  {t('billing.operationalAccessHint')}
                </p>
              )}
            </div>
            <h3>{t('billing.summary')}</h3>
            <p className="pms-billing-hint">{t('billing.summaryHint')}</p>
            <div className="pms-billing-summary">
              {(resource.result.summary || []).map((row) => (
                <div className="pms-billing-summary-card" key={row.currency}>
                  <strong>{row.currency}</strong>
                  <InvoiceAmounts invoice={row} />
                </div>
              ))}
            </div>
            {!resource.result.summary?.length && (
              <p className="pms-billing-state">{t('billing.noInvoices')}</p>
            )}
          </>
        )}
      </section>
      <Invoices timezone={timezone} onOpen={setInvoiceId} />
      <PlanHistory timezone={timezone} />
      {invoiceId && (
        <InvoiceDocument
          key={invoiceId}
          invoiceId={invoiceId}
          timezone={timezone}
          onClose={() => setInvoiceId(null)}
        />
      )}
    </div>
  )
}

function Invoices({ timezone, onOpen }) {
  const { t } = useI18n()
  const { listOwnBillingInvoices } = usePms()
  const [page, setPage] = useState(1)
  const resource = useBillingResource(listOwnBillingInvoices, page)
  const invoices = resource.result?.invoices || []
  return (
    <section
      className="pms-billing-section"
      aria-labelledby="pms-billing-invoices"
      aria-busy={resource.loading}
    >
      <div className="pms-profile-section-heading">
        <h2 id="pms-billing-invoices">{t('billing.invoices')}</h2>
        <button
          type="button"
          className="pms-profile-button"
          disabled={resource.loading}
          onClick={resource.retry}
          aria-label={t('billing.reloadInvoices')}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
      <ResourceState resource={resource} />
      {resource.result && (
        <>
          <div
            className="pms-billing-table-wrap"
            role="region"
            aria-label={t('billing.invoices')}
            tabIndex={0}
          >
            <table className="pms-billing-table">
              <thead>
                <tr>
                  {['invoice', 'description', 'amount', 'paid', 'balance', 'dueDate'].map((key) => (
                    <th scope="col" key={key}>
                      {t(`billing.${key}`)}
                    </th>
                  ))}
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col">{t('billing.document')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <strong>{invoice.number}</strong>
                      <span className="pms-billing-secondary">
                        {billingDate(invoice.createdAt, timezone, false)}
                      </span>
                    </td>
                    <td className="pms-billing-description">{invoice.description}</td>
                    <td>{money(invoice.amount, invoice.currency)}</td>
                    <td>{money(invoice.paid, invoice.currency)}</td>
                    <td>{money(invoice.balance, invoice.currency)}</td>
                    <td>{billingDate(invoice.dueDate, timezone, false)}</td>
                    <td>
                      <span className={`pms-billing-status is-${invoice.status}`}>
                        {invoiceStatusLabel(invoice.status)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="pms-profile-button"
                        onClick={() => onOpen(invoice.id)}
                        aria-label={t('billing.viewInvoice', { number: invoice.number })}
                      >
                        {t('common.details')}
                      </button>
                    </td>
                  </tr>
                ))}
                {!invoices.length && (
                  <tr>
                    <td colSpan={8}>{t('billing.noInvoices')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            pagination={resource.result.pagination}
            page={page}
            onPage={setPage}
            label={t('billing.invoicePagination')}
          />
        </>
      )}
    </section>
  )
}

function PlanHistory({ timezone }) {
  const { t } = useI18n()
  const { listOwnBillingHistory } = usePms()
  const [page, setPage] = useState(1)
  const resource = useBillingResource(listOwnBillingHistory, page)
  const history = resource.result?.history || []
  return (
    <section
      className="pms-billing-section"
      aria-labelledby="pms-billing-history"
      aria-busy={resource.loading}
    >
      <div className="pms-profile-section-heading">
        <div>
          <h2 id="pms-billing-history">{t('billing.history')}</h2>
          <p>{t('billing.historyHint')}</p>
        </div>
        <button
          type="button"
          className="pms-profile-button"
          disabled={resource.loading}
          onClick={resource.retry}
          aria-label={t('billing.reloadHistory')}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
      <ResourceState resource={resource} />
      {resource.result && (
        <>
          <div
            className="pms-billing-table-wrap"
            role="region"
            aria-label={t('billing.history')}
            tabIndex={0}
          >
            <table className="pms-billing-table">
              <thead>
                <tr>
                  {[
                    'changedAt',
                    'planAction',
                    'registeredRooms',
                    'startDate',
                    'endDate',
                    'planAmount',
                  ].map((key) => (
                    <th key={key} scope="col">
                      {t(`billing.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{billingDate(row.createdAt, timezone)}</td>
                    <td>
                      <strong>{row.planName}</strong>
                      <span className="pms-billing-secondary">
                        {historyActionLabel(row.action)} · {subscriptionStatusLabel(row)}
                      </span>
                    </td>
                    <td>{row.roomCount ?? '—'}</td>
                    <td>{billingDate(row.effectiveDate, timezone)}</td>
                    <td>
                      {row.endDate ? billingDate(row.endDate, timezone) : t('billing.noExpiry')}
                    </td>
                    <td>{row.amount == null ? '—' : money(row.amount, row.currency)}</td>
                  </tr>
                ))}
                {!history.length && (
                  <tr>
                    <td colSpan={6}>{t('billing.noHistory')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            pagination={resource.result.pagination}
            page={page}
            onPage={setPage}
            label={t('billing.historyPagination')}
          />
        </>
      )}
    </section>
  )
}

function InvoiceDocument({ invoiceId, timezone, onClose }) {
  const { t } = useI18n()
  const { getOwnBillingInvoice } = usePms()
  const resource = useBillingResource(getOwnBillingInvoice, invoiceId)
  const invoice = resource.result
  const [printError, setPrintError] = useState('')
  function documentAction(action) {
    setPrintError('')
    try {
      action(invoice, timezone)
    } catch (error) {
      setPrintError(error.message)
    }
  }
  return (
    <LegacyOverlay
      title={t('billing.documentTitle')}
      onClose={onClose}
      modal
      style={{
        zIndex: 120,
        background: 'var(--bg-modal-backdrop, rgba(15, 23, 42, .55))',
        padding: 20,
      }}
    >
      <div className="pms-billing-document" aria-busy={resource.loading}>
        <div className="pms-profile-section-heading">
          <div>
            <h2>{t('billing.documentTitle')}</h2>
            <p>{invoice?.number || ''}</p>
          </div>
          <button
            type="button"
            className="pms-profile-button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="pms-billing-notice">{t('billing.internalNotice')}</p>
        <ResourceState resource={resource} />
        {invoice && (
          <>
            <h3>{invoice.tenantName || invoice.tenantId}</h3>
            <p className="pms-billing-description">{invoice.description}</p>
            <dl className="pms-billing-details">
              <div>
                <dt>{t('billing.issuedAt')}</dt>
                <dd>{billingDate(invoice.createdAt, timezone)}</dd>
              </div>
              <div>
                <dt>{t('billing.dueDate')}</dt>
                <dd>{billingDate(invoice.dueDate, timezone)}</dd>
              </div>
              <div>
                <dt>{t('common.status')}</dt>
                <dd>{invoiceStatusLabel(invoice.status)}</dd>
              </div>
            </dl>
            <InvoiceAmounts invoice={invoice} />
            <h3>{t('billing.payments')}</h3>
            {invoice.payments?.length ? (
              <ul className="pms-billing-payments">
                {invoice.payments.map((payment) => (
                  <li key={payment.id}>
                    <div>
                      <strong>{money(payment.amount, invoice.currency)}</strong>
                      <time dateTime={payment.createdAt}>
                        {billingDate(payment.createdAt, timezone)}
                      </time>
                    </div>
                    <p>
                      {paymentMethodLabel(payment.method)}
                      {payment.reference ? ` · ${payment.reference}` : ''}
                    </p>
                    {payment.note && <p>{payment.note}</p>}
                    <small>{payment.id}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t('billing.noPayments')}</p>
            )}
            {invoice.refunds?.length > 0 && (
              <>
                <h3>{t('billing.refunds')}</h3>
                <ul className="pms-billing-payments">
                  {invoice.refunds.map((refund) => (
                    <li key={refund.id}>
                      <div>
                        <strong>−{money(refund.amount, invoice.currency)}</strong>
                        <time dateTime={refund.createdAt}>
                          {billingDate(refund.createdAt, timezone)}
                        </time>
                      </div>
                      <p>{refund.reason}</p>
                      <small>{refund.paymentId}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {invoice.status === 'void' && (
              <p className="pms-billing-notice">
                {t('billing.voidReason')}: {invoice.voidReason || '—'}
              </p>
            )}
            {printError && (
              <p className="pms-profile-feedback is-error" role="alert">
                {printError}
              </p>
            )}
            <div className="pms-profile-actions">
              <button
                type="button"
                className="pms-profile-button"
                onClick={() => documentAction(downloadBillingDocument)}
              >
                <Download size={16} aria-hidden="true" />
                {t('billing.download')}
              </button>
              <button
                type="button"
                className="pms-profile-button"
                onClick={() => documentAction(openBillingDocument)}
              >
                <Printer size={16} aria-hidden="true" />
                {t('billing.printPreview')}
              </button>
            </div>
          </>
        )}
      </div>
    </LegacyOverlay>
  )
}
