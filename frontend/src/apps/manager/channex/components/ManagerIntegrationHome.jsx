import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, Building2, RefreshCw, Search } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import { connectionStatus } from '../../../pms/channel-manager/presentation'
import ManagerOTA from '../../tenants/pages/ManagerOTA'
import { useChannexQuery } from '../useChannexQuery'
import { DataState } from './RemoteData'

export default function ManagerIntegrationHome() {
  useI18n()
  const { getManagerChannels } = usePms()
  const query = useChannexQuery(getManagerChannels, 'hotels')
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const selected = params.get('hotel') || ''
  const hotels = query.data?.hotels || []
  const rows = hotels.filter((hotel) =>
    `${hotel.name} ${hotel.city || ''}`
      .toLocaleLowerCase('vi')
      .includes(search.toLocaleLowerCase('vi')),
  )
  function choose(tenantId) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (tenantId) next.set('hotel', tenantId)
      else next.delete('hotel')
      next.delete('tab')
      return next
    })
  }
  return (
    <div className="manager-channex manager-ota">
      <section className="manager-panel channex-hotel-picker">
        <div className="channex-section-heading">
          <button
            type="button"
            className="manager-button"
            disabled={query.loading}
            onClick={query.refresh}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {tUi('common.reload')}
          </button>
        </div>
        <DataState query={query} label="khách sạn PMS">
          <div className="channex-hotel-controls">
            <label>
              {labelUi('Khách sạn PMS')}
              <select
                value={hotels.some((hotel) => hotel.tenantId === selected) ? selected : ''}
                onChange={(event) => choose(event.target.value)}
              >
                <option value="">{labelUi('Xem tất cả khách sạn')}</option>
                {hotels.map((hotel) => (
                  <option key={hotel.tenantId} value={hotel.tenantId}>
                    {hotel.name}
                    {hotel.status?.toLowerCase() !== 'active' ? ' ' + labelUi('· Tạm ngưng') : ''}
                  </option>
                ))}
              </select>
            </label>
            {!selected && (
              <label>
                <span>
                  <Search size={14} aria-hidden="true" />
                  {labelUi('Tìm khách sạn')}
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={labelUi('Tên hoặc thành phố')}
                />
              </label>
            )}
          </div>
          {!selected && (
            <ul className="channex-hotel-list">
              {rows.map((hotel) => {
                const status = connectionStatus(hotel.connection)
                return (
                  <li key={hotel.tenantId}>
                    <Building2 size={22} aria-hidden="true" />
                    <div>
                      <strong>{hotel.name}</strong>
                      <p>
                        {hotel.city || labelUi('Khách sạn PMS')} · {hotel.mappingCount}/
                        {hotel.roomTypeCount} loại phòng đã ghép
                      </p>
                    </div>
                    <span className={`ota-status ota-status--${status.tone}`}>{status.label}</span>
                    <button
                      type="button"
                      className="manager-button"
                      onClick={() => choose(hotel.tenantId)}
                    >
                      {hotel.connection
                        ? labelUi('Quản lý & đồng bộ')
                        : labelUi('Thiết lập kết nối')}
                      <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
              {!rows.length && (
                <li role="status">
                  {hotels.length
                    ? labelUi('Không tìm thấy khách sạn phù hợp.')
                    : labelUi('Chưa có khách sạn bật tính năng OTA.')}
                </li>
              )}
            </ul>
          )}
        </DataState>
      </section>
      {selected && <ManagerOTA tenantId={selected} embedded />}
    </div>
  )
}
