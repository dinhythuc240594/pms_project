import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../drafts/testDom.js';

test('lazy route failure preserves the surrounding draft and Retry honors live pending writes', async context => {
  await withDraftDom(async ({ React, act, window, document, load, mount, click }) => {
    context.mock.method(console, 'error', () => {});
    const { MemoryRouter } = await import('react-router-dom');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { DraftGuardProvider, useDraftGuard } = await load('/src/shared/drafts/DraftGuardProvider.jsx');
    const { default: RouteErrorBoundary } = await load('/src/shared/components/RouteErrorBoundary.jsx');
    const { lazyRoute } = await load('/src/shared/lib/lazyRoute.js');
    const controls = { pending: false };
    let rejectImport;
    const LazyPage = lazyRoute(() => new Promise((resolve, reject) => { rejectImport = reject; }));
    function Shell() {
      useDraftGuard({ dirty: true, pending: () => controls.pending });
      return React.createElement(React.Fragment, null,
        React.createElement('input', { 'aria-label': 'Bản nháp', defaultValue: 'Chưa lưu' }),
        React.createElement(RouteErrorBoundary, { fullPage: false },
          React.createElement(React.Suspense, { fallback: React.createElement('p', null, 'Đang tải') }, React.createElement(LazyPage))));
    }
    window.history.replaceState({}, '', '/id/reports/revenue?period=month#totals');
    const fixture = await mount(React.createElement(DraftGuardProvider, null,
      React.createElement(PmsContext.Provider, { value: { user: null } },
        React.createElement(MemoryRouter, { initialEntries: ['/id/reports/revenue?period=month#totals'] }, React.createElement(Shell)))));
    assert.match(fixture.container.textContent, /Đang tải/);
    await act(async () => rejectImport(new TypeError('Failed to fetch dynamically imported module: /assets/Reports-old.js')));
    assert.ok(fixture.container.querySelector('[aria-label="Lỗi 503"]') || fixture.container.textContent.includes('503'));
    assert.equal(fixture.container.querySelector('.loha-error-page').tagName, 'SECTION');
    assert.equal(fixture.container.querySelector('input').value, 'Chưa lưu');
    assert.equal(window.sessionStorage.length, 0, 'dirty draft prevents automatic reload and its session marker');
    assert.equal(window.location.pathname + window.location.search + window.location.hash, '/id/reports/revenue?period=month#totals');

    controls.pending = true;
    await click(fixture.container.querySelector('.loha-error-actions button'));
    assert.match(document.querySelector('dialog').textContent, /Đang lưu thay đổi/);
    assert.equal([...document.querySelectorAll('dialog button')].find(button => button.textContent === 'Bỏ bản nháp').disabled, true);
    await click([...document.querySelectorAll('dialog button')].find(button => button.textContent === 'Tiếp tục sửa'));
    assert.equal(document.querySelector('dialog'), null);
    assert.equal(fixture.container.querySelector('input').value, 'Chưa lưu');
    assert.equal(window.sessionStorage.length, 0);
  });
});

test('ordinary render failures retain in-place retry without triggering chunk recovery', async context => {
  await withDraftDom(async ({ React, load, mount, click, window }) => {
    context.mock.method(console, 'error', () => {});
    const { MemoryRouter } = await import('react-router-dom');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const { default: RouteErrorBoundary } = await load('/src/shared/components/RouteErrorBoundary.jsx');
    let broken = true;
    function Page() {
      if (broken) throw new Error('Invalid rendered data');
      return React.createElement('p', null, 'Trang đã phục hồi');
    }
    const fixture = await mount(React.createElement(PmsContext.Provider, { value: { user: null } },
      React.createElement(MemoryRouter, null, React.createElement(RouteErrorBoundary, null, React.createElement(Page)))));
    assert.equal(fixture.container.querySelector('.loha-error-page').tagName, 'MAIN');
    assert.match(fixture.container.textContent, /500/);
    assert.equal(window.sessionStorage.length, 0);
    broken = false;
    await click(fixture.container.querySelector('.loha-error-actions button'));
    assert.equal(fixture.container.textContent, 'Trang đã phục hồi');
    assert.equal(window.sessionStorage.length, 0);
  });
});
