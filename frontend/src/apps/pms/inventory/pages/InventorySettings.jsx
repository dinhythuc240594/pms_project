import { decimalInput } from '../../../../shared/lib/number.js'
import { phoneInput, phonePattern } from '../../../../shared/lib/phone.js'
import { emailInput, emailPattern, taxIdPattern } from '../../../../shared/lib/validation.js'
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useId, useRef, useState } from 'react'
import {
  Boxes,
  Check,
  CircleCheck,
  Edit2,
  FolderTree,
  MapPin,
  Package,
  Plus,
  Power,
  Save,
  Search,
  Truck,
  Warehouse,
  X,
} from 'lucide-react'
import { usePms } from '../../data/usePms'
import { useInventoryQuery } from '../useInventoryQuery'
import InventoryDocuments, { InventoryLines } from '../InventoryDocuments'
import { quantityText } from '../values'
import '../../components/DomainForms.css'
import '../Inventory.css'
import './InventorySettings.css'

const definitions = {
  warehouses: {
    title: 'Danh sách kho',
    nameKey: 'warehousesName',
    icon: Warehouse,
    description: 'Kho dùng để ghi nhận hàng nhập, hàng xuất và chuyển kho.',
    fields: [
      { key: 'name', label: 'Tên kho', required: true },
      { key: 'location', label: 'Vị trí' },
      { key: 'isDefault', label: 'Kho mặc định', type: 'checkbox', group: 'otherInfo' },
    ],
  },
  itemCategories: {
    title: 'Danh mục mặt hàng',
    nameKey: 'itemCategoriesName',
    icon: FolderTree,
    description: 'Nhóm hàng hóa để sắp xếp và tra cứu.',
    fields: [
      { key: 'name', label: 'Tên danh mục', required: true },
      { key: 'parentId', label: 'Danh mục cha', catalog: 'itemCategories' },
      { key: 'sortOrder', label: 'Thứ tự', type: 'number', integer: true, default: '0' },
    ],
  },
  items: {
    title: 'Hàng hóa & Vật tư',
    nameKey: 'itemsName',
    icon: Package,
    description: 'Giá vốn ban đầu chỉ là cấu hình mặt hàng; tồn thực tế được ghi qua phiếu kho.',
    fields: [
      { key: 'name', label: 'Tên mặt hàng', required: true },
      { key: 'sku', label: 'Mã hàng / SKU', required: true },
      { key: 'categoryId', label: 'Danh mục', catalog: 'itemCategories' },
      { key: 'unit', label: 'Đơn vị tính', required: true },
      {
        key: 'costPrice',
        label: 'Giá vốn cấu hình',
        type: 'number',
        default: '0',
        group: 'pricingInfo',
      },
      { key: 'sellingPrice', label: 'Giá bán', type: 'number', default: '0', group: 'pricingInfo' },
      {
        key: 'minStock',
        label: 'Ngưỡng cảnh báo tồn',
        type: 'number',
        default: '0',
        group: 'pricingInfo',
      },
    ],
  },
  suppliers: {
    title: 'Nhà cung cấp',
    nameKey: 'suppliersName',
    icon: Truck,
    description: 'Thông tin đối tác gắn với các phiếu nhập kho.',
    fields: [
      { key: 'name', label: 'Tên nhà cung cấp', required: true },
      { key: 'taxCode', label: 'Mã số thuế' },
      { key: 'contactPerson', label: 'Người liên hệ', group: 'contactInfo' },
      { key: 'phone', label: 'Điện thoại', type: 'tel', group: 'contactInfo' },
      { key: 'email', label: 'Email', type: 'email', group: 'contactInfo' },
      { key: 'address', label: 'Địa chỉ', group: 'contactInfo' },
      { key: 'bankName', label: 'Ngân hàng', group: 'paymentInfo' },
      { key: 'bankAccount', label: 'Số tài khoản ngân hàng', group: 'paymentInfo' },
      { key: 'notes', label: 'Ghi chú', type: 'textarea', group: 'otherInfo' },
    ],
  },
}

