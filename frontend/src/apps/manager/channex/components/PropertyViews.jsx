import DateInput from '../../../../shared/components/DateInput.jsx'
import { formatDateTime } from '../../../../shared/lib/date.js'
import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useCallback, useState } from 'react'
import { BedDouble, Check, Link2, Pencil, Plus, RefreshCw } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import { addDays } from '../../../pms/data/model'
import {
  channexMoney,
  channexToday,
  dateLabel,
  inventoryDateError,
  inventoryValue,
} from '../presentation'
import { DataState, EmptyState, Pagination, RemoteId, TableWrap } from './RemoteData'
import { useChannexQuery } from '../useChannexQuery'
import CatalogEditor from './CatalogEditor'
import '../ChannexSurface.css'
export { default as ChannelsView } from './ChannelsView'

const sellModes = { per_room: 'Theo phòng', per_person: 'Theo người' }
const rateModes = {
  manual: 'Giá thủ công',
  derived: 'Giá kế thừa',
  auto: 'Giá tự động',
  cascade: 'Giá liên kết',
}
const bookingStatuses = { new: 'Mới', modified: 'Đã thay đổi', cancelled: 'Đã hủy' }

function ViewHeading({ title, query, children }) {
  useI18n()
  return (
    <div className="channex-section-heading">
      <div>
        <h3>{labelUi(title)}</h3>
        {children && <p>{children}</p>}
      </div>
      <button
        type="button"
        className="manager-button channex-refresh"
        disabled={query.loading}
        onClick={query.refresh}
      >
        <RefreshCw size={15} aria-hidden="true" />
        {tUi('common.reload')}
      </button>
    </div>
  )
}

