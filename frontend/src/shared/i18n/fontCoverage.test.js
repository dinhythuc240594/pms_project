import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import legacyZhCN from './locales/legacy-zh-CN.json' with { type: 'json' };
import { dictionaries, languages } from './core.js';

const sharedStylesheet = new URL('../styles/fonts.css', import.meta.url);
const styleImports = [...readFileSync(sharedStylesheet, 'utf8').matchAll(/@import\s+['"]([^'"]+)['"]/g)];
const fontFaces = styleImports.flatMap(([, specifier]) => {
  const stylesheet = specifier.startsWith('.')
    ? new URL(specifier, sharedStylesheet)
    : new URL(import.meta.resolve(specifier));
  return [...readFileSync(stylesheet, 'utf8').matchAll(/@font-face\s*\{([^}]+)\}/g)]
    .map(([, declarations]) => ({ stylesheet, declarations }));
});
const chineseCopy = [
  ...Object.entries(dictionaries['zh-CN']),
  ...Object.entries(legacyZhCN),
  ...languages.map(language => [`language.${language.code}`, language.nativeName]),
];

test('application stylesheets load without remote CSS imports that can block local fonts', () => {
  function check(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) check(url);
      else if (entry.name.endsWith('.css')) {
        for (const [, source] of readFileSync(url, 'utf8').matchAll(/@import\s+(?:url\(\s*)?['"]?([^'"\s);]+)/g)) {
          assert.doesNotMatch(source, /^(?:[a-z]+:)?\/\//i, `Remote CSS import blocks local fonts: ${url}`);
        }
      }
    }
  }
  check(new URL('../../', import.meta.url));
});

test('the shipped fonts reference valid local WOFF2 assets', () => {
  assert.ok(fontFaces.length > 0, 'Shared fonts must import self-hosted font faces');
  const checked = new Set();
  for (const { stylesheet, declarations } of fontFaces) {
    const sources = [...declarations.matchAll(/url\(\s*['"]?([^'"\s)]+\.woff2)['"]?\s*\)/g)];
    assert.ok(sources.length > 0, 'Each font face must provide a WOFF2 asset');
    for (const [, source] of sources) {
      const asset = new URL(source, stylesheet);
      assert.equal(asset.protocol, 'file:', `Font asset must be local: ${asset}`);
      if (checked.has(asset.href)) continue;
      checked.add(asset.href);
      const font = readFileSync(asset);
      assert.ok(font.length >= 48, `Incomplete WOFF2 header: ${asset}`);
      assert.equal(font.toString('ascii', 0, 4), 'wOF2', `Invalid WOFF2 signature: ${asset}`);
      assert.equal(font.readUInt32BE(8), font.length, `Invalid WOFF2 file length: ${asset}`);
    }
  }
});

test('the shipped font covers all Chinese catalog characters and language labels', () => {
  const chineseFaces = fontFaces.filter(({ declarations }) => /font-family\s*:\s*['"]Noto Sans SC Variable['"]\s*;/.test(declarations));
  assert.ok(chineseFaces.length > 0, 'The shared stack must ship the Chinese font face');
  const ranges = chineseFaces.flatMap(({ declarations }) => {
    const range = declarations.match(/unicode-range\s*:\s*([^;]+);/i);
    assert.ok(range, 'Font faces must declare their glyph ranges');
    return range[1].split(',').map(value => {
      const match = value.trim().match(/^U\+([\da-f?]+)(?:-([\da-f]+))?$/i);
      assert.ok(match, `Invalid Unicode range: ${value}`);
      const start = Number.parseInt(match[1].replaceAll('?', '0'), 16);
      const end = Number.parseInt(match[2] ?? match[1].replaceAll('?', 'f'), 16);
      return [start, end];
    });
  });
  assert.ok(ranges.length > 0, 'No shipped font glyph ranges found');
  const required = new Map();
  for (const [key, text] of chineseCopy) {
    for (const character of text) {
      if (/[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u.test(character)) {
        required.set(character.codePointAt(0), { character, key });
      }
    }
  }
  assert.ok(required.size > 0, 'Chinese copy must contain CJK characters');
  const uncovered = [...required].filter(([code]) => !ranges.some(([start, end]) => code >= start && code <= end));
  assert.deepEqual(uncovered.map(([code, { character, key }]) => `${character} U+${code.toString(16).toUpperCase()} (${key})`), []);
});

test('Chinese translations contain no replacement characters or placeholder boxes', () => {
  for (const [key, text] of chineseCopy) {
    assert.doesNotMatch(text, /[\ufffd\u25a1\u25af]/u, key);
  }
});
