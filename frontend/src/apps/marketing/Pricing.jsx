import { tr as labelUi, t as tUi, useI18n } from '../../shared/i18n/useI18n.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, ChevronDown, Info } from 'lucide-react';
import { enabledPlanFeatures, planRoomLabel } from '../../shared/config/pricingPlans';
import { calculatePlanPrice, defaultPricingRules } from '../../shared/lib/planPricing.js';
import { createApiClient } from '../pms/data/api';
import { money } from '../pms/data/model';

const publicApi = createApiClient();

function estimatePlanPrice(plan, roomCount, cycle) {
  try { return calculatePlanPrice(plan, roomCount, cycle === 'year' ? 'yearly' : 'monthly'); }
  catch { return null; }
}

const questions = [
  ['Các gói có những tính năng nào?', 'Danh sách đang hiển thị lấy từ cấu hình gói của LOHA. Mỗi gói có quyền sử dụng riêng; hãy đối chiếu danh sách tính năng trước khi chọn.'],
  ['Số phòng được tính như thế nào?', 'Mỗi khách sạn đăng ký số phòng cụ thể khi được cấp gói. Ví dụ, khách sạn đăng ký 10 phòng sẽ được quản lý tối đa 10 phòng, trong giới hạn của gói đã chọn.'],
  ['Giá theo năm được tính như thế nào?', 'Chọn Theo năm để xem giá năm hiện tại của từng gói. Giá tháng và giá năm được cấu hình riêng; mức phí được xác nhận khi đăng ký.'],
  ['Channel Manager và các tích hợp đã sẵn sàng chưa?', 'Nếu gói có quyền Đồng bộ OTA, kết nối Channex vẫn cần được cấu hình và nghiệm thu cho khách sạn. Hãy trao đổi để xác nhận phạm vi triển khai.'],
  ['Tôi bắt đầu từ đâu?', 'Bạn có thể xem trang Liên hệ để chuẩn bị nhu cầu triển khai. Nếu đã được cấp tài khoản khách sạn, chọn Mở LOHA để đăng nhập.'],
];

