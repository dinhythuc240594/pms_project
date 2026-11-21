import DateInput from '../../../../shared/components/DateInput.jsx'
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import React, { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { usePms } from '../../data/usePms'
import { timestamp } from '../../data/presentation'
import { bookingRooms, bookingRoomStays, today } from '../../data/model'
import { isClosed, taskKinds } from '../planCalendar'
import {
  Search,
  Download,
  CheckCircle,
  Clock,
  AlertCircle,
  Calendar,
  User,
  History,
} from 'lucide-react'
import { downloadCsv } from '../../../../shared/lib/csv'
import './Housekeeping.css'

const HISTORY_PAGE_SIZE = 50
// Read-only queue presets. They only narrow the loaded rows and never trigger a write.
const queuePresets = [
  ['all', 'Tất cả'],
  ['unassigned', 'Chưa giao'],
  ['working', 'Đang dọn'],
  ['inspection', 'Chờ kiểm tra'],
  ['arrival', 'Cần cho khách đến'],
]
const matchesPreset = (row, preset) => preset === 'all' || Boolean(row.queue[preset])
const isoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const displayDate = (value) => value.split('-').reverse().join('/')
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
const hasControlChars = (value) =>
  [...value].some((char) => {
    const code = char.charCodeAt(0)
    return code < 32 || (code >= 127 && code <= 159)
  })

// Room target contract: /id/housekeeping/status?room=<exact room.id, 1..64 chars>. Read only, derived on every render.
function readRoomTarget(pathname, searchParams, rooms) {
  if (!pathname.replace(/\/+$/, '').endsWith('/housekeeping/status')) return null
  const values = searchParams.getAll('room')
  if (!values.length) return null
  if (values.length > 1) return { state: 'invalid' }
  const raw = values[0]
  if (!raw) return { state: 'empty' }
  if (
    Array.from(raw).length > 64 ||
    hasControlChars(raw) ||
    (typeof raw.isWellFormed === 'function' && !raw.isWellFormed())
  )
    return { state: 'invalid' }
  const room = rooms.find((row) => String(row.id) === raw)
  return room && room.active !== false ? { state: 'found', raw } : { state: 'missing', raw }
}

export default function Housekeeping() {
  useI18n()
  const [selectedTab, setSelectedTab] = useState('status') // 'status' or 'history'
  const [startValid, setStartValid] = useState(true),
    [endValid, setEndValid] = useState(true)

  const {
    rooms,
    bookings,
    cleanRoom,
    dirtyRoom,
    housekeepingLog,
    housekeepingWorkLogs,
    housekeepingTasks,
    housekeepingStaff,
    setCondition,
    roomTypes,
    settings,
    access,
    runAction,
  } = usePms()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [conditionFilter, setConditionFilter] = useState('')
  const [bookingFilter, setBookingFilter] = useState('')
  const [staffFilter, setStaffFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [preset, setPreset] = useState('all')
  const [historyFilter, setHistoryFilter] = useState({
    start: today(settings.timezone),
    end: today(settings.timezone),
    room: '',
    actor: '',
  })
  const [historyPage, setHistoryPage] = useState(1)
  const target = readRoomTarget(location.pathname, searchParams, rooms)
  // A room target always shows the status view; the chosen tab is kept for when the target is cleared.
  const activeTab = target ? 'status' : selectedTab
  const day = today(settings.timezone)

  const allRows = rooms
    .filter((r) => r.active !== false)
    .map((r) => {
      const roomId = String(r.id)
      const openTasks = housekeepingTasks.filter(
        (task) => String(task.room) === roomId && !isClosed(task),
      )
      const dated = openTasks.filter((task) => isoDate(task.date)).sort(byDate)
      // Explicit identity: today's task, else the earliest open past task, else the earliest future task.
      const task =
        dated.find((row) => row.date === day) ||
        dated.find((row) => row.date < day) ||
        dated.find((row) => row.date > day) ||
        openTasks[0]
      const currentTasks = dated.filter((row) => row.date <= day)
      const currentTask = task && currentTasks.includes(task) ? task : null
      const worker = housekeepingStaff.find((worker) => worker.id === task?.staffId)
      const booking = bookings.find(
        (b) => bookingRooms(b).includes(roomId) && b.status === 'IN_HOUSE',
      )
      const arrivalBooking = bookings.find(
        (b) =>
          b.status === 'CONFIRMED' &&
          b.checkIn === day &&
          bookingRoomStays(b).some(
            (stay) => String(stay.room) === roomId && stay.start <= day && day < stay.end,
          ),
      )
      const arrivalTask = dated.find((row) => row.kind === 'arrival' && row.date === day)
      const queue = {
        unassigned:
          Boolean(currentTask && !currentTask.staffId) ||
          (r.condition === 'dirty' && !openTasks.length),
        working: currentTask?.status === 'in_progress',
        inspection: r.condition === 'inspection' || currentTask?.status === 'inspection',
        arrival:
          Boolean(arrivalBooking || arrivalTask) &&
          (r.condition !== 'clean' || currentTasks.length > 0),
      }
      const reason = !queue.arrival
        ? ''
        : arrivalBooking
          ? labelUi('Khách đến hôm nay')
          : `${labelUi('Việc dọn')}: ${labelUi(taskKinds.arrival)}`
      const taskWhen =
        !task || !isoDate(task.date)
          ? ''
          : task.date === day
            ? labelUi('Việc hôm nay')
            : task.date < day
              ? `${labelUi('Việc ngày')} ${displayDate(task.date)}`
              : `${labelUi('Đã lên lịch')} ${displayDate(task.date)}`
      return {
        id: 'R-' + r.id,
        number: r.id,
        typeId: r.typeId,
        condition: r.condition,
        booking: booking ? 'Đang ở' : 'Trống',
        hkCode: booking
          ? 'OCC'
          : r.condition === 'maintenance'
            ? 'OOO'
            : r.condition === 'inspection'
              ? 'VI'
              : r.condition === 'dirty'
                ? 'VD'
                : 'VC',
        hkDesc: booking
          ? 'Khách đang ở (' + booking.guest + ')'
          : r.condition === 'maintenance'
            ? 'Phòng bảo trì'
            : r.condition === 'inspection'
              ? 'Phòng chờ kiểm tra'
              : r.condition === 'dirty'
                ? 'Phòng trống cần dọn'
                : 'Phòng trống sạch',
        staff: worker?.name || '',
        staffId: task?.staffId,
        taskId: task?.id,
        taskDate: task?.date || '',
        note: task?.note || '',
        hasOpenTask: openTasks.length > 0,
        queue,
        reason,
        taskWhen,
      }
    })
  const baseRows = allRows.filter(
    (r) =>
      r.id.includes(query) &&
      (!conditionFilter || r.condition === conditionFilter) &&
      (!bookingFilter || r.booking === bookingFilter) &&
      (!typeFilter || r.typeId === typeFilter) &&
      (!staffFilter || r.staffId === staffFilter),
  )
  const presetCounts = Object.fromEntries(
    queuePresets.map(([id]) => [id, baseRows.filter((row) => matchesPreset(row, id)).length]),
  )
  const roomStatusList = target
    ? target.state === 'found'
      ? allRows.filter((row) => String(row.number) === target.raw)
      : []
    : baseRows.filter((row) => matchesPreset(row, preset))

  const allHistory = [
    ...housekeepingLog,
    ...housekeepingWorkLogs.filter((log) => !log.condition && log.room),
  ].map((log) => ({
    ...log,
    sortAt: Date.parse(log.createdAt || log.at) || 0,
    date: new Date(log.createdAt || log.at).toLocaleDateString('en-CA', {
      timeZone: settings.timezone,
    }),
    time: timestamp(log.createdAt || log.at, settings.timezone),
    user: log.actor || log.actorName || log.actorId || '—',
    room: 'R-' + log.room,
    action:
      {
        clean: 'Phòng sạch',
        dirty: 'Phòng bẩn',
        maintenance: 'Phòng bảo trì',
        inspection: 'Đang kiểm tra',
      }[log.condition] ||
      {
        'housekeeping.task_created': 'Tạo việc dọn',
        'housekeeping.task_assigned': 'Phân công',
        'housekeeping.task_superseded': 'Hủy việc cũ',
      }[log.action] ||
      'Cập nhật công việc',
    note: log.note || log.details?.note || '',
  }))
  const historyList = (!startValid || !endValid ? [] : allHistory)
    .filter(
      (log) =>
        (!historyFilter.start || log.date >= historyFilter.start) &&
        (!historyFilter.end || log.date <= historyFilter.end) &&
        (!historyFilter.room || log.room === historyFilter.room) &&
        (!historyFilter.actor || log.user === historyFilter.actor),
    )
    .sort((a, b) => b.sortAt - a.sortAt)
  const historyPages = Math.max(1, Math.ceil(historyList.length / HISTORY_PAGE_SIZE))
  // Clamp on render so a shrinking dataset never leaves an empty page behind.
  const currentHistoryPage = Math.min(Math.max(1, historyPage), historyPages)
  const historyFrom = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE
  const historyRows = historyList.slice(historyFrom, historyFrom + HISTORY_PAGE_SIZE)
  const updateHistoryFilter = (patch) => {
    setHistoryFilter((f) => ({ ...f, ...patch }))
    setHistoryPage(1)
  }

  function clearTarget() {
    setSelectedTab('status')
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete('room')
        return next
      },
      { replace: true },
    )
  }
  function chooseTab(tab) {
    if (tab === 'history' && target) clearTarget()
    setSelectedTab(tab)
  }
  function exportHousekeeping() {
    if (activeTab === 'history' && (!startValid || !endValid)) return
    if (activeTab === 'status' && target && target.state !== 'found') return
    if (activeTab === 'history')
      downloadCsv(
        ['Ngày', 'Thời gian', 'Phòng', 'Nhân viên', 'Thao tác', 'Ghi chú'],
        historyList.map((row) => [row.date, row.time, row.room, row.user, row.action, row.note]),
        'lich-su-buong-phong.csv',
      )
    else
      downloadCsv(
        ['Phòng', 'Loại phòng', 'Tình trạng', 'Lưu trú', 'Mã buồng phòng', 'Nhân viên', 'Ghi chú'],
        roomStatusList.map((row) => [
          row.number,
          roomTypes.find((type) => type.id === row.typeId)?.name || '',
          { clean: 'Sạch', dirty: 'Bẩn', inspection: 'Kiểm tra', maintenance: 'Bảo trì' }[
            row.condition
          ],
          row.booking,
          row.hkCode,
          row.staff,
          row.note,
        ]),
        'buong-phong.csv',
      )
  }

  // Helpers for UI Badges
  const getConditionBadge = (condition) => {
    if (condition === 'clean')
      return (
        <span
          style={{
            ...badgeStyle,
            backgroundColor: '#d1fae5',
            color: '#059669',
            border: '1px solid #10b981',
          }}
        >
          <CheckCircle size={14} /> {tUi('hk.cleanRoom')}
        </span>
      )
    if (condition === 'dirty')
      return (
        <span
          style={{
            ...badgeStyle,
            backgroundColor: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #ef4444',
          }}
        >
          <AlertCircle size={14} /> {tUi('hk.dirtyRoom')}
        </span>
      )
    return (
      <span style={badgeStyle}>
        {condition === 'maintenance'
          ? tUi('hk.maintenanceRoom')
          : condition === 'inspection'
            ? tUi('hk.inspecting')
            : condition}
      </span>
    )
  }

  const getHkCodeBadge = (code) => {
    switch (code) {
      case 'VC':
        return <span style={{ ...hkBadgeStyle, backgroundColor: '#10b981' }}>VC</span> // Vacant Clean
      case 'VD':
        return <span style={{ ...hkBadgeStyle, backgroundColor: '#ef4444' }}>VD</span> // Vacant Dirty
      case 'OCC':
        return <span style={{ ...hkBadgeStyle, backgroundColor: '#3b82f6' }}>OCC</span> // Occupied Clean
      default:
        return <span style={{ ...hkBadgeStyle, backgroundColor: '#6b7280' }}>{code}</span>
    }
  }

  const statusLabels = [
    tUi('common.room'),
    tUi('hk.condition'),
    tUi('hk.systemStatus'),
    tUi('hk.hkCode'),
    tUi('hk.assignment'),
    tUi('common.notes'),
  ]
  const historyLabels = [
    tUi('common.time'),
    tUi('hk.operator'),
    tUi('common.room'),
    tUi('hk.actionStatus'),
    tUi('common.notes'),
  ]
  const targetMessage = !target
    ? ''
    : target.state === 'found'
      ? `${labelUi('Đang xem phòng')} ${target.raw}`
      : target.state === 'missing'
        ? labelUi('Không tìm thấy phòng trong liên kết hoặc phòng đã ngừng hoạt động.')
        : target.state === 'empty'
          ? labelUi('Liên kết thiếu mã phòng.')
          : labelUi('Liên kết phòng không hợp lệ.')

  return (
    <div
      className="pms-original pms-housekeeping"
      style={{
        padding: '24px',
        backgroundColor: '#f4f5f7',
        minHeight: '100%',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {activeTab === 'history' && (!startValid || !endValid) && (
        <p className="domain-error" role="alert">
          {labelUi('Ngày không hợp lệ.')}
        </p>
      )}

      {/* Header & Local Tabs */}
      <div
        className="hk-page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1
            style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', margin: '0 0 16px 0' }}
          >
            {tUi('hk.management')}
          </h1>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              backgroundColor: '#e5e7eb',
              padding: '4px',
              borderRadius: '8px',
              width: 'fit-content',
            }}
          >
            <button
              onClick={() => chooseTab('status')}
              style={activeTab === 'status' ? activeTabStyle : inactiveTabStyle}
            >
              <CheckCircle size={16} /> {labelUi('Trạng thái phòng')}
            </button>
            <button
              onClick={() => chooseTab('history')}
              style={activeTab === 'history' ? activeTabStyle : inactiveTabStyle}
            >
              <History size={16} /> {tUi('hk.history')}
            </button>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={exportHousekeeping}
            disabled={
              !access('housekeeping.view', 'HOUSEKEEPING').allowed ||
              (activeTab === 'status' && Boolean(target) && target.state !== 'found')
            }
            style={{
              backgroundColor: '#fff',
              border: '1px solid #d1d5db',
              padding: '10px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: '500',
            }}
          >
            <Download size={16} /> {tUi('common.exportCsv')}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div
        className="pms-housekeeping-panel"
        style={{
          backgroundColor: '#fff',
          borderRadius: '16px',
          border: '1px solid #e5e7eb',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
          overflow: 'hidden',
        }}
      >
        {target ? (
          <div
            className={`hk-target-banner is-${target.state}`}
            role={target.state === 'found' ? 'status' : 'alert'}
          >
            <p>
              {targetMessage}
              {target.state === 'missing' && (
                <>
                  {' '}
                  <code className="hk-target-raw">{target.raw}</code>
                </>
              )}
            </p>
            <button type="button" className="hk-room-action hk-target-clear" onClick={clearTarget}>
              {labelUi('Bỏ lọc phòng')}
            </button>
          </div>
        ) : (
          /* Filter Toolbar */
          <div
            className="pms-housekeeping-filters"
            style={{
              padding: '20px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              gap: '16px',
              alignItems: 'center',
              backgroundColor: '#f9fafb',
            }}
          >
            {activeTab === 'status' ? (
              <>
                <select
                  aria-label={tUi('common.roomType')}
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">{tUi('hk.allTypes')}</option>
                  {roomTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={tUi('hk.roomCondition')}
                  value={conditionFilter}
                  onChange={(e) => setConditionFilter(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">{tUi('hk.allConditions')}</option>
                  <option value="clean">{tUi('hk.cleanRoom')}</option>
                  <option value="dirty">{tUi('hk.dirtyRoom')}</option>
                  <option value="inspection">{tUi('hk.inspecting')}</option>
                  <option value="maintenance">{tUi('hk.maintenanceAction')}</option>
                </select>
                <select
                  aria-label={tUi('hk.stayStatus')}
                  value={bookingFilter}
                  onChange={(e) => setBookingFilter(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">{tUi('hk.allStayStatuses')}</option>
                  <option value="Trống">{tUi('hk.vacant')}</option>
                  <option value="Đang ở">{tUi('hk.occupied')}</option>
                </select>
                <select
                  aria-label={tUi('hk.assignedStaff')}
                  style={inputStyle}
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                >
                  <option value="">{tUi('hk.allStaff')}</option>
                  {housekeepingStaff.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
                <div
                  className="hk-search"
                  style={{ position: 'relative', flex: 1, maxWidth: '250px' }}
                >
                  <Search
                    size={16}
                    style={{ position: 'absolute', left: '12px', top: '10px', color: '#9ca3af' }}
                  />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={tUi('hk.searchRoom')}
                    style={{ ...inputStyle, paddingLeft: '36px', width: '100%' }}
                  />
                </div>
              </>
            ) : (
              <>
                <div
                  className="hk-history-dates"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Calendar size={18} color="#6b7280" />
                  <DateInput
                    aria-label={tUi('hk.historyFrom')}
                    value={historyFilter.start}
                    max={historyFilter.end || undefined}
                    onChange={(start) => updateHistoryFilter({ start })}
                    onValidityChange={setStartValid}
                    style={inputStyle}
                  />
                  <span>-</span>
                  <DateInput
                    aria-label={tUi('hk.historyTo')}
                    min={historyFilter.start || undefined}
                    value={historyFilter.end}
                    onChange={(end) => updateHistoryFilter({ end })}
                    onValidityChange={setEndValid}
                    style={inputStyle}
                  />
                </div>
                <select
                  aria-label={tUi('hk.historyRoom')}
                  style={inputStyle}
                  value={historyFilter.room}
                  onChange={(e) => updateHistoryFilter({ room: e.target.value })}
                >
                  <option value="">{tUi('common.allRooms')}</option>
                  {[...new Set(allHistory.map((log) => log.room))].map((room) => (
                    <option key={room}>{room}</option>
                  ))}
                </select>
                <select
                  aria-label={tUi('hk.historyActor')}
                  style={inputStyle}
                  value={historyFilter.actor}
                  onChange={(e) => updateHistoryFilter({ actor: e.target.value })}
                >
                  <option value="">{tUi('common.allStaff')}</option>
                  {[...new Set(allHistory.map((log) => log.user))].map((actor) => (
                    <option key={actor}>{actor}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}

        {!target && activeTab === 'status' && (
          <div className="hk-queue-bar">
            <div
              className="hk-queue-presets"
              role="group"
              aria-label={labelUi('Nhóm công việc buồng phòng')}
            >
              {queuePresets.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  data-queue={id}
                  aria-pressed={preset === id}
                  onClick={() => setPreset(id)}
                >
                  {labelUi(label)}
                  <span className="hk-queue-count">{presetCounts[id]}</span>
                </button>
              ))}
            </div>
            <span className="hk-queue-summary" role="status">
              {labelUi('Hiển thị')} {roomStatusList.length} / {allRows.length} {labelUi('phòng')}
            </span>
            {preset !== 'all' && (
              <button
                type="button"
                className="hk-room-action hk-queue-clear"
                onClick={() => setPreset('all')}
              >
                {labelUi('Bỏ chọn nhóm')}
              </button>
            )}
          </div>
        )}

        {/* Data Table */}
        <div className="hk-table-scroll" style={{ overflowX: 'auto' }}>
          <table
            className={activeTab === 'status' ? 'hk-status-table' : 'hk-history-table'}
            style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}
          >
            <thead>
              {activeTab === 'status' ? (
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {statusLabels.map((label, index) => (
                    <th key={index} scope="col" style={thStyle}>
                      {label}
                    </th>
                  ))}
                </tr>
              ) : (
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {historyLabels.map((label, index) => (
                    <th key={index} scope="col" style={thStyle}>
                      {label}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {activeTab === 'status'
                ? roomStatusList.map((room) => (
                    <tr
                      key={room.id}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        transition: 'background-color 0.2s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f9fafb')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#fff')}
                    >
                      <td
                        data-label={statusLabels[0]}
                        className="hk-cell-room"
                        style={{
                          ...tdStyle,
                          fontWeight: 'bold',
                          color: '#111827',
                          fontSize: '15px',
                        }}
                      >
                        <span className="hk-room-number">{room.id}</span>
                        {room.reason && <span className="hk-room-reason">{room.reason}</span>}
                      </td>
                      <td
                        data-label={statusLabels[1]}
                        className="hk-cell-condition"
                        style={tdStyle}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {getConditionBadge(room.condition)}
                          {/* Quick toggle button: any open task (even future-only) keeps it disabled. */}
                          <button
                            className="hk-quick-toggle"
                            disabled={
                              room.hasOpenTask ||
                              Boolean(room.taskId) ||
                              room.condition === 'inspection' ||
                              room.condition === 'maintenance' ||
                              !access('housekeeping.manage').allowed
                            }
                            aria-label={'Đổi trạng thái ' + room.id}
                            onClick={() =>
                              runAction('housekeeping.write', 'HOUSEKEEPING', () =>
                                room.condition === 'dirty'
                                  ? cleanRoom(room.number)
                                  : dirtyRoom(room.number),
                              )
                            }
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#9ca3af',
                              cursor: 'pointer',
                            }}
                            title={labelUi('Đổi trạng thái nhanh')}
                          >
                            <Clock size={16} />
                          </button>
                        </div>
                      </td>
                      <td
                        data-label={statusLabels[2]}
                        className="hk-cell-stay"
                        style={{ ...tdStyle, color: '#4b5563', fontWeight: '500' }}
                      >
                        {room.booking}
                      </td>
                      <td data-label={statusLabels[3]} className="hk-cell-code" style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {getHkCodeBadge(room.hkCode)}
                          <span style={{ fontSize: '13px', color: '#6b7280' }}>{room.hkDesc}</span>
                        </div>
                      </td>
                      <td
                        data-label={statusLabels[4]}
                        className="hk-cell-assignment"
                        style={tdStyle}
                      >
                        {room.staff ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              backgroundColor: '#f3f4f6',
                              padding: '4px 8px',
                              borderRadius: '12px',
                              fontSize: '13px',
                              width: 'fit-content',
                            }}
                          >
                            <User size={14} /> {room.staff}
                          </div>
                        ) : (
                          <Link
                            className="hk-room-action"
                            to={
                              '/id/housekeeping/plan?' +
                              new URLSearchParams(
                                room.taskId
                                  ? { task: room.taskId, date: room.taskDate, room: room.number }
                                  : { room: room.number, date: today(settings.timezone) },
                              )
                            }
                          >
                            {tUi('hk.assignAction')}
                          </Link>
                        )}
                        {room.taskWhen && <span className="hk-task-when">{room.taskWhen}</span>}
                      </td>
                      <td
                        data-label={statusLabels[5]}
                        className="hk-cell-notes"
                        style={{
                          ...tdStyle,
                          color: '#6b7280',
                          fontStyle: room.note ? 'normal' : 'italic',
                        }}
                      >
                        {room.taskId ? (
                          <Link
                            className="hk-room-task-link"
                            to={
                              '/id/housekeeping/plan?' +
                              new URLSearchParams({
                                task: room.taskId,
                                date: room.taskDate,
                                room: room.number,
                              })
                            }
                          >
                            {room.note || tUi('hk.viewTask')}
                          </Link>
                        ) : (
                          room.note || tUi('common.none')
                        )}
                        {access('housekeeping.manage').allowed && !room.taskId && (
                          <button
                            type="button"
                            className="hk-room-action"
                            onClick={() =>
                              runAction('housekeeping.write', 'HOUSEKEEPING', () =>
                                setCondition(
                                  room.number,
                                  room.condition === 'maintenance' ? 'dirty' : 'maintenance',
                                ),
                              )
                            }
                          >
                            {room.condition === 'maintenance'
                              ? tUi('hk.endMaintenance')
                              : tUi('hk.maintenanceAction')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                : historyRows.map((hist) => (
                    <tr key={hist.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td
                        data-label={historyLabels[0]}
                        style={{ ...tdStyle, fontWeight: '500', color: '#374151' }}
                      >
                        {hist.time}
                      </td>
                      <td data-label={historyLabels[1]} style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div
                            style={{
                              width: '24px',
                              height: '24px',
                              backgroundColor: '#e5e7eb',
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <User size={14} color="#4b5563" />
                          </div>
                          <span
                            style={{ fontWeight: hist.user === 'SYSTEM ADMIN' ? 'bold' : 'normal' }}
                          >
                            {hist.user}
                          </span>
                        </div>
                      </td>
                      <td data-label={historyLabels[2]} style={{ ...tdStyle, fontWeight: 'bold' }}>
                        {hist.room}
                      </td>
                      <td data-label={historyLabels[3]} style={tdStyle}>
                        {hist.action === 'Phòng sạch' ? (
                          <span style={{ color: '#059669', fontWeight: '600' }}>
                            {tUi('hk.markClean')}
                          </span>
                        ) : (
                          <span style={{ color: '#dc2626', fontWeight: '600' }}>
                            {tUi('hk.changeTo')} {labelUi(hist.action)}
                          </span>
                        )}
                      </td>
                      <td data-label={historyLabels[4]} style={{ ...tdStyle, color: '#6b7280' }}>
                        {hist.note}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {activeTab === 'status' &&
          !roomStatusList.length &&
          (!target || target.state === 'found') && (
            <div className="hk-empty">
              <p>{labelUi('Không có phòng phù hợp với bộ lọc hiện tại.')}</p>
              {preset !== 'all' && (
                <button type="button" className="hk-room-action" onClick={() => setPreset('all')}>
                  {labelUi('Bỏ chọn nhóm')}
                </button>
              )}
            </div>
          )}
        {activeTab === 'history' &&
          startValid &&
          endValid &&
          (historyList.length ? (
            <nav className="hk-history-pager" aria-label={labelUi('Phân trang lịch sử')}>
              <span className="hk-history-range" role="status">
                {historyFrom + 1}–{historyFrom + historyRows.length} / {historyList.length}{' '}
                {labelUi('mục trong dữ liệu đã tải')}
              </span>
              <div className="hk-history-pager-actions">
                <button
                  type="button"
                  className="hk-room-action hk-history-prev"
                  disabled={currentHistoryPage <= 1}
                  onClick={() => setHistoryPage(currentHistoryPage - 1)}
                >
                  {labelUi('Trang trước')}
                </button>
                <span className="hk-history-page">
                  {labelUi('Trang')} {currentHistoryPage}/{historyPages}
                </span>
                <button
                  type="button"
                  className="hk-room-action hk-history-next"
                  disabled={currentHistoryPage >= historyPages}
                  onClick={() => setHistoryPage(currentHistoryPage + 1)}
                >
                  {labelUi('Trang sau')}
                </button>
              </div>
            </nav>
          ) : (
            <div className="hk-empty">
              <p>{labelUi('Không có lịch sử phù hợp trong dữ liệu đã tải.')}</p>
            </div>
          ))}
      </div>
    </div>
  )
}

// Styles
const activeTabStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  backgroundColor: '#fff',
  color: '#111827',
  border: 'none',
  padding: '8px 16px',
  borderRadius: '6px',
  fontWeight: 'bold',
  fontSize: '14px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  cursor: 'pointer',
}

const inactiveTabStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  backgroundColor: 'transparent',
  color: '#6b7280',
  border: 'none',
  padding: '8px 16px',
  borderRadius: '6px',
  fontWeight: '500',
  fontSize: '14px',
  cursor: 'pointer',
}

const thStyle = {
  padding: '16px',
  fontSize: '13px',
  fontWeight: '600',
  color: '#4b5563',
  textTransform: 'uppercase',
}

const tdStyle = {
  padding: '16px',
  fontSize: '14px',
  color: '#374151',
}

const inputStyle = {
  padding: '8px 12px',
  borderRadius: '8px',
  border: '1px solid #d1d5db',
  backgroundColor: '#fff',
  fontSize: '14px',
  outline: 'none',
}

const badgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 10px',
  borderRadius: '12px',
  fontSize: '13px',
  fontWeight: '600',
}

const hkBadgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '40px',
  height: '24px',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '12px',
  fontWeight: 'bold',
  boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
}
