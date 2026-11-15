import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePms } from '../../data/usePms';
import { Plus } from 'lucide-react';
import RoomLocationFilters from '../components/RoomLocationFilters';
import { matchesRoomLocationFilters, roomLocationValue } from '../roomLocations.js';
import './RoomDiagram.css';

export default function Rooms() {
  useI18n();
  const { rooms, roomTypes, access } = usePms();
  const navigate = useNavigate();
  const [areaFilter, setAreaFilter] = useState('');
  const [floorFilter, setFloorFilter] = useState('');
  const visibleRooms = rooms.filter(room => matchesRoomLocationFilters(room, { area: areaFilter, floor: floorFilter }));

  return (
    <div className="loha-rooms">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1e293b' }}>{tUi("rooms.physical")}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          {access('settings.write').allowed && <Link to="/id/settings?section=rooms&tab=room_locations">{tUi('rooms.configureLocations')}</Link>}
          <button disabled={!access('settings.write').allowed} onClick={() => navigate('/id/settings?section=rooms&tab=room_types')} style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '16px' }}>
            <Plus size={20} />{' '}{tUi("rooms.add")}</button>
        </div>
      </div>

      <div className="loha-rooms-filters" style={{ marginBottom: '16px' }}>
        <RoomLocationFilters rooms={rooms} area={areaFilter} floor={floorFilter} onAreaChange={setAreaFilter} onFloorChange={setFloorFilter} idPrefix="rooms" />
      </div>

      <div role="region" aria-label={tUi('rooms.list')} tabIndex={0} style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <tr>
              <th style={{ padding: '16px', color: '#475569', fontWeight: 'bold' }}>{tUi("rooms.number")}</th>
              <th style={{ padding: '16px', color: '#475569', fontWeight: 'bold' }}>{tUi("rooms.name")}</th>
              <th style={{ padding: '16px', color: '#475569', fontWeight: 'bold' }}>{tUi("common.roomType")}</th>
              <th style={{ padding: '16px', color: '#475569', fontWeight: 'bold' }}>{tUi("rooms.area")}</th>
              <th style={{ padding: '16px', color: '#475569', fontWeight: 'bold' }}>{tUi("rooms.floor")}</th>
              <th style={{ padding: '16px', color: '#475569', fontWeight: 'bold' }}>{tUi("rooms.cleaningStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRooms.map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '16px', fontWeight: 'bold', fontSize: '16px' }}>{item.id}</td>
                <td style={{ padding: '16px', fontSize: '16px' }}>{tUi('rooms.roomName', { room: item.id })}</td>
                <td style={{ padding: '16px', fontSize: '16px', color: '#64748b' }}>{roomTypes.find(type => type.id === item.typeId)?.name || tUi('rooms.noType')}</td>
                <td data-i18n-ignore style={{ padding: '16px', fontSize: '16px' }}>{roomLocationValue(item.area) ?? tUi('rooms.unassignedArea')}</td>
                <td data-i18n-ignore style={{ padding: '16px', fontSize: '16px' }}>{roomLocationValue(item.floor) === null ? tUi('rooms.unassignedFloor') : tUi('rooms.floorName', { floor: roomLocationValue(item.floor) })}</td>
                <td style={{ padding: '16px' }}>
                  <span style={{ backgroundColor: item.condition === 'clean' ? '#d1fae5' : '#fee2e2', color: item.condition === 'clean' ? '#059669' : '#dc2626', padding: '6px 12px', borderRadius: '20px', fontSize: '14px', fontWeight: 'bold' }}>
                    {labelUi(({clean:'Sạch sẽ',dirty:'Phòng bẩn',inspection:'Đang kiểm tra',maintenance:'Bảo trì / hỏng'})[item.condition])}
                  </span>
                </td>
              </tr>
            ))}
            {!visibleRooms.length && <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>{rooms.length ? tUi('rooms.noMatch') : tUi('rooms.none')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