export default function Pricing() {
  const { apiText } = useI18n();
  const [cycle, setCycle] = useState('month');
  const [roomCount, setRoomCount] = useState(() => String(defaultPricingRules().baseRooms));
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState({ loading: true, plans: [], featureLabels: {}, error: '' });
  const featureLabels = Object.fromEntries(Object.entries(catalog.featureLabels).map(([code, label]) => [code, apiText(label)]));
  const validRoomCount = /^\d+$/.test(roomCount) && Number(roomCount) >= 1 && Number(roomCount) <= 1000000;
  useEffect(() => {
    let disposed = false, controller;
    const load = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setCatalog({ loading: true, plans: [], featureLabels: {}, error: '' });
      try {
        const result = await publicApi.request('/api/public/plans', { signal: request.signal });
        if (!Array.isArray(result?.plans) || !result.featureLabels || typeof result.featureLabels !== 'object') throw new Error('Dữ liệu bảng giá không hợp lệ.');
        if (!disposed && !request.signal.aborted) setCatalog({ loading: false, plans: result.plans, featureLabels: result.featureLabels, error: '' });
      } catch (err) {
        if (!disposed && !request.signal.aborted) setCatalog({ loading: false, plans: [], featureLabels: {}, error: err.message || 'Không tải được bảng giá.' });
      }
    };
    load();
    window.addEventListener('focus', load);
    return () => { disposed = true; controller?.abort(); window.removeEventListener('focus', load); };
  }, [revision]);
  return (
    <>
      <section className="loha-page-intro">
        <div className="loha-container">
          <span className="loha-kicker">{labelUi("BẢNG GIÁ LOHA · GÓI DỊCH VỤ")}</span>
          <h1>{labelUi("Chọn gói phù hợp.")}<br /><em>{labelUi("Vận hành theo cách của bạn.")}</em></h1>
          <p>{labelUi("Chọn tính năng phù hợp với đội ngũ và đăng ký số phòng theo quy mô khách sạn. Giá dưới đây là mức tham khảo hiện tại.")}</p>
        </div>
      </section>
      <section className="loha-price-section">
        <div className="loha-container">
          <div className="loha-price-top">
            <div className="loha-price-controls">
              <div className="loha-price-cycle" role="group" aria-label={labelUi("Chu kỳ giá tham khảo")}>
                <button type="button" aria-pressed={cycle === 'month'} onClick={() => setCycle('month')}>{labelUi("Theo tháng")}</button>
                <button type="button" aria-pressed={cycle === 'year'} onClick={() => setCycle('year')}>{labelUi("Theo năm")}</button>
              </div>
              <div className="loha-price-room-field">
                <label htmlFor="pricing-room-count">{tUi('pricing.roomCount')}</label>
                <input id="pricing-room-count" type="number" inputMode="numeric" min="1" max="1000000" step="1" required value={roomCount} onChange={event => setRoomCount(event.target.value)} aria-invalid={!validRoomCount} aria-describedby={validRoomCount ? 'pricing-room-count-hint' : 'pricing-room-count-hint pricing-room-count-error'} />
                <span id="pricing-room-count-hint">{tUi('pricing.roomCountHint')}</span>
              </div>
            </div>
            {/* <p>{labelUi("Tính năng và giá được đồng bộ với cấu hình gói của LOHA.")}</p> */}
          </div>
          {!validRoomCount && <p id="pricing-room-count-error" className="loha-price-input-error" role="alert">{tUi('pricing.invalidRoomCount')}</p>}
          {catalog.loading && <p className="loha-price-state" role="status">{labelUi("Đang tải bảng giá hiện tại…")}</p>}
          {catalog.error && <div className="loha-price-state"><p role="alert">Không tải được bảng giá: {catalog.error}</p><button type="button" className="loha-button loha-button-primary" onClick={() => setRevision(value => value + 1)}>{tUi("common.retry")}</button></div>}
          {!catalog.loading && !catalog.error && !catalog.plans.length && <p className="loha-price-state" role="status">{labelUi("Chưa có gói đang cung cấp.")}{" "}<Link to="/contact">{labelUi("Liên hệ LOHA")}</Link>{" "}{labelUi("để trao đổi nhu cầu.")}</p>}
          <div className="loha-price-grid" aria-live="polite" aria-busy={catalog.loading}>
            {catalog.plans.map(plan => {
              const isPro = plan.code === 'PRO';
              const quote = validRoomCount ? estimatePlanPrice(plan, roomCount, cycle) : null;
              const exceedsRoomLimit = validRoomCount && plan.maxRooms != null && Number(roomCount) > plan.maxRooms;
              let estimateMessage = tUi('pricing.estimateForRooms', { count: Number(roomCount) });
              if (!validRoomCount) estimateMessage = tUi('pricing.invalidRoomCount');
              else if (exceedsRoomLimit) estimateMessage = tUi('pricing.exceedsRoomLimit', { count: plan.maxRooms });
              else if (!quote) estimateMessage = tUi('pricing.estimateUnavailable');
              const features = enabledPlanFeatures(plan, featureLabels);
              return (
                <article key={plan.id} className={isPro ? 'loha-price-card loha-price-card-pro' : 'loha-price-card'}>
                  <div className="loha-price-card-top"><h2>{plan.name}</h2><span>{plan.code}</span></div>
                  <p className="loha-price-description">{planRoomLabel(plan)}. {plan.maxUsers == null ? labelUi("Số tài khoản theo nhu cầu.") : `Tối đa ${plan.maxUsers} tài khoản.`}</p>
                  <p className="loha-price-amount"><strong>{quote ? money(quote.amount, plan.currency) : '—'}</strong><span>/ {cycle === 'month' ? labelUi("tháng") : labelUi("năm")}</span></p>
                  <p className="loha-price-period">{estimateMessage}</p>
                  <Link className={isPro ? 'loha-button loha-button-light' : 'loha-button loha-button-primary'} to="/contact">{labelUi("Trao đổi về gói")}<ArrowUpRight size={18} aria-hidden="true" /></Link>
                  <div className="loha-price-includes">
                    <h3>{labelUi("Tính năng bao gồm")}</h3>
                    {features.length ? <ul>{features.map(feature => <li key={feature.code}><Check size={16} aria-hidden="true" />{feature.name}</li>)}</ul> : <p>{labelUi("Chưa có tính năng được bật trong gói.")}</p>}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="loha-price-note"><Info size={19} aria-hidden="true" /><p>{labelUi("Mỗi khách sạn có số phòng đăng ký riêng. Giá và tính năng lấy từ cấu hình gói đang cung cấp; chuyển chu kỳ ở đây chỉ để xem giá, chưa đăng ký hoặc thanh toán.")}</p></div>
        </div>
      </section>
      <section className="loha-section loha-faq">
        <div className="loha-container">
          <div className="loha-price-questions"><span className="loha-kicker">{labelUi("TRƯỚC KHI CHỌN GÓI")}</span><h2>{labelUi("Một vài điều cần biết.")}</h2>
            <div className="loha-faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={19} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div>
          </div>
        </div>
      </section>
    </>
  );
}
