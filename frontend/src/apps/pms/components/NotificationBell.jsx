import { formatDateTime } from '../../../shared/lib/date.js'
import { t as tUi, tr as labelUi, useI18n } from '../../../shared/i18n/useI18n.js'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  Bell,
  Brush,
  Building2,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  Check,
  CheckCheck,
  ChevronDown,
  CreditCard,
  Inbox as InboxIcon,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { usePms } from '../data/usePms'
import { ROLE_NAMES } from '../data/access'
import LegacyOverlay from './LegacyOverlay'
import { notificationTarget } from './notificationTargets.js'
import './NotificationBell.css'

const badgeRefreshInterval = 60_000

const targetLabels = { reservation: 'Mở đặt phòng', room: 'Mở trạng thái buồng phòng' }
const targetReasons = {
  unsupported: 'Chưa có liên kết trực tiếp cho loại hồ sơ này.',
  invalid: 'Mã hồ sơ trong thông báo không hợp lệ.',
  tenant: 'Hồ sơ thuộc khách sạn khác, không mở được trong khách sạn hiện tại.',
  permission: 'Bạn chưa có quyền xem hồ sơ này.',
  missing: {
    reservation: 'Không có đặt phòng này trong dữ liệu đang tải. Tải lại dữ liệu để kiểm tra.',
    room: 'Không có phòng đang hoạt động này trong dữ liệu đang tải. Tải lại dữ liệu để kiểm tra.',
  },
}
function targetReason(target) {
  const text = targetReasons[target.reason]
  const base = labelUi(
    typeof text === 'string' ? text : text?.[target.kind] || targetReasons.unsupported,
  )
  return target.reason === 'permission' && target.message ? `${base} ${target.message}` : base
}

// Mounted only inside a Router: exposes navigate and reports location changes,
// so the inbox closes only after a navigation was actually committed.
function RouteBridge({ onNavigate, onLocationChange }) {
  const navigate = useNavigate(),
    location = useLocation()
  const seen = useRef(location.key)
  useLayoutEffect(() => {
    onNavigate(navigate)
    return () => {
      onNavigate(null)
    }
  }, [onNavigate, navigate])
  useEffect(() => {
    if (seen.current === location.key) return
    seen.current = location.key
    onLocationChange()
  }, [location.key, onLocationChange])
  return null
}

const eventAppearance = {
  NEW_BOOKING: { icon: CalendarPlus, tone: 'blue' },
  BOOKING_MODIFIED: { icon: CalendarClock, tone: 'blue' },
  BOOKING_CANCELLED: { icon: CalendarX, tone: 'red' },
  CHECKIN_DONE: { icon: LogIn, tone: 'green' },
  CHECKOUT_DONE: { icon: LogOut, tone: 'blue' },
  ROOM_CLEANED: { icon: Brush, tone: 'green' },
  ROOM_MAINTENANCE: { icon: Wrench, tone: 'amber' },
  PAYMENT_RECEIVED: { icon: CreditCard, tone: 'green' },
  OTA_SYNC_ERROR: { icon: TriangleAlert, tone: 'red' },
}

function EventSymbol({ code }) {
  const { icon: Icon, tone } = eventAppearance[code] || { icon: Bell, tone: 'blue' }
  return (
    <span className={`pms-notification-symbol is-${tone}`} aria-hidden="true">
      <Icon size={19} />
    </span>
  )
}

