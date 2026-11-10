import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React, { act, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let server;
let dom;
let createRoot;
let drafts;
const originalGlobals = new Map();

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/booking' });
  // Use this DOM's event constructors locally; replacing Node's global Event
  // would break native EventTargets in other files sharing the test process.
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement']) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  originalGlobals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom does not implement native modal dialog lifecycle/focus yet.
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  ({ createRoot } = await import('react-dom/client'));
  server = await createServer({
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  drafts = await server.ssrLoadModule('/src/shared/drafts/DraftGuardProvider.jsx');
});

after(async () => {
  await server?.close();
  dom?.window.close();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

async function mountForm({ initialEntries = ['/booking'], dirty = true } = {}) {
  const controls = { pending: false, discarded: 0, closed: 0 };
  function Form() {
    const [isDirty, setDirty] = useState(dirty);
    const [, forceRender] = useState(0);
    controls.setDirty = setDirty;
    controls.render = () => forceRender(value => value + 1);
    controls.navigation = drafts.useDraftNavigation();
    const { requestLeave } = drafts.useDraftGuard({
      dirty: isDirty,
      pending: () => controls.pending,
      onDiscard: () => { controls.discarded += 1; setDirty(false); },
    });
    controls.close = () => requestLeave(() => { controls.closed += 1; });
    return React.createElement('input', { 'aria-label': 'Nội dung', defaultValue: 'Bản nháp chưa lưu' });
  }
  const router = createMemoryRouter([{
    path: '*',
    element: React.createElement(React.Fragment, null, React.createElement(drafts.DraftRouteGuard), React.createElement(Form)),
  }], { initialEntries });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(drafts.DraftGuardProvider, null, React.createElement(RouterProvider, { router }))));
  return {
    controls,
    router,
    host,
    async dispose() {
      await act(async () => root.unmount());
      router.dispose();
      host.remove();
    },
  };
}

const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
const click = async label => act(async () => button(label).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));

test('route changes in path, search, and hash keep the draft until discard is accepted', async () => {
  const fixture = await mountForm();
  try {
    for (const destination of ['/another', '/booking?tab=other', '/booking#details']) {
      await act(async () => fixture.router.navigate(destination));
      assert.equal(fixture.router.state.location.pathname, '/booking');
      assert.equal(fixture.router.state.location.search, '');
      assert.equal(fixture.router.state.location.hash, '');
      assert.equal(document.querySelectorAll('dialog').length, 1);
      await click('Tiếp tục sửa');
      assert.equal(document.querySelector('dialog'), null);
      assert.equal(fixture.host.querySelector('input').value, 'Bản nháp chưa lưu');
    }
    await act(async () => fixture.router.navigate('/another?accepted=1#details'));
    await click('Bỏ bản nháp');
    assert.equal(fixture.router.state.location.pathname, '/another');
    assert.equal(fixture.router.state.location.search, '?accepted=1');
    assert.equal(fixture.router.state.location.hash, '#details');
    assert.equal(fixture.controls.discarded, 1);
    assert.equal(document.querySelector('dialog'), null);
  } finally { await fixture.dispose(); }
});

test('history back and forward each honor draft cancellation and accepted discard', async () => {
  const fixture = await mountForm({ initialEntries: ['/previous', '/booking'] });
  try {
    await act(async () => fixture.router.navigate(-1));
    assert.equal(fixture.router.state.location.pathname, '/booking');
    await click('Tiếp tục sửa');
    await act(async () => fixture.router.navigate(-1));
    await click('Bỏ bản nháp');
    assert.equal(fixture.router.state.location.pathname, '/previous');
    await act(async () => fixture.controls.setDirty(true));
    await act(async () => fixture.router.navigate(1));
    assert.equal(fixture.router.state.location.pathname, '/previous');
    await click('Bỏ bản nháp');
    assert.equal(fixture.router.state.location.pathname, '/booking');
  } finally { await fixture.dispose(); }
});

test('successive blocked route attempts use one dialog and discard follows the latest route', async () => {
  const fixture = await mountForm();
  try {
    await act(async () => fixture.router.navigate('/first'));
    await act(async () => fixture.router.navigate('/second'));
    assert.equal(document.querySelectorAll('dialog').length, 1);
    await click('Bỏ bản nháp');
    assert.equal(fixture.router.state.location.pathname, '/second');
  } finally { await fixture.dispose(); }
});

test('Escape cancels only the confirmation and does not reach underlying overlay listeners', async () => {
  const fixture = await mountForm();
  let underlyingEscapes = 0;
  const underlying = event => { if (event.key === 'Escape') underlyingEscapes += 1; };
  document.addEventListener('keydown', underlying);
  try {
    await act(async () => fixture.controls.close());
    await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(document.querySelector('dialog'), null);
    assert.equal(fixture.controls.closed, 0);
    assert.equal(fixture.controls.discarded, 0);
    assert.equal(underlyingEscapes, 0);
  } finally {
    document.removeEventListener('keydown', underlying);
    await fixture.dispose();
  }
});

test('live pending writes block leave and unload; success removes the guard', async () => {
  const fixture = await mountForm();
  try {
    fixture.controls.pending = true;
    await act(async () => fixture.controls.close());
    assert.equal(button('Bỏ bản nháp').disabled, true);
    assert.match(document.querySelector('dialog').textContent, /Đang lưu thay đổi/);
    const unload = new dom.window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    assert.equal(unload.defaultPrevented, true);
    await act(async () => {
      fixture.controls.pending = false;
      fixture.controls.render();
    });
    assert.equal(button('Bỏ bản nháp').disabled, false);
    assert.equal(fixture.controls.closed, 0);
    await act(async () => fixture.controls.setDirty(false));
    assert.equal(fixture.controls.closed, 1);
    assert.equal(document.querySelector('dialog'), null);
    const cleanUnload = new dom.window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    assert.equal(cleanUnload.defaultPrevented, false);
  } finally { await fixture.dispose(); }
});
