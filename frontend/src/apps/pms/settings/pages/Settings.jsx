import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Building2,
  Bed,
  ShoppingCart,
  Calculator,
  Package,
  ShieldCheck,
  Warehouse,
  Boxes,
  Truck,
  Ruler,
  ClipboardList,
  Layers3,
  Link2,
} from 'lucide-react'
import { usePms } from '../../data/usePms'
import { HOTEL_CURRENCY_CODES } from '../../../../shared/lib/currencies.js'
import { CORE_ROLES as ROLE_ACTIONS } from '../../data/api'
import { ROLE_NAMES } from '../../data/access'
import { AccessMessage } from '../../../../shared/components/AccessControl'
import { useRevealActive } from '../../components/useRevealActive'
import IntegrationWorkspace from '../../channel-manager/pages/IntegrationWorkspace'
import InventorySettings from '../../inventory/pages/InventorySettings'
import PricingExchangeRates from '../../rates-inventory/pages/ExchangeRates'
import CommissionPage from '../../finance/pages/Commissions'
import RoomLocations from './RoomLocations.jsx'
import RoomTypesGrid from './RoomTypesGrid.jsx'
import InventoryUnits from './InventoryUnits.jsx'
import { BusinessProfile, BusinessPolicies } from './BusinessSettings.jsx'
import { MasterGrid, BookingSources } from './SettingsCatalogs.jsx'
import './InventorySettingsShell.css'
import './Settings.css'

const SETTING_GROUPS = [
  {
    id: 'business',
    name: 'Thông tin Doanh nghiệp',
    icon: Building2,
    tabs: [
      ['profile', 'settings.profileTab'],
      ['policies', 'settings.policies'],
      ['sources', 'settings.bookingSources'],
    ],
  },
  {
    id: 'rooms',
    name: 'Phòng & Loại giường',
    icon: Bed,
    tabs: [
      ['room_types', 'settings.roomTypes'],
      ['room_locations', 'rooms.configureLocations'],
      ['bed_types', 'settings.beds'],
    ],
  },
  {
    id: 'services',
    name: 'Dịch vụ & Bán hàng',
    icon: ShoppingCart,
    tabs: [
      ['services', 'settings.catalogServices'],
      ['meals', 'settings.meals'],
      ['sources', 'settings.bookingSources'],
    ],
  },
  {
    id: 'accounting',
    name: 'Kế toán & Thanh toán',
    icon: Calculator,
    tabs: [
      ['transactions', 'settings.cashCategories'],
      ['payments', 'payments.method'],
      // ['currency', 'settings.currency'],
      // ['commissions', 'settings.commissions']
    ],
  },
  {
    id: 'inventory',
    name: 'Kho & Mua hàng',
    icon: Package,
    tabs: [
      ['warehouses', 'inventory.warehouses', Warehouse],
      ['items', 'settings.items', Boxes],
      ['suppliers', 'inventory.supplier', Truck],
      ['units', 'inventory.unit', Ruler],
      ['opening', 'inventory.opening', ClipboardList],
      ['service_stock', 'settings.posStock', Layers3],
    ],
  },
  { id: 'channels', name: 'Channex & Kênh OTA', icon: Link2 },
  {
    id: 'system',
    name: 'Hệ thống & Bảo mật',
    icon: ShieldCheck,
    tabs: [['roles', 'settings.roles']],
  },
]

function SettingsTabs({ tabs, value, onChange, label, nested = false }) {
  const ref = useRef(null)
  useRevealActive(ref, value)
  return (
    <div
      ref={ref}
      className={`pms-settings-tabs${nested ? ' is-nested' : ''}`}
      role="group"
      aria-label={label}
    >
      {tabs.map(([id, key, Icon]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
          {Icon && <Icon size={16} aria-hidden="true" />}
          <span>{tUi(key)}</span>
        </button>
      ))}
    </div>
  )
}

