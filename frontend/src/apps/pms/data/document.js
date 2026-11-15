export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function openPrintDocument(renderHtml, printLabel, blockedMessage) {
  const preview = window.open('about:blank', '_blank');
  if (!preview) throw new Error(blockedMessage);
  preview.opener = null;
  preview.document.open();
  preview.document.write(renderHtml());
  preview.document.close();
  const button = preview.document.createElement('button');
  button.textContent = printLabel;
  button.type = 'button';
  button.addEventListener('click', () => preview.print());
  preview.document.body.prepend(button);
}
