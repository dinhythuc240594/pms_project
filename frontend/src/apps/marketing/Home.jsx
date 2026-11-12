import { t as tUi, tr as labelUi, useI18n } from '../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUpRight, BedDouble, CalendarDays, Check, ChevronDown, CircleCheck, CreditCard, LayoutGrid, ShieldCheck, SlidersHorizontal, Users } from 'lucide-react';
import './Home.css';

const previewViews = [
  { id: 'calendar', name: 'Lịch đặt phòng', icon: CalendarDays },
  { id: 'rooms', name: 'Sơ đồ phòng', icon: LayoutGrid },
  { id: 'payments', name: 'Thanh toán', icon: CreditCard },
];
const previewRooms = [
  { number: '101', type: 'Superior', state: 'Đang ở', guest: 'Nguyễn An', start: 1, span: 3, color: 'blue' },
  { number: '102', type: 'Superior', state: 'Phòng sạch', guest: 'Lê Minh', start: 3, span: 2, color: 'mint' },
  { number: '201', type: 'Deluxe', state: 'Đang ở', guest: 'Trần Hà', start: 1, span: 2, color: 'blue' },
  { number: '202', type: 'Deluxe', state: 'Cần dọn', guest: 'Phạm Linh', start: 4, span: 2, color: 'peach' },
  { number: '301', type: 'Suite', state: 'Phòng sạch', guest: 'Hoàng Nam', start: 2, span: 3, color: 'mint' },
];
const features = [
  { icon: CalendarDays, number: '01', title: 'Phòng nào, khách nào. Rõ ràng.', text: 'Lịch đặt phòng và sơ đồ phòng giúp lễ tân theo dõi lượt khách, ngày đến và ngày đi trong cùng một góc nhìn.', tags: ['Đặt phòng nhiều phòng', 'Nhận & trả phòng'] },
  { icon: CreditCard, number: '02', title: 'Mỗi khoản tiền, một lịch sử.', text: 'Ghi nhận tiền cọc, dịch vụ, thanh toán và hoàn tiền ngay trong booking. Theo dõi số dư trước khi trả phòng.', tags: ['Cọc & thanh toán', 'Tiền mặt & ngân hàng'] },
  { icon: Users, number: '03', title: 'Cùng đội ngũ, đúng vai trò.', text: 'Lễ tân, buồng phòng và kế toán làm việc theo quyền được cấp. Trạng thái phòng và lịch sử thao tác luôn có nơi để tra cứu.', tags: ['Phân quyền nhân viên', 'Trạng thái buồng phòng'] },
];
const questions = [
  ['LOHA quản lý những công việc nào?', 'LOHA tập trung vào phòng, giá theo ngày, đặt phòng, khách lưu trú, dịch vụ và thanh toán. Bạn có thể theo dõi lịch đặt phòng, nhận/trả phòng và trạng thái dọn phòng trong cùng hệ thống.'],
  ['Một tài khoản có thể làm việc với nhiều khách sạn không?', 'Có. Nếu được cấp quyền tại nhiều khách sạn, bạn có thể chuyển khách sạn trong ứng dụng. Mỗi khách sạn có phòng, booking và dữ liệu vận hành riêng.'],
  ['Lễ tân và kế toán có quyền giống nhau không?', 'Không. Chủ khách sạn cấp vai trò cho từng nhân viên. Lễ tân, buồng phòng và kế toán có quyền truy cập và thao tác phù hợp với công việc của mình.'],
  ['Tôi bắt đầu sử dụng LOHA như thế nào?', 'Nếu đã có tài khoản được cấp, chọn “Mở LOHA” để đăng nhập. Nếu cần tìm hiểu thêm, bạn có thể xem thông tin liên hệ và trao đổi về nhu cầu của khách sạn.'],
];

