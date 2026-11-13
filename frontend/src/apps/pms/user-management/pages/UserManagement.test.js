import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

test('hotel owners can grant an existing system account a scoped role without its password', async () => {
  await withDraftDom(async ({ React, act, load, mount, click, input, window }) => {
    const previousFetch = globalThis.fetch;
    const session = { csrfToken: 'csrf', user: { id: 'owner', globalRole: 'USER', memberships: [{ tenantId: 'hotel-a', role: 'HOTEL_OWNER', active: true }] }, tenants: [{ id: 'hotel-a', status: 'active' }] };
    const grants = [];
    globalThis.fetch = async (url, options) => {
      if (url === '/api/auth/session') return Response.json(session);
      if (url === '/api/tenants/hotel-a/workspace') return Response.json({ tenant: session.tenants[0] });
      if (url === '/api/tenants/hotel-a/users' && options.method === 'POST') {
        grants.push(JSON.parse(options.body));
        return Response.json({ id: 'existing-account' });
      }
      throw new Error('Unexpected request: ' + url);
    };
    try {
      const { PmsProvider } = await load('/src/apps/pms/data/PmsProvider.jsx');
      const { usePms } = await load('/src/apps/pms/data/usePms.js');
      const { default: UserManagement } = await load('/src/apps/pms/user-management/pages/UserManagement.jsx');
      const { DraftGuardProvider } = await load('/src/shared/drafts/DraftGuardProvider.jsx');
      function Page() {
        const pms = usePms();
        return pms.loading || pms.workspaceLoading ? null : React.createElement(UserManagement);
      }
      const view = await mount(React.createElement(DraftGuardProvider, null, React.createElement(PmsProvider, null, React.createElement(Page))));
      for (const email of ['admin@example.test', 'manager@example.test']) {
        await click([...view.container.querySelectorAll('button')].find(button => button.textContent.includes('Thêm mới tài khoản')));
        const dialog = view.container.querySelector('dialog');
        await click(dialog.querySelector('input[type="checkbox"]'));
        assert.equal(dialog.querySelector('#user-password'), null);
        assert.equal(dialog.querySelector('#user-name'), null);
        await input(dialog.querySelector('#user-email'), email);
        await input(dialog.querySelector('select'), 'HOUSEKEEPING');
        await act(async () => { dialog.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
        assert.deepEqual(grants.at(-1), { email, role: 'HOUSEKEEPING', active: true });
        assert.equal(view.container.querySelector('dialog'), null);
      }
      assert.equal(grants.length, 2);
    } finally { globalThis.fetch = previousFetch; }
  });
});
