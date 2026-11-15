import { t } from '../../../../shared/i18n/useI18n.js';
import { roomLocationOptions } from '../roomLocations.js';

export default function RoomLocationFilters({ rooms, area, floor, onAreaChange, onFloorChange, idPrefix }) {
  return <>
    <label className="loha-rooms-visually-hidden" htmlFor={`${idPrefix}-area`}>{t('rooms.area')}</label>
    <select id={`${idPrefix}-area`} value={area} onChange={event => onAreaChange(event.target.value)}>
      <option value="">{t('rooms.allAreas')}</option>
      {roomLocationOptions(rooms, 'area').map(option => <option key={option.filterValue} value={option.filterValue} data-i18n-ignore>{option.value ?? t('rooms.unassignedArea')}</option>)}
    </select>
    <label className="loha-rooms-visually-hidden" htmlFor={`${idPrefix}-floor`}>{t('rooms.floor')}</label>
    <select id={`${idPrefix}-floor`} value={floor} onChange={event => onFloorChange(event.target.value)}>
      <option value="">{t('rooms.allFloors')}</option>
      {roomLocationOptions(rooms, 'floor').map(option => <option key={option.filterValue} value={option.filterValue} data-i18n-ignore>{option.value === null ? t('rooms.unassignedFloor') : t('rooms.floorName', { floor: option.value })}</option>)}
    </select>
  </>;
}
