import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftGuardManager } from './guardManager.js';

test('clean navigation is immediate and cancel keeps dirty contents intact', () => {
  const manager = createDraftGuardManager();
  let dirty = false;
  let left = 0;
  let discarded = 0;
  let cancelled = 0;
  manager.register('booking', () => ({ dirty, onDiscard: () => { discarded += 1; } }));
  assert.equal(manager.requestLeave(() => { left += 1; }), true);
  dirty = true;
  assert.equal(manager.requestLeave(() => { left += 1; }, { onCancel: () => { cancelled += 1; } }), false);
  assert.ok(manager.getSnapshot().confirmation);
  manager.cancel();
  assert.equal(left, 1);
  assert.equal(discarded, 0);
  assert.equal(cancelled, 1);
  assert.equal(manager.hasBlockers(), true);
});

test('form close discards its own group and global navigation protects other forms', () => {
  const manager = createDraftGuardManager();
  const discarded = [];
  manager.register('first', () => ({ dirty: true, group: 'first', onDiscard: () => discarded.push('first') }));
  manager.register('second', () => ({ dirty: true, group: 'second', onDiscard: () => discarded.push('second') }));
  let left = 0;
  manager.requestLeave(() => { left += 1; }, { group: 'first' });
  assert.equal(manager.discard(), true);
  assert.deepEqual(discarded, ['first']);
  assert.equal(left, 1);
  assert.equal(manager.requestLeave(() => { left += 1; }, { group: 'unrelated' }), true);
  assert.equal(manager.requestLeave(() => { left += 1; }), false);
});

test('pending writes in any group disable discard and cannot be bypassed before rerender', () => {
  const manager = createDraftGuardManager();
  let pending = false;
  let left = false;
  let discarded = false;
  manager.register('booking', () => ({ dirty: true, group: 'booking', onDiscard: () => { discarded = true; } }));
  manager.register('other-write', () => ({ pending: () => pending, group: 'other' }));
  manager.requestLeave(() => { left = true; }, { group: 'booking' });
  pending = true;
  assert.equal(manager.discard(), false);
  assert.equal(manager.getSnapshot().confirmation.pending, true);
  assert.equal(left, false);
  assert.equal(discarded, false);
  pending = false;
  manager.refresh();
  assert.equal(manager.getSnapshot().confirmation.pending, false);
  assert.equal(manager.discard(), true);
  assert.equal(discarded, true);
  assert.equal(left, true);
});

test('failed writes keep the draft guarded while successful save releases requested navigation', () => {
  const manager = createDraftGuardManager();
  let pending = true;
  let dirty = true;
  let left = 0;
  manager.register('booking', () => ({ dirty: () => dirty, pending: () => pending }));
  manager.requestLeave(() => { left += 1; });
  pending = false;
  manager.refresh();
  assert.equal(left, 0);
  assert.equal(manager.hasBlockers(), true);
  assert.ok(manager.getSnapshot().confirmation);
  dirty = false;
  manager.refresh();
  assert.equal(left, 1);
  assert.equal(manager.hasBlockers(), false);
  assert.equal(manager.getSnapshot().confirmation, null);
});

test('accepted discard bypasses route guard while React state is still dirty', () => {
  const manager = createDraftGuardManager();
  manager.register('booking', () => ({ dirty: true }));
  let blockedInsideAction;
  manager.requestLeave(() => { blockedInsideAction = manager.hasBlockers(); });
  manager.discard();
  assert.equal(blockedInsideAction, false);
  assert.equal(manager.hasBlockers(), true);
});

test('tenant clear cancels old navigation, removes stale form guards, and keeps persistent write guards', () => {
  const manager = createDraftGuardManager();
  let dirty = true;
  let pending = false;
  let left = false;
  let cancelled = false;
  manager.register('booking', () => ({ dirty: () => dirty, pending: true, onDiscard: () => { dirty = false; } }));
  manager.register('provider', () => ({ persistent: true, pending: () => pending }));
  manager.requestLeave(() => { left = true; }, { onCancel: () => { cancelled = true; } });
  manager.clearDrafts();
  assert.equal(left, false);
  assert.equal(cancelled, true);
  assert.equal(dirty, false);
  assert.equal(manager.getSnapshot().confirmation, null);
  assert.equal(manager.hasBlockers(), false, 'an expired form write cannot block the next session');
  pending = true;
  assert.equal(manager.hasBlockers(), true);
});

test('unregister removes stale forms and published snapshots remain stable until changed', () => {
  const manager = createDraftGuardManager();
  const unregister = manager.register('booking', () => ({ dirty: true }));
  let notifications = 0;
  manager.subscribe(() => { notifications += 1; });
  manager.requestLeave(() => {});
  const snapshot = manager.getSnapshot();
  manager.refresh();
  assert.equal(manager.getSnapshot(), snapshot);
  assert.equal(notifications, 1);
  manager.cancel();
  unregister();
  assert.equal(manager.hasBlockers(), false);
});

test('successive router attempts share one prompt and accept only the current transition', () => {
  const manager = createDraftGuardManager();
  manager.register('booking', () => ({ dirty: true }));
  const owner = Symbol('router');
  const events = [];
  manager.requestLeave(() => events.push('old-route'), { owner, onCancel: () => events.push('reset-old-route') });
  const firstPrompt = manager.getSnapshot().confirmation;
  manager.requestLeave(() => events.push('new-route'), { owner, onCancel: () => events.push('reset-new-route') });
  assert.equal(manager.getSnapshot().confirmation.id, firstPrompt.id);
  assert.deepEqual(events, []);
  manager.discard();
  assert.deepEqual(events, ['new-route']);
});

test('cancel after a repeated router attempt resets the current transition', () => {
  const manager = createDraftGuardManager();
  manager.register('booking', () => ({ dirty: true }));
  const owner = Symbol('router');
  const events = [];
  manager.requestLeave(() => events.push('old-route'), { owner, onCancel: () => events.push('reset-old-route') });
  manager.requestLeave(() => events.push('new-route'), { owner, onCancel: () => events.push('reset-new-route') });
  manager.cancel();
  assert.deepEqual(events, ['reset-new-route']);
});
