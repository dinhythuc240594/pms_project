import { formatDate } from '../../../../shared/lib/date.js';
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import React, { useState } from 'react';
import { usePms } from '../../data/usePms';
import { bookingRoomStays, today, addDays, nights, money, overlaps, roomIsBlocked } from '../../data/model';
import BookingDetailPanel from '../../reservations/components/BookingDetailPanel';
import { ChevronLeft, ChevronRight, Search, Filter, Calendar as CalendarIcon } from 'lucide-react';
import './ARI.css';

export default function ARI() {
  useI18n();
  const { rooms, bookings: reservations, available, roomTypes, settings, roomBlocks } = usePms();
  const [currentDate, setCurrentDate] = useState(today(settings.timezone));
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const dates = Array.from({ length: 14 }, (_, i) => new Date(addDays(currentDate, i) + 'T00:00:00'));
  const getDayName = date => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()];
  const isWeekend = date => date.getDay() === 0 || date.getDay() === 6;
  const isToday = date => date.toLocaleDateString('en-CA') === today(settings.timezone);
  const groups = roomTypes.filter(t => !typeFilter || t.id === typeFilter).map(t => ({ ...t, price: money(t.price,settings.currency), rooms: rooms.filter(r => r.active !== false && r.typeId === t.id).map(r => ({ ...r, name: 'R - ' + r.id, blocked: roomIsBlocked(r, roomBlocks, currentDate, addDays(currentDate, 14)) })), available: dates.map((_, i) => available(addDays(currentDate, i), addDays(currentDate, i + 1), t.id).length) }));
  const bookings = reservations.filter(b => overlaps(b, currentDate, addDays(currentDate, 14)) && (b.guest + ' ' + b.id).toLowerCase().includes(query.toLowerCase())).flatMap(b => bookingRoomStays(b).filter(stay => stay.start < addDays(currentDate, 14) && stay.end > currentDate).map(stay => ({ ...b, room: String(stay.room), colStart: Math.max(0, nights(currentDate, stay.start)), colSpan: Math.min(14, nights(currentDate, stay.end)) - Math.max(0, nights(currentDate, stay.start)), bgColor: b.status === 'IN_HOUSE' ? '#10b981' : '#3b82f6', payment: Number(b.balance) === 0 ? 'paid' : Number(b.paid)>0 ? 'partial' : 'unpaid' })));

  return (
    <div className="pms-original pms-legacy-timeline" style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#f4f5f7', fontFamily: 'var(--font-sans)' }}>
      
      {/* Header Toolbar */}
      <div className="ari-toolbar" style={{ backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#111827', margin: '0 0 4px 0' }}>{labelUi("Lịch đặt phòng (Tape Chart)")}</h1>
          <p style={{ color: '#6b7280', margin: 0, fontSize: '13px' }}>{labelUi("Click để xem chi tiết, nhận phòng hoặc trả phòng")}</p>
        </div>
        
        <div className="ari-toolbar-actions" style={{ display: 'flex', alignItems: 'center' }}>
          <div className="ari-date-navigation" style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f3f4f6', borderRadius: '8px', padding: '4px' }}>
            <button aria-label={labelUi("14 ngày trước")} onClick={() => setCurrentDate(addDays(currentDate, -14))} style={{ border: 'none', background: 'none', padding: '6px', cursor: 'pointer', borderRadius: '4px' }}><ChevronLeft size={18} /></button>
            <span className="ari-date-label" style={{ fontWeight: '600', color: '#374151' }}>{formatDate(currentDate)} – {formatDate(addDays(currentDate, 13))}</span>
            <button aria-label={labelUi("14 ngày sau")} onClick={() => setCurrentDate(addDays(currentDate, 14))} style={{ border: 'none', background: 'none', padding: '6px', cursor: 'pointer', borderRadius: '4px' }}><ChevronRight size={18} /></button>
          </div>
          
          <div className="ari-search" style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} aria-hidden="true" />
            <input type="search" aria-label={labelUi("Tìm tên khách hoặc mã đặt phòng")} value={query} onChange={e => setQuery(e.target.value)} placeholder={labelUi("Tìm tên khách, mã...")} style={{ padding: '8px 12px 8px 36px', borderRadius: '8px', border: '1px solid #d1d5db' }} />
          </div>

          <button aria-expanded={showFilter} aria-controls={showFilter ? 'ari-room-type-filter' : undefined} onClick={() => setShowFilter(!showFilter)} style={{ backgroundColor: '#fff', border: '1px solid #d1d5db', padding: '8px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: '500', color: '#374151' }}>
            <Filter size={16} />{' '}{tUi("common.filter")}</button>
          <button onClick={() => setCurrentDate(today(settings.timezone))} style={{ backgroundColor: '#4f46e5', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarIcon size={16} />{' '}{tUi("common.today")}</button>
        </div>
      </div>

      {showFilter && <select id="ari-room-type-filter" className="ari-room-type-filter" aria-label={labelUi("Lọc loại phòng")} value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ margin: '8px 12px', padding: '8px', border: '1px solid #d1d5db', borderRadius: '8px' }}><option value="">{tUi("common.allRoomTypes")}</option>{roomTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      <p className="ari-mobile-hint">{labelUi("Vuốt ngang để xem ngày khác. Chạm đặt phòng để mở chi tiết.")}</p>
      {/* Main Gantt Chart Area */}
      <div className="pms-legacy-chart" role="region" aria-label={labelUi("Lịch đặt phòng, có thể cuộn ngang và dọc")} tabIndex={0} style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
        
        {/* Timeline Header (Dates) */}
        <div className="ari-chart-row" style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 20, borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
          {/* Top-left empty corner */}
          <div className="ari-room-column ari-room-heading" style={{ position: 'sticky', left: 0, zIndex: 21, flexShrink: 0, borderRight: '1px solid #e5e7eb', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#6b7280' }}>{labelUi("Loại phòng / Phòng")}</span>
          </div>
          
          {/* Date Columns */}
          <div style={{ display: 'flex', flex: 1, overflowX: 'hidden' }}>
            {dates.map((d, i) => (
              <div key={i} className="ari-date-cell" style={{
                flex: '0 0 100px',
                borderRight: '1px solid #e5e7eb', 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center',
                backgroundColor: isToday(d) ? '#eff6ff' : (isWeekend(d) ? '#fef2f2' : 'transparent')
              }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: isToday(d) ? '#2563eb' : (isWeekend(d) ? '#dc2626' : '#6b7280'), textTransform: 'uppercase' }}>
                  {getDayName(d)}
                </span>
                <span style={{ fontSize: '18px', fontWeight: 'bold', color: isToday(d) ? '#2563eb' : '#111827', marginTop: '2px' }}>
                  {d.getDate()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Timeline Body (Scrollable both ways) */}
        <div className="ari-chart-row" style={{ display: 'flex' }}>
          
          {/* Left Fixed Column: Room Types & Rooms */}
          <div className="ari-room-column" style={{ position: 'sticky', left: 0, flexShrink: 0, borderRight: '1px solid #e5e7eb', backgroundColor: '#fff', zIndex: 10 }}>
            {groups.map((rt) => (
              <div key={rt.id}>
                {/* Room Type Row */}
                <div className="ari-room-type" style={{ height: '44px', backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex' }}>
                  <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#111827' }}>{rt.name}</span>
                  <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500' }}>{rt.price}</span>
                </div>
                {/* Rooms */}
                {rt.rooms.map((room) => (
                  <div key={room.id} data-room-id={room.id} title={room.name} className={`ari-room-label${room.blocked ? ' ari-room-blocked' : ''}`} style={{ height: '48px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="ari-room-dot" aria-hidden="true" />
                      <div className="ari-room-caption"><span style={{ fontSize: '14px', fontWeight: '600', color: '#4b5563' }}>{room.name}</span>{room.blocked && <small>{tUi('rooms.blocked')}</small>}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Right Scrollable Grid: Bookings */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 'fit-content' }}>
            {groups.map((rt) => (
              <div key={rt.id}>
                {/* Room Type Availability Row */}
                <div style={{ display: 'flex', height: '44px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                  {rt.available.map((av, i) => (
                    <div key={i} style={{ width: '100px', flexShrink: 0, borderRight: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: av === 0 ? '#ef4444' : '#6b7280' }}>
                        {av === 0 ? labelUi("Hết") : av}
                      </span>
                    </div>
                  ))}
                </div>
                
                {/* Room Rows */}
                {rt.rooms.map((room) => {
                  // Find bookings for this room
                  const roomBookings = bookings.filter(b => b.room === String(room.id));
                  
                  return (
                    <div key={room.id} data-room-id={room.id} className="ari-room-track" style={{ display: 'flex', height: '48px', borderBottom: '1px solid #f3f4f6', position: 'relative' }}>
                      
                      {/* Empty Grid Cells */}
                      {dates.map((d, i) => {
                        const date = addDays(currentDate, i);
                        const blocked = roomIsBlocked(room, roomBlocks, date, addDays(date, 1));
                        return <div key={i} data-date={date} className={blocked ? 'ari-cell-blocked' : undefined} title={blocked ? `${room.name}, ${formatDate(date)}: ${tUi('rooms.blocked')}` : undefined} style={{
                          width: '100px', flexShrink: 0, borderRight: '1px solid #f3f4f6',
                          backgroundColor: blocked ? undefined : isWeekend(d) ? '#fffaf5' : 'transparent'
                        }}>{blocked && <span className="ari-blocked-caption">{room.condition === 'maintenance' ? tUi('hk.maintenance') : tUi('rooms.blocked')}</span>}</div>;
                      })}

                      {/* Booking Pills */}
                      {roomBookings.map((booking) => (
                        <button className="ari-booking" aria-label={`${booking.guest}, phòng ${room.name}, ${formatDate(booking.checkIn)} đến ${formatDate(booking.checkOut)}`} onClick={() => setSelectedBookingId(booking.id)} key={`${booking.id}:${booking.colStart}`} style={{ border: 'none', textAlign: 'left',
                          position: 'absolute',
                          left: `${booking.colStart * 100 + 2}px`, // 100px per day, 2px inset
                          width: `${booking.colSpan * 100 - 4}px`,
                          backgroundColor: booking.bgColor,
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0 8px',
                          color: '#fff',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          transition: 'transform 0.1s, filter 0.1s',
                          zIndex: 5
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                        title={`${booking.guest} (${booking.status})`}
                        >
                          <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold', marginRight: '4px', flexShrink: 0 }}>
                            {booking.guest.charAt(0)}
                          </div>
                          <span style={{ fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {booking.guest}
                          </span>
                          
                          {/* Payment Status Icon */}
                          <div style={{
                            width: '18px', height: '18px', borderRadius: '50%',
                            background: booking.payment === 'paid' ? '#10b981' : booking.payment === 'partial' ? 'linear-gradient(to right, #3b82f6 50%, #e5e7eb 50%)' : '#e5e7eb',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '1px solid #fff',
                            marginLeft: 'auto', flexShrink: 0
                          }} title={booking.payment === 'paid' ? tUi("rooms.paidFull") : booking.payment === 'partial' ? labelUi("Đã cọc / Thanh toán 1 phần") : labelUi("Chưa thanh toán")}>
                            <span style={{ fontSize: '11px', color: booking.payment === 'paid' ? '#fff' : (booking.payment === 'partial' ? '#fff' : '#6b7280'), fontWeight: 'bold' }}>$</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          
        </div>
      </div>
      {selectedBookingId && <BookingDetailPanel bookingId={selectedBookingId} onClose={() => setSelectedBookingId(null)} />}
    </div>
  );
}
