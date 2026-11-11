import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeTree, localizeText, localizeAttributes } from './legacyDom.js';

// Keep the DOM fixture limited to the tree, attribute and selector operations used
// by the bridge. Parent links and reparenting follow browser DOM behavior.
function withDom(run) {
  const nodeTypes = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  const filters = { SHOW_ELEMENT: 1, SHOW_TEXT: 4 };
  class Element {
    constructor(tagName, attrs, children) {
      this.nodeType = 1;
      this.tagName = tagName.toUpperCase();
      this.parentElement = null;
      this.childNodes = [];
      this.attrs = new Map(Object.entries(attrs));
      this.value = attrs.value || '';
      this.ownerDocument = doc;
      for (const child of children) this.appendChild(typeof child === 'string' ? text(child) : child);
    }
    appendChild(node) {
      if (node.parentElement) node.parentElement.childNodes.splice(node.parentElement.childNodes.indexOf(node), 1);
      node.parentElement = this;
      this.childNodes.push(node);
      return node;
    }
    hasAttribute(name) { return this.attrs.has(name); }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    removeAttribute(name) { this.attrs.delete(name); }
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim();
        const exclusion = part.match(/^(.*):not\((.*)\)$/);
        if (exclusion) return this.matches(exclusion[1]) && !this.matches(exclusion[2]);
        if (/^[\w-]+$/.test(part)) return this.tagName === part.toUpperCase();
        const attribute = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
        if (!attribute) throw new Error(`Unsupported fixture selector: ${part}`);
        return this.hasAttribute(attribute[1]) && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]);
      });
    }
    closest(selector) {
      for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
      return null;
    }
    get textContent() { return this.childNodes.map(node => node.nodeType === 3 ? node.nodeValue : node.textContent).join(''); }
  }
  const doc = {
    createTreeWalker(root, mask) {
      function* descendants(parent) {
        for (const child of parent.childNodes || []) {
          if ((child.nodeType === 1 && (mask & filters.SHOW_ELEMENT)) || (child.nodeType === 3 && (mask & filters.SHOW_TEXT))) yield child;
          yield* descendants(child);
        }
      }
      const iterator = descendants(root);
      return { nextNode: () => iterator.next().value ?? null };
    },
  };
  const text = value => ({ nodeType: 3, nodeValue: value, parentElement: null, ownerDocument: doc });
  const element = (tagName, attrs = {}, ...children) => new Element(tagName, attrs, children);
  const previous = ['document', 'Node', 'NodeFilter'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  Object.defineProperties(globalThis, {
    document: { configurable: true, writable: true, value: doc },
    Node: { configurable: true, writable: true, value: nodeTypes },
    NodeFilter: { configurable: true, writable: true, value: filters },
  });
  try { return run({ element, text }); }
  finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('unmarked guest names, hotel names and notes remain opaque despite dictionary collisions', () => withDom(({ element }) => {
  const data = element('section', {}, element('h1', {}, 'Đặt phòng'), element('strong', {}, 'Lưu'), element('p', {}, 'Cấu hình giá không hợp lệ.'), element('p', {}, 'i18n:common.save'));
  const label = element('button', { 'data-i18n-ui': '' }, 'Lưu');
  const root = element('main', {}, data, label);
  for (const [locale, translated] of [['vi', 'Lưu'], ['en-US', 'Save'], ['zh-CN', '保存'], ['vi', 'Lưu']]) {
    localizeTree(root, locale);
    assert.equal(data.textContent, 'Đặt phòngLưuCấu hình giá không hợp lệ.i18n:common.save');
    assert.equal(label.textContent, translated);
  }
}));

test('UI text opt-in applies only to direct text children and never inherits into business data', () => withDom(({ element }) => {
  const business = element('span', {}, 'Hủy');
  const explicitChild = element('span', { 'data-i18n-ui': '' }, 'Lưu');
  const root = element('button', { 'data-i18n-ui': '' }, '  Lưu \n', business, explicitChild);
  localizeTree(root, 'en-US');
  assert.equal(root.childNodes[0].nodeValue, '  Save \n');
  assert.equal(business.textContent, 'Hủy');
  assert.equal(explicitChild.textContent, 'Save');
  localizeTree(root, 'zh-CN');
  assert.equal(root.childNodes[0].nodeValue, '  保存 \n');
  assert.equal(business.textContent, 'Hủy');
  localizeTree(root, 'vi');
  assert.equal(root.childNodes[0].nodeValue, '  Lưu \n');
}));

test('only explicitly listed supported attributes translate while form and business values remain intact', () => withDom(({ element }) => {
  const input = element('input', {
    'data-i18n-attrs': 'aria-label placeholder value alt data-guest',
    'aria-label': 'Lưu', placeholder: 'Hủy', title: 'Đặt phòng', value: 'Lưu', alt: 'Hủy', 'data-guest': 'Đặt phòng',
  });
  input.value = 'Đặt phòng';
  const unmarked = element('input', { 'data-i18n-ui': '', 'aria-label': 'Lưu', placeholder: 'Hủy', title: 'Đặt phòng', value: 'Hủy' });
  const root = element('main', {}, input, unmarked);
  for (const [locale, label, placeholder] of [['en-US', 'Save', 'Cancel'], ['zh-CN', '保存', '取消'], ['vi', 'Lưu', 'Hủy']]) {
    localizeTree(root, locale);
    assert.equal(input.getAttribute('aria-label'), label);
    assert.equal(input.getAttribute('placeholder'), placeholder);
    assert.equal(input.getAttribute('title'), 'Đặt phòng');
    assert.equal(input.getAttribute('value'), 'Lưu');
    assert.equal(input.value, 'Đặt phòng');
    assert.equal(input.getAttribute('alt'), 'Hủy');
    assert.equal(input.getAttribute('data-guest'), 'Đặt phòng');
    assert.equal(unmarked.getAttribute('aria-label'), 'Lưu');
    assert.equal(unmarked.getAttribute('placeholder'), 'Hủy');
    assert.equal(unmarked.getAttribute('title'), 'Đặt phòng');
    assert.equal(unmarked.value, 'Hủy');
  }
}));

test('ignored and editable ancestors protect nested text and attributes even when descendants opt in', () => withDom(({ element }) => {
  const protectedElements = [];
  const wrappers = [{ 'data-i18n-ignore': '' }, { contenteditable: 'true' }, { contenteditable: '' }, { contenteditable: 'plaintext-only' }].map(attrs => {
    const child = element('span', { 'data-i18n-ui': '', 'data-i18n-attrs': 'title', title: 'Lưu' }, 'Hủy');
    protectedElements.push(child);
    return element('div', attrs, element('div', {}, child));
  });
  const noneditable = element('span', { contenteditable: 'false', 'data-i18n-ui': '' }, 'Lưu');
  const root = element('main', {}, ...wrappers, noneditable);
  localizeTree(root, 'en-US');
  for (const child of protectedElements) {
    assert.equal(child.textContent, 'Hủy');
    assert.equal(child.getAttribute('title'), 'Lưu');
    localizeText(child.childNodes[0], 'zh-CN');
    localizeAttributes(child, 'zh-CN');
    assert.equal(child.textContent, 'Hủy');
    assert.equal(child.getAttribute('title'), 'Lưu');
  }
  assert.equal(noneditable.textContent, 'Save');
}));

test('textarea and skipped tag ancestors retain manual data for full-tree and mutation callbacks', () => withDom(({ element }) => {
  const children = [];
  const wrappers = ['textarea', 'script', 'style', 'noscript'].map(tag => {
    const child = element('span', { 'data-i18n-ui': '', 'data-i18n-attrs': 'title', title: 'Lưu' }, 'Hủy');
    children.push(child);
    return element(tag, { 'data-i18n-ui': '', 'data-i18n-attrs': 'title', title: 'Đặt phòng', value: 'Lưu' }, 'Đặt phòng', child);
  });
  const root = element('main', {}, ...wrappers);
  for (const locale of ['en-US', 'zh-CN', 'vi']) {
    localizeTree(root, locale);
    for (const wrapper of wrappers) {
      assert.equal(wrapper.childNodes[0].nodeValue, 'Đặt phòng');
      assert.equal(wrapper.getAttribute('title'), 'Đặt phòng');
      assert.equal(wrapper.value, 'Lưu');
    }
    for (const child of children) {
      localizeTree(child, locale);
      localizeText(child.childNodes[0], locale);
      localizeAttributes(child, locale);
      assert.equal(child.textContent, 'Hủy');
      assert.equal(child.getAttribute('title'), 'Lưu');
    }
  }
}));

test('UI text and attributes use freshly rendered source values after external mutations', () => withDom(({ element }) => {
  const label = element('button', { 'data-i18n-ui': '', 'data-i18n-attrs': 'title', title: 'Lưu' }, 'Lưu');
  localizeTree(label, 'en-US');
  assert.equal(label.textContent, 'Save');
  assert.equal(label.getAttribute('title'), 'Save');
  label.childNodes[0].nodeValue = 'Hủy';
  label.setAttribute('title', 'Hủy');
  localizeText(label.childNodes[0], 'en-US');
  localizeAttributes(label, 'en-US');
  assert.equal(label.textContent, 'Cancel');
  assert.equal(label.getAttribute('title'), 'Cancel');
  localizeTree(label, 'zh-CN');
  assert.equal(label.textContent, '取消');
  assert.equal(label.getAttribute('title'), '取消');
  localizeTree(label, 'vi');
  assert.equal(label.textContent, 'Hủy');
  assert.equal(label.getAttribute('title'), 'Hủy');
}));

test('inserted and reparented nodes follow the current direct-parent opt-in boundary', () => withDom(({ element, text }) => {
  const label = element('button', { 'data-i18n-ui': '' });
  const business = element('span', {}, 'Lưu');
  const root = element('main', {}, label, business);
  const inserted = text('Hủy');
  label.appendChild(inserted);
  localizeTree(inserted, 'en-US');
  assert.equal(inserted.nodeValue, 'Cancel');
  business.appendChild(inserted);
  inserted.nodeValue = 'Lưu';
  localizeTree(inserted, 'en-US');
  assert.equal(inserted.nodeValue, 'Lưu');
  const newBusinessChild = element('strong', {}, 'Hủy');
  label.appendChild(newBusinessChild);
  localizeTree(newBusinessChild, 'en-US');
  assert.equal(newBusinessChild.textContent, 'Hủy');
  localizeTree(root, 'zh-CN');
  assert.equal(business.textContent, 'LưuLưu');
  assert.equal(newBusinessChild.textContent, 'Hủy');
}));
