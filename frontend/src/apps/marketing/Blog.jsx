import { tr as labelUi, useI18n } from '../../shared/i18n/useI18n.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, ClipboardCheck, KeyRound, Wallet } from 'lucide-react';
import './Blog.css';

const topics = ['Tất cả', 'Đặt phòng', 'Vận hành', 'Thanh toán'];
const articles = [
  {
    id: 'booking', topic: 'Đặt phòng', icon: CalendarDays,
    title: 'Một đặt phòng rõ ràng bắt đầu từ những thông tin nhỏ',
    excerpt: 'Ngày đến, ngày đi, khách lưu trú và phòng được chọn cần thống nhất trước khi xác nhận với khách.',
    intro: 'Khi thông tin đặt phòng được ghi nhận đầy đủ, ca trực tiếp theo có thể tiếp nhận khách mà không phải hỏi lại từ đầu.',
    steps: [
      'Đối chiếu ngày nhận và trả phòng, số khách và từng phòng trong đặt phòng. Kiểm tra tình trạng phòng trước khi xác nhận.',
      'Ghi rõ tên khách, thông tin liên hệ và yêu cầu đặc biệt. Với đặt phòng nhiều phòng, rà soát toàn bộ danh sách phòng.',
      'Kiểm tra giá và tiền cọc đã ghi nhận. Khi khách thay đổi lịch, cập nhật đặt phòng rồi xác nhận lại thông tin với khách.',
    ],
    takeaway: 'Trước khi kết thúc, đọc lại ngày lưu trú, phòng, tổng tiền và khoản đã thanh toán cùng khách.',
  },
  {
    id: 'rooms', topic: 'Vận hành', icon: KeyRound,
    title: 'Phòng trống chưa chắc đã sẵn sàng đón khách',
    excerpt: 'Tách việc khách đã trả phòng khỏi việc phòng đã dọn sạch để lễ tân và buồng phòng phối hợp đúng nhịp.',
    intro: 'Tình trạng lưu trú và tình trạng vệ sinh là hai thông tin cần kiểm tra riêng. Một phòng không có khách vẫn có thể đang chờ dọn hoặc bảo trì.',
    steps: [
      'Sau khi khách trả phòng, kiểm tra tình trạng phòng và ghi nhận các hạng mục cần dọn hoặc xử lý.',
      'Cập nhật tình trạng vệ sinh khi công việc thực sự hoàn tất. Với phòng có sự cố, ghi rõ nội dung để ca tiếp theo biết cần xử lý gì.',
      'Trước khi giao phòng, lễ tân đối chiếu tình trạng vệ sinh và khả năng sử dụng của phòng, cùng thông tin đặt phòng của khách.',
    ],
    takeaway: 'Bàn giao phòng bằng trạng thái rõ ràng và ghi chú cụ thể, tránh chỉ báo miệng “phòng đã xong”.',
  },
  {
    id: 'payments', topic: 'Thanh toán', icon: Wallet,
    title: 'Đối chiếu tiền cọc, dịch vụ và thanh toán trước checkout',
    excerpt: 'Một lượt kiểm tra ngắn giúp phát hiện khoản còn thiếu trước khi hoàn tất trả phòng.',
    intro: 'Tiền cọc, tiền phòng, dịch vụ phát sinh và các lần thanh toán cần được đối chiếu trên cùng một đặt phòng. Chỉ hoàn tất checkout khi công nợ đã được thanh toán đủ.',
    steps: [
      'Rà soát phòng và thời gian lưu trú. Kiểm tra từng dịch vụ phát sinh, số lượng và số tiền trước khi chốt với khách.',
      'Đối chiếu khoản cọc và các lần thanh toán đã ghi nhận. Chỉ ghi nhận khoản thanh toán mới sau khi đã kiểm tra tiền thực nhận.',
      'Thu phần còn thiếu và xác nhận số dư bằng không trước khi checkout. Nếu có hoàn tiền, kiểm tra lý do và lưu ghi chú rõ ràng.',
    ],
    takeaway: 'Khi số tiền chưa khớp, dừng để kiểm tra từng khoản thay vì ghi thêm một khoản thu để cân bằng.',
  },
  {
    id: 'handover', topic: 'Vận hành', icon: ClipboardCheck,
    title: 'Bàn giao ca bằng một danh sách có thể kiểm tra',
    excerpt: 'Khách sắp đến, khách sắp đi, phòng cần xử lý và khoản cần đối chiếu: bốn nhóm thông tin nên xem trước khi đổi ca.',
    intro: 'Bàn giao tốt giúp ca tiếp theo biết việc nào đã hoàn tất và việc nào còn cần người xử lý. Hãy gắn mỗi ghi chú với phòng hoặc đặt phòng cụ thể.',
    steps: [
      'Rà soát khách dự kiến nhận và trả phòng, thay đổi lịch lưu trú và các yêu cầu đã hẹn với khách.',
      'Liệt kê phòng đang chờ dọn, phòng có sự cố và người cần tiếp nhận từng việc. Cập nhật những thay đổi đã xác nhận.',
      'Đối chiếu các khoản thu, khoản hoàn tiền và đặt phòng còn nợ. Ghi lại việc chưa hoàn tất và bàn giao cho ca tiếp theo.',
    ],
    takeaway: 'Một ghi chú hữu ích trả lời được ba câu hỏi: phòng nào, còn việc gì, ai sẽ tiếp nhận?',
  },
];

