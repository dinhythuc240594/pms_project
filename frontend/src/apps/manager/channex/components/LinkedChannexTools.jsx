import { tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useState } from 'react'
import { BedDouble, CalendarDays, ChartNoAxesCombined } from 'lucide-react'
import { BookingsView, CatalogView, InventoryView } from './PropertyViews'
import '../ChannexSurface.css'

const tabs = [
  ['catalog', 'Phòng & gói giá', BedDouble],
  ['bookings', 'Đặt phòng trên Channex', CalendarDays],
  ['inventory', 'Tồn phòng & giá trên Channex', ChartNoAxesCombined],
]

export default function LinkedChannexTools({ pms, connection }) {
  useI18n()
  const [tab, setTab] = useState('catalog')
  const account = { id: 'hotel:' + pms.tenantId, environment: connection.environment }
  const property = {
    id: connection.propertyId,
    name: pms.tenant?.name,
    timezone: pms.settings.timezone,
    currency: pms.settings.currency,
  }
  const props = { account, property }
  const canWrite = pms.access('channels.write', 'OTA_SYNC', true).allowed
  return (
    <section
      className="manager-panel channex-surface"
      aria-label={labelUi('Dữ liệu Channex của khách sạn đang chọn')}
    >
      <nav className="channex-tabs" aria-label={labelUi('Dữ liệu Channex nâng cao')}>
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            className={tab === id ? 'is-active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={16} aria-hidden="true" />
            {labelUi(label)}
          </button>
        ))}
      </nav>
      {tab === 'catalog' && <CatalogView {...props} canWrite={canWrite} />}
      {tab === 'bookings' && <BookingsView {...props} />}
      {tab === 'inventory' && <InventoryView {...props} />}
    </section>
  )
}
