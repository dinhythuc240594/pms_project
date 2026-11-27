import { formatDate, formatDateTime, parseIsoDate } from '../../../shared/lib/date.js'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { workflowLink } from './workflowNavigation.js'
import DateInput from '../../../shared/components/DateInput.jsx'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  CheckCheck,
  CircleCheck,
  Clock3,
  FileCheck2,
  History,
  Info,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  UserRound,
  Wallet,
} from 'lucide-react'
import { usePms } from '../data/usePms'
import { createIntentJournal } from '../data/api'
import { addDays, today, money } from '../data/model'
import { useI18n } from '../../../shared/i18n/useI18n'
import FormDialog from '../components/FormDialog'
import './DayReconciliation.css'
import NightAuditPanel from './NightAuditPanel'

const intentStorage = () => {
  try {
    return sessionStorage
  } catch {
    return undefined
  }
}

export default function DayReconciliation() {
  const { t } = useI18n()
  const { settings, tenantId, user, authGeneration, requestTenant, access, workspaceRevision } =
    usePms()
  const [params, setParams] = useSearchParams()
  const day = params.get('date') ?? today(settings.timezone)
  const [dayValid, setDayValid] = useState(true)
  const [previewResult, setPreviewResult] = useState(null),
    [historyResult, setHistoryResult] = useState(null)
  const [actionError, setActionError] = useState(''),
    [stalePreview, setStalePreview] = useState(false),
    [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0),
    [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(false),
    [note, setNote] = useState(''),
    [acknowledged, setAcknowledged] = useState(false)
  const [dialogError, setDialogError] = useState(''),
    [notice, setNotice] = useState(''),
    [selectedRecord, setSelectedRecord] = useState(null)
  const [historyRevision, setHistoryRevision] = useState(0),
    [auditSummary, setAuditSummary] = useState(null)
  const [journal] = useState(() => createIntentJournal(intentStorage()))
  const inFlight = useRef(false),
    current = useRef(null)
  const scope = `${tenantId}:${user?.id}:${authGeneration}`
  const maxDay = today(settings.timezone)
  const valid =
    dayValid && Number.isFinite(parseIsoDate(day)) && day >= '0001-01-01' && day <= maxDay
  const canConfirm = access('reconciliation.confirm').allowed
  const previewKey = JSON.stringify([scope, day, revision, workspaceRevision])
  const historyKey = JSON.stringify([previewKey, page, historyRevision])
  const preview = !stalePreview && previewResult?.key === previewKey ? previewResult.data : null
  const history = historyResult?.key === historyKey ? historyResult.data : null
  const error = actionError || (previewResult?.key === previewKey ? previewResult.error : '')
  const historyError = historyResult?.key === historyKey ? historyResult.error : ''
  const loading = valid && previewResult?.key !== previewKey
  const savedView =
    selectedRecord?.scope === scope && selectedRecord?.day === day ? selectedRecord.record : null

  useEffect(() => {
    let mounted = true
    if (valid)
      requestTenant(`/reconciliation?date=${encodeURIComponent(day)}`)
        .then((data) => {
          if (mounted) setPreviewResult({ key: previewKey, data, error: '' })
        })
        .catch((err) => {
          if (mounted) setPreviewResult({ key: previewKey, data: null, error: err.message })
        })
    return () => {
      mounted = false
    }
  }, [requestTenant, previewKey, day, valid])

  useEffect(() => {
    let mounted = true
    if (valid)
      requestTenant(
        `/reconciliation/history?${new URLSearchParams({ date: day, page, pageSize: 10 })}`,
      )
        .then((data) => {
          if (mounted) setHistoryResult({ key: historyKey, data, error: '' })
        })
        .catch((err) => {
          if (mounted) setHistoryResult({ key: historyKey, data: null, error: err.message })
        })
    return () => {
      mounted = false
    }
  }, [requestTenant, historyKey, day, valid, page])

  useEffect(() => {
    current.current = { scope, requestTenant }
    return () => {
      current.current = { scope: null }
    }
  }, [scope, requestTenant])

  function changeDay(value) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('date', value)
        return next
      },
      { replace: true },
    )
    setPage(1)
    setNotice('')
    setNote('')
    setSelectedRecord(null)
    setActionError('')
    setStalePreview(false)
  }
  function reload() {
    setNotice('')
    setActionError('')
    setStalePreview(false)
    setSelectedRecord(null)
    setRevision((value) => value + 1)
  }
  function openConfirmation() {
    setAcknowledged(false)
    setDialogError('')
    setDialog(true)
  }
  async function confirm(event) {
    event.preventDefault()
    if (inFlight.current || !valid || !preview || !acknowledged || !canConfirm) return
    inFlight.current = true
    setBusy(true)
    setDialogError('')
    const operationScope = scope
    const body = { date: day, previewToken: preview.previewToken, note }
    const path = `/api/tenants/${encodeURIComponent(tenantId)}/reconciliation/confirm`
    try {
      const intent = await journal.acquire(path, body, undefined, user?.id)
      if (current.current.scope !== operationScope) return
      const result = await current.current.requestTenant('/reconciliation/confirm', {
        method: 'POST',
        body,
        intent: intent.key,
      })
      journal.confirm(intent)
      if (current.current.scope !== operationScope) return
      setDialog(false)
      setNote('')
      setNotice(t('reconciliation.saved'))
      setSelectedRecord({ scope, day, record: result })
      // History changes after a confirmation; the displayed saved snapshot stays fixed.
      setPage(1)
      setHistoryRevision((value) => value + 1)
    } catch (err) {
      if (current.current.scope === operationScope) {
        if (err.code === 'preview_changed') {
          setDialog(false)
          setStalePreview(true)
          setActionError(err.message)
        } else setDialogError(err.message)
      }
    } finally {
      inFlight.current = false
      if (current.current.scope === operationScope) setBusy(false)
    }
  }

  const data = valid ? savedView?.snapshot || preview : null
  const timestamp = (value, timezone = settings.timezone) => formatDateTime(value, timezone)
  const totalPages = Math.max(1, Math.ceil((history?.pagination.totalItems || 0) / 10))
  // Night Audit summary comes from the panel's own preview read; ignore it unless it matches this scope and audit day.
  const auditDay = params.get('auditDate') ?? addDays(today(settings.timezone), -1)
  const audit = auditSummary?.scope === scope && auditSummary.day === auditDay ? auditSummary : null
  const navBlocked = busy || dialog || Boolean(audit?.busy)
  const stayText = loading ? 'Đang tải…' : 'Chưa có dữ liệu'
  const auditText =
    !audit || audit.status === 'loading'
      ? 'Đang tải…'
      : audit.status === 'invalid'
        ? 'Ngày không hợp lệ'
        : audit.status === 'error'
          ? 'Chưa tải được'
          : audit.locked
            ? 'Đã chốt'
            : `${audit.blockers} vướng mắc`
  const summaryItems = [
    [
      'reconciliation-arrivals',
      t('reconciliation.arrivals'),
      data ? String(data.arrivals.length) : stayText,
      Boolean(data),
      data?.arrivals.length > 0,
    ],
    [
      'reconciliation-departures',
      t('reconciliation.departures'),
      data ? String(data.departures.length) : stayText,
      Boolean(data),
      data?.departures.length > 0,
    ],
    [
      'night-audit',
      `${t('nightAudit.title')} · ${formatDate(auditDay)}`,
      auditText,
      true,
      audit?.status === 'ready' && audit.blockers > 0,
    ],
  ]
  function jump(event, id) {
    event.preventDefault()
    if (navBlocked) return
    const target = document.getElementById(id)
    if (!target) return
    target.scrollIntoView?.({ block: 'start' })
    target.focus({ preventScroll: true })
  }
  return (
    <div className="day-reconciliation" data-i18n-ignore>
      <header className="day-reconciliation-heading">
        <span className="day-reconciliation-heading-icon">
          <CalendarCheck size={25} aria-hidden="true" />
        </span>
        <div>
          <h1>{t('reconciliation.title')}</h1>
          <p>{t('reconciliation.intro')}</p>
        </div>
      </header>
      <section className="day-reconciliation-filter" aria-label={t('reconciliation.current')}>
        <label htmlFor="reconciliation-date">
          {t('reconciliation.date')}
          <DateInput
            id="reconciliation-date"
            required
            value={day}
            max={maxDay}
            disabled={busy || dialog}
            onValidityChange={setDayValid}
            onChange={changeDay}
            aria-invalid={!valid}
            aria-describedby={!valid ? 'reconciliation-date-error' : undefined}
          />
        </label>
        <div className="day-reconciliation-timezone">
          <Clock3 size={17} aria-hidden="true" />
          <p>
            {t('reconciliation.timezone')}
            <strong>{settings.timezone}</strong>
          </p>
        </div>
        <button type="button" disabled={loading || busy || dialog || !valid} onClick={reload}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('reconciliation.reload')}
        </button>
        <p className="day-reconciliation-filter-note">
          <Info size={16} aria-hidden="true" />
          <span>{t('reconciliation.boundary')}</span>
        </p>
      </section>
      <nav className="day-reconciliation-summary" aria-labelledby="reconciliation-summary-heading">
        <h2 id="reconciliation-summary-heading">Cần xử lý</h2>
        <ul>
          {summaryItems.map(([id, label, value, available, attention]) => (
            <li key={id}>
              {available ? (
                <a
                  className={`day-reconciliation-summary-item${attention ? ' is-attention' : ''}`}
                  href={`#${id}`}
                  data-summary={id}
                  aria-disabled={navBlocked || undefined}
                  onClick={(event) => jump(event, id)}
                >
                  <span>{label}</span>
                  <strong>{value}</strong>
                </a>
              ) : (
                <span className="day-reconciliation-summary-item is-unavailable" data-summary={id}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>
      {!valid && (
        <p id="reconciliation-date-error" className="day-reconciliation-error" role="alert">
          {t('reconciliation.invalidDate')}
        </p>
      )}
      {notice && (
        <p className="day-reconciliation-success" role="status">
          <CircleCheck size={18} aria-hidden="true" />
          {notice}
        </p>
      )}
      {error && (
        <div className="day-reconciliation-error" role="alert">
          <p>{error}</p>
          <button type="button" disabled={busy || loading} onClick={reload}>
            {t('reconciliation.retry')}
          </button>
        </div>
      )}
      {loading && (
        <div className="day-reconciliation-loading" role="status">
          <LoaderCircle size={20} aria-hidden="true" />
          {t('reconciliation.loading')}
        </div>
      )}
      {data && (
        <>
          <section
            className="day-reconciliation-overview"
            aria-label={savedView ? t('reconciliation.savedView') : t('reconciliation.current')}
          >
            <div className="day-reconciliation-snapshot">
              <div>
                <h2>
                  <span className={`day-reconciliation-status${savedView ? ' is-saved' : ''}`}>
                    <span aria-hidden="true" />
                    {savedView ? t('reconciliation.savedView') : t('reconciliation.current')}
                  </span>
                </h2>
                <p>
                  {t('reconciliation.captured')}:{' '}
                  <strong>{timestamp(data.generatedAt, data.timezone)}</strong>
                </p>
                {savedView && (
                  <p>
                    {t('reconciliation.by')}: <span>{savedView.actor}</span> ·{' '}
                    {t('reconciliation.savedAt')}: {timestamp(savedView.createdAt, data.timezone)}
                  </p>
                )}
              </div>
              {savedView ? (
                <button type="button" disabled={busy} onClick={() => setSelectedRecord(null)}>
                  <RefreshCw size={15} aria-hidden="true" />
                  {t('reconciliation.backToPreview')}
                </button>
              ) : (
                <span className="day-reconciliation-currency">{data.currency}</span>
              )}
            </div>
            {savedView && (
              <div className="day-reconciliation-notice">
                <FileCheck2 size={18} aria-hidden="true" />
                <div>
                  <p>{t('reconciliation.snapshotNote')}</p>
                  <p className="day-reconciliation-note-text">
                    {savedView.note || t('reconciliation.noNote')}
                  </p>
                </div>
              </div>
            )}
            <div className="day-reconciliation-cards" aria-label={t('reconciliation.cashNote')}>
              {[
                { key: 'receipts', amount: data.summary.cashReceived, Icon: ArrowDownLeft },
                { key: 'refunds', amount: data.summary.cashRefunded, Icon: ArrowUpRight },
                { key: 'net', amount: data.summary.netReceipts, Icon: Wallet },
              ].map(({ key, amount, Icon }) => (
                <div className={`day-reconciliation-card is-${key}`} key={key}>
                  <div className="day-reconciliation-card-label">
                    <span>{t(`reconciliation.${key}`)}</span>
                    <span className="day-reconciliation-card-icon">
                      <Icon size={19} aria-hidden="true" />
                    </span>
                  </div>
                  <strong>{money(amount, data.currency)}</strong>
                </div>
              ))}
            </div>
            <p className="day-reconciliation-help day-reconciliation-overview-note">
              <Info size={15} aria-hidden="true" />
              {t('reconciliation.cashNote')}
            </p>
          </section>
          <div className="day-reconciliation-stays">
            <StayList
              title={t('reconciliation.arrivals')}
              rows={data.arrivals}
              kind="arrivals"
              blocked={busy || dialog}
            />
            <StayList
              title={t('reconciliation.departures')}
              rows={data.departures}
              kind="departures"
              blocked={busy || dialog}
            />
          </div>
          <p className="day-reconciliation-help day-reconciliation-stays-note">
            <Info size={15} aria-hidden="true" />
            {t('reconciliation.historical')}
          </p>
          <section
            className="day-reconciliation-section"
            aria-labelledby="reconciliation-funds-heading"
          >
            <div className="day-reconciliation-section-heading">
              <span className="day-reconciliation-section-icon">
                <Wallet size={19} aria-hidden="true" />
              </span>
              <h2 id="reconciliation-funds-heading">{t('reconciliation.funds')}</h2>
            </div>
            <div className="day-reconciliation-fund-list">
              {data.funds.length ? (
                data.funds.map((fund) => (
                  <article
                    className="day-reconciliation-fund"
                    key={`${fund.fundId}:${fund.currency}`}
                  >
                    <div className="day-reconciliation-fund-name">
                      <span className="day-reconciliation-currency">{fund.currency}</span>
                      <h3>{fund.fund}</h3>
                    </div>
                    <dl>
                      {[
                        ['opening', t('reconciliation.opening')],
                        ['income', t('reconciliation.income')],
                        ['outflow', t('reconciliation.outflow')],
                        ['closing', t('reconciliation.closing')],
                      ].map(([key, label]) => (
                        <div key={key} className={`is-${key}`}>
                          <dt>{label}</dt>
                          <dd>{money(fund[key], fund.currency)}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))
              ) : (
                <div className="day-reconciliation-empty">
                  <Wallet size={26} aria-hidden="true" />
                  <p>{t('reconciliation.emptyFunds')}</p>
                </div>
              )}
            </div>
            <p className="day-reconciliation-help day-reconciliation-section-note">
              <Info size={15} aria-hidden="true" />
              {t('reconciliation.fundNote')}
            </p>
          </section>
          {!savedView && (
            <div className="day-reconciliation-confirm">
              <span className="day-reconciliation-confirm-icon">
                <CheckCheck size={22} aria-hidden="true" />
              </span>
              <div>
                <h3>{t('reconciliation.confirmTitle')}</h3>
                <p className="day-reconciliation-help">
                  {canConfirm ? t('reconciliation.confirmHelp') : t('reconciliation.readOnly')}
                </p>
              </div>
              <button
                type="button"
                className="is-primary"
                disabled={!canConfirm || busy || loading || !preview}
                onClick={openConfirmation}
              >
                <CheckCheck size={18} aria-hidden="true" />
                {t('reconciliation.confirm')}
              </button>
            </div>
          )}
        </>
      )}
      {valid && (
        <section
          className="day-reconciliation-section day-reconciliation-history"
          aria-labelledby="reconciliation-history-heading"
        >
          <div className="day-reconciliation-section-heading">
            <span className="day-reconciliation-section-icon">
              <History size={19} aria-hidden="true" />
            </span>
            <h2 id="reconciliation-history-heading">{t('reconciliation.history')}</h2>
          </div>
          {historyError && (
            <div className="day-reconciliation-error" role="alert">
              <p>
                {t('reconciliation.historyError')} {historyError}
              </p>
              <button type="button" disabled={busy} onClick={reload}>
                {t('reconciliation.retry')}
              </button>
            </div>
          )}
          {!history && !historyError && (
            <p className="day-reconciliation-loading" role="status">
              <LoaderCircle size={18} aria-hidden="true" />
              {t('reconciliation.loading')}
            </p>
          )}
          {history?.confirmations.length === 0 && (
            <div className="day-reconciliation-empty">
              <FileCheck2 size={27} aria-hidden="true" />
              <p>{t('reconciliation.emptyHistory')}</p>
            </div>
          )}
          {history?.confirmations.map((record) => (
            <article
              className={`day-reconciliation-record${savedView?.id === record.id ? ' is-selected' : ''}`}
              key={record.id}
            >
              <span className="day-reconciliation-record-icon">
                <FileCheck2 size={20} aria-hidden="true" />
              </span>
              <div>
                <strong>{timestamp(record.createdAt, record.timezone)}</strong>
                <p className="day-reconciliation-record-actor">
                  <UserRound size={14} aria-hidden="true" />
                  {t('reconciliation.by')}: {record.actor}
                </p>
                <p className="day-reconciliation-note-text">
                  {record.note || t('reconciliation.noNote')}
                </p>
              </div>
              <button
                type="button"
                disabled={busy || dialog}
                aria-pressed={savedView?.id === record.id}
                onClick={() => {
                  setSelectedRecord({ scope, day, record })
                  setNotice('')
                }}
              >
                {t('reconciliation.view')}
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </article>
          ))}
          {totalPages > 1 && (
            <nav className="day-reconciliation-pagination" aria-label={t('reconciliation.history')}>
              <button
                type="button"
                disabled={page === 1 || !history || busy}
                onClick={() => setPage((value) => value - 1)}
              >
                {t('reconciliation.previous')}
              </button>
              <span>
                {t('reconciliation.page')} {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || !history || busy}
                onClick={() => setPage((value) => value + 1)}
              >
                {t('reconciliation.next')}
              </button>
            </nav>
          )}
        </section>
      )}
      {dialog && preview && (
        <FormDialog
          title={t('reconciliation.confirmTitle')}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(false)}
        >
          <form className="day-reconciliation-dialog" onSubmit={confirm} data-i18n-ignore>
            <p>{t('reconciliation.confirmHelp')}</p>
            <dl>
              <div>
                <dt>{t('reconciliation.date')}</dt>
                <dd>
                  {formatDate(day)} · {preview.timezone}
                </dd>
              </div>
              <div>
                <dt>{t('reconciliation.unresolved')}</dt>
                <dd>{preview.arrivals.length + preview.departures.length}</dd>
              </div>
            </dl>
            <label>
              {t('reconciliation.note')}
              <textarea
                value={note}
                maxLength={1000}
                rows={4}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
                aria-describedby="reconciliation-note-hint"
              />
            </label>
            <p id="reconciliation-note-hint" className="day-reconciliation-help">
              {t('reconciliation.noteHint')}
            </p>
            <label className="day-reconciliation-ack">
              <input
                type="checkbox"
                required
                checked={acknowledged}
                disabled={busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>{t('reconciliation.acknowledge')}</span>
            </label>
            <div className="day-reconciliation-dialog-actions">
              <button type="button" disabled={busy} onClick={() => setDialog(false)}>
                {t('reconciliation.cancel')}
              </button>
              <button type="submit" className="is-primary" disabled={busy || !acknowledged}>
                {busy ? t('reconciliation.saving') : t('reconciliation.confirm')}
              </button>
            </div>
          </form>
        </FormDialog>
      )}
      <NightAuditPanel onSummary={setAuditSummary} />
    </div>
  )
}

function StayList({ title, rows, kind, blocked }) {
  const { t } = useI18n()
  const pms = usePms(),
    location = useLocation()
  const Icon = kind === 'arrivals' ? LogIn : LogOut
  return (
    <section
      id={`reconciliation-${kind}`}
      tabIndex={-1}
      className={`day-reconciliation-section day-reconciliation-stay-section is-${kind}`}
    >
      <div className="day-reconciliation-section-heading">
        <span className="day-reconciliation-section-icon">
          <Icon size={19} aria-hidden="true" />
        </span>
        <h2>{title}</h2>
        <span className="day-reconciliation-count">{rows.length}</span>
      </div>
      {rows.length ? (
        <ul className="day-reconciliation-stay-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="day-reconciliation-stay-guest">
                <span className="day-reconciliation-guest-icon">
                  <UserRound size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong>{row.guest}</strong>
                  <small>
                    {t('reconciliation.booking')}: {row.id}
                  </small>
                  {!blocked && (
                    <Link
                      {...workflowLink(
                        '/id/reservations?' +
                          new URLSearchParams({
                            booking: row.id,
                            ...(kind === 'departures' ? { tab: 'payments' } : {}),
                          }),
                        row.id,
                        pms,
                        location,
                      )}
                    >
                      {kind === 'departures'
                        ? 'Mở thanh toán / trả phòng'
                        : 'Mở booking / nhận phòng'}
                    </Link>
                  )}
                </div>
              </div>
              <dl>
                <div>
                  <dt>{t('reconciliation.rooms')}</dt>
                  <dd>{row.rooms.join(', ') || '—'}</dd>
                </div>
                <div>
                  <dt>{t('reconciliation.checkIn')}</dt>
                  <dd>
                    {formatDate(row.checkIn)}
                    <ArrowRight
                      className="day-reconciliation-stay-arrow"
                      size={15}
                      aria-hidden="true"
                    />
                  </dd>
                </div>
                <div>
                  <dt>{t('reconciliation.checkOut')}</dt>
                  <dd>{formatDate(row.checkOut)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <div className="day-reconciliation-empty">
          <CircleCheck size={27} aria-hidden="true" />
          <p>{t('reconciliation.none')}</p>
        </div>
      )}
    </section>
  )
}
