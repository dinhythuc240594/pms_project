import { useEffect } from 'react';
import { localizeTree, localizeText, observedAttributes } from './legacyDom.js';
import { useI18n } from './useI18n.js';

export default function LegacyI18nBridge() {
  const { locale } = useI18n();

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    localizeTree(root, locale);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') localizeText(record.target, locale);
        else if (record.type === 'attributes') localizeTree(record.target, locale);
        else for (const node of record.addedNodes) localizeTree(node, locale);
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: observedAttributes });
    return () => observer.disconnect();
  }, [locale]);

  return null;
}
