import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Sliders,
  Search,
  CheckCircle2,
  X,
  ChevronRight,
  Plus,
  Building2,
  Trash2,
  Clock,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react'

import { usePms } from '../../../pms/data/usePms'
import { getThemeTokens } from '../../theme'
import { displayDate, featureOverridePayload, overrideExpiry } from './featureOverride'
import { isFeatureVisible } from '../../../../shared/config/featureVisibility.js'
import './AdminFeatures.css'

export default function AdminFeatures() {
  const { apiText } = useI18n()
  const { searchQuery: globalSearch, isDarkMode, theme } = useOutletContext() || {}
  const t = theme || getThemeTokens(isDarkMode)

  const {
    tenants,
    user,
    getManagerFeatures,
    setGlobalFeature,
    saveFeatureOverride,
    removeFeatureOverride,
  } = usePms()
  const userKey = `${user?.id || ''}:${user?.globalRole || ''}`
  const currentUserKey = useRef(userKey)
  useLayoutEffect(() => {
    currentUserKey.current = userKey
  }, [userKey])
  const requestVersion = useRef(0)
  const mutationPending = useRef(false)
  const drawerRef = useRef(null)
  const modalRef = useRef(null)
  const [catalog, setCatalog] = useState({
    userKey: null,
    features: [],
    tenantFeatureOverrides: {},
  })
  const features =
    catalog.userKey === userKey
      ? catalog.features
          .filter((feature) => isFeatureVisible(feature.code))
          .map((feature) => ({
            ...feature,
            name: apiText(feature.name),
            description: apiText(feature.description),
            category: apiText(feature.category),
          }))
      : []
  const tenantFeatureOverrides = catalog.userKey === userKey ? catalog.tenantFeatureOverrides : {}
  const canManageOverrides = ['SUPER_ADMIN', 'SYSTEM_MANAGER'].includes(user?.globalRole)
  const canToggleGlobal = user?.globalRole === 'SUPER_ADMIN'
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const actionsDisabled = busy || loading || Boolean(error)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [toastMessage, setToastMessage] = useState(null)

  // Tenant Overrides Drawer & State
  const tenantOverrides = {}
  for (const [tenantId, entries] of Object.entries(tenantFeatureOverrides)) {
    const tenant = tenants.find((t) => t.id === tenantId)
    if (!tenant) continue
    for (const [code, entry] of Object.entries(entries)) {
      if (!isFeatureVisible(code)) continue
      ;(tenantOverrides[code] ||= []).push({
        ...entry,
        ...overrideExpiry(entry.expiresAt),
        id: `${tenantId}-${code}`,
        tenantId,
        tenantName: tenant.name,
        subdomain: tenant.subdomain || '—',
        basePlan: tenant.plan || '—',
        overrideType: entry.isTrial ? 'TRIAL' : entry.enabled ? 'FORCE_ENABLE' : 'FORCE_DISABLE',
        overrideLabel: entry.isTrial
          ? 'Dùng thử tính năng'
          : entry.enabled
            ? 'Đã bật riêng'
            : 'Đã tắt riêng',
        notes: entry.notes || '',
        grantedBy: entry.grantedBy || '—',
        grantedAt: displayDate(entry.grantedAt),
      })
    }
  }
  const [activeDrawerCode, setActiveDrawerCode] = useState(null)
  const activeDrawerFeature = features.find((feature) => feature.code === activeDrawerCode)
  const [drawerSearch, setDrawerSearch] = useState('')

  // Sub-modal for adding a new override
  const [isAddOverrideModalOpen, setIsAddOverrideModalOpen] = useState(false)
  const [newOverride, setNewOverride] = useState({
    tenantId: '',
    overrideType: 'FORCE_ENABLE',
    notes: '',
  })

  const isCurrent = useCallback(
    (version) => requestVersion.current === version && currentUserKey.current === userKey,
    [userKey],
  )
  const loadFeatures = useCallback(
    async (version) => {
      const data = await getManagerFeatures()
      if (isCurrent(version)) setCatalog({ ...data, userKey })
    },
    [getManagerFeatures, isCurrent, userKey],
  )

  const refreshFeatures = useCallback(async () => {
    const version = requestVersion.current
    setLoading(true)
    setError('')
    try {
      await loadFeatures(version)
    } catch (failure) {
      if (isCurrent(version)) setError(failure.message || 'Không tải được cấu hình tính năng.')
    } finally {
      if (isCurrent(version)) setLoading(false)
    }
  }, [loadFeatures, isCurrent])

  useEffect(() => {
    const version = ++requestVersion.current
    mutationPending.current = false
    setBusy(false)
    setActiveDrawerCode(null)
    setIsAddOverrideModalOpen(false)
    setToastMessage(null)
    setCategoryFilter('ALL')
    if (canManageOverrides) refreshFeatures()
    else {
      setLoading(false)
      setError('Bạn không có quyền quản trị tính năng.')
    }
    return () => {
      requestVersion.current = version + 1
    }
  }, [userKey, refreshFeatures, canManageOverrides])

  useEffect(() => {
    if (!activeDrawerCode) return
    const panel = isAddOverrideModalOpen ? modalRef.current : drawerRef.current
    if (!panel) return
    const previousFocus = document.activeElement
    const focusable = () => [
      ...panel.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ]
    ;(focusable()[0] || panel).focus()
    const handleKey = (event) => {
      if (event.key === 'Escape' && !mutationPending.current) {
        event.preventDefault()
        if (isAddOverrideModalOpen) setIsAddOverrideModalOpen(false)
        else setActiveDrawerCode(null)
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0],
        last = elements.at(-1)
      if (!first) {
        event.preventDefault()
        panel.focus()
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !panel.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      previousFocus?.focus()
    }
  }, [activeDrawerCode, isAddOverrideModalOpen])

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 3500)
    return () => clearTimeout(timer)
  }, [toastMessage])

  const runMutation = async (save, message, onSaved) => {
    if (mutationPending.current || loading || error || !canManageOverrides) return
    const version = requestVersion.current
    mutationPending.current = true
    setBusy(true)
    setError('')
    try {
      await save()
      if (!isCurrent(version)) return
      onSaved?.()
      setToastMessage(message)
      try {
        await loadFeatures(version)
      } catch (failure) {
        if (isCurrent(version))
          setError(`Đã lưu thay đổi nhưng chưa tải lại được dữ liệu: ${failure.message}`)
      }
    } catch (failure) {
      if (isCurrent(version)) setError(failure.message || 'Không lưu được cấu hình tính năng.')
    } finally {
      if (isCurrent(version)) {
        mutationPending.current = false
        setBusy(false)
      }
    }
  }

  const handleToggleFeature = (feature) => {
    if (!canToggleGlobal) return
    runMutation(
      () => setGlobalFeature(feature.code, !feature.enabledGlobal),
      `Tính năng [${feature.name}] đã được ${feature.enabledGlobal ? 'TẮT' : 'BẬT'} trên toàn hệ thống.`,
    )
  }

  const handleOpenDrawer = (feature) => {
    setActiveDrawerCode(feature.code)
    setDrawerSearch('')
    setIsAddOverrideModalOpen(false)
  }

  const handleCloseDrawer = () => {
    if (mutationPending.current) return
    setActiveDrawerCode(null)
    setIsAddOverrideModalOpen(false)
  }

  const handleOpenAddOverrideModal = () => {
    // Find first available tenant not already overridden
    const currentList = tenantOverrides[activeDrawerFeature.code] || []
    const availableTenant = tenants.find((tn) => !currentList.some((o) => o.tenantId === tn.id))

    setNewOverride({
      tenantId: availableTenant ? availableTenant.id : tenants[0]?.id || '',
      overrideType: 'FORCE_ENABLE',
      notes: '',
    })
    setIsAddOverrideModalOpen(true)
  }

  const handleSaveNewOverride = (e) => {
    e.preventDefault()
    if (!newOverride.tenantId) {
      setError('Vui lòng chọn khách sạn áp dụng ngoại lệ.')
      return
    }

    const tenantObj = tenants.find((t) => t.id === newOverride.tenantId)
    if (!tenantObj || !activeDrawerFeature) return

    const featureCode = activeDrawerFeature.code
    runMutation(
      () => saveFeatureOverride(tenantObj.id, featureCode, featureOverridePayload(newOverride)),
      `Đã lưu quyền ngoại lệ cho ${tenantObj.name}.`,
      () => setIsAddOverrideModalOpen(false),
    )
  }

  const handleRemoveOverride = (tenantId, tenantName) => {
    if (!activeDrawerFeature) return
    const featureCode = activeDrawerFeature.code
    runMutation(
      () => removeFeatureOverride(tenantId, featureCode),
      `Đã gỡ bỏ ngoại lệ của ${tenantName}, hoàn về quyền theo gói.`,
    )
  }

  const effectiveSearch = (search || globalSearch || '').toLowerCase()
  const categories = ['ALL', ...new Set(features.map((f) => f.category))]

  const filteredFeatures = features.filter((f) => {
    const matchesSearch =
      f.name.toLowerCase().includes(effectiveSearch) ||
      f.code.toLowerCase().includes(effectiveSearch) ||
      f.description.toLowerCase().includes(effectiveSearch) ||
      f.category.toLowerCase().includes(effectiveSearch)

    const matchesCat = categoryFilter === 'ALL' || f.category === categoryFilter
    return matchesSearch && matchesCat
  })

  const totalActiveGlobal = features.filter((f) => f.enabledGlobal).length

  // Drawer overrides list filtered by search
  const currentDrawerOverrides = activeDrawerFeature
    ? (tenantOverrides[activeDrawerFeature.code] || []).filter(
        (item) =>
          item.tenantName.toLowerCase().includes(drawerSearch.toLowerCase()) ||
          item.subdomain.toLowerCase().includes(drawerSearch.toLowerCase()) ||
          item.notes.toLowerCase().includes(drawerSearch.toLowerCase()),
      )
    : []

  const totalAllOverrides = Object.values(tenantOverrides).reduce(
    (acc, list) => acc + list.length,
    0,
  )
  const statusBanner =
    loading || busy || error ? (
      <div
        role={error ? 'alert' : 'status'}
        style={{
          padding: '14px 18px',
          border: `1px solid ${t.border}`,
          borderRadius: '14px',
          backgroundColor: t.bgInput,
          color: error ? '#EF4444' : t.textSecondary,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '13px',
        }}
      >
        {error && <AlertCircle size={17} />}
        <span style={{ flex: 1 }}>
          {error ||
            (busy
              ? labelUi('Đang lưu cấu hình tính năng…')
              : labelUi('Đang tải cấu hình tính năng…'))}
        </span>
        {error && canManageOverrides && (
          <button
            type="button"
            disabled={loading || busy}
            onClick={refreshFeatures}
            style={{
              border: `1px solid ${t.border}`,
              borderRadius: '10px',
              padding: '6px 12px',
              backgroundColor: t.bgSurface,
              color: t.primary,
              cursor: 'pointer',
            }}
          >
            {tUi('common.retry')}
          </button>
        )}
      </div>
    ) : null

  return (
    <div className="manager-page admin-features-page">
      {/* Toast Alert */}
      {toastMessage && (
        <div
          className="admin-features-toast"
          role="status"
          style={{
            position: 'fixed',
            bottom: '30px',
            right: '30px',
            backgroundColor: t.isDark ? '#1E222B' : '#1E242B',
            color: t.primary,
            padding: '14px 22px',
            borderRadius: '16px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            fontSize: '13px',
            fontWeight: '800',
            zIndex: 200,
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

      {statusBanner}
      {canManageOverrides && !canToggleGlobal && (
        <div style={{ fontSize: '12px', color: t.textSecondary }}>
          {labelUi(
            'System Manager có thể quản lý ngoại lệ theo khách sạn. Chỉ Super Admin được thay đổi cờ Global.',
          )}
        </div>
      )}

      <section className="admin-features-summary" aria-label={labelUi('Tổng quan tính năng')}>
        <div className="manager-panel admin-features-metric">
          <span>{labelUi('Tổng số tính năng')}</span>
          <strong>{loading ? '—' : features.length}</strong>
          <small>{labelUi('Danh mục toàn hệ thống')}</small>
        </div>
        <div className="manager-panel admin-features-metric">
          <span>{labelUi('Đang bật toàn hệ thống')}</span>
          <strong>
            {loading ? '—' : totalActiveGlobal}
            <small> / {features.length}</small>
          </strong>
          <small>{labelUi('Áp dụng theo gói của khách sạn')}</small>
        </div>
        <div className="manager-panel admin-features-metric">
          <span>{labelUi('Ngoại lệ theo khách sạn')}</span>
          <strong>{loading ? '—' : totalAllOverrides}</strong>
          <small>{labelUi('Tổng lượt cấp quyền riêng')}</small>
        </div>
      </section>
      <div className="manager-panel admin-features-filters">
        <label className="admin-features-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={labelUi('Tìm tính năng')}
            placeholder={labelUi('Tìm tên hoặc mã tính năng...')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {/* <div className="admin-features-categories" role="group" aria-label={labelUi("Lọc theo nhóm tính năng")}>
          {categories.map(category => (
            <button key={category} type="button" aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(category)}>
              {category === 'ALL' ? labelUi("Tất cả nhóm") : category}
            </button>
          ))}
        </div> */}
      </div>

      {/* -------------------------------------------------------------
          FEATURES CARDS LIST WITH TOGGLES
          ------------------------------------------------------------- */}
      <div className="admin-features-grid">
        {!loading && !error && filteredFeatures.length === 0 && (
          <div role="status" style={{ padding: '24px', color: t.textSecondary }}>
            {labelUi('Không có tính năng phù hợp.')}
          </div>
        )}
        {filteredFeatures.map((f) => {
          const overrideCount = (tenantOverrides[f.code] || []).length

          return (
            <div key={f.id} className="manager-panel admin-features-card">
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginBottom: '4px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: '800',
                          backgroundColor: t.aquaBg,
                          color: t.aquaText,
                          padding: '3px 8px',
                          borderRadius: '8px',
                          border: `1px solid ${t.aquaBorder}`,
                        }}
                      >
                        {f.category}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          color: t.textSecondary,
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {f.code}
                      </span>
                    </div>
                    <h3
                      style={{
                        fontSize: '16px',
                        fontWeight: '800',
                        color: t.textPrimary,
                        margin: 0,
                      }}
                    >
                      {f.name}
                    </h3>
                  </div>

                  {/* Royal Blue Toggle Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={f.enabledGlobal}
                    aria-label={`Cờ Global: ${f.name}`}
                    title={
                      canToggleGlobal
                        ? labelUi('Bật hoặc tắt tính năng toàn hệ thống')
                        : labelUi('Chỉ Super Admin được thay đổi cờ Global')
                    }
                    disabled={!canToggleGlobal || actionsDisabled}
                    onClick={() => handleToggleFeature(f)}
                    style={{
                      border: 'none',
                      padding: 0,
                      width: '52px',
                      height: '28px',
                      borderRadius: '16px',
                      backgroundColor: f.enabledGlobal
                        ? t.primary
                        : t.isDark
                          ? '#2E3440'
                          : '#CBD5E1',
                      cursor: !canToggleGlobal || actionsDisabled ? 'not-allowed' : 'pointer',
                      opacity: !canToggleGlobal || actionsDisabled ? 0.65 : 1,
                      position: 'relative',
                      transition: 'background-color 0.2s ease',
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        backgroundColor: '#FFFFFF',
                        position: 'absolute',
                        top: '3px',
                        left: f.enabledGlobal ? '27px' : '3px',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                      }}
                    />
                  </button>
                </div>

                <p
                  style={{
                    fontSize: '13px',
                    color: t.textSecondary,
                    margin: '12px 0 0 0',
                    lineHeight: 1.5,
                  }}
                >
                  {f.description}
                </p>
              </div>

              <div className="admin-features-card-footer">
                <div
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', fontSize: '12px' }}
                >
                  <span style={{ color: t.textSecondary }}>
                    {labelUi('Gói:')} <strong>{f.minPlan}</strong>
                  </span>
                  <span style={{ color: t.textSecondary }}>
                    Ngoại lệ:{' '}
                    <strong style={{ color: overrideCount > 0 ? t.primary : t.textSecondary }}>
                      {overrideCount} {tUi('common.hotelLower')}
                    </strong>
                  </span>
                </div>

                <button
                  disabled={busy}
                  onClick={() => handleOpenDrawer(f)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.03)'
                    e.currentTarget.style.borderColor = t.primary
                    e.currentTarget.style.color = t.primary
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)'
                    e.currentTarget.style.borderColor = t.border
                    e.currentTarget.style.color = t.textPrimary
                  }}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '12px',
                    border: `1px solid ${overrideCount > 0 ? t.primary : t.border}`,
                    backgroundColor:
                      overrideCount > 0
                        ? t.isDark
                          ? 'rgba(79, 70, 229, 0.12)'
                          : t.aquaBg
                        : t.bgInput,
                    color: overrideCount > 0 ? t.primary : t.textPrimary,
                    fontSize: '11.5px',
                    fontWeight: '800',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  <Sliders size={13} />
                  <span>Cấu hình ghi đè ({overrideCount})</span>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* =============================================================
          SLIDE-OVER DRAWER: TENANT OVERRIDES MANAGEMENT VIEW
          ============================================================= */}
      {activeDrawerFeature && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 120,
            display: 'flex',
            justifyContent: 'flex-end',
            backgroundColor: t.bgModalBackdrop,
            backdropFilter: 'blur(5px)',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          {/* Backdrop click to close */}
          <div
            aria-hidden="true"
            onClick={handleCloseDrawer}
            style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}
          />

          {/* Drawer Content Panel */}
          <div
            className="admin-features-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal={!isAddOverrideModalOpen}
            aria-hidden={isAddOverrideModalOpen || undefined}
            inert={isAddOverrideModalOpen || undefined}
            aria-label={`Quản lý ghi đè: ${activeDrawerFeature.name}`}
            tabIndex={-1}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '820px',
              minWidth: 0,
              height: '100%',
              backgroundColor: t.bgSurface,
              boxShadow: '-10px 0 40px rgba(0,0,0,0.35)',
              borderLeft: `1px solid ${t.border}`,
              display: 'flex',
              flexDirection: 'column',
              zIndex: 121,
              animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Drawer Header */}
            <div
              className="admin-features-drawer-heading"
              style={{
                padding: '24px 28px',
                borderBottom: `1px solid ${t.borderSubtle}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: t.isDark ? '#191D24' : '#F8FAFC',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '16px',
                    backgroundColor: t.aquaBg,
                    color: t.primary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Sliders size={24} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: '800',
                        backgroundColor: t.aquaBg,
                        color: t.aquaText,
                        padding: '2px 8px',
                        borderRadius: '6px',
                        border: `1px solid ${t.aquaBorder}`,
                      }}
                    >
                      {activeDrawerFeature.category}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        color: t.textSecondary,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {activeDrawerFeature.code}
                    </span>
                  </div>
                  <h2
                    style={{
                      fontSize: '18px',
                      fontWeight: '900',
                      color: t.textPrimary,
                      margin: '4px 0 0 0',
                    }}
                  >
                    Quản lý Ghi đè: {activeDrawerFeature.name}
                  </h2>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  aria-label={labelUi('Đóng bảng ngoại lệ')}
                  disabled={busy}
                  onClick={handleCloseDrawer}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '12px',
                    border: `1px solid ${t.border}`,
                    backgroundColor: t.bgInput,
                    color: t.textSecondary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#EF4444'
                    e.currentTarget.style.color = '#EF4444'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = t.border
                    e.currentTarget.style.color = t.textSecondary
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Feature Description & Global Status Bar */}
            <div
              className="admin-features-drawer-status"
              style={{
                padding: '14px 28px',
                backgroundColor: t.isDark ? '#14181F' : '#F1F5F9',
                borderBottom: `1px solid ${t.borderSubtle}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <div
                style={{
                  fontSize: '12.5px',
                  color: t.textSecondary,
                  lineHeight: '1.4',
                  flex: '1 1 280px',
                }}
              >
                {activeDrawerFeature.description}
                {!activeDrawerFeature.enabledGlobal && (
                  <div style={{ marginTop: '6px', fontWeight: '700' }}>
                    {labelUi(
                      'Cờ Global đang tắt: mọi khách sạn đều bị chặn, kể cả khách sạn có ngoại lệ bật.',
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <span style={{ fontSize: '11.5px', color: t.textSecondary }}>
                  {labelUi('Cờ Global:')}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: '800',
                    padding: '3px 8px',
                    borderRadius: '8px',
                    backgroundColor: activeDrawerFeature.enabledGlobal
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(107, 114, 128, 0.15)',
                    color: activeDrawerFeature.enabledGlobal ? '#10B981' : '#6B7280',
                  }}
                >
                  {activeDrawerFeature.enabledGlobal
                    ? labelUi('✓ Bật toàn hệ thống')
                    : labelUi('✕ Tắt toàn hệ thống')}
                </span>
              </div>
            </div>

            {/* Action Bar (Add Tenant Override & Search) */}
            <div
              className="admin-features-drawer-toolbar"
              style={{
                padding: '18px 28px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '16px',
                borderBottom: `1px solid ${t.borderSubtle}`,
              }}
            >
              <div
                className="admin-features-drawer-search"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: t.bgInput,
                  borderRadius: '14px',
                  padding: '8px 14px',
                  flex: '1 1 240px',
                  minWidth: 0,
                  border: `1px solid ${t.border}`,
                }}
              >
                <Search size={15} color={t.textSecondary} />
                <input
                  type="text"
                  aria-label={labelUi('Tìm khách sạn có ngoại lệ')}
                  placeholder={labelUi('Tìm khách sạn đã ghi đè...')}
                  value={drawerSearch}
                  onChange={(e) => setDrawerSearch(e.target.value)}
                  style={{
                    border: 'none',
                    outline: 'none',
                    backgroundColor: 'transparent',
                    paddingLeft: '8px',
                    fontSize: '12.5px',
                    color: t.textPrimary,
                    width: '100%',
                    fontWeight: '500',
                  }}
                />
              </div>

              <button
                disabled={actionsDisabled || !canManageOverrides || tenants.length === 0}
                onClick={handleOpenAddOverrideModal}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: t.primary,
                  color: '#FFFFFF',
                  border: 'none',
                  padding: '9px 18px',
                  borderRadius: '14px',
                  fontSize: '12.5px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(79, 70, 229, 0.25)',
                  transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 6px 18px rgba(79, 70, 229, 0.35)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(79, 70, 229, 0.25)'
                }}
              >
                <Plus size={16} />
                <span>{labelUi('Thêm khách sạn áp dụng ngoại lệ')}</span>
              </button>
            </div>

            {/* Overrides Table / List Area */}
            <div
              className="admin-features-drawer-body"
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px' }}
            >
              {statusBanner}
              {currentDrawerOverrides.length === 0 ? (
                /* Empty State */
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '60px 20px',
                    textAlign: 'center',
                    backgroundColor: t.bgInput,
                    borderRadius: '20px',
                    border: `1px dashed ${t.border}`,
                  }}
                >
                  <div
                    style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: '20px',
                      backgroundColor: t.aquaBg,
                      color: t.primary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '16px',
                    }}
                  >
                    <ShieldCheck size={28} />
                  </div>
                  <h4
                    style={{
                      fontSize: '15px',
                      fontWeight: '800',
                      color: t.textPrimary,
                      margin: '0 0 6px 0',
                    }}
                  >
                    Chưa có khách sạn nào được cấp ngoại lệ riêng
                  </h4>
                  <p
                    style={{
                      fontSize: '12.5px',
                      color: t.textSecondary,
                      margin: '0 0 18px 0',
                      maxWidth: '420px',
                      lineHeight: '1.4',
                    }}
                  >
                    Tất cả các cơ sở hiện đang tuân thủ quyền hạn mặc định theo gói thuê bao. Nhấn
                    nút bên dưới để cấp quyền vượt cấp hoặc dùng thử riêng.
                  </p>
                  <button
                    disabled={actionsDisabled || !canManageOverrides || tenants.length === 0}
                    onClick={handleOpenAddOverrideModal}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '12px',
                      backgroundColor: t.primary,
                      color: '#FFFFFF',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: '800',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Plus size={14} /> {labelUi('Thêm khách sạn áp dụng ngoại lệ')}
                  </button>
                </div>
              ) : (
                /* Overrides Table */
                <div
                  style={{
                    backgroundColor: t.bgSurface,
                    borderRadius: '18px',
                    border: `1px solid ${t.border}`,
                    overflowX: 'auto',
                    minWidth: 0,
                    boxShadow: t.cardShadow,
                  }}
                >
                  <table
                    className="admin-features-overrides"
                    role="table"
                    style={{
                      width: '100%',
                      minWidth: '680px',
                      borderCollapse: 'collapse',
                      textAlign: 'left',
                    }}
                  >
                    <thead role="rowgroup">
                      <tr
                        role="row"
                        style={{
                          backgroundColor: t.isDark ? '#191D24' : '#F8FAFC',
                          borderBottom: `1px solid ${t.border}`,
                        }}
                      >
                        <th
                          style={{
                            padding: '12px 16px',
                            fontSize: '11px',
                            fontWeight: '800',
                            color: t.textSecondary,
                            textTransform: 'uppercase',
                          }}
                        >
                          {labelUi('Khách sạn áp dụng')}
                        </th>
                        <th
                          style={{
                            padding: '12px 16px',
                            fontSize: '11px',
                            fontWeight: '800',
                            color: t.textSecondary,
                            textTransform: 'uppercase',
                          }}
                        >
                          {labelUi('Hình thức ngoại lệ')}
                        </th>
                        <th
                          style={{
                            padding: '12px 16px',
                            fontSize: '11px',
                            fontWeight: '800',
                            color: t.textSecondary,
                            textTransform: 'uppercase',
                          }}
                        >
                          {labelUi('Lý do / Ghi chú')}
                        </th>
                        <th
                          style={{
                            padding: '12px 16px',
                            fontSize: '11px',
                            fontWeight: '800',
                            color: t.textSecondary,
                            textTransform: 'uppercase',
                            textAlign: 'right',
                          }}
                        >
                          {tUi('common.actions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      {currentDrawerOverrides.map((item, idx) => (
                        <tr
                          role="row"
                          key={item.id}
                          style={{
                            borderBottom:
                              idx < currentDrawerOverrides.length - 1
                                ? `1px solid ${t.borderSubtle}`
                                : 'none',
                            transition: 'background-color 0.15s ease',
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor = t.isDark
                              ? 'rgba(255,255,255,0.02)'
                              : 'rgba(0,0,0,0.01)')
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = 'transparent')
                          }
                        >
                          {/* Khách sạn */}
                          <td role="cell" style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '10px',
                                  backgroundColor: t.bgInput,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: t.primary,
                                  flexShrink: 0,
                                }}
                              >
                                <Building2 size={16} />
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: '13px',
                                    fontWeight: '800',
                                    color: t.textPrimary,
                                  }}
                                >
                                  {item.tenantName}
                                </div>
                                <div
                                  style={{
                                    fontSize: '11px',
                                    color: t.textSecondary,
                                    marginTop: '2px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                  }}
                                >
                                  <span>{item.subdomain}</span>
                                  <span>•</span>
                                  <span style={{ color: t.textMuted }}>
                                    {labelUi('Gói:')} {item.basePlan}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Hình thức ngoại lệ */}
                          <td
                            role="cell"
                            data-label={labelUi('Hình thức ngoại lệ')}
                            style={{ padding: '14px 16px', verticalAlign: 'middle' }}
                          >
                            <div>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 10px',
                                  borderRadius: '8px',
                                  fontSize: '11px',
                                  fontWeight: '800',
                                  backgroundColor:
                                    item.overrideType === 'FORCE_ENABLE'
                                      ? t.aquaBg
                                      : item.overrideType === 'TRIAL'
                                        ? 'rgba(245, 158, 11, 0.14)'
                                        : 'rgba(239, 68, 68, 0.14)',
                                  color:
                                    item.overrideType === 'FORCE_ENABLE'
                                      ? t.primary
                                      : item.overrideType === 'TRIAL'
                                        ? '#F59E0B'
                                        : '#EF4444',
                                  border: `1px solid ${
                                    item.overrideType === 'FORCE_ENABLE'
                                      ? t.aquaBorder
                                      : item.overrideType === 'TRIAL'
                                        ? 'rgba(245, 158, 11, 0.3)'
                                        : 'rgba(239, 68, 68, 0.3)'
                                  }`,
                                }}
                              >
                                {item.overrideType === 'FORCE_ENABLE' && '👑 '}
                                {item.overrideType === 'TRIAL' && '⏳ '}
                                {item.overrideType === 'FORCE_DISABLE' && '⛔ '}
                                {item.overrideLabel}
                              </span>
                              {item.overrideType === 'TRIAL' && item.daysRemaining !== null && (
                                <div
                                  style={{
                                    fontSize: '10.5px',
                                    color: '#F59E0B',
                                    marginTop: '4px',
                                    fontWeight: '700',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                >
                                  <Clock size={11} />{' '}
                                  {item.expired
                                    ? labelUi('Đã hết hạn')
                                    : `Còn lại ${item.daysRemaining} ngày`}{' '}
                                  · {displayDate(item.expiresAt)}
                                </div>
                              )}
                              {item.overrideType === 'TRIAL' && item.daysRemaining === null && (
                                <div
                                  style={{
                                    fontSize: '10.5px',
                                    color: t.textSecondary,
                                    marginTop: '4px',
                                  }}
                                >
                                  {labelUi('Hết hạn: —')}
                                </div>
                              )}
                              {item.expiresAt && item.overrideType !== 'TRIAL' && (
                                <div
                                  style={{
                                    fontSize: '10.5px',
                                    color: t.textSecondary,
                                    marginTop: '4px',
                                  }}
                                >
                                  {item.expired ? labelUi('Đã hết hạn') : labelUi('Hết hạn')}:{' '}
                                  {displayDate(item.expiresAt)}
                                </div>
                              )}
                              {(!activeDrawerFeature.enabledGlobal || item.expired) && (
                                <div
                                  style={{
                                    fontSize: '10.5px',
                                    color: t.textSecondary,
                                    marginTop: '4px',
                                  }}
                                >
                                  {!activeDrawerFeature.enabledGlobal
                                    ? labelUi('Đang bị chặn bởi cờ Global')
                                    : labelUi('Đang áp dụng quyền theo gói')}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Ghi chú & Ngày cấp */}
                          <td
                            role="cell"
                            data-label={labelUi('Lý do / Ghi chú')}
                            style={{ padding: '14px 16px', verticalAlign: 'middle' }}
                          >
                            <div
                              style={{
                                fontSize: '12px',
                                color: t.textPrimary,
                                fontWeight: '600',
                                maxWidth: '240px',
                                lineHeight: '1.4',
                              }}
                            >
                              {item.notes}
                            </div>
                            <div
                              style={{
                                fontSize: '10.5px',
                                color: t.textSecondary,
                                marginTop: '3px',
                              }}
                            >
                              Cấp ngày {item.grantedAt} bởi {item.grantedBy}
                            </div>
                          </td>

                          {/* Thao tác */}
                          <td
                            role="cell"
                            style={{
                              padding: '14px 16px',
                              verticalAlign: 'middle',
                              textAlign: 'right',
                            }}
                          >
                            <button
                              disabled={actionsDisabled || !canManageOverrides}
                              onClick={() => handleRemoveOverride(item.tenantId, item.tenantName)}
                              title={labelUi('Gỡ bỏ quyền ghi đè, hoàn về mặc định')}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '10px',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                                color: '#EF4444',
                                fontSize: '11px',
                                fontWeight: '800',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#EF4444'
                                e.currentTarget.style.color = '#FFFFFF'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.08)'
                                e.currentTarget.style.color = '#EF4444'
                              }}
                            >
                              <Trash2 size={12} />
                              <span>{labelUi('Gỡ bỏ')}</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div
              className="admin-features-drawer-footer"
              style={{
                padding: '16px 28px',
                borderTop: `1px solid ${t.borderSubtle}`,
                backgroundColor: t.isDark ? '#191D24' : '#F8FAFC',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '12px', color: t.textSecondary }}>
                Đang áp dụng:{' '}
                <strong style={{ color: t.primary }}>
                  {currentDrawerOverrides.length} khách sạn ngoại lệ
                </strong>
              </span>

              <button
                disabled={busy}
                onClick={handleCloseDrawer}
                style={{
                  padding: '9px 20px',
                  borderRadius: '12px',
                  border: `1px solid ${t.border}`,
                  backgroundColor: t.bgInput,
                  color: t.textPrimary,
                  fontSize: '12.5px',
                  fontWeight: '800',
                  cursor: 'pointer',
                }}
              >
                {tUi('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =============================================================
          SUB-MODAL: ADD NEW TENANT OVERRIDE
          ============================================================= */}
      {isAddOverrideModalOpen && activeDrawerFeature && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 130,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(6px)',
            padding: '20px',
            animation: 'fadeIn 0.18s ease-out',
          }}
        >
          <div
            className="admin-features-modal"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={labelUi('Thêm khách sạn áp dụng ngoại lệ')}
            tabIndex={-1}
            style={{
              backgroundColor: t.bgSurface,
              borderRadius: '12px',
              width: '100%',
              maxWidth: '540px',
              padding: '28px',
              boxShadow: t.cardShadow,
              border: `1px solid ${t.border}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '18px',
              }}
            >
              <div>
                <h3
                  style={{ fontSize: '17px', fontWeight: '900', color: t.textPrimary, margin: 0 }}
                >
                  Thêm Khách sạn Áp dụng Ngoại lệ
                </h3>
                <p style={{ fontSize: '12px', color: t.textSecondary, margin: '3px 0 0 0' }}>
                  Module: <strong style={{ color: t.primary }}>{activeDrawerFeature.name}</strong> (
                  {activeDrawerFeature.code})
                </p>
              </div>
              <button
                aria-label={labelUi('Đóng hộp thoại thêm ngoại lệ')}
                disabled={busy}
                onClick={() => setIsAddOverrideModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: t.textSecondary,
                }}
              >
                <X size={20} />
              </button>
            </div>

            {statusBanner}

            <form
              onSubmit={handleSaveNewOverride}
              style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
            >
              {/* Select Tenant */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: '700',
                    color: t.textPrimary,
                    marginBottom: '6px',
                  }}
                >
                  Chọn Khách sạn áp dụng
                </label>
                <select
                  aria-label={labelUi('Khách sạn áp dụng ngoại lệ')}
                  disabled={busy || loading}
                  required
                  value={newOverride.tenantId}
                  onChange={(e) => setNewOverride({ ...newOverride, tenantId: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: `1px solid ${t.border}`,
                    backgroundColor: t.bgInput,
                    color: t.textPrimary,
                    fontSize: '13px',
                    fontWeight: '600',
                    outline: 'none',
                  }}
                >
                  {tenants.map((item) => {
                    const isAlreadyOverridden = (
                      tenantOverrides[activeDrawerFeature.code] || []
                    ).some((o) => o.tenantId === item.id)
                    return (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.subdomain || '—'}) - {item.plan || '—'}{' '}
                        {isAlreadyOverridden ? labelUi('[Đang có ngoại lệ]') : ''}
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Override Type */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: '700',
                    color: t.textPrimary,
                    marginBottom: '6px',
                  }}
                >
                  Hình thức áp dụng ngoại lệ
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
                    gap: '8px',
                  }}
                >
                  {[
                    { type: 'FORCE_ENABLE', label: 'Vượt cấp VIP', desc: 'Mở vĩnh viễn' },
                    { type: 'TRIAL', label: 'Dùng thử 30 ngày', desc: 'Hết hạn về gói' },
                    { type: 'FORCE_DISABLE', label: 'Ép buộc tắt', desc: 'Chặn riêng cơ sở' },
                  ].map((opt) => (
                    <button
                      key={opt.type}
                      type="button"
                      aria-pressed={newOverride.overrideType === opt.type}
                      disabled={busy || loading}
                      onClick={() => setNewOverride({ ...newOverride, overrideType: opt.type })}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '12px',
                        border: `1px solid ${newOverride.overrideType === opt.type ? t.primary : t.border}`,
                        backgroundColor:
                          newOverride.overrideType === opt.type
                            ? t.isDark
                              ? 'rgba(79, 70, 229, 0.15)'
                              : t.aquaBg
                            : t.bgInput,
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: '800',
                          color: newOverride.overrideType === opt.type ? t.primary : t.textPrimary,
                        }}
                      >
                        {opt.label}
                      </div>
                      <div style={{ fontSize: '10px', color: t.textSecondary, marginTop: '2px' }}>
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes / Reason */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: '700',
                    color: t.textPrimary,
                    marginBottom: '6px',
                  }}
                >
                  Lý do / Ghi chú quản trị
                </label>
                <input
                  type="text"
                  aria-label={labelUi('Lý do hoặc ghi chú quản trị')}
                  disabled={busy || loading}
                  maxLength={1000}
                  placeholder={labelUi(
                    'Ví dụ: Khách VIP ký kết hợp đồng 2 năm, Cấp trải nghiệm trước...',
                  )}
                  value={newOverride.notes}
                  onChange={(e) => setNewOverride({ ...newOverride, notes: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: '12px',
                    border: `1px solid ${t.border}`,
                    backgroundColor: t.bgInput,
                    color: t.textPrimary,
                    fontSize: '13px',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  gap: '10px',
                  marginTop: '10px',
                }}
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setIsAddOverrideModalOpen(false)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '12px',
                    border: `1px solid ${t.border}`,
                    backgroundColor: t.bgInput,
                    color: t.textPrimary,
                    cursor: 'pointer',
                    fontWeight: '700',
                    fontSize: '12.5px',
                  }}
                >
                  {tUi('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={actionsDisabled || !newOverride.tenantId || !canManageOverrides}
                  style={{
                    padding: '10px 22px',
                    borderRadius: '12px',
                    border: 'none',
                    backgroundColor: t.primary,
                    color: '#FFFFFF',
                    cursor: 'pointer',
                    fontWeight: '800',
                    fontSize: '12.5px',
                    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.25)',
                  }}
                >
                  {busy ? tUi('common.saving') : labelUi('Lưu & Áp dụng ngoại lệ')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
