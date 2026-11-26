import { tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useCallback, useRef } from 'react'
import { RadioTower, X } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import LegacyOverlay from '../../../pms/components/LegacyOverlay'
import { useChannexQuery } from '../useChannexQuery'
import { DataState } from './RemoteData'
import ChannelForm from './ChannelForm'

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 120,
  background: 'rgba(9,24,40,.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
}

export default function ChannelEditor({
  account,
  property,
  operations,
  canWrite = true,
  item,
  onClose,
  onSaved,
  onReload,
}) {
  useI18n()
  const busy = useRef(false)
  const close = () => {
    if (!busy.current) onClose()
  }
  const pms = usePms()
  const { getChannexChannelAdapters, getChannexChannel } = operations || pms
  const request = useCallback(
    () =>
      item
        ? getChannexChannel(account.id, property.id, item.id)
        : getChannexChannelAdapters(account.id, property.id),
    [getChannexChannelAdapters, getChannexChannel, account.id, property.id, item],
  )
  const query = useChannexQuery(request, item ? 'rateOptions' : 'adapters,groups,rateOptions')
  const title = item ? 'Cấu hình kênh OTA' : 'Thêm kênh OTA'
  return (
    <LegacyOverlay title={labelUi(title)} onClose={close} style={overlayStyle}>
      <div className="channex-editor channex-channel-editor">
        {query.loading || query.error ? (
          <>
            <div className="channex-editor-heading">
              <span className="channex-editor-icon">
                <RadioTower size={21} aria-hidden="true" />
              </span>
              <div>
                <h2>{labelUi(title)}</h2>
                <p>{property.name}</p>
              </div>
              <button
                type="button"
                className="manager-icon-button"
                aria-label={labelUi('Đóng cấu hình kênh')}
                onClick={close}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <DataState query={query} label="cấu hình kênh" />
          </>
        ) : (
          <ChannelForm
            account={account}
            property={property}
            operations={operations}
            canWrite={canWrite}
            data={query.data}
            onClose={close}
            onSaved={onSaved}
            onReload={onReload}
            onBusy={(value) => {
              busy.current = value
            }}
          />
        )}
      </div>
    </LegacyOverlay>
  )
}
