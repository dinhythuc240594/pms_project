import { formatDateTime } from '../../../shared/lib/date.js'
import { t as tUi, useI18n } from '../../../shared/i18n/useI18n.js'
import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { usePms } from '../data/usePms'
import Sidebar from '../components/Sidebar'
import ChatbotWorkspace from '../chatbot/ChatbotWorkspace'
import RequestActivity from '../../../shared/components/RequestActivity'
import { watchWorkspace } from '../data/workspaceSync'
import './PmsLayout.css'
import '../components/PmsControls.css'

export default function PmsLayout() {
  useI18n()
  const [mobileMenu, setMobileMenu] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [refreshing, setRefreshing] = useState(false),
    [blockedRefresh, setBlockedRefresh] = useState(null)
  const {
    subscription,
    storageWarning,
    tenantId,
    user,
    tenant,
    settings,
    accessDialog,
    authGeneration,
    workspaceLoading,
    pendingRequests,
    workspaceRevision,
    workspaceSyncError,
    writeReceipt,
    refreshWorkspace,
  } = usePms()
  const { pathname } = useLocation()
  const menuRef = useRef(null)
  const syncControl = useRef(null),
    syncState = useRef(null)
  const refreshInFlight = useRef(false)
  const unsyncedWrite =
    writeReceipt && writeReceipt.tenantId === tenantId && !writeReceipt.synchronized
  const refreshKey = JSON.stringify([tenantId, authGeneration, pathname, workspaceRevision])
  useEffect(() => {
    syncState.current = { workspaceLoading, pendingRequests, accessDialog }
  }, [workspaceLoading, pendingRequests, accessDialog])
  useEffect(() => {
    if (!tenantId) return
    const control = watchWorkspace((canApply) => refreshWorkspace({ quiet: true, canApply }), {
      isBlocked: () =>
        syncState.current.workspaceLoading ||
        syncState.current.pendingRequests.writes > 0 ||
        Boolean(syncState.current.accessDialog),
    })
    syncControl.current = control
    return () => {
      control.stop()
      syncControl.current = null
    }
  }, [tenantId, authGeneration, pathname, refreshWorkspace])
  useEffect(() => {
    syncControl.current?.resetDrafts()
  }, [workspaceRevision])
  async function retryWorkspace() {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    setRefreshing(true)
    setBlockedRefresh(null)
    try {
      if ((await syncControl.current?.refresh()) === false) setBlockedRefresh(refreshKey)
    } finally {
      refreshInFlight.current = false
      setRefreshing(false)
    }
  }
  useEffect(() => {
    if (mobileMenu && !accessDialog) menuRef.current?.showModal()
    else menuRef.current?.close()
  }, [mobileMenu, accessDialog])
  return (
    <div className={`app-theme pms-shell${isCollapsed ? ' pms-shell-collapsed' : ''}`}>
      <a className="pms-skip-link" href="#pms-main-content">
        {tUi('nav.skip')}
      </a>
      <div className="pms-desktop-navigation">
        <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      </div>
      <dialog
        id="pms-mobile-navigation"
        className="pms-mobile-navigation"
        ref={menuRef}
        aria-label={tUi('nav.hotelMenu')}
        onClick={(event) => {
          if (event.target === event.currentTarget) setMobileMenu(false)
        }}
        onCancel={() => setMobileMenu(false)}
        onClose={() => setMobileMenu(false)}
      >
        <Sidebar onClose={() => setMobileMenu(false)} />
      </dialog>
      <div className="pms-workspace">
        <RequestActivity />
        <ChatbotWorkspace
          key={JSON.stringify([tenantId, user?.id, authGeneration])}
          tenantId={tenantId}
          onOpenNavigation={() => setMobileMenu(true)}
        >
          <main id="pms-main-content" className="pms-main" tabIndex={-1}>
            <div className="pms-content">
              {subscription?.operationalAccess?.active && (
                <p className="pms-shell-notice" role="status">
                  {tUi('billing.operationalAccess', {
                    until: formatDateTime(subscription.operationalAccess.until, settings.timezone),
                  })}{' '}
                  {tUi('billing.operationalAccessHint')}
                </p>
              )}
              {storageWarning && (
                <p className="pms-shell-notice" role="alert">
                  {storageWarning}
                </p>
              )}
              {(unsyncedWrite || workspaceSyncError) && (
                <div className="pms-shell-notice pms-sync-notice">
                  <span role="status">
                    {unsyncedWrite
                      ? tUi(
                          writeReceipt.id
                            ? 'system.writeSavedPendingWithId'
                            : 'system.writeSavedPending',
                          { id: writeReceipt.id },
                        )
                      : tUi('system.syncError')}
                  </span>
                  {workspaceSyncError && (
                    <button
                      type="button"
                      disabled={
                        !tenantId || refreshing || workspaceLoading || pendingRequests.writes > 0
                      }
                      onClick={retryWorkspace}
                    >
                      {refreshing ? tUi('common.loading') : tUi('common.retry')}
                    </button>
                  )}
                  {workspaceSyncError && blockedRefresh === refreshKey && (
                    <span className="pms-sync-blocked" role="status">
                      {tUi('system.refreshBlocked')}
                    </span>
                  )}
                </div>
              )}
              {tenant && tenant.status?.toUpperCase() !== 'ACTIVE' && (
                <p className="pms-shell-notice" role="status">
                  {tUi('system.suspended')}
                </p>
              )}
              <Outlet key={JSON.stringify([tenantId, authGeneration, pathname])} />
            </div>
          </main>
        </ChatbotWorkspace>
      </div>
    </div>
  )
}
