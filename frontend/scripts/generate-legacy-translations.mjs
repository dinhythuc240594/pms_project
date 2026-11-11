import fs from 'node:fs';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const auditedValues = JSON.parse(execFileSync(process.execPath, ['scripts/audit-i18n.mjs', '--json'], { encoding: 'utf8' }));
const normalizeTemplate = value => {
  let index = 0;
  return value.replace(/\$?\{[^}]+\}/g, () => `{${index++}}`);
};
const codeFragment = /(?:=>|<\/?[a-z]|\b(?:className|onClick|onChange|style|value|disabled)=|\{\{)/i;
const values = [...new Set(auditedValues.map(normalizeTemplate).filter(value => !codeFragment.test(value)))];
const targets = [['en-US', 'en'], ['zh-CN', 'zh-CN']];
const delimiter = '\n[[LOHA_I18N_BREAK]]\n';

function batches(items, maxLength = 3000) {
  const result = [];
  let current = [];
  let length = 0;
  for (const item of items) {
    if (current.length && length + item.length > maxLength) {
      result.push(current);
      current = [];
      length = 0;
    }
    current.push(item);
    length += item.length + delimiter.length;
  }
  if (current.length) result.push(current);
  return result;
}

async function translate(texts, target) {
  const translated = [];
  for (const batch of batches(texts)) {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', 'vi');
    url.searchParams.set('tl', target);
    url.searchParams.set('dt', 't');
    const protectedBatch = batch.map(text => text.replace(/\{(\d+)\}/g, 'LOHAPARAM$1X'));
    url.searchParams.set('q', protectedBatch.join(delimiter));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Translation request failed: ${response.status}`);
    const payload = await response.json();
    const output = payload[0].map(part => part[0]).join('');
    const parts = output.split(/\s*\[\[LOHA_I18N_BREAK\]\]\s*/).map(text => text.replace(/(?:LOHAPARAM|洛哈帕拉姆)\s*(\d+)\s*X/gi, '{$1}'));
    if (parts.length !== batch.length) throw new Error(`Translation batch mismatch: ${batch.length} inputs, ${parts.length} outputs`);
    translated.push(...parts);
  }
  return translated;
}

for (const [locale, target] of targets) {
  const output = await translate(values, target);
  const dictionary = Object.fromEntries(values.map((value, index) => [value, output[index]]));
  fs.writeFileSync(`src/shared/i18n/locales/legacy-${locale}.json`, `${JSON.stringify(dictionary, null, 2)}\n`);
  console.log(`${locale}: ${output.length} strings`);
}
