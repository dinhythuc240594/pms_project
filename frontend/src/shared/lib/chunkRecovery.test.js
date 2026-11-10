import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptChunkReload, isChunkLoadError, isRouteChunkLoadError, registerChunkReloadGuard, RouteChunkLoadError, wrapRouteImport } from './chunkRecovery.js';

const failedImport = () => new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/Reports-old.js');
const chunkError = () => new RouteChunkLoadError(failedImport());

function browserFixture() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const location = { href: 'https://example.test/id/reports/revenue?period=month#totals', reloads: 0, reload() { this.reloads += 1; } };
  return { storage, location, online: true, values };
}

test('recognizes browser and Vite chunk transport failures without treating application errors as chunk failures', () => {
  for (const error of [
    failedImport(),
    new TypeError('error loading dynamically imported module: https://example.test/assets/route.js'),
    new TypeError('Importing a module script failed.'),
    Object.assign(new Error('Loading chunk 7 failed. (missing: route.js)'), { name: 'ChunkLoadError' }),
    new Error('Loading CSS chunk 3 failed.'),
    new Error('Unable to preload CSS for /assets/Reports-old.css'),
  ]) assert.equal(isChunkLoadError(error), true, error.message);
  for (const error of [new Error('Failed to fetch'), new Error('Cannot read properties of null'), new SyntaxError('Unexpected token'), 'Failed to fetch dynamically imported module', null]) {
    assert.equal(isChunkLoadError(error), false);
  }
});

test('lazy imports return modules unchanged, wrap chunk failures, and preserve ordinary rejection identity', async () => {
  const module = { default() {} };
  assert.equal(await wrapRouteImport(() => Promise.resolve(module))(), module);
  const failure = failedImport();
  await assert.rejects(wrapRouteImport(() => Promise.reject(failure)), error => isRouteChunkLoadError(error) && error.cause === failure);
  const runtimeError = new Error('Bad module initialization');
  await assert.rejects(wrapRouteImport(() => { throw runtimeError; }), error => error === runtimeError);
});

test('recovery reloads the same deep link at most once per URL and session, including across deployments', () => {
  const browser = browserFixture();
  const originalUrl = browser.location.href;
  assert.equal(attemptChunkReload(chunkError(), browser), true);
  assert.equal(browser.location.reloads, 1);
  assert.equal(browser.location.href, originalUrl);
  // A fresh error and location object model a new document or another build.
  const nextDocument = { ...browser, location: { ...browser.location, reloads: 0 } };
  assert.equal(attemptChunkReload(chunkError(), nextDocument), false);
  assert.equal(nextDocument.location.reloads, 0);
  browser.location.href = 'https://example.test/manager/users?search=admin#active';
  assert.equal(attemptChunkReload(chunkError(), browser), true);
  assert.equal(browser.location.reloads, 2);
});

test('storage denial, failure to persist, or reload failure never creates an automatic reload loop', () => {
  for (const storage of [
    { getItem() { throw new Error('Denied'); } },
    { getItem: () => null, setItem() { throw new Error('Full'); } },
    { getItem: () => null, setItem() {} },
  ]) {
    const browser = { ...browserFixture(), storage };
    assert.equal(attemptChunkReload(chunkError(), browser), false);
    assert.equal(browser.location.reloads, 0);
  }
  const browser = browserFixture();
  browser.location.reload = () => { throw new Error('Unavailable'); };
  assert.equal(attemptChunkReload(chunkError(), browser), false);
  assert.equal(browser.values.size, 1);
});

test('offline transport errors and ordinary runtime exceptions do not automatically reload', () => {
  const browser = browserFixture();
  assert.equal(attemptChunkReload(chunkError(), { ...browser, online: false }), false);
  assert.equal(browser.values.size, 0);
  assert.equal(attemptChunkReload(new Error('Render failed'), browser), false);
  assert.equal(browser.location.reloads, 0);
  assert.equal(attemptChunkReload(chunkError(), browser), true);
});

test('dirty or pending drafts are captured before a failed lazy tree unmounts', async () => {
  let dirty = true;
  let pending = false;
  const unregister = registerChunkReloadGuard(() => dirty || pending);
  let failure;
  try {
    await assert.rejects(wrapRouteImport(() => Promise.reject(failedImport())), error => {
      failure = error;
      return error.reloadBlocked === true;
    });
    dirty = false;
    pending = true;
    assert.equal(chunkError().reloadBlocked, true);
  } finally { unregister(); }
  // React may now have unregistered the failed form, but its snapshot survives.
  const browser = browserFixture();
  assert.equal(attemptChunkReload(failure, browser), false);
  assert.equal(browser.location.reloads, 0);
  assert.equal(attemptChunkReload(chunkError(), browser), true);
});

test('live guards recheck writes started after rejection, and a failed guard blocks automatic reload', () => {
  const failure = chunkError();
  const browser = browserFixture();
  let blocked = true;
  const unregister = registerChunkReloadGuard(() => blocked);
  try {
    assert.equal(attemptChunkReload(failure, browser), false);
    blocked = false;
    assert.equal(attemptChunkReload(failure, browser), true);
  } finally { unregister(); }
  const unregisterBroken = registerChunkReloadGuard(() => { throw new Error('Unavailable guard'); });
  try { assert.equal(chunkError().reloadBlocked, true); }
  finally { unregisterBroken(); }
});
