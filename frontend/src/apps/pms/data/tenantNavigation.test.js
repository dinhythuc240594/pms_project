import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestScope } from './api.js';
import { createDraftGuardManager } from '../../../shared/drafts/guardManager.js';
import { requestTenantSelection } from './tenantNavigation.js';

function workspace() {
  const manager = createDraftGuardManager();
  const scope = createRequestScope();
  scope.select('hotel-a');
  let dirty = true;
  let pending = false;
  let selected = 'hotel-a';
  let draft = { guestName: 'Khách đang sửa' };
  manager.register('booking', () => ({
    dirty,
    pending,
    onDiscard: () => { dirty = false; draft = null; },
  }));
  const select = id => requestTenantSelection({
    id, tenantId: selected, hotels: [{ id: 'hotel-a' }, { id: 'hotel-b' }], scope,
    requestLeave: manager.requestLeave, clearDrafts: manager.clearDrafts,
    apply: id => { assert.equal(draft, null); selected = id; },
    fail: error => { throw error; },
  });
  return { manager, scope, select, setPending: value => { pending = value; }, getSelected: () => selected, getDraft: () => draft };
}

test('tenant selection keeps scope and in-memory draft until the user discards', () => {
  const app = workspace();
  const originalScope = app.scope.current();
  assert.equal(app.select('hotel-b'), false);
  assert.equal(app.scope.isCurrent(originalScope), true);
  assert.equal(app.getSelected(), 'hotel-a');
  app.manager.cancel();
  assert.equal(app.getDraft().guestName, 'Khách đang sửa');
  assert.equal(app.getSelected(), 'hotel-a');

  app.select('hotel-b');
  assert.equal(app.manager.discard(), true);
  assert.equal(app.scope.isCurrent(originalScope), false);
  assert.equal(app.getSelected(), 'hotel-b');
  assert.equal(app.getDraft(), null);
});

test('a tenant confirmation from an expired scope cannot change the current tenant', () => {
  const app = workspace();
  app.select('hotel-b');
  app.scope.select(null);
  app.manager.discard();
  assert.equal(app.getSelected(), 'hotel-a');
  assert.equal(app.scope.current().tenantId, null);
});

test('pending writes prevent confirmed tenant changes until they settle', () => {
  const app = workspace();
  app.setPending(true);
  app.select('hotel-b');
  assert.equal(app.manager.discard(), false);
  assert.equal(app.scope.current().tenantId, 'hotel-a');
  assert.ok(app.getDraft());
  app.setPending(false);
  assert.equal(app.manager.discard(), true);
  assert.equal(app.scope.current().tenantId, 'hotel-b');
  assert.equal(app.getDraft(), null);
});

test('same-tenant and unauthorized selections do not discard data or change scope', () => {
  const app = workspace();
  const originalScope = app.scope.current();
  assert.equal(app.select('hotel-a'), false);
  assert.throws(() => app.select('hotel-c'), /không có quyền/);
  assert.equal(app.scope.isCurrent(originalScope), true);
  assert.ok(app.getDraft());
  assert.equal(app.manager.getSnapshot().confirmation, null);
});
