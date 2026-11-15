import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePms } from '../../data/usePms';
import { bookingRooms, today, addDays, overlaps, roomIsBlocked } from '../../data/model';
import BookingModal from '../../reservations/components/BookingModal';
import BookingDetailPanel from '../../reservations/components/BookingDetailPanel';
import LegacyOverlay from '../../components/LegacyOverlay';
import RoomLocationFilters from '../components/RoomLocationFilters';
import { groupRoomsByLocation, matchesRoomLocationFilters } from '../roomLocations.js';
import { User, CalendarDays, AlertTriangle, DollarSign, Sparkles, Grid, List, X, Key, LogOut, Brush, ArrowUpRight, BedDouble } from 'lucide-react';
import './RoomDiagram.css';

export default function RoomDiagram() {
  useI18n();
  const { rooms, bookings, available, cleanRoom, dirtyRoom, changeStatus, roomTypes, settings, roomBlocks, setCondition, allowAction, runAction, access, housekeepingTasks } = usePms();
  const [selectedRoomNumber, setSelectedRoomNumber] = useState(null);
  const [bookingId, setBookingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [floorFilter, setFloorFilter] = useState('');
  const [listView, setListView] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const setSelectedRoom = room => { setSelectedRoomNumber(room?.number || null); setError(''); };
  const roomCards = rooms.filter(r => r.active !== false).map(r => {
    const b = bookings.find(b => bookingRooms(b).includes(String(r.id)) && b.status === 'IN_HOUSE') || bookings.find(b => bookingRooms(b).includes(String(r.id)) && overlaps(b, today(settings.timezone), addDays(today(settings.timezone), 1)));
    const blocked = roomIsBlocked(r, roomBlocks, today(settings.timezone), addDays(today(settings.timezone), 1));
    return { blocked, condition: r.condition, number: r.id, typeId: r.typeId, area: r.area, floor: r.floor, name: tUi('rooms.roomName', { room: r.id }), state: b ? 'occupied' : 'empty', status: b?.status === 'CONFIRMED' ? 'confirmed' : 'in-house', guest: b?.guest, id: b?.id, checkIn: b?.checkIn, checkOut: b?.checkOut, dirty: r.condition === 'dirty' || r.condition === 'inspection', paid: b && Number(b.balance) === 0, type: roomTypes.find(t => t.id === r.typeId)?.name };
  });
  const selectedRoom = roomCards.find(r => r.number === selectedRoomNumber);
  async function checkout() { if (!allowAction('reservations.write', 'RESERVATION_VIEW')) return; try { await changeStatus(selectedRoom.id, 'CHECKED_OUT', bookings.find(row => row.id === selectedRoom.id)?.version); setError(''); } catch (err) { setError(err.message); } }
  const openCreate = () => { if (allowAction('reservations.write', 'RESERVATION_CREATE')) { setCreateOpen(true); setSelectedRoom(null); } };
  const stats = [
    { label: 'Nhận phòng hôm nay', count: bookings.filter(b => b.status === 'CONFIRMED' && b.checkIn === today(settings.timezone)).reduce((sum, b) => sum + bookingRooms(b).length, 0), kind: 'confirmed' },
    { label: 'Trả phòng hôm nay', count: bookings.filter(b => b.status === 'IN_HOUSE' && b.checkOut === today(settings.timezone)).reduce((sum, b) => sum + bookingRooms(b).length, 0), kind: 'checkout' },
    { label: 'Phòng đang có khách', count: bookings.filter(b => b.status === 'IN_HOUSE').reduce((sum, b) => sum + bookingRooms(b).length, 0), kind: 'occupied' },
    { label: 'Sẵn sàng bán', count: available().filter(r => r.condition === 'clean').length, kind: 'available' },
    { label: 'Phòng cần dọn', count: rooms.filter(r => r.active !== false && r.condition === 'dirty').length, kind: 'dirty' },
  ];
  const legend = [
    { key: '', label: 'Tất cả', matches: () => true },
    { key: 'empty', label: 'Phòng trống', matches: room => room.state === 'empty' && !room.blocked },
    { key: 'confirmed', label: 'Đã xác nhận', matches: room => room.state === 'occupied' && room.status === 'confirmed' },
    { key: 'occupied', label: 'Đang có khách', matches: room => room.state === 'occupied' && room.status !== 'confirmed' },
    { key: 'dirty', label: 'Cần dọn / kiểm tra', matches: room => room.dirty },
    { key: 'blocked', label: 'Khóa / bảo trì', matches: room => room.blocked },
  ];
  const selectedLegend = legend.find(item => item.key === statusFilter);
  const unassigned = bookings.filter(b => !b.room && ['CONFIRMED', 'IN_HOUSE'].includes(b.status));
  const locationGroups = groupRoomsByLocation(roomCards.filter(room => matchesRoomLocationFilters(room, { area: areaFilter, floor: floorFilter }) && (!typeFilter || room.typeId === typeFilter) && selectedLegend.matches(room)));
  const locationGroupName = group => `${group.area ?? tUi('rooms.unassignedArea')} · ${group.floor === null ? tUi('rooms.unassignedFloor') : tUi('rooms.floorName', { floor: group.floor })}`;
  const roomLabel = room => room.blocked ? 'Khóa / bảo trì' : room.state === 'empty' ? 'Phòng trống' : room.status === 'confirmed' ? 'Đã xác nhận' : 'Đang có khách';
  const roomKind = room => room.blocked ? 'blocked' : room.state === 'empty' ? 'empty' : room.status === 'confirmed' ? 'confirmed' : 'occupied';
  const hasOpenTask = selectedRoom && housekeepingTasks.some(task => task.room === selectedRoom.number && !['completed', 'cancelled'].includes(task.status));

  return (
    <div className="loha-rooms">
      <header className="loha-rooms-heading"><div><span className="loha-rooms-eyebrow">{tUi("rooms.statusKicker")}</span><h1>{tUi("nav.roomDiagram")}</h1><p>Toàn cảnh phòng và lượt lưu trú trong ngày · {today(settings.timezone)}</p></div></header>
      <div className="loha-rooms-stats" aria-label={tUi("rooms.statsLabel")}>{stats.map(stat => <div key={stat.kind} className={'loha-rooms-stat stat-' + stat.kind}><span>{labelUi(stat.label)}</span><strong>{stat.count}<span>{tUi("common.roomsLower")}</span></strong></div>)}</div>
      <section className="loha-rooms-panel" aria-label={tUi("rooms.byArea")}>
        <div className="loha-rooms-toolbar"><div><h2>{tUi("rooms.list")}</h2><p>{tUi("rooms.selectHint")}</p></div><div className="loha-rooms-filters">
          <label className="loha-rooms-visually-hidden" htmlFor="diagram-type">{tUi("common.roomType")}</label><select id="diagram-type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="">{tUi("common.allRoomTypes")}</option>{roomTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
          <RoomLocationFilters rooms={roomCards} area={areaFilter} floor={floorFilter} onAreaChange={setAreaFilter} onFloorChange={setFloorFilter} idPrefix="diagram" />
          <div className="loha-rooms-view" role="group" aria-label={tUi("rooms.view")}><button type="button" aria-label={tUi("rooms.grid")} aria-pressed={!listView} onClick={() => setListView(false)}><Grid size={16} aria-hidden="true" /></button><button type="button" aria-label={tUi("rooms.listView")} aria-pressed={listView} onClick={() => setListView(true)}><List size={16} aria-hidden="true" /></button></div>
        </div></div>
        <div className="loha-rooms-legend" aria-label={tUi("rooms.filter")}>{legend.map(item => <button key={item.key} type="button" aria-pressed={statusFilter === item.key} className={'legend-' + (item.key || 'all')} onClick={() => setStatusFilter(item.key)}><span className="loha-rooms-dot" aria-hidden="true" />{labelUi(item.label)}<strong>{roomCards.filter(item.matches).length}</strong></button>)}</div>
        <div className="loha-rooms-body">
          {!!unassigned.length && <section className="loha-rooms-unassigned"><div className="loha-rooms-floor-heading"><h3>{tUi("rooms.unassigned")}</h3><span>{unassigned.length}{" "}{labelUi("đặt phòng")}</span></div><div className={'loha-rooms-grid' + (listView ? ' is-list' : '')}>{unassigned.map(booking => <button type="button" key={booking.id} className="loha-room-card room-confirmed" onClick={() => setBookingId(booking.id)}><span className="loha-room-card-top"><strong>{tUi("rooms.unassigned")}</strong><ArrowUpRight size={16} aria-hidden="true" /></span><span className="loha-room-card-body"><strong className="loha-room-guest"><User size={14} aria-hidden="true" />{booking.guest}</strong><span className="loha-room-stay">{booking.checkIn} → {booking.checkOut}</span><span className="loha-room-booking-code">{booking.id}</span><span className="loha-room-status">{booking.status === 'CONFIRMED' ? tUi("rooms.confirmed") : tUi("hk.occupied")}</span></span></button>)}</div></section>}
          {locationGroups.map(group => <section className="loha-rooms-floor" key={group.key}><div className="loha-rooms-floor-heading"><h3 data-i18n-ignore>{locationGroupName(group)}</h3><span>{group.rooms.length}{' '}{tUi("common.roomsLower")}</span></div><div className={'loha-rooms-grid' + (listView ? ' is-list' : '')}>{group.rooms.map(room => <button type="button" key={room.number} className={'loha-room-card room-' + roomKind(room)} onClick={() => setSelectedRoom(room)} aria-label={`${room.name}, ${labelUi(roomLabel(room))}${room.dirty ? ', cần dọn hoặc kiểm tra' : ''}`}><span className="loha-room-card-top"><strong>{room.name}</strong><span className="loha-room-card-icons">{room.dirty && <AlertTriangle size={15} aria-label={room.condition === 'inspection' ? tUi("hk.inspecting") : tUi("hk.dirtyRoom")} />}{room.state !== 'empty' && room.paid && <DollarSign size={15} aria-label={tUi("rooms.paidFull")} />}<ArrowUpRight size={16} aria-hidden="true" /></span></span><span className="loha-room-type">{room.type || tUi("rooms.noType")}</span><span className="loha-room-card-body">{room.state === 'empty' ? <span className="loha-room-empty"><BedDouble size={22} aria-hidden="true" /><span>{labelUi(roomLabel(room))}</span>{room.dirty && <small>{room.condition === 'inspection' ? tUi("hk.inspecting") : tUi("rooms.needsCleaningShort")}</small>}</span> : <><strong className="loha-room-guest"><User size={14} aria-hidden="true" />{room.guest}</strong><span className="loha-room-stay">{room.checkIn} → {room.checkOut}</span><span className="loha-room-booking-code">{room.id}</span></>}</span><span className="loha-room-card-footer"><span className="loha-room-status">{labelUi(roomLabel(room))}</span>{room.state !== 'empty' && <span className="loha-room-payment">{room.paid ? tUi("rooms.paid") : tUi("rooms.balance")}</span>}</span></button>)}</div></section>)}
          {!locationGroups.length && <div className="loha-rooms-empty" role="status"><BedDouble size={32} aria-hidden="true" /><strong>{roomCards.length ? tUi("rooms.noMatch") : tUi("rooms.none")}</strong><span>{roomCards.length ? tUi("rooms.filterHint") : tUi("rooms.emptyHint")}</span></div>}
        </div>
      </section>
      {selectedRoom && <LegacyOverlay title={selectedRoom.name} onClose={() => setSelectedRoom(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(18,43,68,.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
        <div className="loha-room-dialog"><header className="loha-room-dialog-heading"><div><h2>{selectedRoom.name}</h2><span className={'loha-room-status room-' + roomKind(selectedRoom)}>{labelUi(roomLabel(selectedRoom))}</span>{selectedRoom.dirty && <span className="loha-room-dirty">{selectedRoom.condition === 'inspection' ? tUi("hk.inspecting") : tUi("rooms.cleanShort")}</span>}</div><button type="button" aria-label={tUi("common.close")} className="loha-room-close" onClick={() => setSelectedRoom(null)}><X size={18} /></button></header>
          <div className="loha-room-dialog-info">{selectedRoom.state === 'occupied' ? <><div><span>{tUi("hk.stayover")}</span><strong>{selectedRoom.guest}</strong></div><div><span>{tUi("rooms.bookingCode")}</span><strong>{selectedRoom.id}</strong></div><div><span>{tUi("rooms.stayDates")}</span><strong>{selectedRoom.checkIn} → {selectedRoom.checkOut}</strong></div><div><span>{tUi("common.roomType")}</span><strong>{selectedRoom.type}</strong></div><div><span>{tUi("rooms.payment")}</span><strong>{selectedRoom.paid ? tUi("rooms.paidFull") : tUi("rooms.notPaidFull")}</strong></div></> : <><div><span>{tUi("common.roomType")}</span><strong>{selectedRoom.type}</strong></div><div><span>{tUi("rooms.cleaning")}</span><strong>{selectedRoom.condition === 'inspection' ? tUi("hk.inspecting") : selectedRoom.condition === 'maintenance' ? tUi("hk.maintenanceAction") : selectedRoom.dirty ? tUi("rooms.needsCleaningShort") : tUi("rooms.cleaned")}</strong></div></>}</div>
          {error && <p role="alert" className="loha-room-error">{error}</p>}
          <div className="loha-room-dialog-actions">
            {access('housekeeping.manage').allowed && !hasOpenTask && selectedRoom.condition !== 'inspection' && <button type="button" onClick={() => runAction('housekeeping.write', '', () => setCondition(selectedRoom.number, selectedRoom.condition === 'maintenance' ? 'dirty' : 'maintenance'))}>{selectedRoom.condition === 'maintenance' ? tUi("rooms.endMaintenance") : tUi("rooms.markMaintenance")}</button>}
            <button type="button" className="loha-rooms-primary" onClick={() => { if (selectedRoom.id) setBookingId(selectedRoom.id); else openCreate(); }}><Grid size={17} aria-hidden="true" />{tUi("rooms.details")}</button>
            <div className="loha-room-action-grid">{selectedRoom.state === 'empty' ? <>
              <button type="button" disabled={selectedRoom.blocked} title={selectedRoom.blocked ? tUi("rooms.lockedHint") : ''} onClick={openCreate}><Key size={16} aria-hidden="true" />{tUi("rooms.checkIn")}</button>
              <button type="button" onClick={openCreate}><CalendarDays size={16} aria-hidden="true" />{tUi("rooms.hold")}</button>
              {selectedRoom.condition === 'inspection' || !access('housekeeping.manage').allowed || hasOpenTask ? <Link className="loha-room-action-wide" to="/id/housekeeping/plan">{tUi("rooms.housekeepingTask")}</Link> : selectedRoom.dirty ? <button type="button" className="loha-room-action-wide" onClick={() => runAction('housekeeping.write', 'HOUSEKEEPING', () => cleanRoom(selectedRoom.number))}><Sparkles size={16} aria-hidden="true" />{tUi("rooms.markClean")}</button> : <button type="button" className="loha-room-action-wide" onClick={() => runAction('housekeeping.write', 'HOUSEKEEPING', () => dirtyRoom(selectedRoom.number))}><Brush size={16} aria-hidden="true" />{tUi("rooms.markDirty")}</button>}
            </> : <>
              <button type="button" onClick={() => setBookingId(selectedRoom.id)}><User size={16} aria-hidden="true" />{tUi("rooms.editBooking")}</button>
              <button type="button" onClick={() => setBookingId(selectedRoom.id)}><DollarSign size={16} aria-hidden="true" />{tUi("rooms.services")}</button>
              <button type="button" className="loha-room-action-wide" disabled={selectedRoom.status !== 'confirmed' && !selectedRoom.paid} title={!selectedRoom.paid ? tUi("rooms.checkoutHint") : ''} onClick={() => selectedRoom.status === 'confirmed' ? setBookingId(selectedRoom.id) : checkout()}><LogOut size={16} aria-hidden="true" />{selectedRoom.status === 'confirmed' ? tUi("rooms.checkIn") : tUi("rooms.checkOut")}</button>
            </>}</div>
          </div>
        </div>
      </LegacyOverlay>}
      {bookingId && <BookingDetailPanel bookingId={bookingId} onClose={() => setBookingId(null)} />}
      {createOpen && <BookingModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
