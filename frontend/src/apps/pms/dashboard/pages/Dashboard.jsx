import { formatDate } from '../../../../shared/lib/date.js'
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import React from 'react'
import { Link } from 'react-router-dom'
import { usePms } from '../../data/usePms'
import { today, money } from '../../data/model'
import {
  Users,
  LogIn,
  LogOut,
  Percent,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Search,
  X,
  Wallet,
  Receipt,
} from 'lucide-react'
import { dashboardLayout, financeSummary, visibleShortcuts } from '../../data/roleProfiles'
import './Dashboard.css'

// Case- and accent-insensitive matching so "nguyen" finds "Nguyễn".
const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
const searchText = (booking) =>
  fold(
    [booking.id, booking.guest, booking.phone, ...(booking.rooms || [])]
      .filter((value) => value != null && value !== '')
      .join(' '),
  )
// Reservations task URL contract: task + explicit hotel day.
const taskLink = (task, date) => `/id/reservations?task=${task}&date=${date}`

export default function Dashboard() {
  useI18n()
  const { settings, getDashboardReport, workspaceRevision, role, routeAccess } = usePms()
  const layout = dashboardLayout(role)
  const date = today(settings.timezone)
  const [data, setData] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [revision, setRevision] = React.useState(0)
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    let mounted = true
    setLoading(true)
    setError('')
    setData(null)
    getDashboardReport(date)
      .then((res) => {
        if (mounted) setData(res)
      })
      .catch((err) => {
        if (mounted) setError(err.message)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [date, getDashboardReport, revision, workspaceRevision])

  const {
    arriving = '—',
    departing = '—',
    occupied = '—',
    activeRooms = 0,
    chart = [],
    arrivalBookings = [],
    departureBookings = [],
  } = data || {}
  const alerts = data?.alerts
  const hasFinance = Boolean(data?.financial)
  const needle = fold(query.trim())
  const matches = (booking) => !needle || searchText(booking).includes(needle)
  const shownArrivals = arrivalBookings.filter(matches)
  const shownDepartures = departureBookings.filter(matches)
  const finance = financeSummary(data)
  const emptyDetail = loading ? tUi('common.loadingShort') : tUi('dashboard.noData')
  const metricCards = {
    arrivals: {
      title: tUi('dashboard.arrivals'),
      value: String(arriving),
      unit: tUi('common.roomsLower'),
      detail: tUi('dashboard.arrivalsDetail'),
      icon: <LogIn size={20} />,
    },
    departures: {
      title: tUi('dashboard.departures'),
      value: String(departing),
      unit: tUi('common.roomsLower'),
      detail: tUi('dashboard.departuresDetail'),
      icon: <LogOut size={20} />,
    },
    occupied: {
      title: tUi('dashboard.occupied'),
      value: String(occupied),
      unit: tUi('common.roomsLower'),
      detail: tUi('dashboard.checkedIn'),
      icon: <Users size={20} />,
    },
    occupancy: {
      title: tUi('dashboard.occupancy'),
      value: data ? `${Number(data.occupancy).toFixed(1)}%` : '—',
      detail: data ? tUi('dashboard.usedRooms', { occupied, total: activeRooms }) : emptyDetail,
      icon: <Percent size={20} />,
    },
    overdue: {
      title: tUi('roleDashboard.overdue'),
      value: data ? String(alerts?.overdueDepartures?.length ?? 0) : '—',
      unit: tUi('roleDashboard.overdueUnit'),
      detail: data ? tUi('roleDashboard.overdueDetail') : emptyDetail,
      icon: <Clock size={20} />,
    },
    revenue: {
      title: tUi('roleDashboard.revenueToday'),
      value: finance ? money(finance.revenue, data.currency) : '—',
      detail: finance
        ? tUi('roleDashboard.revenueDetail')
        : data
          ? tUi('roleDashboard.noFinance')
          : emptyDetail,
      icon: <Wallet size={20} />,
    },
    balanceDue: {
      title: tUi('roleDashboard.balanceDue'),
      value: finance ? money(finance.balanceDue, data.currency) : '—',
      detail: finance
        ? tUi('roleDashboard.balanceDetail', { currency: data.currency })
        : data
          ? tUi('roleDashboard.noFinance')
          : emptyDetail,
      icon: <Receipt size={20} />,
    },
  }
  const taskItems = {
    dirty: alerts?.dirtyRooms.length > 0 && (
      <TaskItem
        key="dirty"
        icon={<AlertCircle size={18} />}
        title={tUi('dashboard.dirtyCount', { count: alerts.dirtyRooms.length })}
        desc={tUi('dashboard.roomPrefix') + alerts.dirtyRooms.map((r) => r.number).join(', ')}
        tone="danger"
        to="/id/housekeeping/status"
      />
    ),
    inspection: alerts?.inspectionRooms.length > 0 && (
      <TaskItem
        key="inspection"
        icon={<CheckCircle2 size={18} />}
        title={tUi('dashboard.inspectionCount', { count: alerts.inspectionRooms.length })}
        desc={tUi('dashboard.roomPrefix') + alerts.inspectionRooms.map((r) => r.number).join(', ')}
        to="/id/housekeeping/status"
      />
    ),
    overdue: alerts?.overdueDepartures.length > 0 && (
      <TaskItem
        key="overdue"
        icon={<Clock size={18} />}
        title={tUi('dashboard.overdueCount', { count: alerts.overdueDepartures.length })}
        desc={alerts.overdueDepartures.map((b) => b.guest).join(', ')}
        tone="warning"
        to={taskLink('overdue', date)}
      />
    ),
    arrivals: alerts?.pendingArrivals.length > 0 && (
      <TaskItem
        key="arrivals"
        icon={<Users size={18} />}
        title={tUi('dashboard.arrivalCount', { count: alerts.pendingArrivals.length })}
        desc={alerts.pendingArrivals.map((b) => b.guest).join(', ')}
        to={taskLink('arrivals', date)}
      />
    ),
  }
  const shownTasks = layout.tasks.map((key) => taskItems[key]).filter(Boolean)
  const showArrivals = layout.queues.includes('arrivals')
  const showDepartures = layout.queues.includes('departures')
  const overviewFirst = layout.order[0] === 'overview'
  const overview = data && (
    <div className={`pms-dashboard-overview${layout.overview.length === 1 ? ' is-single' : ''}`}>
      {layout.overview.includes('chart') && (
        <ChartPanel chart={chart} hasFinance={hasFinance} currency={data.currency} />
      )}
      {layout.overview.includes('shortcuts') && (
        <ShortcutPanel items={visibleShortcuts(routeAccess)} />
      )}
      {layout.overview.includes('tasks') && (
        <section
          className="pms-dashboard-panel pms-dashboard-tasks"
          aria-labelledby="dashboard-tasks-title"
        >
          <div className="pms-dashboard-panel-heading">
            <div>
              <h2 id="dashboard-tasks-title">{tUi('dashboard.tasks')}</h2>
              <p>{tUi('dashboard.tasksDetail')}</p>
            </div>
            <Clock size={18} aria-hidden="true" />
          </div>
          <div className="pms-dashboard-task-list">
            {shownTasks}
            {!shownTasks.length && (
              <div className="pms-dashboard-empty">
                <CheckCircle2 size={24} aria-hidden="true" />
                <p>{tUi('dashboard.noTasks')}</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )

  return (
    <div className="pms-dashboard">
      <h1 className="visually-hidden">{tUi(layout.titleKey)}</h1>

      {error && (
        <div role="alert" className="pms-dashboard-error">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setRevision((v) => v + 1)}>
            {tUi('common.retry')}
          </button>
        </div>
      )}

      <dl className="pms-dashboard-metrics" aria-busy={loading}>
        {layout.metrics.map((key) => (
          <MetricCard key={key} {...metricCards[key]} highlight={key === layout.highlight} />
        ))}
      </dl>

      <p role="status" className="pms-dashboard-sync">
        {loading ? (
          tUi('dashboard.loading')
        ) : data ? (
          <>
            <CheckCircle2 size={14} aria-hidden="true" /> {tUi('dashboard.synced')}
          </>
        ) : (
          tUi('dashboard.failed')
        )}
      </p>

      {data && (
        <>
          {overviewFirst && overview}
          <section className="pms-dashboard-queues" aria-labelledby="dashboard-queues-title">
            <div className="pms-dashboard-queue-toolbar">
              <h2 id="dashboard-queues-title">{labelUi('Khách đến và khách đi hôm nay')}</h2>
              <div className="pms-dashboard-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  aria-label={labelUi('Tìm khách đến và khách đi hôm nay')}
                  placeholder={labelUi('Tên khách, mã đặt phòng, số phòng…')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    aria-label={labelUi('Xóa tìm kiếm')}
                    onClick={() => setQuery('')}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
              {needle && (
                <p className="pms-dashboard-search-result" role="status">
                  {labelUi('Khớp')} <strong>{shownArrivals.length}</strong>/{arrivalBookings.length}{' '}
                  {labelUi('khách đến')}
                  {' · '}
                  <strong>{shownDepartures.length}</strong>/{departureBookings.length}{' '}
                  {labelUi('khách đi')}
                </p>
              )}
            </div>
            <div
              className={`pms-dashboard-bookings${layout.queues.length === 1 ? ' is-single' : ''}`}
            >
              {showArrivals && (
                <ListContainer
                  id="arrivals"
                  title={tUi('dashboard.arrivals')}
                  shown={shownArrivals.length}
                  total={arrivalBookings.length}
                  filtered={Boolean(needle)}
                  icon={<LogIn size={18} />}
                  to={taskLink('arrivals', date)}
                >
                  {shownArrivals.map((b, index) => (
                    <ListItem
                      key={b.id + ':' + index}
                      booking={b}
                      time={settings.checkInTime}
                      status={
                        b.balance !== undefined
                          ? tUi('dashboard.balancePrefix') + money(b.balance, b.currency)
                          : 'Chờ nhận phòng'
                      }
                      action="Xem đặt phòng"
                    />
                  ))}
                  <QueueEmpty
                    total={arrivalBookings.length}
                    shown={shownArrivals.length}
                    query={query}
                  />
                </ListContainer>
              )}
              {showDepartures && (
                <ListContainer
                  id="departures"
                  title={tUi('dashboard.departures')}
                  shown={shownDepartures.length}
                  total={departureBookings.length}
                  filtered={Boolean(needle)}
                  icon={<LogOut size={18} />}
                  to={taskLink('departures', date)}
                >
                  {shownDepartures.map((b, index) => (
                    <ListItem
                      key={b.id + ':' + index}
                      booking={b}
                      time={settings.checkOutTime}
                      status={
                        b.balance !== undefined
                          ? tUi('dashboard.balancePrefix') + money(b.balance, b.currency)
                          : 'Chờ trả phòng'
                      }
                      action="Xem thanh toán"
                      tab="payments"
                    />
                  ))}
                  <QueueEmpty
                    total={departureBookings.length}
                    shown={shownDepartures.length}
                    query={query}
                  />
                </ListContainer>
              )}
            </div>
          </section>

          {!overviewFirst && overview}
        </>
      )}
    </div>
  )
}

const MetricCard = ({ title, value, unit, detail, icon, highlight }) => {
  useI18n()
  return (
    <div className={`pms-dashboard-metric${highlight ? ' pms-dashboard-metric-highlight' : ''}`}>
      <dt className="pms-dashboard-metric-top">
        <span>{labelUi(title)}</span>
        <span className="pms-dashboard-metric-icon" aria-hidden="true">
          {icon}
        </span>
      </dt>
      <dd className="pms-dashboard-metric-value">
        <strong>{value}</strong>
        {unit && <span>{labelUi(unit)}</span>}
      </dd>
      <dd className="pms-dashboard-metric-detail">{labelUi(detail)}</dd>
    </div>
  )
}

function ChartPanel({ chart, hasFinance, currency }) {
  useI18n()
  const maximumRevenue = Math.max(1, ...chart.map((row) => Number(row.realizedRevenue || 0)))
  return (
    <section
      className="pms-dashboard-panel pms-dashboard-chart-panel"
      aria-labelledby="dashboard-chart-title"
    >
      <div className="pms-dashboard-panel-heading">
        <div>
          <h2 id="dashboard-chart-title">
            {hasFinance ? tUi('dashboard.revenueOccupancy') : tUi('dashboard.occupancy')}
          </h2>
          <p>
            {tUi('dashboard.lastSeven')}
            {hasFinance ? ` · ${currency}` : ''}
          </p>
        </div>
        <Link
          className="pms-dashboard-text-link"
          to={hasFinance ? '/id/reports/revenue' : '/id/room-diagram'}
        >
          {tUi('common.details')} <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <div className="pms-dashboard-chart-content">
        <div className="pms-dashboard-chart-legend">
          {hasFinance && (
            <span>
              <i className="pms-dashboard-revenue-key" aria-hidden="true" />
              {tUi('dashboard.revenue')}
            </span>
          )}
          <span>
            <i className="pms-dashboard-occupancy-key" aria-hidden="true" />
            {tUi('dashboard.occupancy')}
          </span>
        </div>
        <div
          className="pms-dashboard-chart"
          role="img"
          aria-label={`${hasFinance ? tUi('dashboard.chart') : tUi('dashboard.occupancyChart')} từng ngày; số liệu chi tiết có trong bảng bên dưới.`}
        >
          {chart.map((row) => (
            <div
              className="pms-dashboard-chart-column"
              key={row.date}
              title={`${formatDate(row.date)}: công suất ${Number(row.occupancy).toFixed(1)}%${hasFinance ? ', doanh thu ghi nhận ' + money(row.realizedRevenue, currency) : ''}`}
            >
              {hasFinance && (
                <div
                  className="pms-dashboard-revenue-bar"
                  style={{
                    height: `${Math.max(0, (Number(row.realizedRevenue) / maximumRevenue) * 100)}%`,
                  }}
                />
              )}
              <div
                className="pms-dashboard-occupancy-bar"
                style={{ height: `${Math.min(100, Number(row.occupancy))}%` }}
              />
            </div>
          ))}
        </div>
        <div className="pms-dashboard-chart-dates" aria-hidden="true">
          {chart.map((row) => (
            <span key={row.date}>{row.date.slice(5).split('-').reverse().join('/')}</span>
          ))}
        </div>
        <p className="pms-dashboard-chart-note">
          {hasFinance ? labelUi('Doanh thu ghi nhận từ hóa đơn đã chốt.') + ' ' : ''}
          {tUi('dashboard.occupancyHint')}
        </p>
        <details className="pms-dashboard-chart-details">
          <summary>{tUi('dashboard.dailyFigures')}</summary>
          <div
            className="pms-dashboard-chart-table-wrap"
            role="region"
            aria-label={tUi('dashboard.chartData')}
            tabIndex={0}
          >
            <table>
              <caption>{tUi('dashboard.chartDetails')}</caption>
              <thead>
                <tr>
                  <th scope="col">{tUi('common.date')}</th>
                  <th scope="col">{tUi('dashboard.occupiedRooms')}</th>
                  <th scope="col">{tUi('dashboard.occupancyShort')}</th>
                  {hasFinance && <th scope="col">{tUi('dashboard.revenue')}</th>}
                </tr>
              </thead>
              <tbody>
                {chart.map((row) => (
                  <tr key={row.date}>
                    <th scope="row">{row.date.split('-').reverse().join('/')}</th>
                    <td>
                      {row.occupied}/{row.capacity}
                    </td>
                    <td>{Number(row.occupancy).toFixed(1)}%</td>
                    {hasFinance && <td>{money(row.realizedRevenue, currency)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  )
}

function ShortcutPanel({ items }) {
  useI18n()
  return (
    <section
      className="pms-dashboard-panel pms-dashboard-tasks"
      aria-labelledby="dashboard-shortcuts-title"
    >
      <div className="pms-dashboard-panel-heading">
        <div>
          <h2 id="dashboard-shortcuts-title">{tUi('roleDashboard.shortcuts')}</h2>
          <p>{tUi('roleDashboard.shortcutsDetail')}</p>
        </div>
        <Wallet size={18} aria-hidden="true" />
      </div>
      <div className="pms-dashboard-task-list">
        {items.map((item) => (
          <TaskItem
            key={item.path}
            icon={<ArrowUpRight size={18} />}
            title={tUi(item.labelKey)}
            to={item.path}
          />
        ))}
      </div>
    </section>
  )
}

const TaskItem = ({ icon, title, desc, tone = 'info', to }) => {
  useI18n()
  return (
    <Link className="pms-dashboard-task" to={to}>
      <span className={`pms-dashboard-task-icon pms-dashboard-task-${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span className="pms-dashboard-task-copy">
        <strong>{labelUi(title)}</strong>
        <span>{desc}</span>
      </span>
      <ArrowUpRight size={14} className="pms-dashboard-task-arrow" aria-hidden="true" />
    </Link>
  )
}

const QueueEmpty = ({ total, shown, query }) => {
  useI18n()
  if (shown) return null
  return (
    <p className="pms-dashboard-list-empty">
      {total
        ? `${labelUi('Không có khách khớp')} “${query.trim()}”.`
        : tUi('dashboard.emptyBookings')}
    </p>
  )
}

const ListContainer = ({ id, title, shown, total, filtered, icon, to, children }) => {
  useI18n()
  return (
    <section
      className="pms-dashboard-panel pms-dashboard-booking-panel"
      aria-label={labelUi(title)}
      data-queue={id}
    >
      <div className="pms-dashboard-panel-heading">
        <div className="pms-dashboard-list-title">
          <span aria-hidden="true">{icon}</span>
          <h2>{labelUi(title)}</h2>
          <span
            className="pms-dashboard-count"
            aria-label={
              filtered ? `${shown} / ${total} ${labelUi('khớp tìm kiếm')}` : String(total)
            }
          >
            {filtered ? `${shown}/${total}` : total}
          </span>
        </div>
        <Link className="pms-dashboard-text-link" to={to}>
          {tUi('dashboard.viewAll')} <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <div
        className="pms-dashboard-booking-list"
        role="region"
        aria-label={`${labelUi(title)}: ${labelUi('danh sách có thể cuộn')}`}
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  )
}

const ListItem = ({ booking, time, status, action, tab }) => {
  useI18n()
  const { id: bookingId, guest: name = '', rooms = [], checkIn, checkOut, phone } = booking
  return (
    <div className="pms-dashboard-booking">
      <div className="pms-dashboard-guest">
        <span className="pms-dashboard-avatar" aria-hidden="true">
          {name.charAt(0)}
        </span>
        <div>
          <strong>{name}</strong>
          <span className="pms-dashboard-room">
            {tUi('dashboard.roomPrefix') + rooms.join(', ')}
          </span>
          {checkIn && checkOut && (
            <span className="pms-dashboard-room pms-dashboard-stay">
              {formatDate(checkIn)}
              <span aria-hidden="true"> → </span>
              <span className="pms-dashboard-sr"> {labelUi('đến')} </span>
              {formatDate(checkOut)}
            </span>
          )}
          {phone && <span className="pms-dashboard-room">{phone}</span>}
          <span className="pms-dashboard-booking-id">#{bookingId}</span>
        </div>
      </div>
      <div className="pms-dashboard-booking-action">
        <div className="pms-dashboard-booking-status">
          <span>
            <Clock size={12} aria-hidden="true" />
            {time}
          </span>
          <p>{status}</p>
        </div>
        <Link
          to={`/id/reservations?booking=${encodeURIComponent(bookingId)}${tab ? `&tab=${tab}` : ''}`}
          aria-label={`${action}: ${name}`}
        >
          {labelUi(action)}
        </Link>
      </div>
    </div>
  )
}
