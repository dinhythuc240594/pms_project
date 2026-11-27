import { formatDateTime } from '../../../../shared/lib/date.js'
import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import React, { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Search,
  Download,
  Eye,
  CheckCircle2,
  X,
  Copy,
  Check,
  Clock,
  User,
  Building2,
  Globe,
  FileCode,
  Shield,
  Activity,
} from 'lucide-react'

import { usePms } from '../../../pms/data/usePms'
import { getThemeTokens } from '../../theme'
import LegacyOverlay from '../../../pms/components/LegacyOverlay'
import './AdminLogs.css'
import { downloadCsv } from '../../../../shared/lib/csv'

const ipScopes = [
  'public',
  'private',
  'loopback',
  'link_local',
  'multicast',
  'unspecified',
  'reserved',
  'shared',
  'unknown',
  'invalid',
]
const ipSources = ['direct', 'trusted_proxy', 'unknown']

export default function AdminLogs() {
  useI18n()
  const { searchQuery: globalSearch, isDarkMode, theme } = useOutletContext() || {}
  const t = theme || getThemeTokens(isDarkMode)

  const { workspace } = usePms()
  const labels = {
    'tenant.created': 'Tạo khách sạn',
    'tenant.updated': 'Cập nhật khách sạn',
    'membership.created': 'Gán tài khoản khách sạn',
    'membership.updated': 'Cập nhật vai trò / trạng thái',
    'guest.created': 'Tạo hồ sơ khách',
    'guest.updated': 'Sửa hồ sơ khách',
    'reservation.created': 'Tạo đặt phòng',
    'reservation.updated': 'Sửa đặt phòng',
    'reservation.status': 'Đổi trạng thái đặt phòng',
    'reservation.payment': 'Thu tiền',
    'reservation.refund': 'Hoàn tiền',
    'reservation.charge': 'Thêm phụ thu',
    'reservation.note': 'Thêm ghi chú',
  }
  const logs = workspace.auditLogs.map((log) => ({
    ...log,
    action: log.event || log.action || 'Cập nhật',
    timestamp: formatDateTime(log.createdAt || log.at),
    operator: log.userName || log.userId || log.user || '—',
    operatorRole: log.role || '',
    tenantName:
      workspace.tenants.find((tenant) => tenant.id === log.tenantId)?.name || 'Toàn hệ thống',
    target: log.entityId || '—',
    details: labels[log.event] || log.event || 'Cập nhật',
    ipAddress: log.ipAddress || '—',
    ipScope: ipScopes.includes(log.ipInfo?.scope) ? log.ipInfo.scope : 'unknown',
    ipSource: ipSources.includes(log.ipInfo?.source) ? log.ipInfo.source : 'unknown',
    ipVersion: [4, 6].includes(log.ipInfo?.version) ? `IPv${log.ipInfo.version}` : '—',
    metadata: log,
  }))
  const [search, setSearch] = useState('')
  const [ipScopeFilter, setIpScopeFilter] = useState('ALL')
  const [selectedLogId, setSelectedLogId] = useState(null)
  const selectedLog = logs.find((log) => log.id === selectedLogId)
  const [logViewMode, setLogViewMode] = useState('overview') // 'overview' | 'json'
  const [copiedJson, setCopiedJson] = useState(false)
  const [toastMessage, setToastMessage] = useState(null)

  const showToast = (msg) => {
    setToastMessage(msg)
  }

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 3500)
    return () => clearTimeout(timer)
  }, [toastMessage])

  useEffect(() => {
    if (!copiedJson) return
    const timer = setTimeout(() => setCopiedJson(false), 2000)
    return () => clearTimeout(timer)
  }, [copiedJson])

  const copyText = async (value, onCopied) => {
    try {
      await navigator.clipboard.writeText(value)
      onCopied()
    } catch {
      showToast(tUi('auditIp.copyFailed'))
    }
  }

  const effectiveSearch = (search || globalSearch || '').trim().toLowerCase()

  const filteredLogs = logs.filter((l) => {
    const matchesSearch =
      l.id.toLowerCase().includes(effectiveSearch) ||
      l.operator.toLowerCase().includes(effectiveSearch) ||
      l.action.toLowerCase().includes(effectiveSearch) ||
      l.tenantName.toLowerCase().includes(effectiveSearch) ||
      l.ipAddress.toLowerCase().includes(effectiveSearch) ||
      l.details.toLowerCase().includes(effectiveSearch)

    const matchesIpScope = ipScopeFilter === 'ALL' || l.ipScope === ipScopeFilter

    return matchesSearch && matchesIpScope
  })

  const handleExportCSV = () => {
    downloadCsv(
      [
        'Thời gian',
        'Nhân viên',
        'Khách sạn',
        'Hành động',
        'Đối tượng',
        labelUi('Địa chỉ IP'),
        tUi('auditIp.version'),
        tUi('auditIp.scope'),
        tUi('auditIp.source'),
      ],
      filteredLogs.map((log) => [
        log.timestamp,
        log.operator,
        log.tenantName,
        log.action,
        log.target,
        log.ipAddress,
        log.ipVersion,
        tUi(`auditIp.scope.${log.ipScope}`),
        tUi(`auditIp.source.${log.ipSource}`),
      ]),
      'nhat-ky-he-thong.csv',
    )
    showToast('Đã xuất các sự kiện đang hiển thị.')
  }

  return (
    <div className="manager-page admin-logs-page">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: '30px',
            maxWidth: 'calc(100vw - 60px)',
            right: '30px',
            backgroundColor: t.isDark ? '#1E222B' : '#1E242B',
            color: t.primary,
            padding: '14px 22px',
            borderRadius: '16px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            fontSize: '13px',
            fontWeight: '800',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            border: `1px solid ${t.border}`,
          }}
        >
          <CheckCircle2 size={18} color={t.primary} />
          <span>{toastMessage}</span>
        </div>
      )}

      <section className="admin-logs-summary" aria-label={labelUi('Tổng quan nhật ký')}>
        {[
          {
            label: tUi('auditIp.unique'),
            value: new Set(
              logs
                .filter((log) => !['unknown', 'invalid'].includes(log.ipScope))
                .map((log) => log.ipAddress),
            ).size,
          },
          {
            label: tUi('auditIp.public'),
            value: logs.filter((log) => log.ipScope === 'public').length,
          },
          {
            label: tUi('auditIp.internal'),
            value: logs.filter((log) =>
              ['private', 'loopback', 'link_local', 'shared'].includes(log.ipScope),
            ).length,
          },
          {
            label: tUi('auditIp.missing'),
            value: logs.filter((log) => log.ipScope === 'unknown').length,
          },
        ].map((card) => (
          <div key={card.label} className="manager-panel admin-logs-metric">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>
              {tUi('auditIp.loaded')}: {logs.length}
            </small>
          </div>
        ))}
      </section>
      <div className="manager-panel admin-logs-filters">
        <label className="admin-logs-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={labelUi('Tìm sự kiện nhật ký')}
            placeholder={tUi('auditIp.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="admin-logs-filter-actions">
          <select
            aria-label={tUi('auditIp.filter')}
            value={ipScopeFilter}
            onChange={(event) => setIpScopeFilter(event.target.value)}
          >
            <option value="ALL">{tUi('auditIp.all')}</option>
            {ipScopes.map((scope) => (
              <option key={scope} value={scope}>
                {tUi(`auditIp.scope.${scope}`)}
              </option>
            ))}
          </select>
          <button className="manager-button" type="button" onClick={handleExportCSV}>
            <Download size={16} aria-hidden="true" />
            {tUi('common.exportCsv')}
          </button>
        </div>
      </div>

      {/* -------------------------------------------------------------
          MAIN AUDIT LOGS DATA TABLE
          ------------------------------------------------------------- */}
      <div className="manager-panel admin-logs-table-panel">
        <div
          className="manager-table-wrap"
          role="region"
          aria-label={labelUi('Danh sách nhật ký hệ thống')}
          tabIndex={0}
        >
          <table
            style={{
              width: '100%',
              minWidth: '920px',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '13px',
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: t.isDark ? '#222731' : '#F8FAFC',
                  color: t.textSecondary,
                  borderBottom: `1px solid ${t.border}`,
                }}
              >
                <th style={{ padding: '14px 12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                  {tUi('common.time')}
                </th>
                <th style={{ padding: '14px 12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                  {labelUi('Người thực hiện')}
                </th>
                <th style={{ padding: '14px 10px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                  {labelUi('Mã hành động')}
                </th>
                <th style={{ padding: '14px 12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                  {labelUi('Đối tượng / tenant')}
                </th>
                <th
                  style={{
                    padding: '14px 12px',
                    fontWeight: '700',
                    whiteSpace: 'nowrap',
                    maxWidth: '220px',
                  }}
                >
                  {labelUi('Mô tả can thiệp')}
                </th>
                <th style={{ padding: '14px 12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                  {labelUi('Địa chỉ IP')}
                </th>
                <th
                  style={{
                    padding: '14px 12px',
                    fontWeight: '700',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tUi('common.details')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={7} className="admin-logs-empty">
                    <span role="status">
                      {logs.length
                        ? labelUi('Không có sự kiện phù hợp với bộ lọc.')
                        : labelUi('Chưa có sự kiện được ghi nhận.')}
                    </span>
                  </td>
                </tr>
              )}
              {filteredLogs.map((log) => {
                const [datePart, timePart] = log.timestamp.split(' ')
                return (
                  <tr
                    key={log.id}
                    style={{
                      borderBottom: `1px solid ${t.borderSubtle}`,
                      transition: 'background-color 0.18s ease, transform 0.18s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = t.bgSurfaceHover
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    {/* Col 1: Timestamp (2 rows: Date + Time) */}
                    <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                      <div
                        style={{
                          color: t.textPrimary,
                          fontWeight: '700',
                          fontSize: '12.5px',
                          lineHeight: 1.25,
                        }}
                      >
                        {datePart}
                      </div>
                      <div
                        style={{
                          color: t.textSecondary,
                          fontSize: '11px',
                          marginTop: '3px',
                          lineHeight: 1.2,
                        }}
                      >
                        {timePart}
                      </div>
                    </td>

                    {/* Col 2: Operator (2 rows: Name + Role) */}
                    <td style={{ padding: '12px 12px', whiteSpace: 'nowrap' }}>
                      <div
                        style={{
                          fontWeight: '800',
                          color: t.textPrimary,
                          whiteSpace: 'nowrap',
                          fontSize: '13px',
                          lineHeight: 1.25,
                        }}
                      >
                        {log.operator}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: t.textSecondary,
                          whiteSpace: 'nowrap',
                          marginTop: '3px',
                          lineHeight: 1.2,
                        }}
                      >
                        {log.operatorRole}
                      </div>
                    </td>

                    {/* Col 3: Action Badge */}
                    <td style={{ padding: '12px 10px', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: '800',
                          fontFamily: 'var(--font-mono)',
                          backgroundColor: t.bgInput,
                          color: t.textPrimary,
                          padding: '4px 7px',
                          borderRadius: '6px',
                          border: `1px solid ${t.border}`,
                          whiteSpace: 'nowrap',
                          display: 'inline-block',
                        }}
                      >
                        {log.action}
                      </span>
                    </td>

                    {/* Col 4: Tenant & Target (2 rows: Name + Resource) */}
                    <td
                      style={{
                        padding: '12px 12px',
                        color: t.textPrimary,
                        fontWeight: '700',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div style={{ whiteSpace: 'nowrap', fontSize: '13px', lineHeight: 1.25 }}>
                        {log.tenantName}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: t.textSecondary,
                          whiteSpace: 'nowrap',
                          marginTop: '3px',
                          lineHeight: 1.2,
                        }}
                      >
                        {log.target}
                      </div>
                    </td>

                    {/* Col 5: 2-Line Clamped Description (Synchronized with all 2-row columns) */}
                    <td style={{ padding: '12px 12px', maxWidth: '220px' }}>
                      <div
                        title={log.details}
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          color: t.textSecondary,
                          fontSize: '12px',
                          lineHeight: '1.35',
                          maxHeight: '34px',
                          cursor: 'help',
                        }}
                      >
                        {log.details}
                      </div>
                    </td>

                    {/* Col 6: IP Address */}
                    <td
                      style={{
                        padding: '12px 12px',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)',
                        color: t.textSecondary,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div>{log.ipAddress}</div>
                      <div className="admin-logs-ip-caption">
                        {log.ipVersion !== '—' && `${log.ipVersion} · `}
                        {tUi(`auditIp.scope.${log.ipScope}`)}
                      </div>
                    </td>

                    {/* Col 7: Action Button with Hover micro-animation */}
                    <td style={{ padding: '12px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => {
                          setSelectedLogId(log.id)
                          setCopiedJson(false)
                        }}
                        title={labelUi('Xem toàn bộ payload chi tiết')}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '9px',
                          border: `1px solid ${t.border}`,
                          backgroundColor: t.bgInput,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          color: t.textPrimary,
                          flexShrink: 0,
                          transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = t.aquaBg
                          e.currentTarget.style.color = t.aquaText
                          e.currentTarget.style.borderColor = t.aquaBorder
                          e.currentTarget.style.transform = 'scale(1.12)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = t.bgInput
                          e.currentTarget.style.color = t.textPrimary
                          e.currentTarget.style.borderColor = t.border
                          e.currentTarget.style.transform = 'scale(1)'
                        }}
                      >
                        <Eye size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* =============================================================
          MODAL: PREMIUM LOG DETAILS INSPECTOR
          ============================================================= */}
      {selectedLog && (
        <LegacyOverlay
          title={labelUi('Chi tiết sự kiện nhật ký')}
          onClose={() => {
            setSelectedLogId(null)
            setLogViewMode('overview')
          }}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: t.bgModalBackdrop,
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '20px',
          }}
        >
          <div
            className="admin-logs-dialog"
            style={{
              backgroundColor: t.bgSurface,
              borderRadius: '12px',
              width: '100%',
              maxWidth: '680px',
              minWidth: 0,
              overflowWrap: 'anywhere',
              padding: '28px 32px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
              border: `1px solid ${t.border}`,
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            {/* Modal Top Header */}
            <div
              className="admin-logs-dialog-heading"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '14px',
                    background: 'linear-gradient(135deg, #2870EA 0%, #1D5BD8 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.25)',
                    flexShrink: 0,
                  }}
                >
                  <Activity size={22} strokeWidth={2.3} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3
                      style={{
                        fontSize: '18px',
                        fontWeight: '800',
                        color: t.textPrimary,
                        margin: 0,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      Chi tiết sự kiện audit
                    </h3>
                    <span
                      style={{
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: '800',
                        backgroundColor: t.bgInput,
                        color: t.textSecondary,
                        padding: '2px 8px',
                        borderRadius: '6px',
                        border: `1px solid ${t.border}`,
                      }}
                    >
                      #{selectedLog.id}
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: t.textSecondary, margin: '2px 0 0 0' }}>
                    Nhật ký giám sát can thiệp hệ thống và bảo mật backoffice
                  </p>
                </div>
              </div>

              {/* Close Button */}
              <button
                aria-label={labelUi('Đóng chi tiết nhật ký')}
                onClick={() => {
                  setSelectedLogId(null)
                  setLogViewMode('overview')
                  setCopiedJson(false)
                }}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  backgroundColor: t.bgInput,
                  border: `1px solid ${t.border}`,
                  cursor: 'pointer',
                  color: t.textSecondary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* View Mode Tabs (Overview vs Raw JSON) */}
            <div
              className="admin-logs-dialog-tabs"
              style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '18px',
                borderBottom: `1px solid ${t.borderSubtle}`,
                paddingBottom: '12px',
              }}
            >
              <button
                onClick={() => setLogViewMode('overview')}
                style={{
                  padding: '7px 16px',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: logViewMode === 'overview' ? t.primary : t.bgInput,
                  color: logViewMode === 'overview' ? '#FFFFFF' : t.textSecondary,
                  fontSize: '12px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s',
                }}
              >
                <Shield size={14} />
                <span>{labelUi('Tổng quan sự kiện')}</span>
              </button>
              <button
                onClick={() => setLogViewMode('json')}
                style={{
                  padding: '7px 16px',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: logViewMode === 'json' ? t.primary : t.bgInput,
                  color: logViewMode === 'json' ? '#FFFFFF' : t.textSecondary,
                  fontSize: '12px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s',
                }}
              >
                <FileCode size={14} />
                <span>Raw JSON payload</span>
              </button>
            </div>

            {/* TAB 1: STRUCTURED OVERVIEW */}
            {logViewMode === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* 4 Metadata Cards Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                    gap: '12px',
                  }}
                >
                  {/* Card 1: Time */}
                  <div
                    style={{
                      backgroundColor: t.isDark ? '#1F242D' : '#F8FAFC',
                      padding: '14px 16px',
                      borderRadius: '16px',
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: t.textSecondary,
                        fontSize: '11px',
                        fontWeight: '700',
                        marginBottom: '4px',
                      }}
                    >
                      <Clock size={13} color={t.primary} />
                      <span>{labelUi('Thời gian thực thi')}</span>
                    </div>
                    <div style={{ fontSize: '13.5px', fontWeight: '800', color: t.textPrimary }}>
                      {selectedLog.timestamp}
                    </div>
                  </div>

                  {/* Card 2: Operator */}
                  <div
                    style={{
                      backgroundColor: t.isDark ? '#1F242D' : '#F8FAFC',
                      padding: '14px 16px',
                      borderRadius: '16px',
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: t.textSecondary,
                        fontSize: '11px',
                        fontWeight: '700',
                        marginBottom: '4px',
                      }}
                    >
                      <User size={13} color={t.primary} />
                      <span>{labelUi('Người thực hiện')}</span>
                    </div>
                    <div style={{ fontSize: '13.5px', fontWeight: '800', color: t.textPrimary }}>
                      {selectedLog.operator}
                    </div>
                    <span style={{ fontSize: '10.5px', color: t.aquaText, fontWeight: '700' }}>
                      {selectedLog.operatorRole}
                    </span>
                  </div>

                  {/* Card 3: Tenant */}
                  <div
                    style={{
                      backgroundColor: t.isDark ? '#1F242D' : '#F8FAFC',
                      padding: '14px 16px',
                      borderRadius: '16px',
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: t.textSecondary,
                        fontSize: '11px',
                        fontWeight: '700',
                        marginBottom: '4px',
                      }}
                    >
                      <Building2 size={13} color={t.primary} />
                      <span>{labelUi('Khách sạn / cơ sở')}</span>
                    </div>
                    <div style={{ fontSize: '13.5px', fontWeight: '800', color: t.textPrimary }}>
                      {selectedLog.tenantName}
                    </div>
                    <span style={{ fontSize: '11px', color: t.textSecondary }}>
                      Target: {selectedLog.target}
                    </span>
                  </div>

                  {/* Card 4: IP Address */}
                  <div
                    style={{
                      backgroundColor: t.isDark ? '#1F242D' : '#F8FAFC',
                      padding: '14px 16px',
                      borderRadius: '16px',
                      border: `1px solid ${t.border}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: t.textSecondary,
                        fontSize: '11px',
                        fontWeight: '700',
                        marginBottom: '4px',
                      }}
                    >
                      <Globe size={13} color={t.primary} />
                      <span>{tUi('auditIp.title')}</span>
                    </div>
                    <div
                      style={{
                        fontSize: '13.5px',
                        fontWeight: '800',
                        fontFamily: 'var(--font-mono)',
                        color: t.textPrimary,
                      }}
                    >
                      {selectedLog.ipAddress}
                    </div>
                    <dl className="admin-logs-ip-details">
                      <div>
                        <dt>{tUi('auditIp.version')}</dt>
                        <dd>{selectedLog.ipVersion}</dd>
                      </div>
                      <div>
                        <dt>{tUi('auditIp.scope')}</dt>
                        <dd>{tUi(`auditIp.scope.${selectedLog.ipScope}`)}</dd>
                      </div>
                      <div>
                        <dt>{tUi('auditIp.source')}</dt>
                        <dd>{tUi(`auditIp.source.${selectedLog.ipSource}`)}</dd>
                      </div>
                    </dl>
                    <p className="admin-logs-ip-caption">
                      {tUi(
                        selectedLog.ipScope === 'unknown'
                          ? 'auditIp.noIp'
                          : 'auditIp.localAnalysis',
                      )}
                    </p>
                    {!['unknown', 'invalid'].includes(selectedLog.ipScope) && (
                      <button
                        type="button"
                        className="manager-button"
                        onClick={() =>
                          copyText(selectedLog.ipAddress, () => showToast(tUi('auditIp.copied')))
                        }
                      >
                        <Copy size={13} aria-hidden="true" />
                        {tUi('auditIp.copy')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Action Code Box */}
                <div
                  className="admin-logs-dialog-code"
                  style={{
                    backgroundColor: t.bgInput,
                    padding: '12px 16px',
                    borderRadius: '14px',
                    border: `1px solid ${t.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: '700', color: t.textSecondary }}>
                    {labelUi('Mã hành động can thiệp:')}
                  </span>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: '800',
                      fontFamily: 'var(--font-mono)',
                      backgroundColor: t.aquaBg,
                      color: t.aquaText,
                      padding: '4px 10px',
                      borderRadius: '8px',
                      border: `1px solid ${t.aquaBorder}`,
                    }}
                  >
                    {selectedLog.action}
                  </span>
                </div>

                {/* Full Message Details */}
                <div
                  style={{
                    backgroundColor: t.isDark ? '#191D24' : '#F0FDFA',
                    padding: '16px',
                    borderRadius: '16px',
                    border: `1px solid ${t.isDark ? '#282F3D' : '#CCFBF1'}`,
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: '800',
                      color: t.aquaText,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      display: 'block',
                      marginBottom: '6px',
                    }}
                  >
                    Nội dung can thiệp ghi nhận:
                  </span>
                  <p
                    style={{
                      fontSize: '13px',
                      color: t.textPrimary,
                      margin: 0,
                      lineHeight: 1.5,
                      fontWeight: '500',
                    }}
                  >
                    {selectedLog.details}
                  </p>
                </div>
              </div>
            )}

            {/* TAB 2: RAW JSON PAYLOAD */}
            {logViewMode === 'json' && (
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    backgroundColor: t.isDark ? '#11141A' : '#1E242B',
                    color: '#E2E8F0',
                    padding: '20px',
                    borderRadius: '16px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    lineHeight: 1.6,
                    border: '1px solid #333842',
                    maxHeight: '280px',
                    overflowY: 'auto',
                  }}
                >
                  <pre style={{ margin: 0 }}>{JSON.stringify(selectedLog.metadata, null, 2)}</pre>
                </div>

                {/* Copy Button on Top Right of JSON */}
                <button
                  onClick={() =>
                    copyText(JSON.stringify(selectedLog.metadata, null, 2), () => {
                      setCopiedJson(true)
                    })
                  }
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    backgroundColor: copiedJson ? '#10B981' : 'rgba(255, 255, 255, 0.12)',
                    color: '#FFFFFF',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s',
                  }}
                >
                  {copiedJson ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedJson ? labelUi('Đã sao chép!') : labelUi('Sao chép JSON')}</span>
                </button>
              </div>
            )}

            {/* Modal Bottom Actions Footer */}
            <div
              className="admin-logs-dialog-footer"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                marginTop: '24px',
                paddingTop: '16px',
                borderTop: `1px solid ${t.borderSubtle}`,
              }}
            >
              <button
                onClick={() =>
                  copyText(selectedLog.id, () => {
                    showToast(`Đã sao chép mã sự kiện #${selectedLog.id}`)
                  })
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '9px 14px',
                  borderRadius: '10px',
                  border: `1px solid ${t.border}`,
                  backgroundColor: t.bgInput,
                  color: t.textSecondary,
                  fontSize: '12px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <Copy size={14} />
                <span>{labelUi('Sao chép ID')}</span>
              </button>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <button
                  onClick={() => {
                    const dataStr =
                      'data:text/json;charset=utf-8,' +
                      encodeURIComponent(JSON.stringify(selectedLog.metadata, null, 2))
                    const downloadAnchor = document.createElement('a')
                    downloadAnchor.setAttribute('href', dataStr)
                    downloadAnchor.setAttribute('download', `audit_log_${selectedLog.id}.json`)
                    document.body.appendChild(downloadAnchor)
                    downloadAnchor.click()
                    downloadAnchor.remove()
                    showToast(`Đã tải xuống file audit_log_${selectedLog.id}.json`)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '10px 16px',
                    borderRadius: '12px',
                    border: `1px solid ${t.border}`,
                    backgroundColor: t.bgInput,
                    color: t.textPrimary,
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer',
                  }}
                >
                  <Download size={14} />
                  <span>{labelUi('Xuất JSON')}</span>
                </button>

                <button
                  onClick={() => {
                    setSelectedLogId(null)
                    setLogViewMode('overview')
                  }}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '12px',
                    border: 'none',
                    backgroundColor: t.primary,
                    color: '#FFFFFF',
                    fontWeight: '800',
                    fontSize: '13px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.25)',
                    transition: 'filter 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.08)')}
                  onMouseLeave={(e) => (e.currentTarget.style.filter = 'brightness(1)')}
                >
                  {tUi('common.closeWindow')}
                </button>
              </div>
            </div>
          </div>
        </LegacyOverlay>
      )}
    </div>
  )
}
