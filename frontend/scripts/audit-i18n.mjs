import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const sourceRoot = path.resolve('src');
const backendRoot = path.resolve('../backend/pms_api');
const vietnamese = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'shared/i18n/locales/vi.json'), 'utf8'));
const legacyEnglish = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'shared/i18n/locales/legacy-en-US.json'), 'utf8'));
const translatedValues = new Set([...Object.values(vietnamese), ...Object.keys(legacyEnglish)]);
const vietnamesePattern = /[À-ỹĐđ]/u;
const ignoredFiles = /(?:\.test\.js|\/data\/|\/mockData\.js$)/;
const codeFragment = /(?:=>|<\/?[a-z]|\b(?:className|onClick|onChange|style|value|disabled)=|\{\{)/i;
const normalizeTemplate = value => {
  let index = 0;
  return value.replace(/\$?\{[^}]+\}/g, () => `{${index++}}`);
};

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : /\.(?:jsx|js|py)$/.test(entry.name) ? [filename] : [];
  });
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

const findings = [];
for (const filename of [...sourceFiles(sourceRoot), ...sourceFiles(backendRoot)]) {
  const frontendFile = filename.startsWith(sourceRoot);
  const relative = `${frontendFile ? 'frontend' : 'backend'}/${path.relative(frontendFile ? sourceRoot : backendRoot, filename).replaceAll('\\', '/')}`;
  if (ignoredFiles.test(relative)) continue;
  const source = fs.readFileSync(filename, 'utf8');
  const patterns = frontendFile ? [
    />([^<>{}\n]*[À-ỹĐđ][^<>{}\n]*)</gu,
    /(['"])([^'"\n]*[À-ỹĐđ][^'"\n]*)\1/gu,
    /`([^`\n]*[À-ỹĐđ][^`\n]*)`/gu,
  ] : [/(?:[furb]*)?(['"])([^'"\n]*[À-ỹĐđ][^'"\n]*)\1/giu];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[2] ?? match[1];
      const text = value.trim();
      if (!text || codeFragment.test(text) || !vietnamesePattern.test(text) || seen.has(`${match.index}:${text}`)) continue;
      seen.add(`${match.index}:${text}`);
      findings.push({ file: relative, line: lineNumber(source, match.index), text, catalogued: translatedValues.has(text) || translatedValues.has(normalizeTemplate(text)) });
    }
  }
}

const grouped = Map.groupBy(findings, finding => finding.file);
if (process.argv.includes('--json')) {
  const primaryValues = new Set(Object.values(vietnamese));
  const values = [...new Set(findings.map(row => normalizeTemplate(row.text)).filter(value => !primaryValues.has(value)))].sort();
  console.log(JSON.stringify(values, null, 2));
  process.exit(0);
}
for (const [file, rows] of [...grouped].sort((left, right) => right[1].length - left[1].length)) {
  console.log(`${file}: ${rows.length} (${rows.filter(row => row.catalogued).length} already catalogued)`);
  if (process.argv.includes('--verbose')) {
    for (const row of rows) console.log(`  ${row.line}: ${row.catalogued ? '[catalogued]' : '[missing]'} ${row.text}`);
  }
}
console.log(`\nTotal: ${findings.length}; catalogued: ${findings.filter(row => row.catalogued).length}; missing: ${findings.filter(row => !row.catalogued).length}`);

