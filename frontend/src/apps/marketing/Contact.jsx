import { tr as labelUi, t as tUi, useI18n } from '../../shared/i18n/useI18n.js'
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  LoaderCircle,
  Mail,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react'
import { emailInput, emailPattern } from '../../shared/lib/validation.js'
import { isValidPhone, phonePattern } from '../../shared/lib/phone.js'
import { createApiClient } from '../pms/data/api'
import './Contact.css'

const contactApi = createApiClient()
const contactEmail = 'info@lohapms.com'
const contactErrors = {
  invalid_contact: 'contact.invalidContact',
  invalid_email: 'contact.invalidEmail',
  invalid_phone: 'contact.invalidPhone',
  contact_rate_limited: 'contact.rateLimited',
  contact_unavailable: 'contact.unavailable',
  contact_send_failed: 'contact.sendFailed',
}

function planReference(params) {
  if (!['plan', 'rooms', 'cycle'].every((key) => params.getAll(key).length === 1)) return ''
  const plan = params.get('plan').trim(),
    rooms = params.get('rooms'),
    cycle = params.get('cycle')
  if (!plan || plan.length > 160 || /[<>\p{C}\u2028\u2029]/u.test(plan)) return ''
  if (
    !/^[1-9]\d{0,6}$/.test(rooms) ||
    Number(rooms) > 1000000 ||
    !['month', 'year'].includes(cycle)
  )
    return ''
  return `Tôi muốn trao đổi về gói ${plan}, ${rooms} phòng, chu kỳ theo ${cycle === 'year' ? 'năm' : 'tháng'}. Đây là nhu cầu tham khảo, chưa đăng ký hoặc thanh toán.`
}