function NotificationLoading() {
  return (
    <div className="pms-notification-loading" role="status">
      <span className="pms-notification-sr-only">{tUi('notification.loading')}</span>
      {[0, 1, 2, 3].map((index) => (
        <div className="pms-notification-skeleton" key={index} aria-hidden="true">
          <span />
          <div>
            <span />
            <span />
            <span />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function NotificationBell() {
  const pms = usePms()
  const routed = useInRouterContext()
  if (!pms.tenantId || !pms.access('notifications.view', undefined, false).allowed) return null
  return (
    <Inbox
      key={`${pms.tenantId}:${pms.user?.id}:${pms.authGeneration}`}
      pms={pms}
      routed={routed}
    />
  )
}

function Inbox({ pms, routed }) {
  const { apiText } = useI18n()
  const panelId = useId(),
    titleId = useId()
  const [open, setOpen] = useState(false),
    [unreadOnly, setUnreadOnly] = useState(false)
  const [items, setItems] = useState([]),
    [unreadCount, setUnreadCount] = useState(0),
    [nextBefore, setNextBefore] = useState(null)
  const [loaded, setLoaded] = useState(null),
    [pendingAction, setPendingAction] = useState(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  const [preferences, setPreferences] = useState(null),
    [editing, setEditing] = useState(false),
    [message, setMessage] = useState('')
  const generation = useRef(0),
    active = useRef(true),
    inFlight = useRef(false)
  const badgeCheckedAt = useRef(null)
  const bridge = useRef(null),
    requestedTarget = useRef(null)
  const registerNavigate = useCallback((value) => {
    bridge.current = value
  }, [])
  const { requestTenant } = pms
  const busy = pendingAction !== null
  const writesPending = pms.pendingRequests?.writes > 0
  const targetScope = {
    tenantId: pms.tenantId,
    bookings: pms.bookings,
    rooms: pms.rooms,
    access: pms.access,
  }
  // Opening a record never marks it read, writes or retries anything.
  function openTarget(target) {
    if (inFlight.current || busy || writesPending || !bridge.current) return
    requestedTarget.current = target.path
    bridge.current(target.path)
  }
  const arrived = useCallback(() => {
    if (!requestedTarget.current) return
    requestedTarget.current = null
    setOpen(false)
  }, [])
  const loading =
    loaded?.requestTenant !== requestTenant ||
    loaded?.unreadOnly !== unreadOnly ||
    loaded?.revision !== revision
  const canConfigure = pms.access('notifications.configure', undefined, true).allowed
  const readMarkerAccess = pms.access('notifications.view', undefined, true)

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    if (open) return
    const controller = new AbortController()
    const { signal } = controller
    let timer
    let reading = false

    function canRefresh() {
      return !signal.aborted && !reading && document.visibilityState !== 'hidden'
    }

    function schedule() {
      window.clearTimeout(timer)
      if (!canRefresh()) return
      const remaining =
        badgeCheckedAt.current === null
          ? 0
          : badgeRefreshInterval - (Date.now() - badgeCheckedAt.current)
      if (remaining > 0) timer = window.setTimeout(refresh, remaining)
      // Start after the parent provider has synchronized its tenant scope.
      else queueMicrotask(refresh)
    }

    async function refresh() {
      if (!canRefresh()) return
      reading = true
      badgeCheckedAt.current = Date.now()
      try {
        const data = await requestTenant('/notifications?limit=1&unread=true', {
          quiet: true,
          signal,
        })
        if (!signal.aborted) setUnreadCount(data.unreadCount)
      } catch {
        // Keep this hotel's last count. The inbox exposes errors when opened.
      } finally {
        reading = false
        schedule()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', schedule)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [open, requestTenant])
  useEffect(() => {
    if (!open) return
    const version = ++generation.current
    let current = true
    requestTenant(
      '/notifications?' +
        new URLSearchParams({ limit: 50, ...(unreadOnly ? { unread: 'true' } : {}) }),
    )
      .then((data) => {
        if (current) {
          setItems(data.items)
          setUnreadCount(data.unreadCount)
          badgeCheckedAt.current = Date.now()
          setNextBefore(data.nextBefore)
          setError('')
        }
      })
      .catch((err) => {
        if (current) {
          setItems([])
          setNextBefore(null)
          setError(err.message)
        }
      })
      .finally(() => {
        if (current && version === generation.current)
          setLoaded({ requestTenant, unreadOnly, revision })
      })
    return () => {
      current = false
    }
  }, [open, requestTenant, unreadOnly, revision])

  async function act(callback, action = 'update') {
    if (inFlight.current) return
    inFlight.current = true
    setPendingAction(action)
    setError('')
    setMessage('')
    try {
      await callback()
    } catch (err) {
      if (active.current) setError(err.message)
    } finally {
      inFlight.current = false
      if (active.current) setPendingAction(null)
    }
  }

  async function markRead(item) {
    if (!readMarkerAccess.allowed) return
    const updated = await pms.requestTenant(
      '/notifications/' + encodeURIComponent(item.id) + '/read',
      { method: 'POST', body: {} },
    )
    if (!active.current) return
    setItems((rows) =>
      unreadOnly
        ? rows.filter((row) => row.id !== item.id)
        : rows.map((row) => (row.id === item.id ? updated : row)),
    )
    setUnreadCount((count) => Math.max(0, count - 1))
  }

  async function loadMore() {
    const version = generation.current
    const data = await pms.requestTenant(
      '/notifications?' +
        new URLSearchParams({
          limit: 50,
          before: nextBefore,
          ...(unreadOnly ? { unread: 'true' } : {}),
        }),
    )
    if (active.current && version === generation.current) {
      setItems((rows) => [...rows, ...data.items])
      setNextBefore(data.nextBefore)
      setUnreadCount(data.unreadCount)
    }
  }

  async function openPreferences(reload = false) {
    setEditing(true)
    if (preferences && !reload) return
    const result = await pms.requestTenant('/notifications/preferences')
    if (active.current) setPreferences(result)
  }

  async function savePreferences(event) {
    event.preventDefault()
    await act(async () => {
      const result = await pms.requestTenant('/notifications/preferences', {
        method: 'PATCH',
        body: { events: preferences.events.map((row) => ({ code: row.code, roles: row.roles })) },
      })
      if (active.current) {
        setPreferences(result)
        setMessage('notification.saved')
      }
    }, 'save-preferences')
  }

  function close() {
    if (!inFlight.current) setOpen(false)
  }
  function reload() {
    if (editing) act(() => openPreferences(true), 'preferences')
    else setRevision((value) => value + 1)
  }

  return (
    <>
      {routed && <RouteBridge onNavigate={registerNavigate} onLocationChange={arrived} />}
      <button
        type="button"
        className="pms-topbar-icon pms-notification-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={
          tUi('notification.title') +
          (unreadCount ? ': ' + tUi('notification.unreadCount', { count: unreadCount }) : '')
        }
        onClick={() => {
          if (!open) {
            setOpen(true)
            if (!loading) setRevision((value) => value + 1)
          }
        }}
      >
        <Bell size={19} aria-hidden="true" />
        {unreadCount > 0 && (
          <span aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <LegacyOverlay
          modal
          title={tUi('notification.title')}
          onClose={close}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: '#102c4b80',
            display: 'grid',
            placeItems: 'center',
            padding:
              'max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
          }}
        >
          <section id={panelId} className="pms-notification-dialog" aria-labelledby={titleId}>
            <header className="pms-notification-heading">
              <span className="pms-notification-emblem" aria-hidden="true">
                <Bell size={22} />
              </span>
              <div className="pms-notification-heading-copy">
                <h2 id={titleId}>{tUi('notification.title')}</h2>
                <p>
                  <Building2 size={13} aria-hidden="true" />
                  <span>{pms.tenant?.name}</span>
                </p>
              </div>
              <span className="pms-notification-count">
                {tUi('notification.unreadCount', { count: unreadCount })}
              </span>
              <button
                type="button"
                className="pms-notification-icon-button"
                disabled={busy}
                aria-label={tUi('errors.close')}
                onClick={close}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="pms-notification-navigation">
              <div
                className="pms-notification-tabs"
                role="group"
                aria-label={tUi('notification.title')}
              >
                <button
                  type="button"
                  className={!editing ? 'is-active' : undefined}
                  aria-pressed={!editing}
                  disabled={busy}
                  onClick={() => {
                    setEditing(false)
                    setError('')
                    setMessage('')
                  }}
                >
                  <InboxIcon size={16} aria-hidden="true" />
                  {tUi('notification.history')}
                </button>
                {canConfigure && (
                  <button
                    type="button"
                    className={editing ? 'is-active' : undefined}
                    aria-pressed={editing}
                    disabled={busy}
                    onClick={() => act(() => openPreferences(), 'preferences')}
                  >
                    <Users size={16} aria-hidden="true" />
                    {tUi('notification.recipients')}
                  </button>
                )}
              </div>
              <button
                type="button"
                className="pms-notification-icon-button"
                disabled={busy || (!editing && loading)}
                aria-label={tUi('common.reload')}
                title={tUi('common.reload')}
                onClick={reload}
              >
                <RefreshCw
                  size={17}
                  className={
                    pendingAction === 'preferences' || (!editing && loading)
                      ? 'pms-notification-spin'
                      : undefined
                  }
                  aria-hidden="true"
                />
              </button>
            </div>

            <div className="pms-notification-feedback" aria-live="polite">
              {error && (
                <div role="alert" className="pms-notification-notice is-error">
                  <TriangleAlert size={17} aria-hidden="true" />
                  <p>{error}</p>
                  <button type="button" disabled={busy || (!editing && loading)} onClick={reload}>
                    {tUi('common.retry')}
                  </button>
                </div>
              )}
              {message && (
                <div role="status" className="pms-notification-notice is-success">
                  <CheckCheck size={17} aria-hidden="true" />
                  <p>{tUi(message)}</p>
                </div>
              )}
              {!editing && !readMarkerAccess.allowed && (
                <div role="status" className="pms-notification-notice">
                  <ShieldCheck size={17} aria-hidden="true" />
                  <p>
                    {readMarkerAccess.message} {tUi('notification.readOnly')}
                  </p>
                </div>
              )}
            </div>

            {editing ? (
              preferences ? (
                <form className="pms-notification-preference-form" onSubmit={savePreferences}>
                  <div className="pms-notification-scroll">
                    <div className="pms-notification-preference-hint">
                      <ShieldCheck size={18} aria-hidden="true" />
                      <p>{tUi('notification.preferenceHint')}</p>
                    </div>
                    <fieldset
                      disabled={busy || !canConfigure}
                      className="pms-notification-preferences"
                    >
                      <legend className="pms-notification-sr-only">
                        {tUi('notification.recipients')}
                      </legend>
                      <table className="pms-notification-preference-table">
                        <thead>
                          <tr>
                            <th scope="col">{tUi('notification.event')}</th>
                            {preferences.availableRoles.map((role) => (
                              <th scope="col" key={role}>
                                {labelUi(ROLE_NAMES[role]) || role}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preferences.events.map((event) => (
                            <tr key={event.code}>
                              <th scope="row">
                                <div>
                                  <EventSymbol code={event.code} />
                                  <span>{apiText(event.name)}</span>
                                </div>
                              </th>
                              {preferences.availableRoles.map((role) => (
                                <td key={role}>
                                  <label className="pms-notification-role-toggle">
                                    <input
                                      type="checkbox"
                                      aria-label={`${apiText(event.name)}: ${labelUi(ROLE_NAMES[role]) || role}`}
                                      checked={event.roles.includes(role)}
                                      onChange={(change) =>
                                        setPreferences((old) => ({
                                          ...old,
                                          events: old.events.map((row) =>
                                            row.code === event.code
                                              ? {
                                                  ...row,
                                                  roles: change.target.checked
                                                    ? [...row.roles, role]
                                                    : row.roles.filter((value) => value !== role),
                                                }
                                              : row,
                                          ),
                                        }))
                                      }
                                    />
                                    <span>{labelUi(ROLE_NAMES[role]) || role}</span>
                                  </label>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </fieldset>
                  </div>
                  <footer className="pms-notification-footer">
                    <button
                      type="submit"
                      className="pms-notification-button is-primary"
                      disabled={busy || !canConfigure}
                    >
                      {pendingAction === 'save-preferences' ? (
                        <LoaderCircle
                          size={16}
                          className="pms-notification-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Check size={16} aria-hidden="true" />
                      )}
                      {pendingAction === 'save-preferences'
                        ? tUi('common.saving')
                        : tUi('notification.saveRecipients')}
                    </button>
                  </footer>
                </form>
              ) : (
                <div className="pms-notification-scroll">
                  {busy ? <NotificationLoading /> : null}
                </div>
              )
            ) : (
              <>
                <div className="pms-notification-toolbar">
                  <div
                    className="pms-notification-filters"
                    role="group"
                    aria-label={tUi('common.list')}
                  >
                    <button
                      type="button"
                      aria-pressed={!unreadOnly}
                      disabled={busy || loading}
                      onClick={() => setUnreadOnly(false)}
                    >
                      {tUi('notification.all')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={unreadOnly}
                      disabled={busy || loading}
                      onClick={() => setUnreadOnly(true)}
                    >
                      {tUi('notification.unread')}
                      <span aria-hidden="true">{unreadCount}</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="pms-notification-button is-quiet"
                    aria-label={tUi('notification.readAll')}
                    title={tUi('notification.readAll')}
                    disabled={busy || loading || !unreadCount || !readMarkerAccess.allowed}
                    onClick={() =>
                      act(async () => {
                        await pms.requestTenant('/notifications/read-all', {
                          method: 'POST',
                          body: {},
                        })
                        if (active.current) setRevision((value) => value + 1)
                      }, 'read-all')
                    }
                  >
                    {pendingAction === 'read-all' ? (
                      <LoaderCircle
                        size={17}
                        className="pms-notification-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <CheckCheck size={17} aria-hidden="true" />
                    )}
                    <span>{tUi('notification.readAll')}</span>
                  </button>
                </div>
                <div className="pms-notification-scroll" aria-busy={loading || undefined}>
                  {loading ? (
                    <NotificationLoading />
                  ) : items.length ? (
                    <ul className="pms-notification-list">
                      {items.map((item) => {
                        const target = notificationTarget(item, targetScope)
                        return (
                          <li className={item.readAt ? undefined : 'is-unread'} key={item.id}>
                            <EventSymbol code={item.eventCode} />
                            <div className="pms-notification-item-copy">
                              <div className="pms-notification-item-heading">
                                <h3>{apiText(item.title)}</h3>
                                {!item.readAt && (
                                  <span
                                    className="pms-notification-unread-dot"
                                    aria-hidden="true"
                                  />
                                )}
                              </div>
                              <p>{apiText(item.body)}</p>
                              <div className="pms-notification-item-meta">
                                <time dateTime={item.createdAt}>
                                  {formatDateTime(item.createdAt, pms.settings.timezone)}
                                </time>
                                <span className={item.readAt ? undefined : 'is-unread'}>
                                  {item.readAt
                                    ? tUi('notification.read')
                                    : tUi('notification.unread')}
                                </span>
                              </div>
                              {target?.status === 'ready' && routed && (
                                <button
                                  type="button"
                                  className="pms-notification-button is-quiet pms-notification-open"
                                  disabled={busy || writesPending}
                                  onClick={() => openTarget(target)}
                                >
                                  <ArrowUpRight size={16} aria-hidden="true" />
                                  {labelUi(targetLabels[target.kind])}
                                </button>
                              )}
                              {target?.status === 'unavailable' && (
                                <p className="pms-notification-target-reason">
                                  {targetReason(target)}
                                </p>
                              )}
                            </div>
                            {!item.readAt && (
                              <button
                                type="button"
                                className="pms-notification-icon-button pms-notification-mark-read"
                                disabled={busy || !readMarkerAccess.allowed}
                                aria-label={tUi('notification.markRead')}
                                title={tUi('notification.markRead')}
                                onClick={() => act(() => markRead(item), item.id)}
                              >
                                {pendingAction === item.id ? (
                                  <LoaderCircle
                                    size={17}
                                    className="pms-notification-spin"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Check size={17} aria-hidden="true" />
                                )}
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    !error && (
                      <div className="pms-notification-empty">
                        <span aria-hidden="true">
                          {unreadOnly ? <CheckCheck size={28} /> : <Bell size={28} />}
                        </span>
                        <h3>
                          {tUi(unreadOnly ? 'notification.caughtUp' : 'notification.emptyTitle')}
                        </h3>
                        <p>{tUi(unreadOnly ? 'notification.emptyUnread' : 'notification.empty')}</p>
                      </div>
                    )
                  )}
                </div>
                {nextBefore && (
                  <footer className="pms-notification-footer is-centered">
                    <button
                      type="button"
                      className="pms-notification-button"
                      disabled={busy || loading}
                      onClick={() => act(loadMore, 'load-more')}
                    >
                      {pendingAction === 'load-more' ? (
                        <LoaderCircle
                          size={16}
                          className="pms-notification-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronDown size={16} aria-hidden="true" />
                      )}
                      {tUi('notification.older')}
                    </button>
                  </footer>
                )}
              </>
            )}
          </section>
        </LegacyOverlay>
      )}
    </>
  )
}
