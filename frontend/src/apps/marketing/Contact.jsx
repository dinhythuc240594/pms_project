import { tr as labelUi, t as tUi, useI18n } from '../../shared/i18n/useI18n.js';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Copy, MessageSquare, ShieldCheck } from 'lucide-react';
import './Contact.css';

export default function Contact() {
  useI18n();
  const [preparedMessage, setPreparedMessage] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [copying, setCopying] = useState(false);
  const previewRef = useRef(null);

  useEffect(() => {
    if (preparedMessage) previewRef.current?.focus();
  }, [preparedMessage]);

  function prepareMessage(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get('name') ?? '').trim();
    const email = String(fields.get('email') ?? '').trim();
    const hotel = String(fields.get('hotel') ?? '').trim();
    const message = String(fields.get('message') ?? '').trim();
    if (!message) {
      const messageField = event.currentTarget.elements.namedItem('message');
      messageField.setCustomValidity('Vui lòng viết nội dung bạn muốn trao đổi.');
      messageField.reportValidity();
      return;
    }
    setPreparedMessage([
      'Xin chào đội ngũ LOHA,',
      '',
      `Tôi là ${name}.`,
      `Email liên hệ: ${email}`,
      ...(hotel ? [`Khách sạn / cơ sở lưu trú: ${hotel}`] : []),
      '',
      message,
      '',
      'Mong được trao đổi thêm với đội ngũ LOHA. Cảm ơn!',
    ].join('\n'));
    setCopyStatus('');
  }

  async function copyMessage() {
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(preparedMessage);
      setCopyStatus('Đã sao chép nội dung. Bạn có thể dán vào cuộc trao đổi của mình.');
    } catch {
      previewRef.current?.focus();
      previewRef.current?.select();
      setCopyStatus('Trình duyệt chưa cho phép sao chép. Nội dung đã được chọn; hãy dùng Ctrl+C hoặc tính năng sao chép trên thiết bị.');
    } finally {
      setCopying(false);
    }
  }

  return (
    <>
      <section className="loha-page-intro">
        <div className="loha-container">
          <span className="loha-kicker">{labelUi("BẮT ĐẦU TỪ MỘT CUỘC TRAO ĐỔI")}</span>
          <h1>{labelUi("Khách sạn của bạn.")}<br />{labelUi("Câu chuyện của bạn.")}</h1>
          <p>{labelUi("Chia sẻ nhu cầu vận hành, những điều đang vướng hoặc câu hỏi về LOHA. Một lời nhắn rõ ràng giúp cuộc trao đổi dễ bắt đầu hơn.")}</p>
        </div>
      </section>

      <section className="loha-section loha-contact-section">
        <div className="loha-container loha-contact-grid">
          <aside className="loha-contact-guidance" aria-labelledby="loha-contact-guidance-title">
            <span className="loha-contact-symbol"><MessageSquare size={28} aria-hidden="true" /></span>
            <h2 id="loha-contact-guidance-title">{labelUi("Cùng tìm cách")}<br />{labelUi("vận hành gọn hơn.")}</h2>
            <p>{labelUi("Bạn có thể bắt đầu bằng quy mô cơ sở lưu trú, công việc cần quản lý và điều bạn mong muốn cải thiện.")}</p>
            <div className="loha-contact-route">
              <h3>{labelUi("Đang tìm gói phù hợp?")}</h3>
              <p>{labelUi("Xem các gói dịch vụ hiện có và đối chiếu với nhu cầu của đội ngũ.")}</p>
              <Link className="loha-text-link" to="/pricing">{labelUi("Xem bảng giá")}{" "}<ArrowRight size={17} aria-hidden="true" /></Link>
            </div>
            <div className="loha-contact-route">
              <h3>{labelUi("Đã có tài khoản LOHA?")}</h3>
              <p>{labelUi("Mở không gian làm việc để tiếp tục quản lý khách sạn của bạn.")}</p>
              <Link className="loha-text-link" to="/id/login">{tUi("auth.title")}{' '}<ArrowUpRight size={17} aria-hidden="true" /></Link>
            </div>
            <div className="loha-contact-privacy"><ShieldCheck size={20} aria-hidden="true" /><p>{labelUi("Không cần đưa mật khẩu, mã truy cập hay thông tin riêng của khách lưu trú vào lời nhắn.")}</p></div>
          </aside>

          <div className="loha-contact-form-panel">
            <span className="loha-kicker">{labelUi("MỘT VÀI THÔNG TIN ĐỂ BẮT ĐẦU")}</span>
            <h2>{labelUi("Chuẩn bị lời nhắn của bạn.")}</h2>
            <p id="loha-contact-form-help" className="loha-contact-form-help">{labelUi("Chuẩn bị nội dung để trao đổi với đội ngũ LOHA. Biểu mẫu chưa gửi trực tiếp.")}</p>
            <form onSubmit={prepareMessage} aria-describedby="loha-contact-form-help" onChange={() => { setPreparedMessage(''); setCopyStatus(''); }}>
              <div className="loha-contact-field-row">
                <div className="loha-contact-field">
                  <label htmlFor="loha-contact-name">{tUi("common.fullName")}{' '}<span aria-hidden="true">*</span></label>
                  <input id="loha-contact-name" name="name" type="text" autoComplete="name" required maxLength={120} pattern=".*\S.*" placeholder={labelUi("Tên của bạn")} />
                </div>
                <div className="loha-contact-field">
                  <label htmlFor="loha-contact-email">Email <span aria-hidden="true">*</span></label>
                  <input id="loha-contact-email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="ban@khachsan.vn" />
                </div>
              </div>
              <div className="loha-contact-field">
                <label htmlFor="loha-contact-hotel">{labelUi("Khách sạn / cơ sở lưu trú")}{" "}<small>{labelUi("(không bắt buộc)")}</small></label>
                <input id="loha-contact-hotel" name="hotel" type="text" autoComplete="organization" maxLength={180} placeholder={labelUi("Tên khách sạn của bạn")} />
              </div>
              <div className="loha-contact-field">
                <label htmlFor="loha-contact-message">{labelUi("Bạn muốn trao đổi điều gì?")}{" "}<span aria-hidden="true">*</span></label>
                <textarea id="loha-contact-message" name="message" rows={5} required maxLength={4000} onInput={event => event.currentTarget.setCustomValidity('')} placeholder={labelUi("Ví dụ: Tôi quản lý một khách sạn 20 phòng và muốn tìm hiểu cách theo dõi đặt phòng, dịch vụ và thanh toán với LOHA.")} />
              </div>
              <p className="loha-contact-required">{labelUi("* Thông tin cần điền để tạo lời nhắn.")}</p>
              <button className="loha-button loha-button-primary loha-contact-submit" type="submit">{labelUi("Tạo nội dung liên hệ")}{" "}<ArrowRight size={18} aria-hidden="true" /></button>
            </form>

            {preparedMessage && <div className="loha-contact-prepared">
              <label htmlFor="loha-contact-preview">{labelUi("Nội dung đã chuẩn bị")}</label>
              <p>{labelUi("Kiểm tra rồi sao chép nội dung để sử dụng trong cuộc trao đổi. Lời nhắn này chưa được gửi.")}</p>
              <textarea ref={previewRef} id="loha-contact-preview" rows={9} readOnly value={preparedMessage} />
              <button className="loha-text-link loha-contact-copy" type="button" disabled={copying} onClick={copyMessage}><Copy size={16} aria-hidden="true" />{copying ? labelUi("Đang sao chép…") : labelUi("Sao chép nội dung")}</button>
              <p className="loha-contact-copy-status" role="status">{copyStatus && <>{copyStatus.startsWith('Đã') && <Check size={16} aria-hidden="true" />}{copyStatus}</>}</p>
            </div>}
          </div>
        </div>
      </section>
    </>
  );
}