function ProductPreview() {
  useI18n();
  const [view, setView] = useState('calendar');
  return (
    <div className="loha-product-stage">
      <div className="loha-product-orbit" aria-hidden="true" />
      <div className="loha-product">
        <div className="loha-product-chrome"><span className="loha-window-dots" aria-hidden="true"><i /><i /><i /></span><span><ShieldCheck size={12} aria-hidden="true" />{" "}{labelUi("Không gian làm việc LOHA")}</span><span className="loha-chrome-symbol" aria-hidden="true">↗</span></div>
        <div className="loha-product-body">
          <div className="loha-preview-title"><div><span className="loha-preview-eyebrow">{labelUi("KHÁCH SẠN CỦA BẠN")}</span><p>{labelUi("Một ngày thật gọn gàng.")}</p></div><span className="loha-preview-avatar" aria-hidden="true">LA</span></div>
          <div className="loha-preview-metrics"><div><span>{labelUi("Phòng đang ở")}</span><strong>12 <small>/ 20</small></strong></div><div><span>{tUi("hk.arrival")}</span><strong>05 <small>{labelUi("hôm nay")}</small></strong></div><div><span>{labelUi("Khách đi")}</span><strong>03 <small>{labelUi("hôm nay")}</small></strong></div></div>
          <div className="loha-preview-controls" role="group" aria-label={labelUi("Chọn màn hình minh họa")}>
            {previewViews.map(({ id, name, icon: Icon }) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}><Icon size={14} aria-hidden="true" />{name}</button>)}
          </div>
          <div className="loha-preview-content" aria-live="polite">
            {view === 'calendar' && <div className="loha-calendar" aria-label={labelUi("Minh họa lịch đặt phòng")}>
              <div className="loha-calendar-head"><span>{tUi("common.room")}</span>{['T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((day, i) => <span key={day}>{day}<b>{12 + i}</b></span>)}</div>
              {previewRooms.map(room => <div key={room.number} className="loha-calendar-row"><div><b>{room.number}</b><small>{room.type}</small></div><div className="loha-calendar-track"><span className={`loha-booking-bar ${room.color}`} style={{ gridColumn: `${room.start} / span ${room.span}` }}><span>{room.guest}</span><small>{room.span} đêm</small></span></div></div>)}
            </div>}
            {view === 'rooms' && <div className="loha-room-preview" aria-label={labelUi("Minh họa sơ đồ phòng")}>{previewRooms.map(room => <div key={room.number} className={`loha-room-tile ${room.state === 'Cần dọn' ? 'peach' : room.state === 'Đang ở' ? 'blue' : 'mint'}`}><BedDouble size={20} aria-hidden="true" /><strong>{room.number}</strong><span>{room.type}</span><small>{room.state}</small></div>)}</div>}
            {view === 'payments' && <div className="loha-payment-preview"><div className="loha-payment-total"><span>{labelUi("Thanh toán đã ghi nhận")}</span><strong>4.800.000 <small>₫</small></strong><span>{labelUi("Minh họa giao dịch trong ngày")}</span></div>{[['Cọc đặt phòng · 101', '+ 1.000.000 ₫', 'Tiền mặt'], ['Thanh toán · 201', '+ 4.000.000 ₫', 'Ngân hàng'], ['Hoàn tiền · 101', '− 200.000 ₫', 'Tiền mặt']].map(([name, amount, fund]) => <div className="loha-payment-row" key={name}><span>{name}<small>{fund}</small></span><b>{amount}</b></div>)}</div>}
          </div>
          <div className="loha-preview-bottom"><span><i aria-hidden="true" />{view === 'calendar' ? tUi("nav.bookingCalendar") : view === 'rooms' ? labelUi("Trạng thái phòng") : labelUi("Giao dịch thanh toán")}</span><span>{labelUi("Giao diện & dữ liệu minh họa")}</span></div>
        </div>
      </div>
      <div className="loha-product-note"><span className="loha-note-icon"><CircleCheck size={20} aria-hidden="true" /></span><span><strong>{labelUi("Từ đặt phòng đến trả phòng")}</strong><small>{labelUi("Các bước nối liền trong một booking.")}</small></span></div>
      <span className="loha-stage-caption">{labelUi("THÊM THỜI GIAN CHO NHỮNG ĐIỀU QUAN TRỌNG.")}</span>
    </div>
  );
}

export default function Home() {
  useI18n();
  return (
    <>
        <section className="loha-hero">
          <div className="loha-container loha-hero-grid">
            <div className="loha-hero-copy">
              <span className="loha-eyebrow"><span aria-hidden="true" />{" "}{labelUi("PHẦN MỀM QUẢN LÝ KHÁCH SẠN")}</span>
              <h1>{tUi("auth.operate")}<br />{tUi("auth.welcome")}<br /><em>{tUi("auth.wholehearted")}</em></h1>
              <p>{labelUi("Phòng, đặt chỗ và thanh toán — tất cả trong một không gian làm việc. LOHA giúp đội ngũ của bạn dành nhiều sự quan tâm hơn cho mỗi vị khách.")}</p>
              <div className="loha-hero-actions"><Link className="loha-button loha-button-primary" to="/id/login">{labelUi("Mở LOHA")}{" "}<ArrowUpRight size={18} aria-hidden="true" /></Link><a className="loha-text-link" href="#tinh-nang">{labelUi("Khám phá giải pháp")}{" "}<ArrowDown size={16} aria-hidden="true" /></a></div>
              <div className="loha-hero-detail"><span className="loha-detail-icon"><BedDouble size={19} aria-hidden="true" /></span><span>{labelUi("Được xây dựng cho những người")}<br /><strong>{labelUi("làm khách sạn mỗi ngày.")}</strong></span></div>
            </div>
            <ProductPreview />
          </div>
          <div className="loha-container loha-capability-strip"><span>{labelUi("MỘT KHÔNG GIAN.")}<br /><strong>{labelUi("TRỌN LUỒNG VẬN HÀNH.")}</strong></span>{[[CalendarDays, 'Đặt phòng'], [BedDouble, 'Buồng phòng'], [SlidersHorizontal, 'Giá & dịch vụ'], [CreditCard, 'Thanh toán'], [ShieldCheck, 'Phân quyền']].map(([Icon, text]) => <span key={text}><Icon size={18} aria-hidden="true" />{text}</span>)}</div>
        </section>

        <section id="tinh-nang" className="loha-section loha-features">
          <div className="loha-container">
            <div className="loha-section-heading"><div><span className="loha-kicker">{labelUi("ÍT THAO TÁC HƠN. NHIỀU CHỦ ĐỘNG HƠN.")}</span><h2>{labelUi("Mọi việc về đúng chỗ.")}</h2></div><p>{labelUi("Từ quầy lễ tân đến buồng phòng, đội ngũ cùng làm việc trên dữ liệu của khách sạn.")}</p></div>
            <div className="loha-feature-list">{features.map(({ icon: Icon, number, title, text, tags }) => <article className="loha-feature" key={number}><div className="loha-feature-top"><span className="loha-feature-icon"><Icon size={24} aria-hidden="true" /></span><span>{number}</span></div><h3>{labelUi(title)}</h3><p>{text}</p><div className="loha-feature-tags">{tags.map(tag => <span key={tag}><Check size={13} aria-hidden="true" />{tag}</span>)}</div></article>)}</div>
          </div>
        </section>

        <section id="van-hanh" className="loha-workflow-section">
          <div className="loha-container loha-workflow-grid">
            <div className="loha-workflow-copy"><span className="loha-kicker">{labelUi("TỪ LƯỢT ĐẶT ĐẦU TIÊN ĐẾN LỜI CHÀO TẠM BIỆT")}</span><h2>{labelUi("Một hành trình.")}<br />{labelUi("Không đứt quãng.")}</h2><p>{labelUi("Thông tin khách, phòng, dịch vụ và thanh toán đi cùng một booking. Dễ theo dõi, dễ bàn giao, dễ tìm lại.")}</p><a className="loha-text-link" href="#cau-hoi">{labelUi("Tìm hiểu thêm")}{" "}<ArrowRight size={17} aria-hidden="true" /></a><div className="loha-workflow-note"><ShieldCheck size={20} aria-hidden="true" /><span>{labelUi("Đúng người, đúng quyền.")}<br /><strong>{labelUi("Dữ liệu riêng cho từng khách sạn.")}</strong></span></div></div>
            <ol className="loha-steps">{[['Đặt phòng', 'Chọn phòng, ngày lưu trú và hồ sơ khách.'], ['Nhận phòng', 'Kiểm tra tình trạng phòng trước khi đón khách.'], ['Dịch vụ & thanh toán', 'Thêm dịch vụ, ghi nhận cọc và các khoản thanh toán.'], ['Trả phòng', 'Đối chiếu số dư, hoàn tất lưu trú và chuyển phòng sang cần dọn.']].map(([title, text], index) => <li key={title}><span className="loha-step-number">0{index + 1}</span><div><h3>{labelUi(title)}</h3><p>{text}</p></div>{index === 3 && <CircleCheck size={20} aria-hidden="true" />}</li>)}</ol>
          </div>
        </section>

        <section className="loha-section loha-perspective">
          <div className="loha-container loha-perspective-grid"><div className="loha-hotel-photo"><img src="https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=1000&q=80" alt="Không gian lưu trú với cây xanh, ánh sáng và kiến trúc thoáng mở" loading="lazy" width="1000" height="750" /><div><span>LOHA PMS SYSTEM</span><strong>{labelUi("Phần mềm đứng sau.")}<br />{labelUi("Trải nghiệm ở phía trước.")}</strong></div></div><div className="loha-perspective-copy"><span className="loha-kicker">{tUi("auth.tagline")}</span><h2>{labelUi("Bớt lo quản lý.")}<br />{labelUi("Thêm thời gian")}<br />{" "}{labelUi("chăm sóc khách.")}</h2><p>{labelUi("Một lịch phòng rõ ràng, khoản thanh toán có lịch sử, một đội ngũ biết việc mình cần làm. Những điều nhỏ tạo nên một ngày vận hành tốt hơn.")}</p><ul>{['Theo dõi phòng và các lượt lưu trú trong cùng hệ thống.', 'Tra cứu dịch vụ, thanh toán và ghi chú của mỗi booking.', 'Xem tiền phòng dự kiến và công suất đặt phòng.'].map(text => <li key={text}><CircleCheck size={19} aria-hidden="true" />{text}</li>)}</ul></div></div>
        </section>

        <section id="cau-hoi" className="loha-section loha-faq"><div className="loha-container loha-faq-grid"><div><span className="loha-kicker">{labelUi("BẠN CÓ THỂ ĐANG THẮC MẮC")}</span><h2>{labelUi("Hiểu LOHA")}<br />{labelUi("trước khi bắt đầu.")}</h2><Link className="loha-text-link" to="/contact">{labelUi("Thông tin liên hệ")}{" "}<ArrowUpRight size={17} aria-hidden="true" /></Link></div><div className="loha-faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={19} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></div></section>
    </>
  );
}
