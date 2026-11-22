import { getLocale, t } from '../../../../shared/i18n/store.js';
import { money } from '../../data/model.js';
import { escapeHtml as escape, openPrintDocument } from '../../data/document.js';
import { billingDate, invoiceStatusLabel, paymentMethodLabel } from './billingDisplay.js';

export function billingDocumentHtml(invoice, timezone = 'Asia/Ho_Chi_Minh') {
  const label = key => escape(t(key));
  const amount = value => escape(money(value, invoice.currency));
  const detail = (key, value) => `<div><dt>${label(key)}</dt><dd>${escape(value)}</dd></div>`;
  const payments = (invoice.payments || []).map(payment => `<tr><td>${escape(payment.id)}<br>${escape(billingDate(payment.createdAt, timezone))}</td><td>${escape(paymentMethodLabel(payment.method))}<br>${escape(payment.reference)}<br>${escape(payment.note)}</td><td>${amount(payment.amount)}</td></tr>`).join('');
  const refunds = (invoice.refunds || []).map(refund => `<tr><td>${escape(refund.paymentId)}<br>${escape(billingDate(refund.createdAt, timezone))}</td><td>${escape(refund.reason)}</td><td>−${amount(refund.amount)}</td></tr>`).join('');
  return `<!doctype html><html lang="${escape(getLocale())}"><head><meta charset="utf-8"><title>${label('billing.documentTitle')} ${escape(invoice.number)}</title><style>body{font:14px Arial,sans-serif;color:#15304a;max-width:850px;margin:32px auto;padding:0 24px}h1{font-size:24px}h2{font-size:18px}p,dd{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.notice{padding:12px;border:1px solid #b8c4cf;background:#f4f7fa}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}dt{font-size:12px;color:#526779}dd{margin:4px 0}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:10px;border-bottom:1px solid #dbe4ec;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th:last-child,td:last-child{text-align:right}button{padding:10px 18px;border:0;border-radius:6px;background:#006bb6;color:white;cursor:pointer}@media print{body{margin:0;padding:0}button{display:none}tr{break-inside:avoid}@page{margin:18mm}}</style></head><body><h1>${label('billing.documentTitle')}</h1><p class="notice">${label('billing.internalNotice')}</p><h2>${escape(invoice.number)}</h2><dl>${detail('billing.hotel', invoice.tenantName || invoice.tenantId)}${detail('billing.tenantCode', invoice.tenantId)}${detail('billing.issuedAt', billingDate(invoice.createdAt, timezone))}${detail('billing.dueDate', billingDate(invoice.dueDate, timezone))}${detail('common.status', invoiceStatusLabel(invoice.status))}${detail('billing.timezone', timezone)}</dl><h2>${label('billing.description')}</h2><p>${escape(invoice.description)}</p><table><thead><tr><th>${label('billing.amount')}</th><th>${label('billing.paid')}</th><th>${label('billing.balance')}</th></tr></thead><tbody><tr><td>${amount(invoice.amount)}</td><td>${amount(invoice.paid)}</td><td>${amount(invoice.balance)}</td></tr></tbody></table><h2>${label('billing.payments')}</h2><table><thead><tr><th>${label('billing.paymentRecord')}</th><th>${label('billing.paymentDetails')}</th><th>${label('billing.amount')}</th></tr></thead><tbody>${payments || `<tr><td colspan="3">${label('billing.noPayments')}</td></tr>`}</tbody></table>${refunds ? `<h2>${label('billing.refunds')}</h2><table><thead><tr><th>${label('billing.paymentRecord')}</th><th>${label('billing.refundReason')}</th><th>${label('billing.amount')}</th></tr></thead><tbody>${refunds}</tbody></table>` : ''}${invoice.status === 'void' ? `<h2>${label('billing.voidReason')}</h2><p>${escape(invoice.voidReason || '—')}<br>${escape(billingDate(invoice.voidedAt, timezone))}</p>` : ''}</body></html>`;
}

export function openBillingDocument(invoice, timezone) {
  openPrintDocument(() => billingDocumentHtml(invoice, timezone), t('billing.print'), t('billing.popupBlocked'));
}

export function downloadBillingDocument(invoice, timezone) {
  const url = URL.createObjectURL(new Blob([billingDocumentHtml(invoice, timezone)], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${String(invoice.number || 'saas-invoice').replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
