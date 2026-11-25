import { tr as labelUi, t as tUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Building2 } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import { channelSupportDecision, subscriptionDecision } from '../../../pms/data/api'
import IntegrationWorkspace from '../../../pms/channel-manager/pages/IntegrationWorkspace'
import LohaErrorPage from '../../../../shared/components/LohaErrorPage'
import './ManagerOTA.css'

export default function ManagerOTA({
  history = false,
  tenantId: selectedTenantId,
  embedded = false,
}) {
  const params = useParams()
  const tenantId = selectedTenantId || params.tenantId
  const { authGeneration, user } = usePms()
  const access = channelSupportDecision(user)
  if (!access.allowed) return <LohaErrorPage status={403} message={access.message} />
  return (
    <HotelChannels
      key={`${tenantId}:${authGeneration}:${user?.globalRole}`}
      tenantId={tenantId}
      history={history}
      embedded={embedded}
    />
  )
}

function HotelChannels({ tenantId, history, embedded }) {
  useI18n()
  const { user, requestManagedTenant } = usePms()
  const requestTenant = useCallback(
    (path, options) => requestManagedTenant(tenantId, path, options),
    [tenantId, requestManagedTenant],
  )
  const [result, setResult] = useState(null),
    [revision, setRevision] = useState(0)
  useEffect(() => {
    let current = true
    requestTenant('/workspace')
      .then((data) => {
        if (current) setResult({ requestTenant, revision, data })
      })
      .catch((error) => {
        if (current) setResult({ requestTenant, revision, error })
      })
    return () => {
      current = false
    }
  }, [requestTenant, revision])
  const loaded = result?.requestTenant === requestTenant && result?.revision === revision
  const workspace = loaded ? result.data : null
  const access = (action, feature, write = !action.endsWith('.view')) => {
    const role = channelSupportDecision(user, workspace?.tenant, action, write)
    return role.allowed
      ? subscriptionDecision(workspace.subscription, workspace.features, action, feature, write)
      : role
  }
  const readAccess = workspace ? access('channels.view', 'OTA_SYNC', false) : null
  const connectionPath = `/manager/tenants/${encodeURIComponent(tenantId)}/ota`
  const pms = {
    user,
    tenantId,
    tenant: workspace?.tenant,
    subscription: workspace?.subscription,
    settings: workspace?.settings,
    requestTenant,
    access,
  }
  return (
    <div className="manager-ota">
      {!embedded && (
        <div className="manager-ota-context">
          <Link className="manager-button" to="/manager/channex">
            <ArrowLeft size={16} aria-hidden="true" /> {tUi('nav.channels')}
          </Link>
          {workspace && (
            <div className="manager-ota-hotel">
              <Building2 size={20} aria-hidden="true" />
              <div>
                <small>{labelUi('KHÁCH SẠN ĐANG CẤU HÌNH OTA')}</small>
                <strong>{workspace.tenant.name}</strong>
              </div>
            </div>
          )}
        </div>
      )}
      {!loaded ? (
        <p className="manager-ota-loading" role="status">
          {labelUi('Đang tải cấu hình khách sạn…')}
        </p>
      ) : result.error ? (
        <LohaErrorPage
          status={result.error.status || 503}
          message={result.error.message}
          onRetry={() => setRevision((value) => value + 1)}
        />
      ) : !readAccess.allowed ? (
        <LohaErrorPage status={403} message={readAccess.message}>
          <Link className="manager-button" to="/manager/features">
            {labelUi('Quản lý tính năng')}
          </Link>
          <Link
            className="manager-button"
            to={'/manager/billing?tenant=' + encodeURIComponent(tenantId)}
          >
            {tUi('header.plan')}
          </Link>
        </LohaErrorPage>
      ) : (
        <IntegrationWorkspace
          pms={pms}
          basePath={
            embedded ? '/manager/channex?hotel=' + encodeURIComponent(tenantId) : connectionPath
          }
          initialTab={history ? 'history' : 'overview'}
        />
      )}
    </div>
  )
}
