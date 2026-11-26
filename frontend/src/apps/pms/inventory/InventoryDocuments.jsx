import { decimalInput } from '../../../shared/lib/number.js'
import { formatDate } from '../../../shared/lib/date.js'
import { dateRangeParams } from '../../../shared/lib/dateRangeQuery.js'
import DateInput from '../../../shared/components/DateInput.jsx'
import { tr as labelUi, t as tUi, useI18n } from '../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDraftGuard } from '../../../shared/drafts/DraftGuardProvider.jsx'
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { usePms } from '../data/usePms'
import { today } from '../data/model'
import LegacyOverlay from '../components/LegacyOverlay'
import { useInventoryQuery } from './useInventoryQuery'
import { INVENTORY_KINDS, quantityText } from './values'
import '../components/DomainForms.css'
import './Inventory.css'

const activeRows = (rows) => (rows || []).filter((row) => row.active !== false)
const freshLine = () => ({
  key: crypto.randomUUID(),
  itemId: '',
  quantity: '',
  unitCost: '',
  warehouseId: '',
})
const formKey = (form, lines) =>
  JSON.stringify([
    form.date,
    form.warehouseId,
    form.toWarehouseId,
    form.supplierId,
    form.note,
    lines.map((line) => [line.itemId, line.quantity, line.unitCost, line.warehouseId]),
  ])
const dialogTitle = (kind) =>
  kind === 'opening'
    ? 'Thiết lập tồn đầu kỳ'
    : `Tạo ${INVENTORY_KINDS[kind].toLocaleLowerCase('vi')}`
const foldItem = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim()
function lineError(line, kind, items) {
  if (!items.some((item) => item.id === line.itemId))
    return { field: 'itemId', message: 'Chọn mặt hàng đang hoạt động.' }
  for (const [field, options] of [
    ['quantity', { min: ['count', 'opening'].includes(kind) ? '0' : '0.0001' }],
    ...(['opening', 'receipt'].includes(kind) ? [['unitCost', {}]] : []),
  ]) {
    try {
      decimalInput(line[field], options)
    } catch (error) {
      return { field, message: error.message }
    }
  }
  return null
}