export default function Contact() {
  useI18n()
  const [params] = useSearchParams()
  const [form, setForm] = useState(() => ({
    name: '',
    email: '',
    phone: '',
    hotel: '',
    message: planReference(params),
  }))
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  function update(field, value) {
    setForm((old) => ({ ...old, [field]: value }))
    setSent(false)
    setError('')
  }

  async function sendMessage(event) {
    event.preventDefault()
    if (inFlight.current || sent) return
    const body = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]))
    if (!body.name || !body.message) {
      setError('contact.invalidContact')
      return
    }
    try {
      body.email = emailInput(body.email)
    } catch {
      setError('contact.invalidEmail')
      return
    }
    if (!isValidPhone(body.phone)) {
      setError('contact.invalidPhone')
      return
    }
    inFlight.current = true
    setSending(true)
    setError('')
    try {
      const result = await contactApi.request('/api/public/contact', { method: 'POST', body })
      if (result?.sent !== true) throw new Error('Contact delivery not confirmed')
      setSent(true)
    } catch (failure) {
      setError(contactErrors[failure.code] || 'contact.sendFailed')
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  return (
    <>
      <section className="loha-page-intro">
        <div className="loha-container">
          <span className="loha-kicker">{labelUi('BẮT ĐẦU TỪ MỘT CUỘC TRAO ĐỔI')}</span>
          <h1>
            {labelUi('Khách sạn của bạn.')}
            <br />
            {labelUi('Câu chuyện của bạn.')}
          </h1>
          <p>
            {labelUi(
              'Chia sẻ nhu cầu vận hành, những điều đang vướng hoặc câu hỏi về LOHA. Một lời nhắn rõ ràng giúp cuộc trao đổi dễ bắt đầu hơn.',
            )}
          </p>
        </div>
      </section>

      <section className="loha-section loha-contact-section">
        <div className="loha-container loha-contact-grid">
          <aside className="loha-contact-guidance" aria-labelledby="loha-contact-guidance-title">
            <span className="loha-contact-symbol">
              <MessageSquare size={28} aria-hidden="true" />
            </span>
            <h2 id="loha-contact-guidance-title">
              {labelUi('Cùng tìm cách')}
              <br />
              {labelUi('vận hành gọn hơn.')}
            </h2>
            <p>
              {labelUi(
                'Bạn có thể bắt đầu bằng quy mô cơ sở lưu trú, công việc cần quản lý và điều bạn mong muốn cải thiện.',
              )}
            </p>
            <div className="loha-contact-route">
              <h3>{tUi('contact.emailHeading')}</h3>
              <p>{tUi('contact.emailHelp')}</p>
              <a className="loha-text-link" href={`mailto:${contactEmail}`}>
                <Mail size={17} aria-hidden="true" />
                {contactEmail}
              </a>
            </div>
            <div className="loha-contact-route">
              <h3>{labelUi('Đang tìm gói phù hợp?')}</h3>
              <p>{labelUi('Xem các gói dịch vụ hiện có và đối chiếu với nhu cầu của đội ngũ.')}</p>
              <Link className="loha-text-link" to="/pricing">
                {labelUi('Xem bảng giá')} <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </div>
            <div className="loha-contact-route">
              <h3>{labelUi('Đã có tài khoản LOHA?')}</h3>
              <p>{labelUi('Mở không gian làm việc để tiếp tục quản lý khách sạn của bạn.')}</p>
              <Link className="loha-text-link" to="/id/login">
                {tUi('auth.title')} <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
            <div className="loha-contact-privacy">
              <ShieldCheck size={20} aria-hidden="true" />
              <p>
                {labelUi(
                  'Không cần đưa mật khẩu, mã truy cập hay thông tin riêng của khách lưu trú vào lời nhắn.',
                )}
              </p>
            </div>
          </aside>

          <div className="loha-contact-form-panel">
            <span className="loha-kicker">{labelUi('MỘT VÀI THÔNG TIN ĐỂ BẮT ĐẦU')}</span>
            <h2>{tUi('contact.formTitle')}</h2>
            <p id="loha-contact-form-help" className="loha-contact-form-help">
              {tUi('contact.formHelp')}
            </p>
            <form
              onSubmit={sendMessage}
              aria-describedby="loha-contact-form-help"
              aria-busy={sending}
            >
              <fieldset className="loha-contact-fields" disabled={sending}>
                <div className="loha-contact-field-row">
                  <div className="loha-contact-field">
                    <label htmlFor="loha-contact-name">
                      {tUi('common.fullName')} <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="loha-contact-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      required
                      maxLength={120}
                      pattern=".*\S.*"
                      placeholder={labelUi('Tên của bạn')}
                      value={form.name}
                      onChange={(event) => update('name', event.target.value)}
                    />
                  </div>
                  <div className="loha-contact-field">
                    <label htmlFor="loha-contact-email">
                      Email <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="loha-contact-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      pattern={emailPattern}
                      placeholder="ban@khachsan.vn"
                      value={form.email}
                      onChange={(event) => update('email', event.target.value)}
                    />
                  </div>
                </div>
                <div className="loha-contact-field-row">
                  <div className="loha-contact-field">
                    <label htmlFor="loha-contact-phone">
                      {tUi('common.phone')} <small>{tUi('contact.optional')}</small>
                    </label>
                    <input
                      id="loha-contact-phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      maxLength={40}
                      pattern={phonePattern}
                      title={tUi('contact.invalidPhone')}
                      value={form.phone}
                      onChange={(event) => update('phone', event.target.value)}
                    />
                  </div>
                  <div className="loha-contact-field">
                    <label htmlFor="loha-contact-hotel">
                      {labelUi('Khách sạn / cơ sở lưu trú')}{' '}
                      <small>{tUi('contact.optional')}</small>
                    </label>
                    <input
                      id="loha-contact-hotel"
                      name="hotel"
                      type="text"
                      autoComplete="organization"
                      maxLength={180}
                      placeholder={labelUi('Tên khách sạn của bạn')}
                      value={form.hotel}
                      onChange={(event) => update('hotel', event.target.value)}
                    />
                  </div>
                </div>
                <div className="loha-contact-field">
                  <label htmlFor="loha-contact-message">
                    {labelUi('Bạn muốn trao đổi điều gì?')} <span aria-hidden="true">*</span>
                  </label>
                  <textarea
                    id="loha-contact-message"
                    name="message"
                    rows={5}
                    required
                    maxLength={4000}
                    value={form.message}
                    onChange={(event) => update('message', event.target.value)}
                    placeholder={labelUi(
                      'Ví dụ: Tôi quản lý một khách sạn 20 phòng và muốn tìm hiểu cách theo dõi đặt phòng, dịch vụ và thanh toán với LOHA.',
                    )}
                  />
                </div>
                <p className="loha-contact-required">{tUi('contact.requiredFields')}</p>
                <button
                  className="loha-button loha-button-primary loha-contact-submit"
                  type="submit"
                  disabled={sending || sent}
                >
                  {sending
                    ? tUi('contact.sending')
                    : sent
                      ? tUi('contact.sentButton')
                      : tUi('contact.send')}{' '}
                  {sending ? (
                    <LoaderCircle size={18} aria-hidden="true" />
                  ) : (
                    <ArrowRight size={18} aria-hidden="true" />
                  )}
                </button>
              </fieldset>
            </form>
            {error && (
              <p className="loha-contact-feedback is-error" role="alert">
                {tUi(error)}
              </p>
            )}
            {sent && (
              <p className="loha-contact-feedback is-success" role="status">
                <Check size={18} aria-hidden="true" />
                {tUi('contact.sent')}
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
