import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import React, { act } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const modules = {
  marketing: 'apps/marketing/layouts/MarketingLayout.jsx',
  home: 'apps/marketing/Home.jsx',
  auth: 'apps/pms/auth/layouts/AuthLayout.jsx',
  login: 'apps/pms/auth/pages/Login.jsx',
  pms: 'apps/pms/layouts/PmsLayout.jsx',
  dashboard: 'apps/pms/dashboard/pages/Dashboard.jsx',
  manager: 'apps/manager/layouts/ManagerLayout.jsx',
  managerDashboard: 'apps/manager/dashboard/pages/AdminDashboard.jsx',
  managerOta: 'apps/manager/tenants/pages/ManagerOTA.jsx',
  managerUsers: 'apps/manager/users/pages/AdminUsers.jsx',
  reports: 'apps/pms/reports/pages/Reports.jsx',
  reconciliation: 'apps/pms/reconciliation/DayReconciliation.jsx',
  inventoryIn: 'apps/pms/inventory/pages/InventoryIn.jsx',
};

// Keep the production route graph, guards, context, and Suspense boundaries.
// Only the expensive page/layout views become small probes, so these tests can
// observe exactly when a route import starts without relying on business APIs.
function routeViewProbes() {
  return {
    name: 'route-view-probes',
    enforce: 'pre',
    transform(_source, id) {
      const name = id.split('/src/')[1];
      if (!name || !name.endsWith('.jsx')) return;
      const layout = /apps\/.+\/layouts\/[^/]+\.jsx$/.test(name);
      const page = /^apps\/.+\/pages\/[^/]+\.jsx$/.test(name)
        || /^apps\/marketing\/[^/]+\.jsx$/.test(name)
        || name === modules.reconciliation;
      if (!layout && !page) return;
      return {
        code: `
          import React from 'react';
          import { Outlet, useLocation, useParams, useOutletContext } from 'react-router-dom';
          const name = ${JSON.stringify(name)};
          globalThis.__appRouteTest.requested.add(name);
          await globalThis.__appRouteTest.gates.get(name);
          export default function RouteViewProbe(props) {
            const location = useLocation();
            const params = useParams();
            const context = useOutletContext();
            return ${layout
              ? `React.createElement('div', { 'data-layout': name }, React.createElement(Outlet, ${name === modules.manager ? `{ context: { probe: 'manager-layout-context' } }` : 'null'}))`
              : `React.createElement('output', { 'data-page': name }, JSON.stringify({ path: location.pathname, search: location.search, params, props, context }))`};
          }
        `,
        map: null,
      };
    },
  };
}

