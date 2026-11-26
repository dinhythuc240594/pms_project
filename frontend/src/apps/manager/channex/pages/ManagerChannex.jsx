import { tr as labelUi } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { usePms } from '../../../pms/data/usePms'
import { airbnbReturn, airbnbResume } from '../airbnbReturn'
import ManagerIntegrationHome from '../components/ManagerIntegrationHome'
import './ManagerChannex.css'

export default function ManagerChannex() {
  const { authGeneration, user, loading, confirmChannexAirbnb } = usePms()
  const [callback] = useState(() => airbnbReturn(window.location.search))
  const [oauth, setOauth] = useState(null),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    if (callback)
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + callback.cleanSearch + window.location.hash,
      )
  }, [callback])
  useEffect(() => {
    if (callback?.kind !== 'success' || loading || !user?.id) return
    let current = true
    const context = { authGeneration, userId: user.id }
    confirmChannexAirbnb({ channelId: callback.channelId, token: callback.token })
      .then((data) => {
        const resume = airbnbResume(data)
        if (!resume)
          throw new Error(
            'Channex chưa trả thông tin khách sạn và kết nối Airbnb hợp lệ. Tải lại để kiểm tra.',
          )
        if (current) setOauth({ ...context, data: resume })
      })
      .catch((error) => {
        if (current) setOauth({ ...context, error })
      })
    return () => {
      current = false
    }
  }, [callback, confirmChannexAirbnb, loading, user?.id, authGeneration, retry])
  const current =
    oauth?.authGeneration === authGeneration && oauth?.userId === user?.id ? oauth : null
  const pending = callback?.kind === 'success' && !current
  const dismiss = () => setOauth({ authGeneration, userId: user?.id, dismissed: true })
  return (
    <>
      {callback && callback.kind !== 'success' && (
        <p role="alert" className="channex-editor-error">
          {callback.kind === 'failure'
            ? labelUi(
                'Chưa hoàn tất ủy quyền Airbnb. Bạn có thể mở lại luồng kết nối trong Kênh OTA.',
              )
            : labelUi('Thông tin quay về từ Airbnb chưa hợp lệ. Vui lòng bắt đầu lại kết nối.')}
        </p>
      )}
      {current?.error && (
        <div role="alert" className="channex-editor-error">
          <p>
            {current.error.message ||
              labelUi('Chưa xác nhận được ủy quyền Airbnb. Vui lòng thử lại.')}
          </p>
          <button
            type="button"
            className="manager-button"
            onClick={() => {
              setOauth(null)
              setRetry((value) => value + 1)
            }}
          >
            {labelUi('Xác nhận lại')}
          </button>
        </div>
      )}
      {current?.data && (
        <div className="channex-success" role="status">
          <Check size={16} aria-hidden="true" />
          {labelUi('Đã xác nhận ủy quyền Airbnb. Chọn listing và gói giá trước khi kích hoạt.')}
          <button
            type="button"
            className="manager-icon-button"
            aria-label={labelUi('Đóng thông báo Airbnb')}
            onClick={dismiss}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      {pending ? (
        <div className="channex-state" role="status">
          <h2>{labelUi('Đang xác nhận ủy quyền Airbnb…')}</h2>
          <p>{labelUi('Kiểm tra tài khoản và khách sạn trước khi mở cấu hình kênh.')}</p>
        </div>
      ) : (
        <ManagerIntegrationHome key={authGeneration} />
      )}
    </>
  )
}