export default function Settings() {
  useI18n()
  const pms = usePms(),
    { tenantId } = pms
  const [params, setParams] = useSearchParams()
  const groups = SETTING_GROUPS.filter(
    (group) => pms.routeAccess('/id/settings').allowed || group.id === 'channels',
  )
  const group = groups.find((candidate) => candidate.id === params.get('section')) || groups[0]
  const requested = params.get('tab')
  const tab = group.tabs
    ? group.tabs.find(([id]) => id === requested)?.[0] || group.tabs[0][0]
    : requested || 'overview'
  const navigationRef = useRef(null)
  useRevealActive(navigationRef, group.id)
  const Icon = group.icon

  function content() {
    switch (group.id) {
      case 'business':
        return tab === 'profile' ? (
          <BusinessProfile key={tenantId} />
        ) : tab === 'policies' ? (
          <BusinessPolicies key={tenantId} />
        ) : (
          <BookingSources key={tenantId} />
        )
      case 'rooms':
        return tab === 'room_types' ? (
          <RoomTypesGrid key={tenantId} />
        ) : tab === 'room_locations' ? (
          <RoomLocations key={tenantId} />
        ) : (
          <MasterGrid
            key={`beds:${tenantId}`}
            catalog="bedTypes"
            title={tUi('settings.beds')}
            fields={[{ key: 'name', label: 'Tên loại giường' }]}
          />
        )
      case 'services':
        return tab === 'services' ? (
          <ServiceCategories key={tenantId} />
        ) : tab === 'meals' ? (
          <MasterGrid
            key={`meals:${tenantId}`}
            catalog="meals"
            title={tUi('settings.meals')}
            activation
            fields={[
              { key: 'name', label: 'Tên bữa ăn' },
              { key: 'price', label: 'Phụ thu', type: 'number' },
            ]}
          />
        ) : (
          <BookingSources key={tenantId} />
        )
      case 'accounting':
        return tab === 'transactions' ? (
          <CashbookCategories key={tenantId} />
        ) : tab === 'payments' ? (
          <PaymentMethods key={tenantId} />
        ) : tab === 'currency' ? (
          <div className="pms-settings-embedded">
            <PricingExchangeRates />
          </div>
        ) : (
          <Commissions key={tenantId} />
        )
      case 'inventory':
        return tab === 'units' ? (
          <InventoryUnits key={tenantId} />
        ) : (
          <InventorySettings catalog={tab} />
        )
      case 'channels': {
        const access = pms.access('channels.view', 'OTA_SYNC', false)
        return access.allowed ? (
          <IntegrationWorkspace
            key={`${tenantId}:${pms.authGeneration}`}
            pms={pms}
            embedded
            hideHeading
          />
        ) : (
          <AccessMessage result={access} />
        )
      }
      case 'system':
        return <RoleMatrix />
      default:
        return null
    }
  }

  return (
    <div className="pms-settings">
      <aside className="pms-settings-navigation" aria-label={tUi('nav.settingsShort')}>
        <div className="pms-settings-navigation-heading">
          <h1>{tUi('nav.settingsShort')}</h1>
          <p>{tUi('settings.catalogs')}</p>
        </div>
        <nav
          ref={navigationRef}
          className="pms-settings-groups"
          aria-label={tUi('settings.catalogs')}
        >
          {groups.map((item) => {
            const GroupIcon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={group.id === item.id}
                onClick={() => setParams({ section: item.id })}
              >
                <GroupIcon size={18} aria-hidden="true" />
                <span>{labelUi(item.name)}</span>
              </button>
            )
          })}
        </nav>
      </aside>
      <div className="pms-settings-content">
        <div className="pms-settings-workspace">
          <section
            className={`pms-settings-section${group.id === 'inventory' ? ' inventory-settings-section' : ''}`}
            aria-labelledby="pms-settings-section-title"
          >
            <header className="pms-settings-heading">
              <span className="pms-settings-heading-icon">
                <Icon size={23} aria-hidden="true" />
              </span>
              <div>
                <h2 id="pms-settings-section-title">{labelUi(group.name)}</h2>
                <p>{tUi(`settingsUi.${group.id}Description`)}</p>
              </div>
            </header>
            {group.tabs && (
              <SettingsTabs
                tabs={group.tabs}
                value={tab}
                onChange={(value) => setParams({ section: group.id, tab: value })}
                label={labelUi(group.name)}
              />
            )}
            <div className="pms-settings-section-content">{content()}</div>
          </section>
        </div>
      </div>
    </div>
  )
}

function ServiceCategories() {
  useI18n()
  const { serviceCategories, units } = usePms()
  return (
    <>
      <MasterGrid
        catalog="serviceCategories"
        title={tUi('settings.mergedServices')}
        description={tUi('settings.serviceCatalog')}
        fields={[
          { key: 'name', label: 'Tên Nhóm (Danh mục)' },
          { key: 'tax', label: 'VAT (%)', type: 'number' },
        ]}
      />
      <MasterGrid
        catalog="services"
        searchable
        title={tUi('settings.categoryServices')}
        description={tUi('settings.posServices')}
        fields={[
          { key: 'name', label: 'Tên Dịch vụ' },
          {
            key: 'category',
            label: 'Nhóm',
            options: serviceCategories
              .filter((category) => category.active !== false)
              .map((category) => category.name),
          },
          { key: 'price', label: 'Giá bán', type: 'number' },
          {
            key: 'unit',
            label: 'Đơn vị tính',
            options: units.filter((unit) => unit.active !== false).map((unit) => unit.name),
          },
        ]}
      />
    </>
  )
}