async function withApp({ role = 'HOTEL_OWNER', memberships, features = {}, gates = new Map() } = {}, callback) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const replacements = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    __appRouteTest: { requested: new Set(), gates },
  };
  const previous = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const tenant = { id: 'hotel-a', name: 'Hotel A', status: 'ACTIVE' };
  const system = ['SUPER_ADMIN', 'SYSTEM_MANAGER'].includes(role);
  const user = role ? { id: 'user-a', globalRole: system ? role : 'USER', memberships: memberships || (system ? [] : [{ tenantId: tenant.id, role }]) } : null;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url === '/api/auth/session') return user
      ? Response.json({ csrfToken: 'test-csrf', user, tenants: [tenant] })
      : Response.json({ error: { message: 'Please sign in' } }, { status: 401 });
    if (url === '/api/tenants/hotel-a/workspace') return Response.json({ tenant, features });
    if (url === '/api/tenants') return Response.json({ tenants: [tenant] });
    if (url === '/api/audit') return Response.json({ logs: [] });
    throw new Error('Unexpected route test request: ' + url);
  };
  let server;
  let root;
  let router;
  try {
    server = await createServer({
      root: fileURLToPath(new URL('../../', import.meta.url)),
      configFile: false,
      plugins: [routeViewProbes()],
      optimizeDeps: { noDiscovery: true },
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    const { appRoutes } = await server.ssrLoadModule('/src/app/App.jsx');
    assert.ok(Array.isArray(appRoutes), 'App exports its production routes for integration checks');
    const { PmsProvider } = await server.ssrLoadModule('/src/apps/pms/data/PmsProvider.jsx');
    const { DraftGuardProvider } = await server.ssrLoadModule('/src/shared/drafts/DraftGuardProvider.jsx');
    const { createRoot } = await import('react-dom/client');
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const requested = globalThis.__appRouteTest.requested;
    async function until(predicate, message) {
      const deadline = Date.now() + 5000;
      while (!predicate() && Date.now() < deadline) await act(async () => { await delay(10); });
      assert.ok(predicate(), message);
    }
    async function open(path) {
      if (!router) {
        router = createMemoryRouter(appRoutes, { initialEntries: [path] });
        await act(async () => root.render(React.createElement(DraftGuardProvider, null,
          React.createElement(PmsProvider, null, React.createElement(RouterProvider, { router })))));
      } else await act(async () => { await router.navigate(path); });
    }
    async function page(name) {
      await until(() => host.querySelector(`[data-page="${name}"]`), `Route renders ${name}: ${host.textContent}`);
      return JSON.parse(host.querySelector(`[data-page="${name}"]`).textContent);
    }
    async function denied() {
      await until(() => host.querySelector('[role="alert"]')?.textContent.includes('403')
        && (!router.state.location.pathname.startsWith('/id/') || host.querySelector(`[data-layout="${modules.pms}"]`))
        && !host.querySelector('.loha-loading'), `Route renders a permission error: ${host.textContent}`);
    }
    await callback({ open, page, denied, until, host, requested, get router() { return router; } });
  } finally {
    if (root) await act(async () => root.unmount());
    router?.dispose();
    await server?.close();
    globalThis.fetch = previousFetch;
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

const protectedModules = requested => [...requested].filter(name =>
  name.startsWith('apps/manager/') || name.includes('/inventory/') || name.includes('/reports/'));

test('marketing and login render on demand without importing Manager, inventory, or reports', async () => {
  await withApp({ role: null }, async ({ open, page, requested }) => {
    assert.equal(requested.size, 0, 'creating the route graph imports no route view');
    await open('/');
    await page(modules.home);
    assert.deepEqual([...requested].sort(), [modules.marketing, modules.home].sort());
    await open('/id/login?next=%2Fid%2Freports');
    const login = await page(modules.login);
    assert.equal(new URLSearchParams(login.search).get('next'), '/id/reports');
    for (const path of ['pricing', 'blog', 'contact']) {
      await open('/' + path);
      await page(`apps/marketing/${path[0].toUpperCase() + path.slice(1)}.jsx`);
    }
    assert.deepEqual(protectedModules(requested), []);
    assert.equal(requested.has(modules.pms), false);
  });
});

test('anonymous protected deep links retain their destination and never import protected views', async () => {
  await withApp({ role: null }, async fixture => {
    for (const path of ['/id/reports/revenue?currency=USD', '/manager/tenants/hotel-a/ota-history?channel=airbnb']) {
      await fixture.open(path);
      await fixture.page(modules.login);
      assert.equal(fixture.router.state.location.pathname, '/id/login');
      assert.equal(new URLSearchParams(fixture.router.state.location.search).get('next'), path);
    }
    assert.deepEqual([...fixture.requested].sort(), [modules.auth, modules.login].sort());
  });
});

test('role guards block Manager, reports, and inventory before importing their views', async () => {
  await withApp({ role: 'FRONT_DESK' }, async ({ open, denied, requested }) => {
    for (const path of ['/manager/dashboard', '/id/reports/source', '/id/inventory/stock']) {
      await open(path);
      await denied();
    }
    assert.deepEqual(protectedModules(requested), []);
    assert.equal(requested.has(modules.pms), true);
  });
});

test('manager deep links preserve params, props, and layout context while enforcing super-admin routes', async () => {
  await withApp({ role: 'SYSTEM_MANAGER', memberships: [{ tenantId: 'hotel-a', role: 'FRONT_DESK' }] }, async fixture => {
    await fixture.open('/manager/tenants/hotel-a/ota-history?channel=airbnb');
    const ota = await fixture.page(modules.managerOta);
    assert.deepEqual(ota.params, { tenantId: 'hotel-a' });
    assert.equal(ota.props.history, true);
    assert.equal(ota.search, '?channel=airbnb');
    assert.deepEqual(ota.context, { probe: 'manager-layout-context' });
    await fixture.open('/manager/users');
    await fixture.denied();
    assert.equal(fixture.requested.has(modules.managerUsers), false);
    await fixture.open('/manager');
    await fixture.page(modules.managerDashboard);
    assert.equal(fixture.router.state.location.pathname, '/manager/dashboard');
    assert.equal(fixture.requested.has(modules.pms), false);
  });
});

test('system users can configure OTA without membership while PMS stays protected', async () => {
  for (const role of ['SUPER_ADMIN', 'SYSTEM_MANAGER']) {
    await withApp({ role }, async fixture => {
      for (const path of ['/id/reports/revenue', '/id/reservations']) {
        await fixture.open(path);
        await fixture.denied();
      }
      assert.equal(fixture.requested.has(modules.reports), false);
      for (const path of ['/manager/tenants/hotel-a/ota-history', '/manager/tenants/hotel-b/ota']) {
        await fixture.open(path);
        await fixture.page(modules.managerOta);
      }
      assert.equal(fixture.requested.has('apps/pms/reservations/pages/Reservations.jsx'), false);
      await fixture.open('/manager/dashboard');
      await fixture.page(modules.managerDashboard);
    });
  }
});

test('PMS deep links, aliases, redirects, and not-found routes retain their original behavior', async () => {
  await withApp({}, async fixture => {
    for (const report of ['', '/revenue', '/occupancy', '/source', '/room', '/roomType', '/cancellations', '/nationality', '/discounts']) {
      const path = '/id/reports' + report;
      await fixture.open(path + '?currency=USD');
      assert.equal((await fixture.page(modules.reports)).path, path);
    }
    await fixture.open('/id/reports/reconciliation');
    await fixture.page(modules.reconciliation);
    await fixture.open('/id/inventory');
    await fixture.page(modules.inventoryIn);
    assert.equal(fixture.router.state.location.pathname, '/id/inventory/in');
    for (const [path, name] of [
      ['/id/inventory/out', 'InventoryOut'],
      ['/id/inventory/transfer', 'InventoryTransfer'],
      ['/id/inventory/check', 'InventoryCheck'],
      ['/id/inventory/stock', 'InventoryStock'],
    ]) {
      await fixture.open(path);
      await fixture.page(`apps/pms/inventory/pages/${name}.jsx`);
    }
    await fixture.open('/id/ota-history?accountId=account-a&propertyId=property-a');
    const settings = await fixture.page('apps/pms/settings/pages/Settings.jsx');
    assert.equal(settings.path, '/id/settings');
    assert.equal(new URLSearchParams(settings.search).get('section'), 'channels');
    assert.equal(new URLSearchParams(settings.search).get('tab'), 'history');
    await fixture.open('/id');
    await fixture.page(modules.dashboard);
    assert.equal(fixture.router.state.location.pathname, '/id/dashboard');
    await fixture.open('/id/does-not-exist');
    await fixture.until(() => fixture.host.querySelector('[role="alert"]')?.textContent.includes('404'), 'Unknown PMS deep link displays 404');
    assert.equal(fixture.router.state.location.pathname, '/id/does-not-exist');
    assert.equal(fixture.requested.has(modules.manager), false);
  });
});

test('feature guards keep disabled inventory and advanced report modules unloaded', async () => {
  await withApp({ features: { INVENTORY_WAREHOUSE: false, REPORTS_ADVANCED: false } }, async ({ open, denied, page, requested }) => {
    for (const path of ['/id/inventory/in', '/id/reports/source']) {
      await open(path);
      await denied();
    }
    assert.deepEqual(protectedModules(requested), []);
    await open('/id/reports/revenue');
    await page(modules.reports);
  });
});

test('layout loading uses the full-page fallback, then page loading keeps the shell mounted', async () => {
  const layout = Promise.withResolvers();
  const report = Promise.withResolvers();
  const gates = new Map([[modules.pms, layout.promise], [modules.reports, report.promise]]);
  await withApp({ gates }, async ({ open, page, until, host, requested }) => {
    await open('/id/reports/revenue?currency=USD');
    await until(() => requested.has(modules.pms) && host.querySelector('.loha-loading-full'), 'Layout import shows a full-page loading status');
    assert.equal(requested.has(modules.reports), false, 'Page waits for its parent layout');
    await act(async () => layout.resolve());
    await until(() => requested.has(modules.reports) && host.querySelector(`[data-layout="${modules.pms}"] .loha-loading`), 'Page import shows a loading status inside the PMS shell');
    assert.equal(host.querySelector('.loha-loading-full'), null);
    assert.equal(host.querySelector('.loha-loading').getAttribute('role'), 'status');
    await act(async () => report.resolve());
    const loaded = await page(modules.reports);
    assert.equal(loaded.search, '?currency=USD');
    assert.equal(host.querySelector('.loha-loading'), null);
  });
});
