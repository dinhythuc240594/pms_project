import { formatDate } from '../../../../shared/lib/date.js';
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import React from 'react';
import { Link } from 'react-router-dom';
import { usePms } from '../../data/usePms';
import { today, money } from '../../data/model';
import { Users, LogIn, LogOut, Percent, Clock, CheckCircle2, AlertCircle, ArrowUpRight, CalendarDays } from 'lucide-react';
import './Dashboard.css';

export default function Dashboard() {
  useI18n();
  const { settings, getDashboardReport, workspaceRevision } = usePms();
  const date = today(settings.timezone);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [revision, setRevision] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    setData(null);
    getDashboardReport(date).then(res => {
      if (mounted) setData(res);
    }).catch(err => {
      if (mounted) setError(err.message);
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [date, getDashboardReport, revision, workspaceRevision]);

  const { arriving = '—', departing = '—', occupied = '—', activeRooms = 0, chart = [], arrivalBookings = [], departureBookings = [] } = data || {};
  const alerts = data?.alerts;
  const hasFinance = Boolean(data?.financial);

  return (
    <div className="pms-dashboard">
      <div className="pms-dashboard-heading">
        <div>
          <p className="pms-dashboard-eyebrow">{tUi("dashboard.operations")}</p>
          <h1>{tUi("dashboard.today")}</h1>
          <p className="pms-dashboard-subtitle"><CalendarDays size={14} aria-hidden="true" />{' '}{tUi("common.date")}{' '}<time dateTime={date}>{date.split('-').reverse().join('/')}</time></p>
        </div>
      </div>

      {error && <div role="alert" className="pms-dashboard-error"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => setRevision(v => v + 1)}>{tUi("common.retry")}</button></div>}

      <dl className="pms-dashboard-metrics" aria-busy={loading}>
        <MetricCard title={tUi("dashboard.arrivals")} value={String(arriving)} unit={tUi("common.roomsLower")} detail={tUi("dashboard.arrivalsDetail")} icon={<LogIn size={20} />} />
        <MetricCard title={tUi("dashboard.departures")} value={String(departing)} unit={tUi("common.roomsLower")} detail={tUi("dashboard.departuresDetail")} icon={<LogOut size={20} />} />
        <MetricCard title={tUi("dashboard.occupied")} value={String(occupied)} unit={tUi("common.roomsLower")} detail={tUi("dashboard.checkedIn")} icon={<Users size={20} />} />
        <MetricCard title={tUi("dashboard.occupancy")} value={data ? `${Number(data.occupancy).toFixed(1)}%` : '—'} detail={data ? tUi('dashboard.usedRooms', { occupied, total: activeRooms }) : loading ? tUi("common.loadingShort") : tUi("dashboard.noData")} icon={<Percent size={20} />} highlight />
      </dl>

      <p role="status" className="pms-dashboard-sync">
        {loading ? tUi("dashboard.loading") : data ? <><CheckCircle2 size={14} aria-hidden="true" />{' '}{tUi("dashboard.synced")}</> : tUi("dashboard.failed")}
      </p>

      {data && <>
        <div className="pms-dashboard-overview">
          <ChartPanel chart={chart} hasFinance={hasFinance} currency={data.currency} />
          <section className="pms-dashboard-panel pms-dashboard-tasks" aria-labelledby="dashboard-tasks-title">
            <div className="pms-dashboard-panel-heading"><div><h2 id="dashboard-tasks-title">{tUi("dashboard.tasks")}</h2><p>{tUi("dashboard.tasksDetail")}</p></div><Clock size={18} aria-hidden="true" /></div>
            <div className="pms-dashboard-task-list">
              {alerts?.dirtyRooms.length > 0 && <TaskItem icon={<AlertCircle size={18} />} title={tUi('dashboard.dirtyCount', { count: alerts.dirtyRooms.length })} desc={tUi('dashboard.roomPrefix') + alerts.dirtyRooms.map(r => r.number).join(', ')} tone="danger" to="/id/housekeeping/status" />}
              {alerts?.inspectionRooms.length > 0 && <TaskItem icon={<CheckCircle2 size={18} />} title={tUi('dashboard.inspectionCount', { count: alerts.inspectionRooms.length })} desc={tUi('dashboard.roomPrefix') + alerts.inspectionRooms.map(r => r.number).join(', ')} to="/id/housekeeping/status" />}
              {alerts?.overdueDepartures.length > 0 && <TaskItem icon={<Clock size={18} />} title={tUi('dashboard.overdueCount', { count: alerts.overdueDepartures.length })} desc={alerts.overdueDepartures.map(b => b.guest).join(', ')} tone="warning" to="/id/reservations" />}
              {alerts?.pendingArrivals.length > 0 && <TaskItem icon={<Users size={18} />} title={tUi('dashboard.arrivalCount', { count: alerts.pendingArrivals.length })} desc={alerts.pendingArrivals.map(b => b.guest).join(', ')} to="/id/reservations" />}
              {!Object.values(alerts || {}).some(rows => rows.length) && <div className="pms-dashboard-empty"><CheckCircle2 size={24} aria-hidden="true" /><p>{tUi("dashboard.noTasks")}</p></div>}
            </div>
          </section>
        </div>

        <div className="pms-dashboard-bookings">
          <ListContainer title={tUi("dashboard.arrivals")} count={arrivalBookings.length} icon={<LogIn size={18} />}>
            {arrivalBookings.map(b => <ListItem key={b.id} name={b.guest} bookingId={b.id} room={tUi('dashboard.roomPrefix') + b.rooms.join(', ')} time={settings.checkInTime} status={b.balance !== undefined ? tUi('dashboard.balancePrefix') + money(b.balance, b.currency) : 'Chờ nhận phòng'} action="Xem đặt phòng" />)}
            {!arrivalBookings.length && <p className="pms-dashboard-list-empty">{tUi("dashboard.emptyBookings")}</p>}
          </ListContainer>
          <ListContainer title={tUi("dashboard.departures")} count={departureBookings.length} icon={<LogOut size={18} />}>
            {departureBookings.map(b => <ListItem key={b.id} name={b.guest} bookingId={b.id} room={tUi('dashboard.roomPrefix') + b.rooms.join(', ')} time={settings.checkOutTime} status={b.balance !== undefined ? tUi('dashboard.balancePrefix') + money(b.balance, b.currency) : 'Chờ trả phòng'} action="Xem thanh toán" tab="payments" />)}
            {!departureBookings.length && <p className="pms-dashboard-list-empty">{tUi("dashboard.emptyBookings")}</p>}
          </ListContainer>
        </div>
      </>}
    </div>
  );
}