export default function Blog() {
  useI18n();
  const [topic, setTopic] = useState('Tất cả');
  const visibleArticles = articles.filter(article => topic === 'Tất cả' || article.topic === topic);

  return (
    <>
      <section className="loha-page-intro">
        <div className="loha-container">
          <span className="loha-kicker">{labelUi("BLOG · SỔ TAY VẬN HÀNH")}</span>
          <h1>{labelUi("Những việc nhỏ.")}<br />{labelUi("Một ca trực tốt hơn.")}</h1>
          <p>{labelUi("Hướng dẫn ngắn dành cho lễ tân và người quản lý: ghi nhận rõ ràng, phối hợp nhịp nhàng và chăm sóc từng lượt khách.")}</p>
        </div>
      </section>

      <section className="loha-section" aria-label={labelUi("Hướng dẫn vận hành")}>
        <div className="loha-container loha-blog-layout">
          <aside className="loha-blog-sidebar" aria-label={labelUi("Lọc bài viết")}>
            <span className="loha-kicker">{labelUi("CHỌN CHỦ ĐỀ")}</span>
            <div className="loha-blog-filters" role="group" aria-label={labelUi("Chủ đề bài viết")}>
              {topics.map(item => (
                <button type="button" key={item} aria-pressed={topic === item} onClick={() => setTopic(item)}>
                  {item}<ArrowRight size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="loha-blog-note">
              <ClipboardCheck size={25} aria-hidden="true" />
              <p><strong>{labelUi("Đọc, rồi áp dụng.")}</strong>{" "}{labelUi("Dùng các bước như một danh sách kiểm tra và điều chỉnh theo quy trình của cơ sở bạn.")}</p>
              <Link className="loha-text-link" to="/id/login">{labelUi("Mở LOHA")}{" "}<ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
          </aside>

          <div className="loha-blog-articles">
            <p className="loha-blog-count" role="status">{visibleArticles.length} bài hướng dẫn · {topic}</p>
            {visibleArticles.map(({ id, topic: articleTopic, icon: Icon, title, excerpt, intro, steps, takeaway }) => (
              <article className="loha-blog-article" key={id}>
                <div className="loha-blog-article-meta"><Icon size={19} aria-hidden="true" /><span>{articleTopic}</span></div>
                <h2 id={`loha-blog-title-${id}`}>{labelUi(title)}</h2>
                <p className="loha-blog-excerpt">{excerpt}</p>
                <details className="loha-blog-details">
                  <summary aria-describedby={`loha-blog-title-${id}`}>
                    <span className="loha-blog-read">{labelUi("Đọc hướng dẫn")}</span><span className="loha-blog-close">{labelUi("Thu gọn hướng dẫn")}</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </summary>
                  <div className="loha-blog-article-body">
                    <p>{intro}</p>
                    <h3>{labelUi("Các bước thực hành")}</h3>
                    <ol>{steps.map(step => <li key={step}>{step}</li>)}</ol>
                    <p className="loha-blog-takeaway"><strong>{labelUi("Ghi nhớ:")}</strong> {takeaway}</p>
                  </div>
                </details>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