export function InventoryLines({
  lines,
  onChange,
  items,
  warehouses = [],
  kind,
  stock = [],
  maxLines = 200,
  searchable = false,
  collapsed,
  onCollapse,
  focusLine,
}) {
  const withCost = ['opening', 'receipt'].includes(kind)
  const [queries, setQueries] = useState({})
  const editor = useRef(null)
  useEffect(() => {
    if (!focusLine) return
    const row = editor.current?.querySelector(`[data-line-key="${focusLine.key}"]`)
    const selector = {
      quantity: '[data-line-quantity]',
      unitCost: '[data-line-cost]',
      itemId: 'select[required]',
      search: 'input[type="search"]',
    }[focusLine.field]
    ;(
      row?.querySelector(selector) ||
      row?.querySelector(':invalid') ||
      row?.querySelector('select')
    )?.focus()
  }, [focusLine, collapsed])
  function update(key, field, value) {
    onChange(
      lines.map((line) =>
        line.key === key
          ? {
              ...line,
              [field]: value,
              ...(field === 'itemId'
                ? {
                    quantity: '',
                    ...(withCost
                      ? {
                          unitCost: String(
                            items.find((item) => item.id === value)?.costPrice ?? '0',
                          ),
                        }
                      : {}),
                  }
                : {}),
            }
          : line,
      ),
    )
  }
  return (
    <div className="inventory-lines" ref={editor}>
      {lines.map((line, index) => {
        const item = items.find((row) => row.id === line.itemId)
        const balance = stock.find((row) => row.itemId === line.itemId)
        const needle = foldItem(queries[line.key])
        const matches = searchable
          ? items.filter(
              (row) =>
                !needle ||
                foldItem(`${row.sku || ''} ${row.name} ${row.unit || ''}`).includes(needle),
            )
          : items
        const options = searchable
          ? [
              ...(item ? [item] : []),
              ...matches.filter((row) => row.id !== line.itemId).slice(0, 50),
            ]
          : items
        if (collapsed?.has(line.key))
          return (
            <div key={line.key} className="inventory-line-summary" data-line-key={line.key}>
              <span>
                Dòng {index + 1}: {item?.sku} · {item?.name} · {item?.unit} · SL{' '}
                {quantityText(line.quantity)}
                {withCost ? ` · Giá vốn ${quantityText(line.unitCost)}` : ''}
                {kind === 'opening'
                  ? ` · ${warehouses.find((row) => row.id === line.warehouseId)?.name || 'Kho của phiếu'}`
                  : ''}
              </span>
              <button type="button" onClick={() => onCollapse(line.key, false)}>
                Sửa dòng {index + 1}
              </button>
              <button
                type="button"
                disabled={lines.length === 1}
                onClick={() => onChange(lines.filter((row) => row.key !== line.key))}
              >
                Xóa dòng {index + 1}
              </button>
            </div>
          )
        return (
          <div
            key={line.key}
            data-line-key={line.key}
            className={`inventory-line ${!withCost ? 'inventory-quantity-line' : ''} ${kind === 'opening' ? 'inventory-opening-line' : ''}`}
          >
            {searchable && (
              <label>
                Tìm mặt hàng dòng {index + 1}
                <input
                  type="search"
                  maxLength={160}
                  placeholder="SKU hoặc tên"
                  value={queries[line.key] || ''}
                  onChange={(event) =>
                    setQueries((previous) => ({ ...previous, [line.key]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    if (matches.length === 1) {
                      if (matches[0].id !== line.itemId) update(line.key, 'itemId', matches[0].id)
                      event.currentTarget
                        .closest('[data-line-key]')
                        .querySelector('[data-line-quantity]')
                        ?.focus()
                    }
                  }}
                />
                <small>
                  {matches.length} mặt hàng khớp
                  {matches.length > 50 ? ' · Hiện tối đa 50 kết quả, nhập để thu hẹp' : ''}
                </small>
              </label>
            )}
            {kind === 'opening' && (
              <label>
                Kho dòng {index + 1}
                <select
                  value={line.warehouseId}
                  onChange={(event) => update(line.key, 'warehouseId', event.target.value)}
                >
                  <option value="">{labelUi('Dùng kho của phiếu')}</option>
                  {warehouses.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Mặt hàng dòng {index + 1}
              <select
                required
                value={line.itemId}
                onChange={(event) => update(line.key, 'itemId', event.target.value)}
              >
                <option value="">{labelUi('Chọn mặt hàng')}</option>
                {options.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.sku ? `${row.sku} · ` : ''}
                    {row.name}
                    {row.unit ? ` (${row.unit})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {kind === 'count' ? labelUi('Số lượng thực tế') : labelUi('Số lượng')} dòng{' '}
              {index + 1}
              <input
                data-line-quantity=""
                type="text"
                inputMode="decimal"
                pattern="[0-9]{1,15}([.][0-9]{1,4})?"
                maxLength={20}
                required
                min={['count', 'opening'].includes(kind) ? '0' : '0.0001'}
                step="0.0001"
                value={line.quantity}
                onChange={(event) => update(line.key, 'quantity', event.target.value)}
              />
              {kind === 'count' && (
                <small>
                  Tồn hiện tại: {quantityText(balance?.quantity)} {item?.unit || ''}
                </small>
              )}
            </label>
            {withCost && (
              <label>
                Đơn giá vốn dòng {index + 1}
                <input
                  data-line-cost=""
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]{1,15}([.][0-9]{1,4})?"
                  maxLength={20}
                  required
                  min="0"
                  step="0.0001"
                  value={line.unitCost}
                  placeholder={item?.costPrice || '0'}
                  onChange={(event) => update(line.key, 'unitCost', event.target.value)}
                />
              </label>
            )}
            <button
              type="button"
              className="inventory-icon-button"
              aria-label={`Xóa dòng ${index + 1}`}
              disabled={lines.length === 1}
              onClick={() => onChange(lines.filter((row) => row.key !== line.key))}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
            {onCollapse && !lineError(line, kind, items) && (
              <button type="button" onClick={() => onCollapse(line.key, true)}>
                Thu gọn dòng {index + 1}
              </button>
            )}
          </div>
        )
      })}
      <button
        type="button"
        className="inventory-icon-button"
        disabled={lines.length >= maxLines}
        onClick={() => onChange([...lines, freshLine()])}
      >
        <Plus size={16} aria-hidden="true" /> {labelUi('Thêm mặt hàng')}
      </button>
    </div>
  )
}

function DocumentForm({ kind, masters, pms, initialWarehouseId, close, saved }) {
  useI18n()
  const warehouses = activeRows(masters.warehouses),
    items = activeRows(masters.items)
  const [form, setForm] = useState(() => ({
    date: today(pms.settings.timezone),
    warehouseId:
      warehouses.find((row) => row.id === initialWarehouseId)?.id ||
      warehouses.find((row) => row.isDefault)?.id ||
      warehouses[0]?.id ||
      '',
    toWarehouseId: '',
    supplierId: '',
    note: '',
  }))
  const [lines, setLines] = useState([freshLine()]),
    [intent, setIntent] = useState(() => crypto.randomUUID())
  const [collapsed, setCollapsed] = useState(new Set()),
    [focusLine, setFocusLine] = useState(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const inFlight = useRef(false)
  // Opening snapshot; per-line React keys are ignored so removing an added blank line is clean.
  const [initial] = useState(() => formKey(form, lines))
  // A typed but invalid date may never reach form.date; compare the raw inputs once edited.
  const dateField = useRef(null),
    dateRaw = useRef([]),
    dateEdited = useRef(false)
  const dateInputs = () => [...(dateField.current?.querySelectorAll('input') || [])]
  const snapshotDate = () => {
    if (!dateEdited.current) dateRaw.current = dateInputs().map((node) => node.value)
  }
  const editDate = () => {
    dateEdited.current = true
  }
  const rawDateDirty = () =>
    dateEdited.current &&
    dateInputs().some(
      (node, index) => node.validity?.badInput || node.value !== dateRaw.current[index],
    )
  useEffect(snapshotDate, [])
  const dirty = () => formKey(form, lines) !== initial || rawDateDirty()
  const { requestLeave } = useDraftGuard({
    dirty,
    pending: () => inFlight.current,
    onDiscard: close,
  })
  const stock = useInventoryQuery(
    kind === 'count' && form.warehouseId
      ? '/inventory/stock?' + new URLSearchParams({ warehouseId: form.warehouseId })
      : null,
  )
  function change(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }))
    setIntent(crypto.randomUUID())
  }
  function changeLines(value) {
    if (value.length > lines.length) {
      setCollapsed(
        new Set(lines.filter((line) => !lineError(line, kind, items)).map((line) => line.key)),
      )
      setFocusLine({ key: value.at(-1).key, field: 'search' })
    }
    setLines(value)
    setIntent(crypto.randomUUID())
  }
  function collapseLine(key, collapse, field = 'search') {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (collapse) next.add(key)
      else next.delete(key)
      return next
    })
    if (!collapse) setFocusLine({ key, field })
  }
  const allowClose = () => {
    if (!inFlight.current) requestLeave(close)
  }
  async function submit(event) {
    event.preventDefault()
    if (inFlight.current) return
    const invalid = lines.findIndex((line) => lineError(line, kind, items))
    if (invalid !== -1) {
      const problem = lineError(lines[invalid], kind, items)
      setError(`Dòng ${invalid + 1}: ${problem.message}`)
      collapseLine(lines[invalid].key, false, problem.field)
      return
    }
    if (!event.currentTarget.reportValidity()) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const body = {
        kind,
        date: form.date,
        warehouseId: form.warehouseId,
        note: form.note,
        ...(kind === 'transfer' ? { toWarehouseId: form.toWarehouseId } : {}),
        ...(kind === 'receipt' && form.supplierId ? { supplierId: form.supplierId } : {}),
        lines: lines.map((line) => ({
          itemId: line.itemId,
          quantity: decimalInput(line.quantity, {
            min: ['count', 'opening'].includes(kind) ? '0' : '0.0001',
          }),
          ...(['opening', 'receipt'].includes(kind)
            ? { unitCost: decimalInput(line.unitCost) }
            : {}),
          ...(kind === 'opening' && line.warehouseId ? { warehouseId: line.warehouseId } : {}),
          ...(kind === 'count'
            ? {
                expectedVersion:
                  stock.data?.rows.find((row) => row.itemId === line.itemId)?.version ?? 0,
              }
            : {}),
        })),
      }
      const result = await pms.createInventoryDocument(body, intent)
      saved(result)
    } catch (err) {
      setError(err.message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const blocked = busy || (kind === 'count' && (stock.loading || Boolean(stock.error)))
  return (
    <LegacyOverlay title={dialogTitle(kind)} onClose={allowClose}>
      <section className="inventory-dialog">
        <div className="domain-toolbar">
          <button
            type="button"
            aria-label={labelUi('Đóng phiếu kho')}
            disabled={busy}
            onClick={allowClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p>
          {kind === 'count'
            ? labelUi(
                'Nhập số lượng thực tế. Chênh lệch và giá trị kho được tính khi ghi sổ; dữ liệu tồn phải còn đúng phiên bản đã tải.',
              )
            : kind === 'opening'
              ? labelUi(
                  'Tồn đầu kỳ chỉ được thiết lập một lần cho khách sạn. Hãy thêm đầy đủ mặt hàng của mọi kho trước khi ghi sổ.',
                )
              : labelUi(
                  'Phiếu đã ghi sổ được giữ trong lịch sử; điều chỉnh bằng phiếu đảo, không xóa hoặc sửa số liệu gốc.',
                )}
        </p>
        <form className="inventory-form" onSubmit={submit}>
          <fieldset disabled={busy}>
            <div className="domain-fields">
              <label>
                {kind === 'transfer' ? labelUi('Kho chuyển') : labelUi('Kho của phiếu')}
                <select
                  required
                  value={form.warehouseId}
                  onChange={(event) => change('warehouseId', event.target.value)}
                >
                  <option value="">{labelUi('Chọn kho')}</option>
                  {warehouses.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              {kind === 'transfer' && (
                <label>
                  {labelUi('Kho nhận')}
                  <select
                    required
                    value={form.toWarehouseId}
                    onChange={(event) => change('toWarehouseId', event.target.value)}
                  >
                    <option value="">{labelUi('Chọn kho nhận')}</option>
                    {warehouses
                      .filter((row) => row.id !== form.warehouseId)
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label ref={dateField} onFocus={snapshotDate} onInput={editDate} onChange={editDate}>
                {labelUi('Ngày phiếu')}
                <DateInput
                  required
                  max={today(pms.settings.timezone)}
                  value={form.date}
                  onChange={(value) => change('date', value)}
                />
              </label>
              {kind === 'receipt' && (
                <label>
                  {tUi('inventory.supplier')}
                  <select
                    value={form.supplierId}
                    onChange={(event) => change('supplierId', event.target.value)}
                  >
                    <option value="">{labelUi('Không chọn nhà cung cấp')}</option>
                    {activeRows(masters.suppliers).map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <label>
              {labelUi('Ghi chú phiếu')}
              <textarea
                maxLength={500}
                rows={2}
                value={form.note}
                onChange={(event) => change('note', event.target.value)}
              />
            </label>
            <h3>{labelUi('Mặt hàng trong phiếu')}</h3>
            {stock.loading && <p role="status">{labelUi('Đang tải tồn kho để kiểm kê…')}</p>}
            {stock.error && (
              <div className="domain-error" role="alert">
                <p>{stock.error}</p>
                <button type="button" onClick={stock.refresh}>
                  {labelUi('Tải lại tồn kho')}
                </button>
              </div>
            )}
            <fieldset disabled={kind === 'count' && (stock.loading || Boolean(stock.error))}>
              <InventoryLines
                lines={lines}
                onChange={changeLines}
                items={items}
                warehouses={warehouses}
                kind={kind}
                stock={stock.data?.rows}
                searchable
                collapsed={collapsed}
                onCollapse={collapseLine}
                focusLine={focusLine}
              />
            </fieldset>
            {kind === 'count' && (
              <p>
                {labelUi(
                  'Khi tồn kho đã đổi, hãy đóng phiếu, tải lại và kiểm đếm lại trước khi lưu.',
                )}
              </p>
            )}
            {!warehouses.length || !items.length ? (
              <p role="status">
                {labelUi('Cần tạo kho và mặt hàng đang hoạt động trong Cài đặt → Kho & Mua hàng.')}
              </p>
            ) : null}
            <p>
              Đơn vị tiền tệ: {pms.settings.currency}. Đơn giá và số lượng hỗ trợ tối đa 4 chữ số
              thập phân.
            </p>
            {error && (
              <p className="domain-error" role="alert">
                {error}
              </p>
            )}
            <div className="domain-toolbar inventory-form-footer">
              <span>
                {lines.length} dòng · Ngày {formatDate(form.date)} ·{' '}
                {warehouses.find((row) => row.id === form.warehouseId)?.name || 'Chưa chọn kho'}
                {kind === 'transfer'
                  ? ' → ' +
                    (warehouses.find((row) => row.id === form.toWarehouseId)?.name ||
                      'Chưa chọn kho nhận')
                  : ''}
              </span>
              <button type="button" disabled={busy} onClick={allowClose}>
                {tUi('common.cancel')}
              </button>
              <button
                type="submit"
                className="primary inventory-icon-button"
                disabled={blocked || !warehouses.length || !items.length}
              >
                <Save size={16} aria-hidden="true" />{' '}
                {busy ? labelUi('Đang ghi sổ…') : labelUi('Ghi sổ phiếu kho')}
              </button>
            </div>
          </fieldset>
        </form>
      </section>
    </LegacyOverlay>
  )
}

function PosStockReturn({ row, pms, saved, onBusy }) {
  const movements = row.lines.filter((line) => String(line.quantity).startsWith('-'))
  const [quantities, setQuantities] = useState({}),
    [reason, setReason] = useState('')
  const [intent, setIntent] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  async function submit(event) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    onBusy(true)
    setError('')
    setNotice('')
    try {
      const lines = movements
        .filter((line) => quantities[line.id])
        .map((line) => ({
          movementId: line.id,
          quantity: decimalInput(quantities[line.id], {
            min: '0.0001',
            max: String(line.quantity).slice(1),
          }),
        }))
      if (!lines.length)
        throw new Error('Nhập số lượng hàng thực tế được trả lại ở ít nhất một dòng.')
      await pms.returnPosStock(row.posInvoiceId, { reason, lines }, intent)
      setQuantities({})
      setReason('')
      setIntent(crypto.randomUUID())
      setNotice('Đã nhập lại hàng trả về kho.')
      saved()
    } catch (err) {
      setError(err.message)
    } finally {
      inFlight.current = false
      setBusy(false)
      onBusy(false)
    }
  }
  return (
    <form className="inventory-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <h3>{labelUi('Ghi nhận hàng trả lại từ POS')}</h3>
        <p>
          {labelUi(
            'Chỉ nhập lượng hàng thực tế nhận lại. Hệ thống kiểm tra các lần trả trước và giữ kho, giá vốn gốc của hóa đơn.',
          )}
        </p>
        <div className="domain-fields">
          {movements.map((line) => (
            <label key={line.id}>
              Số lượng trả: {line.item} ({line.unit || labelUi('đơn vị')})
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]{1,15}([.][0-9]{1,4})?"
                maxLength={20}
                min="0.0001"
                step="0.0001"
                max={String(line.quantity).slice(1)}
                value={quantities[line.id] || ''}
                onChange={(event) => {
                  setQuantities((previous) => ({ ...previous, [line.id]: event.target.value }))
                  setIntent(crypto.randomUUID())
                }}
              />
            </label>
          ))}
        </div>
        <label>
          {labelUi('Lý do hàng trả lại')}
          <input
            required
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
              setIntent(crypto.randomUUID())
            }}
          />
        </label>
        {error && (
          <p className="domain-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="inventory-positive">
            {notice}
          </p>
        )}
        <button type="submit" className="primary inventory-icon-button">
          <RotateCcw size={16} aria-hidden="true" />{' '}
          {busy ? labelUi('Đang nhập hàng trả lại…') : labelUi('Ghi nhận hàng trả lại')}
        </button>
      </fieldset>
    </form>
  )
}

function DocumentDetail({ id, pms, close, changed }) {
  useI18n()
  const detail = useInventoryQuery('/inventory/documents/' + encodeURIComponent(id))
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [intent, setIntent] = useState(() => crypto.randomUUID())
  const inFlight = useRef(false)
  const row = detail.data
  const canWrite = pms.access('inventory.write').allowed
  async function reverse(event) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await pms.reverseInventoryDocument(id, { reason }, intent)
      changed()
      detail.refresh()
      setReason('')
    } catch (err) {
      setError(err.message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <LegacyOverlay
      title={labelUi('Chi tiết phiếu kho')}
      onClose={() => {
        if (!inFlight.current) close()
      }}
    >
      <section className="inventory-dialog">
        <div className="domain-toolbar">
          <button
            type="button"
            aria-label={labelUi('Đóng chi tiết phiếu')}
            disabled={busy}
            onClick={close}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {detail.loading && <p role="status">{labelUi('Đang tải chi tiết phiếu…')}</p>}
        {detail.error && (
          <div className="domain-error" role="alert">
            <p>{detail.error}</p>
            <button type="button" onClick={detail.refresh}>
              {tUi('common.retry')}
            </button>
          </div>
        )}
        {row && (
          <>
            <dl className="inventory-detail">
              <div>
                <dt>{labelUi('Loại phiếu')}</dt>
                <dd>{INVENTORY_KINDS[row.kind] || row.kind}</dd>
              </div>
              <div>
                <dt>{tUi('common.date')}</dt>
                <dd>{formatDate(row.date)}</dd>
              </div>
              <div>
                <dt>Kho</dt>
                <dd>{row.warehouse}</dd>
              </div>
              {row.toWarehouse && (
                <div>
                  <dt>{labelUi('Kho nhận')}</dt>
                  <dd>{row.toWarehouse}</dd>
                </div>
              )}
              <div>
                <dt>{tUi('inventory.supplier')}</dt>
                <dd>{row.supplier || '—'}</dd>
              </div>
              <div>
                <dt>{labelUi('Mã phiếu')}</dt>
                <dd className="inventory-id">{row.id}</dd>
              </div>
            </dl>
            {row.note && (
              <p>
                {tUi('hk.notePrefix')} {row.note}
              </p>
            )}
            {row.reversalOfId && (
              <p>
                {labelUi('Phiếu đảo của:')} <span className="inventory-id">{row.reversalOfId}</span>
              </p>
            )}
            {row.reversedById && (
              <p>
                {labelUi('Đã đảo bằng phiếu:')}{' '}
                <span className="inventory-id">{row.reversedById}</span>
              </p>
            )}
            {row.posInvoiceId && (
              <p>
                {labelUi('Xuất/hoàn kho từ hóa đơn POS:')}{' '}
                <span className="inventory-id">{row.posInvoiceId}</span>
                {labelUi(
                  '. Hoàn tiền POS không tự nhập lại hàng; lượng hàng trả lại được ghi riêng.',
                )}
              </p>
            )}
            <div className="inventory-scroll">
              <table>
                <caption>{labelUi('Số lượng có dấu thể hiện tăng/giảm tại từng kho.')}</caption>
                <thead>
                  <tr>
                    <th>Kho</th>
                    <th>{labelUi('Mặt hàng')}</th>
                    <th>SKU</th>
                    <th>{labelUi('Số lượng')}</th>
                    <th>{labelUi('Đơn vị')}</th>
                    <th>{labelUi('Giá vốn')}</th>
                    <th>Giá trị ({row.currency})</th>
                  </tr>
                </thead>
                <tbody>
                  {row.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        {line.warehouse ||
                          (line.warehouseId === row.toWarehouseId
                            ? row.toWarehouse
                            : row.warehouse)}
                      </td>
                      <td>{line.item}</td>
                      <td>{line.sku || '—'}</td>
                      <td>{quantityText(line.quantity)}</td>
                      <td>{line.unit || '—'}</td>
                      <td>{quantityText(line.unitCost)}</td>
                      <td>{quantityText(line.costValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canWrite && row.canReverse && (
              <form onSubmit={reverse}>
                <fieldset disabled={busy}>
                  <h3>{labelUi('Đảo phiếu kho')}</h3>
                  <p>
                    {labelUi(
                      'Ghi bút toán kho ngược lại và giữ nguyên phiếu gốc. Việc đảo có thể bị chặn nếu tồn kho không còn đủ.',
                    )}
                  </p>
                  <label>
                    {labelUi('Lý do đảo phiếu')}
                    <input
                      required
                      maxLength={500}
                      value={reason}
                      onChange={(event) => {
                        setReason(event.target.value)
                        setIntent(crypto.randomUUID())
                      }}
                    />
                  </label>
                  {error && (
                    <p className="domain-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button type="submit" className="inventory-icon-button">
                    <RotateCcw size={16} aria-hidden="true" />{' '}
                    {busy ? labelUi('Đang đảo phiếu…') : labelUi('Ghi phiếu đảo')}
                  </button>
                </fieldset>
              </form>
            )}
            {canWrite && row.kind === 'pos_issue' && row.posInvoiceId && (
              <PosStockReturn
                row={row}
                pms={pms}
                onBusy={(value) => {
                  inFlight.current = value
                  setBusy(value)
                }}
                saved={() => {
                  changed('Đã ghi nhận hàng trả lại từ POS và cập nhật tồn kho.')
                  detail.refresh()
                }}
              />
            )}
          </>
        )}
      </section>
    </LegacyOverlay>
  )
}

// contextWarehouseId (embedded only): optional warehouse seed from a host page; '' means all warehouses.
// It never carries dates and never overrides a warehouse the user picked manually in this history.
export default function InventoryDocuments({
  kind = 'receipt',
  embedded = false,
  onChanged,
  contextWarehouseId,
}) {
  const pms = usePms()
  return (
    <DocumentWorkspace
      key={`${pms.tenantId}:${pms.user?.id}:${kind}`}
      kind={kind}
      pms={pms}
      embedded={embedded}
      onChanged={onChanged}
      contextWarehouseId={contextWarehouseId}
    />
  )
}

function DocumentWorkspace({ kind, pms, embedded, onChanged, contextWarehouseId }) {
  useI18n()
  const location = useLocation()
  const contextual = embedded && contextWarehouseId != null
  const requestedWarehouse = embedded
    ? contextual
      ? String(contextWarehouseId)
      : ''
    : new URLSearchParams(location.search).get('warehouseId') || ''
  const warehouseContext = embedded ? '' : location.key
  // Embedded pages keep their page while the seed is unchanged and reset it when a new seed applies;
  // a manual warehouse keeps its own page across later seeds.
  const pageContextFor = (manual) =>
    embedded ? (manual ? 'manual' : 'context:' + requestedWarehouse) : warehouseContext
  const [warehouseFilter, setWarehouseFilter] = useState(null)
  const [filters, setFilters] = useState(() => ({
    start: '',
    end: today(pms.settings.timezone),
    page: 1,
    context: pageContextFor(false),
  }))
  const [version, setVersion] = useState(0),
    [creating, setCreating] = useState(null),
    [selected, setSelected] = useState(null),
    [notice, setNotice] = useState('')
  const masters = useInventoryQuery('/inventory/masters', version)
  const allWarehouses = masters.data?.warehouses || []
  const activeWarehouses = activeRows(masters.data?.warehouses)
  const defaultWarehouse = activeWarehouses.find((row) => row.isDefault) || activeWarehouses[0]
  // Embedded history may view any known warehouse (inactive ones keep their past documents); new forms still use active rows only.
  const knownContext =
    embedded &&
    Boolean(requestedWarehouse) &&
    allWarehouses.some((row) => row.id === requestedWarehouse)
  const invalidWarehouse = Boolean(
    requestedWarehouse &&
    masters.data &&
    (embedded ? !knownContext : !activeWarehouses.some((row) => row.id === requestedWarehouse)),
  )
  const manualWarehouse = warehouseFilter?.context === warehouseContext
  const resolvedRequest = !requestedWarehouse
    ? ''
    : embedded
      ? knownContext
        ? requestedWarehouse
        : ''
      : activeWarehouses.find((row) => row.id === requestedWarehouse)?.id ||
        defaultWarehouse?.id ||
        ''
  const warehouseId = manualWarehouse ? warehouseFilter.id : resolvedRequest
  const pageContext = pageContextFor(manualWarehouse)
  const page = filters.context === pageContext ? filters.page : 1
  const query = dateRangeParams({
    start: filters.start,
    end: filters.end,
    warehouseId,
    page,
    kind: kind === 'all' ? '' : kind,
    pageSize: 20,
  })
  // A requested warehouse is validated against the catalog first; never show a mislabeled all-warehouse list meanwhile.
  const paused = Boolean(requestedWarehouse && !masters.data)
  const documents = useInventoryQuery(paused ? null : '/inventory/documents?' + query, version)
  const warehouseName = (id) =>
    id
      ? allWarehouses.find((row) => row.id === id)?.name || labelUi('kho không còn trong danh mục')
      : labelUi('Tất cả kho')
  const offerContext =
    contextual && manualWarehouse && Boolean(masters.data) && warehouseFilter.id !== resolvedRequest
  const rows = documents.data?.documents || []
  const pagination = documents.data?.pagination
  const canWrite = kind !== 'all' && pms.access('inventory.write').allowed
  const openingLocked = kind === 'opening' && masters.data?.openingLocked
  function filter(field, value) {
    if (field === 'warehouseId') setWarehouseFilter({ context: warehouseContext, id: value })
    setFilters((previous) => ({
      ...previous,
      ...(field === 'warehouseId' ? {} : { [field]: value }),
      page: 1,
      context: field === 'warehouseId' ? pageContextFor(true) : pageContext,
    }))
  }
  // Explicit, one-step return to the host's current warehouse; dates, open form and detail stay untouched.
  function applyContextWarehouse() {
    setWarehouseFilter(null)
    setFilters((previous) => ({ ...previous, page: 1, context: pageContextFor(false) }))
  }
  const refresh = () => setVersion((value) => value + 1)
  function saved(result) {
    setCreating(null)
    setSelected(result.id)
    setNotice(`Đã ghi sổ ${INVENTORY_KINDS[kind].toLocaleLowerCase('vi')}.`)
    refresh()
    onChanged?.()
  }
  return (
    <div className="pms-domain-page pms-inventory">
      <header className="domain-toolbar domain-toolbar--actions">
        <div className="inventory-toolbar-actions">
          <button type="button" className="inventory-icon-button" onClick={refresh}>
            <RefreshCw size={16} aria-hidden="true" /> {tUi('common.reload')}
          </button>
          {!embedded && (
            <Link className="inventory-link-button inventory-icon-button" to="/id/inventory/stock">
              <Boxes size={16} aria-hidden="true" />
              {labelUi('Xem tồn kho')}
            </Link>
          )}
          {canWrite && (
            <button
              type="button"
              className="primary inventory-icon-button"
              disabled={masters.loading || Boolean(masters.error) || openingLocked}
              onClick={() => {
                setNotice('')
                setCreating({ masters: masters.data, warehouseId })
              }}
            >
              <Plus size={16} aria-hidden="true" />{' '}
              {kind === 'opening' ? labelUi('Thiết lập tồn đầu kỳ') : labelUi('Tạo phiếu')}
            </button>
          )}
        </div>
      </header>
      {!pms.access('inventory.write').allowed && (
        <p role="status">
          {labelUi('Bạn đang xem kho. Vai trò hoặc gói hiện tại chưa cho phép ghi sổ.')}
        </p>
      )}
      {openingLocked && (
        <p role="status">
          {labelUi(
            'Tồn đầu kỳ đã khóa vì kho đã có giao dịch. Số liệu gốc được giữ trong lịch sử; bổ sung hàng bằng phiếu nhập kho.',
          )}
        </p>
      )}
      {notice && (
        <p className="inventory-positive" role="status">
          {notice}
        </p>
      )}
      {invalidWarehouse &&
        !manualWarehouse &&
        (embedded ? (
          <p role="status">
            {labelUi(
              'Kho đang xem trong báo cáo không còn trong danh mục kho. Lịch sử đang hiển thị tất cả kho.',
            )}
          </p>
        ) : (
          <p role="status">
            {labelUi('Kho trong đường dẫn không tồn tại hoặc đã ngừng hoạt động.')}{' '}
            {defaultWarehouse
              ? `${labelUi('Đang dùng kho mặc định:')} ${defaultWarehouse.name}.`
              : labelUi('Chưa có kho đang hoạt động để tạo phiếu.')}
          </p>
        ))}
      {offerContext && (
        <div className="inventory-context-notice" role="status">
          <p>
            {labelUi('Lịch sử đang lọc theo kho bạn đã chọn:')} {warehouseName(warehouseFilter.id)}.{' '}
            {labelUi('Kho đang xem trong báo cáo:')} {warehouseName(requestedWarehouse)}.
          </p>
          <button type="button" onClick={applyContextWarehouse}>
            {labelUi('Dùng kho đang xem')}
          </button>
        </div>
      )}
      {masters.error && (
        <div className="domain-error" role="alert">
          <p>{masters.error}</p>
          <button type="button" onClick={masters.refresh}>
            {labelUi('Tải lại danh mục')}
          </button>
        </div>
      )}
      {paused && !masters.error && (
        <p role="status">{labelUi('Đang tải danh mục kho để lọc đúng lịch sử phiếu…')}</p>
      )}
      <section className="domain-panel">
        <div className="domain-fields">
          <label>
            {labelUi('Lọc kho')}
            <select
              value={warehouseId}
              disabled={paused}
              onChange={(event) => filter('warehouseId', event.target.value)}
            >
              <option value="">{labelUi('Tất cả kho')}</option>
              {(masters.data?.warehouses || []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tUi('common.fromDate')}
            <DateInput value={filters.start} onChange={(value) => filter('start', value)} />
          </label>
          <label>
            {labelUi('Đến ngày')}
            <DateInput
              min={filters.start || undefined}
              value={filters.end}
              onChange={(value) => filter('end', value)}
            />
          </label>
        </div>
        {documents.loading && <p role="status">{labelUi('Đang tải phiếu kho…')}</p>}
        {documents.error && (
          <div className="domain-error" role="alert">
            <p>{documents.error}</p>
            <button type="button" onClick={documents.refresh}>
              {tUi('common.retry')}
            </button>
          </div>
        )}
        {!paused && !documents.loading && !documents.error && (
          <>
            <div className="inventory-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{tUi('common.date')}</th>
                    {kind === 'all' && <th>{labelUi('Loại phiếu')}</th>}
                    <th>Kho</th>
                    {['transfer', 'all'].includes(kind) && <th>{labelUi('Kho nhận')}</th>}
                    <th>{tUi('inventory.supplier')}</th>
                    <th>{tUi('common.notes')}</th>
                    <th>{tUi('common.status')}</th>
                    <th>{tUi('common.details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.date)}</td>
                      {kind === 'all' && <td>{INVENTORY_KINDS[row.kind] || row.kind}</td>}
                      <td>{row.warehouse}</td>
                      {['transfer', 'all'].includes(kind) && <td>{row.toWarehouse || '—'}</td>}
                      <td>{row.supplier || '—'}</td>
                      <td className="inventory-wrap">{row.note || '—'}</td>
                      <td>
                        {row.reversedById
                          ? labelUi('Đã đảo')
                          : row.reversalOfId
                            ? labelUi('Phiếu đảo')
                            : labelUi('Đã ghi sổ')}
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={`Xem phiếu ${row.id}`}
                          onClick={() => setSelected(row.id)}
                        >
                          {labelUi('Xem phiếu')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={kind === 'all' ? 8 : kind === 'transfer' ? 7 : 6}>
                        {labelUi('Chưa có phiếu kho phù hợp với khoảng ngày và kho đã chọn.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="domain-toolbar">
              <span>
                {pagination?.totalItems ?? rows.length} phiếu · Trang {page}
              </span>
              <div>
                <button
                  type="button"
                  className="inventory-icon-button"
                  aria-label={labelUi('Trang trước')}
                  disabled={page <= 1}
                  onClick={() =>
                    setFilters((previous) => ({
                      ...previous,
                      page: page - 1,
                      context: pageContext,
                    }))
                  }
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="inventory-icon-button"
                  aria-label={labelUi('Trang tiếp')}
                  disabled={page * 20 >= (pagination?.totalItems ?? 0)}
                  onClick={() =>
                    setFilters((previous) => ({
                      ...previous,
                      page: page + 1,
                      context: pageContext,
                    }))
                  }
                >
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      {creating && (
        <DocumentForm
          kind={kind}
          masters={creating.masters}
          pms={pms}
          initialWarehouseId={creating.warehouseId}
          close={() => setCreating(null)}
          saved={saved}
        />
      )}
      {selected && (
        <DocumentDetail
          key={selected}
          id={selected}
          pms={pms}
          close={() => setSelected(null)}
          changed={(message) => {
            setNotice(message || 'Đã ghi phiếu đảo và cập nhật tồn kho.')
            refresh()
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}