const MetricCard = ({ title, value, unit, detail, icon, highlight }) => { useI18n(); return ((
  <div className={`pms-dashboard-metric${highlight ? ' pms-dashboard-metric-highlight' : ''}`}>
    <dt className="pms-dashboard-metric-top"><span>{labelUi(title)}</span><span className="pms-dashboard-metric-icon" aria-hidden="true">{icon}</span></dt>
    <dd className="pms-dashboard-metric-value"><strong>{value}</strong>{unit && <span>{labelUi(unit)}</span>}</dd>
    <dd className="pms-dashboard-metric-detail">{labelUi(detail)}</dd>
  </div>
)); };

function ChartPanel({ chart, hasFinance, currency }) {
  useI18n();
  const maximumRevenue = Math.max(1, ...chart.map(row => Number(row.realizedRevenue || 0)));
  return (
    <section className="pms-dashboard-panel pms-dashboard-chart-panel" aria-labelledby="dashboard-chart-title">
      <div className="pms-dashboard-panel-heading">
        <div><h2 id="dashboard-chart-title">{hasFinance ? tUi("dashboard.revenueOccupancy") : tUi("dashboard.occupancy")}</h2><p>{tUi("dashboard.lastSeven")}{hasFinance ? ` · ${currency}` : ''}</p></div>
        <Link className="pms-dashboard-text-link" to={hasFinance ? '/id/reports/revenue' : '/id/room-diagram'}>{tUi("common.details")}{' '}<ArrowUpRight size={14} aria-hidden="true" /></Link>
      </div>
      <div className="pms-dashboard-chart-content">
        <div className="pms-dashboard-chart-legend">
          {hasFinance && <span><i className="pms-dashboard-revenue-key" aria-hidden="true" />{tUi("dashboard.revenue")}</span>}
          <span><i className="pms-dashboard-occupancy-key" aria-hidden="true" />{tUi("dashboard.occupancy")}</span>
        </div>
        <div className="pms-dashboard-chart" role="img" aria-label={`${hasFinance ? tUi("dashboard.chart") : tUi("dashboard.occupancyChart")} từng ngày; số liệu chi tiết có trong bảng bên dưới.`}>
          {chart.map(row => <div className="pms-dashboard-chart-column" key={row.date} title={`${formatDate(row.date)}: công suất ${Number(row.occupancy).toFixed(1)}%${hasFinance ? ', doanh thu ghi nhận ' + money(row.realizedRevenue, currency) : ''}`}>
            {hasFinance && <div className="pms-dashboard-revenue-bar" style={{ height: `${Math.max(0, Number(row.realizedRevenue) / maximumRevenue * 100)}%` }} />}
            <div className="pms-dashboard-occupancy-bar" style={{ height: `${Math.min(100, Number(row.occupancy))}%` }} />
          </div>)}
        </div>
        <div className="pms-dashboard-chart-dates" aria-hidden="true">{chart.map(row => <span key={row.date}>{row.date.slice(5).split('-').reverse().join('/')}</span>)}</div>
        <p className="pms-dashboard-chart-note">{hasFinance ? labelUi("Doanh thu ghi nhận từ hóa đơn đã chốt.") + " " : ''}{tUi("dashboard.occupancyHint")}</p>
        <details className="pms-dashboard-chart-details">
          <summary>{tUi("dashboard.dailyFigures")}</summary>
          <div className="pms-dashboard-chart-table-wrap" role="region" aria-label={tUi("dashboard.chartData")} tabIndex={0}>
            <table><caption>{tUi("dashboard.chartDetails")}</caption><thead><tr><th scope="col">{tUi("common.date")}</th><th scope="col">{tUi("dashboard.occupiedRooms")}</th><th scope="col">{tUi("dashboard.occupancyShort")}</th>{hasFinance && <th scope="col">{tUi("dashboard.revenue")}</th>}</tr></thead>
              <tbody>{chart.map(row => <tr key={row.date}><th scope="row">{row.date.split('-').reverse().join('/')}</th><td>{row.occupied}/{row.capacity}</td><td>{Number(row.occupancy).toFixed(1)}%</td>{hasFinance && <td>{money(row.realizedRevenue, currency)}</td>}</tr>)}</tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}

const TaskItem = ({ icon, title, desc, tone = 'info', to }) => { useI18n(); return ((
  <Link className="pms-dashboard-task" to={to}>
    <span className={`pms-dashboard-task-icon pms-dashboard-task-${tone}`} aria-hidden="true">{icon}</span>
    <span className="pms-dashboard-task-copy"><strong>{labelUi(title)}</strong><span>{desc}</span></span>
    <ArrowUpRight size={14} className="pms-dashboard-task-arrow" aria-hidden="true" />
  </Link>
)); };

const ListContainer = ({ title, count, icon, children }) => { useI18n(); return ((
  <section className="pms-dashboard-panel pms-dashboard-booking-panel" aria-label={labelUi(title)}>
    <div className="pms-dashboard-panel-heading">
      <div className="pms-dashboard-list-title"><span aria-hidden="true">{icon}</span><h2>{labelUi(title)}</h2><span className="pms-dashboard-count">{count}</span></div>
      <Link className="pms-dashboard-text-link" to="/id/reservations">{tUi("dashboard.viewAll")}{' '}<ArrowUpRight size={14} aria-hidden="true" /></Link>
    </div>
    <div className="pms-dashboard-booking-list">{children}</div>
  </section>
)); };

const ListItem = ({ name, bookingId, room, time, status, action, tab = 'details' }) => { useI18n(); return ((
  <div className="pms-dashboard-booking">
    <div className="pms-dashboard-guest"><span className="pms-dashboard-avatar" aria-hidden="true">{name.charAt(0)}</span><div><strong>{name}</strong><span className="pms-dashboard-room">{room}</span><span className="pms-dashboard-booking-id">#{bookingId}</span></div></div>
    <div className="pms-dashboard-booking-action"><div className="pms-dashboard-booking-status"><span><Clock size={12} aria-hidden="true" />{time}</span><p>{status}</p></div><Link to={'/id/reservations?' + new URLSearchParams({ booking: bookingId, tab })} aria-label={`${action}: ${name}`}>{labelUi(action)}</Link></div>
  </div>
)); };
