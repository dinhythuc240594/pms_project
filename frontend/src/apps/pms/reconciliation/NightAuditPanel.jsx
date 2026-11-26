import { formatDate, parseIsoDate } from '../../../shared/lib/date.js'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { workflowLink } from './workflowNavigation.js'
import DateInput from '../../../shared/components/DateInput.jsx'
import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCheck,
  ChevronDown,
  Clock3,
  FileText,
  LockKeyhole,
  MoonStar,
  RefreshCw,
  UnlockKeyhole,
} from 'lucide-react'
import { usePms } from '../data/usePms'
import { addDays, money, today } from '../data/model'
import { createIntentJournal } from '../data/api'
import { useDraftGuard } from '../../../shared/drafts/DraftGuardProvider'
import { useI18n } from '../../../shared/i18n/useI18n'
import './NightAuditPanel.css'

// onSummary is optional: it receives { scope, day, status, blockers, locked, busy }
// derived from the single preview read below, or null when this scope unmounts.
export default function NightAuditPanel({ onSummary }) {
  const { tenantId, user, authGeneration } = usePms()
  return (
    <NightAuditForm
      key={JSON.stringify([tenantId, user?.id, authGeneration])}
      onSummary={onSummary}
    />
  )
}

function NightAuditForm({ onSummary }) {
  const { t } = useI18n()
  const { tenantId, user, authGeneration, settings, requestTenant, access, refreshWorkspace } =
    usePms()
  const pms = usePms(),
    location = useLocation()
  const [params, setParams] = useSearchParams()
  const day = params.get('auditDate') ?? addDays(today(settings.timezone), -1)
  const [dayValid, setDayValid] = useState(true)
  const [loaded, setLoaded] = useState(null),
    [reason, setReason] = useState(''),
    [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false),
    [actionError, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const [journal] = useState(() =>
    createIntentJournal(
      (() => {
        try {
          return sessionStorage
        } catch {
          return undefined
        }
      })(),
    ),
  )
  const inFlight = useRef(false),
    scope = `${tenantId}:${user?.id}:${authGeneration}`,
    current = useRef(scope)
  const key = JSON.stringify([scope, day, revision])
  const valid =
    dayValid &&
    Number.isFinite(parseIsoDate(day)) &&
    day >= '0001-01-01' &&
    day <= addDays(today(settings.timezone), -1)
  const preview = valid && loaded?.key === key ? loaded.data : null
  const error = actionError || (loaded?.key === key ? loaded.error : '')
  useEffect(() => {
    current.current = scope
    return () => {
      current.current = null
    }
  }, [scope])
  const report = useRef(onSummary)
  useEffect(() => {
    report.current = onSummary
  }, [onSummary])
  const summaryStatus = !valid ? 'invalid' : preview ? 'ready' : error ? 'error' : 'loading'
  const blockerCount = preview ? preview.blockers.length : null,
    locked = Boolean(preview?.periodLocked)
  useEffect(() => {
    report.current?.({ scope, day, status: summaryStatus, blockers: blockerCount, locked, busy })
  }, [scope, day, summaryStatus, blockerCount, locked, busy])
  useEffect(() => () => report.current?.(null), [])
  useDraftGuard({
    dirty: reason.length > 0,
    pending: () => inFlight.current,
    onDiscard: () => {
      setReason('')
      setAck(false)
    },
  })
  useEffect(() => {
    let mounted = true
    if (!valid) return
    requestTenant('/reconciliation/night-audit?date=' + encodeURIComponent(day))
      .then((data) => {
        if (mounted) setLoaded({ key, data, error: '' })
      })
      .catch((err) => {
        if (mounted) setLoaded({ key, data: null, error: err.message })
      })
    return () => {
      mounted = false
    }
  }, [requestTenant, day, key, valid])
  async function close(event) {
    event.preventDefault()
    if (
      inFlight.current ||
      !valid ||
      !preview ||
      !ack ||
      preview.periodLocked ||
      preview.blockers.length
    )
      return
    inFlight.current = true
    setBusy(true)
    setError('')
    const operationScope = scope
    try {
      const body = { date: day, previewToken: preview.previewToken, reason }
      const intent = await journal.acquire(
        `/api/tenants/${encodeURIComponent(tenantId)}/reconciliation/night-audit`,
        body,
        undefined,
        user?.id,
      )
      if (current.current !== operationScope) return
      const result = await requestTenant('/reconciliation/night-audit', {
        method: 'POST',
        body,
        intent: intent.key,
      })
      journal.confirm(intent)
      if (current.current !== operationScope) return
      setLoaded({ key, data: result, error: '' })
      setReason('')
      setNotice(t('nightAudit.saved'))
      await refreshWorkspace?.({ quiet: true }).catch(() => {})
    } catch (err) {
      if (current.current === operationScope) {
        setError(err.message)
        if (err.code === 'preview_changed') setLoaded(null)
      }
    } finally {
      inFlight.current = false
      if (current.current === operationScope) setBusy(false)
    }
  }
  return (
    <section
      id="night-audit"
      tabIndex={-1}
      className="day-reconciliation-section night-audit-panel"
      aria-labelledby="night-audit-heading"
      data-i18n-ignore
    >
      <header className="night-audit-heading">
        <div className="night-audit-heading-title">
          <span className="night-audit-icon">
            <MoonStar size={20} aria-hidden="true" />
          </span>
          <h2 id="night-audit-heading">{t('nightAudit.title')}</h2>
        </div>
        {preview && (
          <span className={`night-audit-status${preview.periodLocked ? ' is-locked' : ''}`}>
            {preview.periodLocked ? (
              <LockKeyhole size={14} aria-hidden="true" />
            ) : (
              <UnlockKeyhole size={14} aria-hidden="true" />
            )}
            {preview.periodLocked ? t('nightAudit.locked') : t('nightAudit.open')}
          </span>
        )}
      </header>
      <p className="night-audit-policy">{t('nightAudit.policy')}</p>
      <div className="day-reconciliation-filter night-audit-filter">
        <label>
          {t('reconciliation.date')}
          <DateInput
            required
            max={addDays(today(settings.timezone), -1)}
            value={day}
            disabled={busy}
            onValidityChange={setDayValid}
            onChange={(value) => {
              setParams(
                (previous) => {
                  const next = new URLSearchParams(previous)
                  next.set('auditDate', value)
                  return next
                },
                { replace: true },
              )
              setNotice('')
              setError('')
              setAck(false)
            }}
          />
        </label>
        <p className="night-audit-timezone">
          <Clock3 size={15} aria-hidden="true" />
          <span>{settings.timezone}</span>
        </p>
        <button
          type="button"
          disabled={busy || !valid}
          onClick={() => {
            setRevision((value) => value + 1)
            setError('')
            setAck(false)
          }}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {t('reconciliation.reload')}
        </button>
      </div>
      {!valid && (
        <p className="day-reconciliation-error" role="alert">
          {t('reconciliation.invalidDate')}
        </p>
      )}
      {error && (
        <p className="day-reconciliation-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="day-reconciliation-success" role="status">
          {notice}
        </p>
      )}
      {preview && (
        <>
          <p className="night-audit-recognition">
            <FileText size={15} aria-hidden="true" />
            <span>
              {t('nightAudit.recognitionStart', { date: formatDate(preview.recognitionStart) })}
            </span>
            <small>{preview.timezone}</small>
          </p>
          {preview.totals.length > 0 && (
            <div className="day-reconciliation-cards night-audit-totals">
              {preview.totals.map((total) => (
                <div
                  className="day-reconciliation-card night-audit-total"
                  key={`${total.currency}:${total.baseCurrency}`}
                >
                  <span>{t('nightAudit.revenue')}</span>
                  <strong>{money(total.amount, total.currency)}</strong>
                  <small>{money(total.baseAmount, total.baseCurrency)}</small>
                </div>
              ))}
            </div>
          )}
          {!preview.totals.length && (
            <p className="night-audit-empty">{t('nightAudit.noRevenue')}</p>
          )}
          {preview.blockers.length > 0 && (
            <div className="night-audit-blockers" role="status">
              <h3>
                <AlertCircle size={17} aria-hidden="true" />
                {t('nightAudit.blockers')}
                <span>{preview.blockers.length}</span>
              </h3>
              <ul>
                {preview.blockers.map((row) => (
                  <li key={row.bookingId || row.reviewId}>
                    <strong>{row.guest || row.reviewId}</strong>
                    <span>{row.status}</span>
                    {!busy &&
                      (row.bookingId ? (
                        <Link
                          {...workflowLink(
                            '/id/reservations?' +
                              new URLSearchParams({ booking: row.bookingId, tab: 'payments' }),
                            row.bookingId,
                            pms,
                            location,
                          )}
                        >
                          Mở booking để xử lý
                        </Link>
                      ) : (
                        row.reviewId && (
                          <Link
                            {...workflowLink(
                              '/id/settings?' +
                                new URLSearchParams({
                                  section: 'channels',
                                  tab: 'history',
                                  reviewId: row.reviewId,
                                }),
                              row.reviewId,
                              pms,
                              location,
                            )}
                          >
                            Mở hồ sơ OTA cần đối soát
                          </Link>
                        )
                      ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="night-audit-entries">
            <summary>
              <span>
                <FileText size={17} aria-hidden="true" />
                {t('nightAudit.entries', { count: preview.entries.length })}
              </span>
              <ChevronDown size={17} aria-hidden="true" />
            </summary>
            <ul>
              {preview.entries.map((row) => (
                <li key={`${row.sourceKind}:${row.sourceId}`}>
                  <div>
                    <strong>{row.details.room || row.details.bookingId || row.sourceId}</strong>
                    <small>
                      {formatDate(row.sourceDate)} · {row.sourceKind}
                      {row.adjustment ? ` · ${t('nightAudit.adjustment')}` : ''}
                    </small>
                  </div>
                  <span>{money(row.amount, row.currency)}</span>
                </li>
              ))}
            </ul>
          </details>
          {!preview.periodLocked && access('reconciliation.confirm').allowed && (
            <form className="day-reconciliation-dialog night-audit-close-form" onSubmit={close}>
              <label>
                {t('nightAudit.reason')}
                <textarea
                  required
                  maxLength={1000}
                  rows={3}
                  value={reason}
                  disabled={busy}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label className="day-reconciliation-ack">
                <input
                  type="checkbox"
                  required
                  checked={ack}
                  disabled={busy}
                  onChange={(event) => setAck(event.target.checked)}
                />
                <span>{t('nightAudit.acknowledge')}</span>
              </label>
              <div className="night-audit-actions">
                <button
                  className="is-primary"
                  type="submit"
                  disabled={busy || !ack || !reason.trim() || preview.blockers.length > 0}
                >
                  <CheckCheck size={17} aria-hidden="true" />
                  {busy ? t('common.loading') : t('nightAudit.close')}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  )
}
