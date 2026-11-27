import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePms } from '../../data/usePms'
import { useDraftGuard } from '../../../../shared/drafts/DraftGuardProvider'
import { errorText } from '../api'
import '../styles.css'

function Brand({ request }) {
  const [saved, setSaved] = useState(null)
  const [profile, setProfile] = useState({
    publicName: '',
    description: '',
    address: '',
    contactUrl: '',
    facts: '',
  })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const alive = useRef(true)
  const dirty = useRef(false)
  const hasChanges = saved !== null && JSON.stringify(profile) !== JSON.stringify(saved.profile)
  useLayoutEffect(() => {
    dirty.current = hasChanges
  }, [hasChanges])
  useDraftGuard({ dirty: () => dirty.current, pending: () => pending.current })
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    request('/brand', { signal: controller.signal })
      .then((result) => {
        if (!alive.current) return
        const complete = {
          publicName: '',
          description: '',
          address: '',
          contactUrl: '',
          facts: '',
          ...result.profile,
        }
        setSaved({ ...result, profile: complete })
        setProfile(complete)
      })
      .catch((e) => {
        if (!controller.signal.aborted && alive.current) setError(errorText(e))
      })
    return () => {
      alive.current = false
      controller.abort()
    }
  }, [request])
  async function save(event) {
    event.preventDefault()
    if (pending.current || !saved) return
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await request('/brand', {
        method: 'PUT',
        body: { expectedVersion: saved.version, profile },
      })
      if (alive.current) {
        setSaved(result)
        setProfile(result.profile)
        dirty.current = false
        setNotice('Đã lưu hồ sơ. Trang đang công khai giữ nguyên nội dung đã duyệt.')
      }
    } catch (e) {
      if (alive.current) setError(errorText(e))
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  return (
    <div className="marketing-module">
      <header className="mk-header">
        <div>
          <p className="mk-eyebrow">MARKETING</p>
          <h1>Hồ sơ thương hiệu</h1>
          <p>Chỉ cung cấp thông tin công khai đã xác nhận. AI dùng hồ sơ này khi tạo nội dung.</p>
        </div>
        <Link className="mk-button" to="/id/marketing/pages">
          Danh sách trang
        </Link>
      </header>
      {error && (
        <div className="mk-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="mk-notice" role="status">
          {notice}
        </p>
      )}
      <form className="mk-brand-form" onSubmit={save}>
        <label>
          Tên khách sạn công khai
          <input
            value={profile.publicName}
            maxLength={160}
            onChange={(e) => setProfile({ ...profile, publicName: e.target.value })}
          />
        </label>
        <label>
          Địa chỉ công khai
          <input
            value={profile.address}
            maxLength={400}
            onChange={(e) => setProfile({ ...profile, address: e.target.value })}
          />
        </label>
        <label>
          Giới thiệu
          <textarea
            value={profile.description}
            maxLength={2000}
            onChange={(e) => setProfile({ ...profile, description: e.target.value })}
          />
        </label>
        <label>
          Đường dẫn đặt phòng, tel: hoặc mailto:
          <input
            value={profile.contactUrl}
            maxLength={2048}
            placeholder="https://… hoặc tel:+84…"
            onChange={(e) => setProfile({ ...profile, contactUrl: e.target.value })}
          />
        </label>
        <label>
          Tiện ích và thông tin đã xác nhận
          <textarea
            value={profile.facts}
            maxLength={4000}
            onChange={(e) => setProfile({ ...profile, facts: e.target.value })}
          />
        </label>
        <button className="mk-button mk-primary" disabled={!saved || busy} type="submit">
          {busy ? 'Đang lưu…' : 'Lưu hồ sơ'}
        </button>
      </form>
    </div>
  )
}

export default function MarketingBrand() {
  const { marketingRequest, tenantId, authGeneration } = usePms()
  return <Brand key={`${tenantId}:${authGeneration}`} request={marketingRequest} />
}