function StatusBadge({ active, recipe = false }) {
  return (
    <span className={`inventory-settings-status ${active ? 'is-active' : 'is-inactive'}`}>
      <span aria-hidden="true" />
      {recipe
        ? tUi(active ? 'hk.applying' : 'hk.stopped')
        : tUi(active ? 'common.active' : 'common.inactive')}
    </span>
  )
}

function EmptyState({ filtered = false, onClear }) {
  return (
    <div className="inventory-settings-empty">
      <span className="inventory-settings-empty-icon" aria-hidden="true">
        {filtered ? <Search size={24} /> : <Boxes size={28} />}
      </span>
      <strong>{tUi(`inventorySettings.${filtered ? 'noResults' : 'empty'}`)}</strong>
      <p>{tUi(`inventorySettings.${filtered ? 'noResultsHint' : 'emptyHint'}`)}</p>
      {filtered && (
        <button type="button" className="inventory-settings-text-button" onClick={onClear}>
          {tUi('inventorySettings.clearFilters')}
        </button>
      )}
    </div>
  )
}

function MasterEditor({ catalog, data, pms, refreshed }) {
  useI18n()
  const definition = definitions[catalog],
    Icon = definition.icon
  const blank = () => ({
    active: true,
    ...Object.fromEntries(
      definition.fields.map((field) => [
        field.key,
        field.default ?? (field.type === 'checkbox' ? false : ''),
      ]),
    ),
  })
  const [draft, setDraft] = useState(null),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const inFlight = useRef(false),
    formRef = useRef(null),
    triggerRef = useRef(null)
  const formId = useId(),
    editing = draft !== null,
    draftId = draft?.id
  useEffect(() => {
    if (editing) formRef.current?.querySelector('input, select, textarea')?.focus()
    else triggerRef.current?.focus()
  }, [editing, draftId])
  const canWrite = pms.access('inventory.write').allowed
  const allRows = data[catalog] || []
  const term = search.trim().toLocaleLowerCase('vi')
  const rows = allRows.filter(
    (row) =>
      (!status || (row.active !== false) === (status === 'active')) &&
      definition.fields.some(
        (field) =>
          !['checkbox', 'number'].includes(field.type) &&
          String(row[field.key] ?? '')
            .toLocaleLowerCase('vi')
            .includes(term),
      ),
  )
  const singular = tUi(`inventorySettings.${definition.nameKey}`)
  const close = () => {
    setDraft(null)
    setError('')
  }
  function edit(row, event) {
    triggerRef.current = event.currentTarget
    setDraft({ ...blank(), ...row })
    setError('')
    setNotice('')
  }
  async function save(input, clear = false) {
    if (inFlight.current || !canWrite) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await pms.saveInventoryMaster(catalog, input)
      if (clear) setDraft(null)
      else if (draft?.id === input.id)
        setDraft((previous) => ({ ...previous, active: input.active }))
      setNotice(tUi('inventorySettings.saved'))
      refreshed()
    } catch (err) {
      setError(err.message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  function submit(event) {
    event.preventDefault()
    try {
      const values = Object.fromEntries(
        definition.fields.map((field) => {
          const value = draft[field.key]
          if (field.integer)
            return [field.key, Number(decimalInput(value, { precision: 0, max: '100000' }))]
          if (field.type === 'number') return [field.key, decimalInput(value)]
          if (field.catalog) return [field.key, value || null]
          if (field.type === 'checkbox') return [field.key, value]
          const text = value.trim(),
            maximum = ['address', 'notes'].includes(field.key)
              ? 500
              : ['sku', 'unit'].includes(field.key)
                ? 80
                : 160
          if ((field.required && !text) || text.length > maximum)
            throw new Error(
              `${field.label}: nhập tối đa ${maximum} ký tự${field.required ? ' và không để trống' : ''}.`,
            )
          return [field.key, text]
        }),
      )
      if (catalog === 'suppliers') {
        values.phone = phoneInput(values.phone)
        if (values.email) values.email = emailInput(values.email)
        if (values.taxCode && !new RegExp(`^(?:${taxIdPattern})$`, 'u').test(values.taxCode))
          throw new Error('Mã số thuế chỉ gồm chữ số và có thể có hậu tố -xxx.')
      }
      save({ ...(draft.id ? { id: draft.id } : {}), active: draft.active, ...values }, true)
    } catch (err) {
      setError(err.message)
    }
  }
  const groups = [
    ...new Set(definition.fields.map((field) => field.group || 'basicInfo')),
    'status',
  ]
  const columns =
    catalog === 'warehouses'
      ? ['name', 'location', 'isDefault']
      : catalog === 'items'
        ? ['name', 'categoryId', 'pricing', 'minStock']
        : catalog === 'suppliers'
          ? ['name', 'contact', 'taxCode']
          : ['name', 'parentId', 'sortOrder']
  const columnLabel = (key) =>
    key === 'pricing' || key === 'contact'
      ? tUi(`inventorySettings.${key}`)
      : key === 'minStock'
        ? tUi('inventorySettings.stockThreshold')
        : labelUi(definition.fields.find((field) => field.key === key).label)
  function shown(row, key) {
    if (key === 'name')
      return (
        <div className="inventory-settings-record">
          <span className="inventory-settings-record-icon" aria-hidden="true">
            <Icon size={17} />
          </span>
          <span>
            <strong>{row.name}</strong>
            {catalog === 'items' && (
              <small>
                <span className="inventory-settings-sku">{row.sku}</span>
                {row.unit && <> · {row.unit}</>}
              </small>
            )}
            {catalog === 'suppliers' && row.address && <small>{row.address}</small>}
          </span>
        </div>
      )
    if (key === 'isDefault')
      return row.isDefault ? (
        <span className="inventory-settings-default">
          <Check size={13} aria-hidden="true" />
          {tUi('inventorySettings.default')}
        </span>
      ) : (
        <span className="inventory-settings-muted">—</span>
      )
    if (key === 'pricing')
      return (
        <div className="inventory-settings-prices">
          <span>{quantityText(row.costPrice)}</span>
          <small>{quantityText(row.sellingPrice)}</small>
        </div>
      )
    if (key === 'contact')
      return (
        <div className="inventory-settings-contact">
          {row.contactPerson && <span>{row.contactPerson}</span>}
          {row.phone && <span>{row.phone}</span>}
          {row.email && <small>{row.email}</small>}
          {!row.contactPerson && !row.phone && !row.email && '—'}
        </div>
      )
    const field = definition.fields.find((candidate) => candidate.key === key)
    if (field.catalog)
      return data[field.catalog]?.find((option) => option.id === row[key])?.name || '—'
    return field.type === 'number' ? quantityText(row[key]) : row[key] || '—'
  }
  return (
    <section
      className="domain-panel inventory-settings-panel"
      aria-label={labelUi(definition.title)}
    >
      <header className="inventory-settings-panel-header">
        <div>
          <h2>
            {labelUi(definition.title)}
            <span className="inventory-settings-count">{allRows.length}</span>
          </h2>
          <p>{labelUi(definition.description)}</p>
        </div>
        {canWrite && (
          <button
            type="button"
            className="primary inventory-icon-button"
            disabled={busy}
            aria-expanded={editing}
            aria-controls={formId}
            onClick={(event) => edit({}, event)}
          >
            <Plus size={16} aria-hidden="true" />
            {tUi('inventorySettings.add', { name: singular })}
          </button>
        )}
      </header>
      {error && (
        <p className="domain-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inventory-settings-notice" role="status">
          <CircleCheck size={16} aria-hidden="true" />
          {notice}
        </p>
      )}
      {canWrite && draft && (
        <form
          id={formId}
          ref={formRef}
          className="inventory-form inventory-settings-editor"
          aria-labelledby={`${formId}-title`}
          onSubmit={submit}
        >
          <fieldset disabled={busy}>
            <div className="inventory-settings-editor-header">
              <div>
                <h3 id={`${formId}-title`}>
                  {tUi(`inventorySettings.${draft.id ? 'edit' : 'add'}`, { name: singular })}
                </h3>
                <p>{tUi('inventorySettings.requiredHint')}</p>
              </div>
              <button
                type="button"
                className="inventory-settings-close"
                aria-label={tUi('common.close')}
                onClick={close}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {groups.map((group) => (
              <div className="inventory-settings-field-group" key={group}>
                <h4>
                  {group === 'status' ? tUi('common.status') : tUi(`inventorySettings.${group}`)}
                </h4>
                <div className="inventory-settings-fields">
                  {group === 'status' ? (
                    <label>
                      {labelUi('Trạng thái bản ghi')}
                      <select
                        value={draft.active ? 'active' : 'inactive'}
                        onChange={(event) =>
                          setDraft((previous) => ({
                            ...previous,
                            active: event.target.value === 'active',
                          }))
                        }
                      >
                        <option value="active">{tUi('common.active')}</option>
                        <option value="inactive">{tUi('common.inactive')}</option>
                      </select>
                    </label>
                  ) : (
                    definition.fields
                      .filter((field) => (field.group || 'basicInfo') === group)
                      .map((field) => {
                        const options = (data[field.catalog] || []).filter(
                          (option) =>
                            option.id !== draft.id &&
                            (option.active !== false || option.id === draft[field.key]),
                        )
                        const change = (value) =>
                          setDraft((previous) => ({ ...previous, [field.key]: value }))
                        if (field.type === 'checkbox')
                          return (
                            <label key={field.key} className="inventory-settings-checkbox">
                              <input
                                type="checkbox"
                                checked={draft[field.key]}
                                onChange={(event) => change(event.target.checked)}
                              />
                              <span>
                                {labelUi(field.label)}
                                <small>{tUi('inventorySettings.defaultHint')}</small>
                              </span>
                            </label>
                          )
                        return (
                          <label
                            key={field.key}
                            className={
                              field.type === 'textarea'
                                ? 'inventory-settings-full-field'
                                : undefined
                            }
                          >
                            <span>
                              {labelUi(field.label)}
                              {field.required && (
                                <span className="inventory-settings-required" aria-hidden="true">
                                  {' '}
                                  *
                                </span>
                              )}
                            </span>
                            {field.catalog ? (
                              <select
                                value={draft[field.key] || ''}
                                onChange={(event) => change(event.target.value)}
                              >
                                <option value="">{labelUi('Không chọn')}</option>
                                {options.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.name}
                                  </option>
                                ))}
                              </select>
                            ) : field.type === 'textarea' ? (
                              <textarea
                                maxLength={500}
                                rows={3}
                                value={draft[field.key]}
                                onChange={(event) => change(event.target.value)}
                              />
                            ) : (
                              <input
                                type={field.type === 'number' ? 'text' : field.type || 'text'}
                                inputMode={
                                  field.type === 'number'
                                    ? field.integer
                                      ? 'numeric'
                                      : 'decimal'
                                    : undefined
                                }
                                required={field.required}
                                maxLength={
                                  field.type === 'number'
                                    ? 20
                                    : field.key === 'address'
                                      ? 500
                                      : ['sku', 'unit'].includes(field.key)
                                        ? 80
                                        : 160
                                }
                                pattern={
                                  field.integer
                                    ? '[0-9]{1,6}'
                                    : field.type === 'number'
                                      ? '[0-9]{1,15}([.][0-9]{1,4})?'
                                      : field.key === 'phone'
                                        ? phonePattern
                                        : field.key === 'email'
                                          ? emailPattern
                                          : field.key === 'taxCode'
                                            ? taxIdPattern
                                            : field.required
                                              ? '.*\\S.*'
                                              : undefined
                                }
                                value={draft[field.key]}
                                onChange={(event) => {
                                  if (
                                    field.key === 'phone' &&
                                    /[^0-9+ .()-]/.test(event.target.value)
                                  )
                                    return
                                  change(event.target.value)
                                }}
                              />
                            )}
                          </label>
                        )
                      })
                  )}
                </div>
              </div>
            ))}
            <footer className="inventory-settings-form-actions">
              <button type="button" onClick={close}>
                {tUi('common.cancel')}
              </button>
              <button type="submit" className="primary inventory-icon-button">
                <Save size={16} aria-hidden="true" />
                {tUi(busy ? 'common.saving' : 'inventorySettings.save')}
              </button>
            </footer>
          </fieldset>
        </form>
      )}
      <div className="inventory-settings-filters">
        <label className="inventory-settings-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label={tUi('inventorySettings.search')}
            placeholder={tUi('inventorySettings.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="inventory-settings-status-filter">
          <span className="inventory-settings-sr-only">
            {tUi('inventorySettings.statusFilter')}
          </span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{tUi('common.allStatuses')}</option>
            <option value="active">{tUi('common.active')}</option>
            <option value="inactive">{tUi('common.inactive')}</option>
          </select>
        </label>
      </div>
      {rows.length ? (
        <div
          className="inventory-scroll inventory-settings-table"
          role="region"
          aria-label={labelUi(definition.title)}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                {columns.map((key) => (
                  <th scope="col" key={key}>
                    {columnLabel(key)}
                  </th>
                ))}
                <th scope="col">{tUi('common.status')}</th>
                {canWrite && (
                  <th scope="col" className="inventory-settings-actions-heading">
                    {tUi('common.actions')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.id === draft?.id ? 'is-editing' : undefined}>
                  {columns.map((key) => (
                    <td
                      key={key}
                      className={
                        ['pricing', 'minStock', 'sortOrder'].includes(key)
                          ? 'inventory-settings-number'
                          : undefined
                      }
                    >
                      {shown(row, key)}
                    </td>
                  ))}
                  <td>
                    <StatusBadge active={row.active !== false} />
                  </td>
                  {canWrite && (
                    <td>
                      <div className="inventory-settings-row-actions">
                        <button
                          type="button"
                          className="inventory-settings-text-button"
                          disabled={busy}
                          aria-label={tUi('inventorySettings.edit', { name: row.name })}
                          onClick={(event) => edit(row, event)}
                        >
                          <Edit2 size={14} aria-hidden="true" />
                          {tUi('common.edit')}
                        </button>
                        <button
                          type="button"
                          className="inventory-settings-power"
                          disabled={busy}
                          aria-label={`${tUi(row.active === false ? 'common.activate' : 'common.inactive')}: ${row.name}`}
                          title={
                            row.active === false ? tUi('common.activate') : labelUi('Ngừng sử dụng')
                          }
                          onClick={() => save({ id: row.id, active: row.active === false })}
                        >
                          <Power size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          filtered={Boolean(term || status)}
          onClear={() => {
            setSearch('')
            setStatus('')
          }}
        />
      )}
      <footer className="inventory-settings-list-footer">
        {tUi('inventorySettings.results', { shown: rows.length, total: allRows.length })}
      </footer>
    </section>
  )
}

function ServiceStockEditor({ data, pms, refreshed }) {
  useI18n()
  const blank = () => ({
    serviceId: '',
    warehouseId: '',
    active: true,
    lines: [{ key: crypto.randomUUID(), itemId: '', quantity: '' }],
  })
  const [draft, setDraft] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const inFlight = useRef(false),
    formRef = useRef(null),
    triggerRef = useRef(null)
  const formId = useId(),
    editing = draft !== null,
    serviceId = draft?.serviceId
  useEffect(() => {
    if (editing) formRef.current?.querySelector('select')?.focus()
    else triggerRef.current?.focus()
  }, [editing, serviceId])
  const canWrite = pms.access('inventory.write').allowed
  const services = pms.services || [],
    recipes = data.serviceStockLinks || []
  const warehouses = (data.warehouses || []).filter(
    (row) => row.active !== false || row.id === draft?.warehouseId,
  )
  const items = (data.items || []).filter(
    (row) => row.active !== false || draft?.lines.some((line) => line.itemId === row.id),
  )
  const missingCatalogs =
    !services.some((row) => row.active !== false) ||
    !data.warehouses?.some((row) => row.active !== false) ||
    !data.items?.some((row) => row.active !== false)
  const close = () => {
    setDraft(null)
    setError('')
  }
  const edit = (row, event) => {
    triggerRef.current = event.currentTarget
    setError('')
    setNotice('')
    setDraft(
      row
        ? { ...row, lines: row.lines.map((line) => ({ ...line, key: crypto.randomUUID() })) }
        : blank(),
    )
  }
  async function save(event) {
    event.preventDefault()
    if (inFlight.current || !canWrite) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await pms.saveServiceStockLink({
        serviceId: draft.serviceId,
        warehouseId: draft.warehouseId,
        active: draft.active,
        lines: draft.lines.map((line) => ({
          itemId: line.itemId,
          quantity: decimalInput(line.quantity, { min: '0.0001' }),
        })),
      })
      setDraft(null)
      setNotice(labelUi('Đã lưu định mức xuất kho của dịch vụ.'))
      refreshed()
    } catch (err) {
      setError(err.message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <section className="domain-panel inventory-settings-panel">
      <header className="inventory-settings-panel-header">
        <div>
          <h2>
            {labelUi('Định mức kho cho dịch vụ POS')}
            <span className="inventory-settings-count">{recipes.length}</span>
          </h2>
          <p>
            {labelUi(
              'Mỗi đơn vị dịch vụ bán ra sẽ xuất các mặt hàng bên dưới từ kho đã chọn khi hóa đơn POS ghi sổ. Bản nháp không trừ kho. Hoàn tiền được ghi riêng với hàng trả lại.',
            )}
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            className="primary inventory-icon-button"
            disabled={busy || missingCatalogs}
            aria-expanded={editing}
            aria-controls={formId}
            onClick={(event) => edit(null, event)}
          >
            <Plus size={16} aria-hidden="true" />
            {tUi('inventorySettings.addRecipe')}
          </button>
        )}
      </header>
      {error && (
        <p className="domain-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="inventory-settings-notice">
          <CircleCheck size={16} aria-hidden="true" />
          {notice}
        </p>
      )}
      {canWrite && missingCatalogs && (
        <p className="inventory-settings-info" role="status">
          {tUi('inventorySettings.recipeMissing')}
        </p>
      )}
      {canWrite && draft && (
        <form
          id={formId}
          ref={formRef}
          className="inventory-form inventory-settings-editor"
          aria-labelledby={`${formId}-title`}
          onSubmit={save}
        >
          <fieldset disabled={busy}>
            <div className="inventory-settings-editor-header">
              <div>
                <h3 id={`${formId}-title`}>
                  {tUi(`inventorySettings.${draft.id ? 'editRecipe' : 'addRecipe'}`)}
                </h3>
                <p>{tUi('inventorySettings.recipeHint')}</p>
              </div>
              <button
                type="button"
                className="inventory-settings-close"
                aria-label={tUi('common.close')}
                onClick={close}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="inventory-settings-fields inventory-settings-recipe-fields">
              <label>
                <span>
                  {labelUi('Dịch vụ POS')}
                  <span className="inventory-settings-required" aria-hidden="true">
                    {' '}
                    *
                  </span>
                </span>
                <select
                  required
                  value={draft.serviceId}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, serviceId: event.target.value }))
                  }
                >
                  <option value="">{labelUi('Chọn dịch vụ')}</option>
                  {services
                    .filter((row) => row.active !== false || row.id === draft.serviceId)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>
                  {labelUi('Kho xuất dịch vụ')}
                  <span className="inventory-settings-required" aria-hidden="true">
                    {' '}
                    *
                  </span>
                </span>
                <select
                  required
                  value={draft.warehouseId}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, warehouseId: event.target.value }))
                  }
                >
                  <option value="">{labelUi('Chọn kho')}</option>
                  {warehouses.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {labelUi('Áp dụng định mức')}
                <select
                  value={draft.active ? 'active' : 'inactive'}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      active: event.target.value === 'active',
                    }))
                  }
                >
                  <option value="active">{tUi('hk.applying')}</option>
                  <option value="inactive">{tUi('hk.stopped')}</option>
                </select>
              </label>
            </div>
            <div className="inventory-settings-recipe-lines">
              <h4>{tUi('inventorySettings.recipeLines')}</h4>
              <InventoryLines
                maxLines={100}
                kind="issue"
                lines={draft.lines}
                onChange={(lines) => setDraft((previous) => ({ ...previous, lines }))}
                items={items}
              />
            </div>
            <footer className="inventory-settings-form-actions">
              <button type="button" onClick={close}>
                {tUi('common.cancel')}
              </button>
              <button
                type="submit"
                className="primary inventory-icon-button"
                disabled={!services.length || !warehouses.length || !items.length}
              >
                <Save size={16} aria-hidden="true" />
                {busy ? tUi('common.saving') : labelUi('Lưu định mức kho')}
              </button>
            </footer>
          </fieldset>
        </form>
      )}
      {recipes.length ? (
        <div
          className="inventory-scroll inventory-settings-table"
          role="region"
          aria-label={labelUi('Định mức kho cho dịch vụ POS')}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{tUi('rooms.services')}</th>
                <th scope="col">{labelUi('Kho')}</th>
                <th scope="col">{labelUi('Định mức cho một đơn vị dịch vụ')}</th>
                <th scope="col">{tUi('common.status')}</th>
                {canWrite && (
                  <th scope="col" className="inventory-settings-actions-heading">
                    {tUi('common.actions')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {recipes.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>
                      {services.find((service) => service.id === row.serviceId)?.name ||
                        row.serviceId}
                    </strong>
                  </td>
                  <td>
                    <span className="inventory-settings-warehouse">
                      <MapPin size={14} aria-hidden="true" />
                      {data.warehouses?.find((warehouse) => warehouse.id === row.warehouseId)
                        ?.name || row.warehouseId}
                    </span>
                  </td>
                  <td className="inventory-wrap">
                    <div className="inventory-settings-recipe-items">
                      {row.lines.map((line, index) => {
                        const item = data.items?.find((item) => item.id === line.itemId)
                        return (
                          <span key={line.id || `${line.itemId}-${index}`}>
                            {item?.name || line.itemId}
                            <strong>
                              {quantityText(line.quantity)} {item?.unit || ''}
                            </strong>
                          </span>
                        )
                      })}
                    </div>
                  </td>
                  <td>
                    <StatusBadge active={row.active} recipe />
                  </td>
                  {canWrite && (
                    <td>
                      <div className="inventory-settings-row-actions">
                        <button
                          type="button"
                          className="inventory-settings-text-button"
                          disabled={busy}
                          aria-label={`${tUi('inventorySettings.editRecipe')}: ${services.find((service) => service.id === row.serviceId)?.name || row.serviceId}`}
                          onClick={(event) => edit(row, event)}
                        >
                          <Edit2 size={14} aria-hidden="true" />
                          {tUi('common.edit')}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState />
      )}
    </section>
  )
}

export default function InventorySettings({ catalog = 'warehouses' }) {
  const pms = usePms()
  return (
    <SettingsWorkspace
      key={`${pms.tenantId}:${pms.user?.id}:${catalog}`}
      pms={pms}
      catalog={catalog}
    />
  )
}

function SettingsWorkspace({ pms, catalog }) {
  useI18n()
  const masters = useInventoryQuery(catalog === 'opening' ? null : '/inventory/masters')
  const [data, setData] = useState(null)
  // Preserve open editors and drafts when the shared catalogs refresh.
  if (masters.data && masters.data !== data) setData(masters.data)
  if (catalog === 'opening')
    return (
      <div className="inventory-settings inventory-settings-opening">
        <InventoryDocuments kind="opening" embedded />
      </div>
    )
  return (
    <div className="pms-domain-page pms-inventory inventory-settings">
      {masters.loading && !data && (
        <p className="inventory-settings-info" role="status">
          {labelUi('Đang tải danh mục kho…')}
        </p>
      )}
      {masters.error && (
        <div className="domain-error" role="alert">
          <p>{masters.error}</p>
          <button type="button" onClick={masters.refresh}>
            {tUi('common.retry')}
          </button>
        </div>
      )}
      {!pms.access('inventory.write').allowed && (
        <p className="inventory-settings-info" role="status">
          {labelUi('Danh mục kho đang ở chế độ xem. Bạn chưa có quyền chỉnh sửa.')}
        </p>
      )}
      {data &&
        (catalog === 'service_stock' ? (
          <ServiceStockEditor data={data} pms={pms} refreshed={masters.refresh} />
        ) : (
          <>
            <MasterEditor catalog={catalog} data={data} pms={pms} refreshed={masters.refresh} />
            {catalog === 'items' && (
              <MasterEditor
                catalog="itemCategories"
                data={data}
                pms={pms}
                refreshed={masters.refresh}
              />
            )}
          </>
        ))}
    </div>
  )
}