export function CatalogView({ account, property, canWrite = false }) {
  useI18n()
  const { getChannexCatalog } = usePms()
  const request = useCallback(
    () => getChannexCatalog(account.id, property.id),
    [getChannexCatalog, account.id, property.id],
  )
  const query = useChannexQuery(request, 'roomTypes,ratePlans')
  const rooms = query.data?.roomTypes || [],
    plans = query.data?.ratePlans || []
  const [editor, setEditor] = useState(null),
    [message, setMessage] = useState('')
  const openEditor = (kind, item = {}) => {
    if (!canWrite) return
    setMessage('')
    setEditor({ kind, item })
  }
  return (
    <section
      className="channex-data-view"
      aria-label={labelUi('Phòng và gói giá')}
      aria-busy={query.loading}
    >
      <ViewHeading title={labelUi('Phòng & gói giá')} query={query}>
        {labelUi('Quản lý loại phòng và mức giá của khách sạn trên Channex.')}
      </ViewHeading>
      {message && (
        <p className="channex-success" role="status">
          <Check size={16} aria-hidden="true" />
          {message}
        </p>
      )}
      <DataState query={query} label="phòng và gói giá">
        <div className="channex-section-block">
          <div className="channex-table-heading">
            <h4>
              {tUi('common.roomType')} <span className="channex-count">{rooms.length}</span>
            </h4>
            {canWrite && (
              <button
                type="button"
                className="manager-button manager-button-primary"
                onClick={() => openEditor('room')}
              >
                <Plus size={16} aria-hidden="true" />
                {labelUi('Thêm loại phòng')}
              </button>
            )}
          </div>
          {!rooms.length ? (
            <EmptyState title={labelUi('Chưa có loại phòng')} />
          ) : (
            <TableWrap label="Loại phòng Channex">
              <table className="manager-table channex-table channex-room-table">
                <thead>
                  <tr>
                    {[
                      'Loại phòng',
                      'Số phòng',
                      'Người lớn',
                      'Trẻ em',
                      'Em bé',
                      'Liên kết PMS',
                      'Thao tác',
                    ].map((label) => (
                      <th key={label} scope="col">
                        {labelUi(label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => (
                    <tr key={room.id}>
                      <td>
                        <div className="channex-table-identity">
                          <span className="channex-room-icon">
                            <BedDouble size={18} aria-hidden="true" />
                          </span>
                          <div>
                            <strong>{room.name}</strong>
                            <RemoteId id={room.id} />
                          </div>
                        </div>
                      </td>
                      <td className="channex-number">{inventoryValue(room.countOfRooms)}</td>
                      <td className="channex-number">{inventoryValue(room.adults)}</td>
                      <td className="channex-number">{inventoryValue(room.children)}</td>
                      <td className="channex-number">{inventoryValue(room.infants)}</td>
                      <td>
                        <span
                          className={`channex-status channex-status--${room.mapped ? 'active' : 'neutral'}`}
                        >
                          {room.mapped && <Link2 size={12} aria-hidden="true" />}
                          {room.mapped ? labelUi('Đã ghép PMS') : labelUi('Chưa ghép')}
                        </span>
                      </td>
                      <td>
                        {canWrite && (
                          <button
                            type="button"
                            className="manager-button channex-edit"
                            onClick={() => openEditor('room', room)}
                            aria-label={`Sửa loại phòng ${room.name}`}
                          >
                            <Pencil size={14} aria-hidden="true" />
                            {tUi('common.edit')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </div>
        <div className="channex-section-block channex-plan-section">
          <div className="channex-table-heading">
            <h4>
              {labelUi('Gói giá')} <span className="channex-count">{plans.length}</span>
            </h4>
            {canWrite && (
              <button
                type="button"
                className="manager-button"
                disabled={!rooms.length}
                onClick={() => openEditor('rate')}
              >
                <Plus size={16} aria-hidden="true" />
                {labelUi('Thêm gói giá')}
              </button>
            )}
          </div>
          {!plans.length ? (
            <EmptyState title={labelUi('Chưa có gói giá')} />
          ) : (
            <TableWrap label="Gói giá">
              <table className="manager-table channex-table channex-rates">
                <thead>
                  <tr>
                    {['Gói giá', 'Loại phòng', 'Giá mặc định', 'Đồng bộ LOHA', 'Thao tác'].map(
                      (label) => (
                        <th key={label} scope="col">
                          {labelUi(label)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id}>
                      <td>
                        <strong>{plan.name}</strong>
                        <small className="channex-rate-mode">
                          {sellModes[plan.sellMode] || plan.sellMode || '—'} ·{' '}
                          {rateModes[plan.rateMode] || plan.rateMode || '—'}
                        </small>
                        <RemoteId id={plan.id} />
                      </td>
                      <td>
                        {rooms.find((room) => room.id === plan.roomTypeId)?.name ||
                          plan.roomTypeId ||
                          '—'}
                      </td>
                      <td className="channex-money">
                        <strong>{channexMoney(plan.rate, plan.currency)}</strong>
                        <small>{plan.currency || '—'}</small>
                      </td>
                      <td>
                        <span
                          className={`channex-status channex-status--${plan.supported ? 'active' : 'warning'}`}
                        >
                          {plan.supported ? labelUi('Tương thích') : labelUi('Chưa hỗ trợ')}
                        </span>
                      </td>
                      <td>
                        {canWrite && (
                          <button
                            type="button"
                            className="manager-button channex-edit"
                            disabled={!plan.editable}
                            onClick={() => openEditor('rate', plan)}
                            aria-label={`Sửa gói giá ${plan.name}`}
                          >
                            <Pencil size={14} aria-hidden="true" />
                            {tUi('common.edit')}
                          </button>
                        )}
                        {!plan.editable && <small>{labelUi('Gói giá phức tạp: chỉ xem')}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <p className="channex-table-caption">
            {labelUi('Giá mặc định của gói. Giá bán từng ngày được hiển thị tại Tồn phòng & giá.')}
          </p>
        </div>
      </DataState>
      {canWrite && editor && (
        <CatalogEditor
          kind={editor.kind}
          item={editor.item}
          account={account}
          property={query.data?.property || property}
          rooms={rooms}
          onClose={() => setEditor(null)}
          onSaved={(text) => {
            setEditor(null)
            setMessage(text)
            query.refresh()
          }}
          onReload={() => {
            setEditor(null)
            query.refresh()
          }}
        />
      )}
    </section>
  )
}

export function BookingsView({ account, property }) {
  useI18n()
  const { getChannexBookings } = usePms()
  const [page, setPage] = useState(1)
  const request = useCallback(
    () => getChannexBookings(account.id, property.id, page),
    [getChannexBookings, account.id, property.id, page],
  )
  const query = useChannexQuery(request, 'bookings')
  const rows = query.data?.bookings || []
  return (
    <section
      className="channex-data-view"
      aria-label={labelUi('Đặt phòng từ Channex')}
      aria-busy={query.loading}
    >
      <ViewHeading title={tUi('nav.bookings')} query={query}>
        {labelUi(
          'Dữ liệu trên Channex, bao gồm đặt phòng đã nhận và lịch sử. Số tiền theo tiền tệ gốc.',
        )}
      </ViewHeading>
      <DataState query={query} label="đặt phòng">
        {!rows.length ? (
          <EmptyState title={labelUi('Chưa có đặt phòng trên trang này')} />
        ) : (
          <TableWrap label={tUi('nav.bookings')}>
            <table className="manager-table channex-table channex-bookings">
              <thead>
                <tr>
                  {[
                    'Mã / nguồn',
                    'Khách',
                    'Trạng thái',
                    'Nhận / trả phòng',
                    'Số phòng',
                    'Tổng tiền',
                    'Tạo lúc',
                  ].map((label) => (
                    <th key={label} scope="col">
                      {labelUi(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.reference || row.id}</strong>
                      <small>{row.source || '—'}</small>
                    </td>
                    <td>{row.guestName || '—'}</td>
                    <td>
                      <span
                        className={`channex-status channex-status--${row.status === 'cancelled' ? 'warning' : 'neutral'}`}
                      >
                        {bookingStatuses[row.status] || row.status || '—'}
                      </span>
                    </td>
                    <td>
                      {dateLabel(row.arrivalDate)}
                      <small>đến {dateLabel(row.departureDate)}</small>
                    </td>
                    <td>{inventoryValue(row.roomCount)}</td>
                    <td className="channex-money">
                      <strong>{channexMoney(row.amount, row.currency)}</strong>
                    </td>
                    <td>
                      {row.createdAt ? (
                        <time dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </DataState>
      <Pagination
        pagination={query.data?.pagination}
        page={page}
        setPage={setPage}
        count={query.loading || query.error ? null : rows.length}
        loading={query.loading}
      />
    </section>
  )
}

export function InventoryView({ account, property }) {
  useI18n()
  const { getChannexInventory } = usePms()
  const [range, setRange] = useState(() => {
    const start = channexToday(property.timezone)
    return { start, end: addDays(start, 6) }
  })
  const [draft, setDraft] = useState(range),
    [dateError, setDateError] = useState('')
  const request = useCallback(
    () => getChannexInventory(account.id, property.id, range.start, range.end),
    [getChannexInventory, account.id, property.id, range],
  )
  const query = useChannexQuery(request, 'dates,availability,rates')
  const dates = query.data?.dates || [],
    availability = query.data?.availability || [],
    rates = query.data?.rates || []
  function applyRange(event) {
    event.preventDefault()
    const error = inventoryDateError(draft.start, draft.end)
    setDateError(error)
    if (!error) {
      if (range.start === draft.start && range.end === draft.end) query.refresh()
      else setRange(draft)
    }
  }
  return (
    <section
      className="channex-data-view"
      aria-label={labelUi('Tồn phòng và giá trên Channex')}
      aria-busy={query.loading}
    >
      <ViewHeading title={labelUi('Tồn phòng & giá')} query={query}>
        {labelUi('Xem tối đa 31 ngày. Dấu — là dữ liệu chưa có.')}
      </ViewHeading>
      <form className="channex-filters channex-date-filter" onSubmit={applyRange}>
        <label>
          {tUi('common.fromDate')}
          <DateInput
            required
            value={draft.start}
            onChange={(start) => setDraft({ ...draft, start })}
          />
        </label>
        <label>
          {labelUi('Đến hết ngày')}
          <DateInput
            required
            min={draft.start}
            value={draft.end}
            onChange={(end) => setDraft({ ...draft, end })}
          />
        </label>
        <button type="submit" className="manager-button" disabled={query.loading}>
          {labelUi('Xem dữ liệu')}
        </button>
        {dateError && (
          <p className="channex-date-error" role="alert">
            {dateError}
          </p>
        )}
      </form>
      <DataState query={query} label="tồn phòng và giá">
        <p className="channex-range-label">
          {dateLabel(range.start)} – {dateLabel(range.end)}, bao gồm ngày kết thúc
        </p>
        <h4 className="channex-table-title">
          <BedDouble size={16} aria-hidden="true" />
          {tUi('rooms.vacant')}
        </h4>
        {!availability.length ? (
          <EmptyState title={tUi('common.noAvailability')} />
        ) : (
          <TableWrap label="Phòng trống theo ngày">
            <table className="manager-table channex-inventory-table">
              <thead>
                <tr>
                  <th scope="col">{tUi('common.roomType')}</th>
                  {dates.map((date) => (
                    <th scope="col" key={date}>
                      {dateLabel(date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {availability.map((room) => (
                  <tr key={room.roomTypeId}>
                    <th scope="row">{room.name}</th>
                    {dates.map((date) => (
                      <td key={date}>{inventoryValue(room.values?.[date])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <h4 className="channex-table-title">{labelUi('Giá & trạng thái bán')}</h4>
        {!rates.length ? (
          <EmptyState title={labelUi('Chưa có dữ liệu giá')} />
        ) : (
          <TableWrap label="Giá theo ngày">
            <table className="manager-table channex-inventory-table">
              <thead>
                <tr>
                  <th scope="col">{labelUi('Gói giá')}</th>
                  {dates.map((date) => (
                    <th scope="col" key={date}>
                      {dateLabel(date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rates.map((plan) => (
                  <tr key={plan.ratePlanId}>
                    <th scope="row">
                      {plan.name}
                      <small>{plan.currency || '—'}</small>
                    </th>
                    {dates.map((date) => {
                      const value = plan.values?.[date]
                      return (
                        <td key={date}>
                          <strong>{channexMoney(value?.rate, plan.currency)}</strong>
                          <small>
                            {value?.stopSell == null ? (
                              '—'
                            ) : (
                              <span
                                className={`channex-status channex-status--${value.stopSell ? 'warning' : 'active'}`}
                              >
                                {value.stopSell ? labelUi('Đóng bán') : labelUi('Đang bán')}
                              </span>
                            )}
                          </small>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </DataState>
    </section>
  )
}
