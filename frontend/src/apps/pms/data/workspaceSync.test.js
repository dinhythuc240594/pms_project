import test from 'node:test';
import assert from 'node:assert/strict';
import { watchWorkspace } from './workspaceSync.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function surface() {
  const win = new EventTarget(), doc = new EventTarget(), timers = new Set();
  win.setInterval = fn => { timers.add(fn); return fn; };
  win.clearInterval = fn => timers.delete(fn);
  doc.visibilityState = 'visible'; doc.activeElement = null; doc.querySelector = () => null;
  return { win, doc, tick: () => { for (const fn of timers) fn(); }, timers };
}

test('workspace never schedules requests or refreshes on focus and visibility changes', async () => {
  const environment = surface(); let calls = 0;
  const control = watchWorkspace(async () => { calls++; }, environment);
  environment.tick();
  environment.win.dispatchEvent(new Event('focus'));
  environment.doc.dispatchEvent(new Event('visibilitychange'));
  await flush();
  assert.equal(environment.timers.size, 0);
  assert.equal(calls, 0);
  assert.equal(await control.refresh(), true);
  assert.equal(calls, 1);
  control.stop();
  assert.equal(await control.refresh(), false);
  assert.equal(calls, 1);
});

test('manual workspace refresh pauses hidden, modal, editing and in-flight writes', async () => {
  const environment = surface(); let blocked = false, calls = 0;
  const control = watchWorkspace(async () => { calls++; }, { ...environment, isBlocked: () => blocked });
  await control.refresh(); assert.equal(calls, 1);
  environment.doc.visibilityState = 'hidden'; assert.equal(await control.refresh(), false);
  environment.doc.visibilityState = 'visible'; environment.doc.querySelector = () => ({}); assert.equal(await control.refresh(), false);
  environment.doc.querySelector = () => null; environment.doc.activeElement = { matches: () => true }; assert.equal(await control.refresh(), false);
  environment.doc.activeElement = null; blocked = true; assert.equal(await control.refresh(), false);
  assert.equal(calls, 1);
  blocked = false; await control.refresh(); assert.equal(calls, 2);
  control.stop();
});

test('manual workspace refresh prevents overlap and preserves connected drafts until saved or unmounted', async () => {
  const environment = surface(); let calls = 0, finish;
  const control = watchWorkspace(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, environment);
  const first = control.refresh(); assert.equal(await control.refresh(), false); assert.equal(calls, 1); finish(); await first;
  const target = { isConnected: true, closest: () => ({}) }, event = new Event('input');
  Object.defineProperty(event, 'target', { value: target }); environment.doc.dispatchEvent(event);
  assert.equal(await control.refresh(), false); assert.equal(calls, 1);
  target.isConnected = false; const second = control.refresh(); assert.equal(calls, 2); finish(); await second;
  target.isConnected = true; environment.doc.dispatchEvent(event); control.resetDrafts();
  const third = control.refresh(); assert.equal(calls, 3); finish(); await third; control.stop();
});

for (const blocker of ['dialog', 'draft', 'focused input', 'hidden page', 'write', 'stopped watcher']) {
  test('a deferred manual workspace read does not apply after ' + blocker, async () => {
    const environment = surface(); let blocked = false, finish, applied = 0;
    const control = watchWorkspace(async canApply => {
      await new Promise(resolve => { finish = resolve; });
      if (canApply()) applied++;
    }, { ...environment, isBlocked: () => blocked });
    const pending = control.refresh();
    assert.equal(typeof finish, 'function');
    if (blocker === 'dialog') environment.doc.querySelector = () => ({});
    if (blocker === 'draft') {
      const event = new Event('input');
      Object.defineProperty(event, 'target', { value: { isConnected: true, closest: () => ({}) } });
      environment.doc.dispatchEvent(event);
    }
    if (blocker === 'focused input') environment.doc.activeElement = { matches: () => true };
    if (blocker === 'hidden page') environment.doc.visibilityState = 'hidden';
    if (blocker === 'write') blocked = true;
    if (blocker === 'stopped watcher') control.stop();
    finish(); await pending;
    assert.equal(applied, 0);
    control.stop();
  });
}

test('a deferred manual workspace read applies while its watcher remains idle and visible', async () => {
  const environment = surface(); let finish, applied = 0;
  const control = watchWorkspace(async canApply => {
    await new Promise(resolve => { finish = resolve; });
    if (canApply()) applied++;
  }, environment);
  const pending = control.refresh(); finish(); await pending;
  assert.equal(applied, 1);
  control.stop();
});

test('failed manual workspace refresh can be retried without background retries', async () => {
  const environment = surface(); let calls = 0;
  const control = watchWorkspace(async () => { calls++; throw new Error('Offline'); }, environment);
  await control.refresh(); environment.tick(); await flush(); assert.equal(calls, 1);
  await control.refresh(); assert.equal(calls, 2);
  control.stop();
});
