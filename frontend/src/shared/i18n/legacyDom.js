import { translateUiText } from './core.js';

const translatedText = new WeakMap();
const translatedAttributes = new WeakMap();
export const translatedAttributeNames = ['aria-label', 'placeholder', 'title'];
export const observedAttributes = [...translatedAttributeNames, 'data-i18n-ui', 'data-i18n-attrs', 'data-i18n-ignore', 'contenteditable'];

function ignored(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  return !element || element.closest('script, style, noscript, textarea, [data-i18n-ignore], [contenteditable]:not([contenteditable="false"])');
}

export function localizeText(node, locale) {
  // A dictionary match cannot distinguish a UI label from a guest or hotel name.
  // Opt in only this element's own text, never the text of its descendants.
  if (ignored(node) || !node.parentElement.hasAttribute('data-i18n-ui')) return;
  const current = node.nodeValue;
  const previous = translatedText.get(node);
  const source = previous && current === previous.rendered ? previous.source : current;
  const leading = source.match(/^\s*/)?.[0] || '';
  const trailing = source.match(/\s*$/)?.[0] || '';
  const content = source.slice(leading.length, source.length - trailing.length || undefined);
  const rendered = `${leading}${translateUiText(locale, content)}${trailing}`;
  translatedText.set(node, { source, rendered });
  if (current !== rendered) node.nodeValue = rendered;
}

export function localizeAttributes(element, locale) {
  if (ignored(element)) return;
  const optedIn = new Set((element.getAttribute('data-i18n-attrs') || '').split(/\s+/));
  const records = translatedAttributes.get(element) || {};
  for (const name of translatedAttributeNames) {
    if (!optedIn.has(name) || !element.hasAttribute(name)) continue;
    const current = element.getAttribute(name);
    const previous = records[name];
    const source = previous && current === previous.rendered ? previous.source : current;
    const rendered = translateUiText(locale, source);
    records[name] = { source, rendered };
    if (current !== rendered) element.setAttribute(name, rendered);
  }
  translatedAttributes.set(element, records);
}

export function localizeTree(root, locale) {
  if (root.nodeType === 3) {
    localizeText(root, locale);
    return;
  }
  if (root.nodeType !== 1 || ignored(root)) return;
  localizeAttributes(root, locale);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) localizeText(node, locale);
    else localizeAttributes(node, locale);
  }
}