function PaymentMethods() {
  useI18n()
  const { settings } = usePms()
  return (
    <>
      <MasterGrid
        catalog="paymentMethods"
        title={tUi('payments.method')}
        activation
        fields={[
          { key: 'name', label: 'Tên phương thức' },
          {
            key: 'type',
            label: 'Loại',
            options: [
              'CASH',
              'BANK_TRANSFER',
              'CREDIT_CARD',
              'DEBIT_CARD',
              'E_WALLET',
              'CITY_LEDGER',
            ],
          },
        ]}
      />
      <MasterGrid
        catalog="funds"
        title={tUi('payments.fund')}
        activation
        fields={[
          { key: 'name', label: 'Tên quỹ' },
          { key: 'type', label: 'Loại', options: ['cash', 'bank'] },
          {
            key: 'currency',
            label: 'Tiền tệ',
            options: HOTEL_CURRENCY_CODES,
            default: settings?.currency || 'VND',
          },
          { key: 'accountNumber', label: 'Số tài khoản' },
          { key: 'bank', label: 'Ngân hàng' },
        ]}
      />
    </>
  )
}

function CashbookCategories() {
  useI18n()
  return (
    <MasterGrid
      catalog="cashbookCategories"
      searchable
      title={tUi('settings.cashCategories')}
      description={tUi('settings.cashCategoryHint')}
      activation
      fields={[
        { key: 'name', label: 'Tên danh mục thu chi' },
        {
          key: 'type',
          label: 'Loại thu chi',
          default: 'INCOME',
          options: [
            { value: 'INCOME', label: 'Khoản thu' },
            { value: 'EXPENSE', label: 'Khoản chi' },
          ],
        },
      ]}
    />
  )
}

function Commissions() {
  useI18n()
  const { commissionTypes } = usePms()
  const [tab, setTab] = useState('settlements')
  const typeOptions = commissionTypes.map((type) => ({
    value: type.id,
    label: type.name + (type.active === false ? ` (${tUi('common.inactive')})` : ''),
    disabled: type.active === false,
  }))
  return (
    <div className="pms-settings-commissions">
      <SettingsTabs
        nested
        tabs={[
          ['settlements', 'settings.settleCommission'],
          ['types', 'settings.commissionCostType'],
          ['subjects', 'settings.commissionRecipient'],
        ]}
        value={tab}
        onChange={setTab}
        label={tUi('settings.commissions')}
      />
      {tab !== 'settlements' && (
        <p className="pms-settings-hint">{tUi('settings.commissionCatalogHint')}</p>
      )}
      {tab === 'settlements' ? (
        <div className="pms-settings-embedded">
          <CommissionPage />
        </div>
      ) : tab === 'types' ? (
        <MasterGrid
          key="commissionTypes"
          catalog="commissionTypes"
          title={tUi('settings.commissionCostType')}
          description={tUi('settings.addCostFirst')}
          activation
          fields={[{ key: 'name', label: 'Tên loại chi phí hoa hồng' }]}
        />
      ) : (
        <>
          {!commissionTypes.some((type) => type.active !== false) && (
            <p className="pms-settings-hint" role="status">
              {tUi('settings.activeCostRequired')}
            </p>
          )}
          <MasterGrid
            key="commissionRules"
            catalog="commissionRules"
            title={tUi('settings.commissionRecipient')}
            description={tUi('settings.commissionRecipientHint')}
            activation
            fields={[
              { key: 'name', label: 'Tên đối tượng nhận hoa hồng' },
              { key: 'typeId', label: 'Loại chi phí hoa hồng', options: typeOptions },
            ]}
          />
        </>
      )}
    </div>
  )
}

function RoleMatrix() {
  useI18n()
  const roles = ['HOTEL_OWNER', 'FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTANT']
  const actions = [
    ['rooms.view', 'Xem sơ đồ phòng'],
    ['reservations.view', 'Xem đặt phòng'],
    ['reservations.write', 'Tạo / sửa / đổi trạng thái booking'],
    ['housekeeping.write', 'Cập nhật buồng phòng'],
    ['payments.write', 'Thanh toán / hoàn tiền / phụ thu'],
    ['reports.view', 'Xem báo cáo'],
    ['settings.write', 'Cài đặt khách sạn'],
    ['users.write', 'Quản lý người dùng'],
  ]
  return (
    <section className="pms-settings-panel">
      <header className="pms-settings-panel-heading">
        <h3>{tUi('settings.roleDefaults')}</h3>
        <p>{tUi('settings.rolesHint')}</p>
      </header>
      <div
        className="pms-settings-table"
        role="region"
        aria-label={tUi('settings.roleDefaults')}
        tabIndex={0}
      >
        <table className="pms-settings-role-table">
          <thead>
            <tr>
              <th scope="col">{tUi('common.actions')}</th>
              {roles.map((role) => (
                <th scope="col" key={role}>
                  {labelUi(ROLE_NAMES[role])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {actions.map(([action, name]) => (
              <tr key={action}>
                <th scope="row">{labelUi(name)}</th>
                {roles.map((role) => (
                  <td key={role}>
                    {ROLE_ACTIONS[role].includes('*') || ROLE_ACTIONS[role].includes(action) ? (
                      <span className="pms-settings-permission">✓</span>
                    ) : (
                      <span className="pms-settings-muted">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
