import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRouter } from 'react-router-dom';
import { withDraftDom } from '../../../../shared/drafts/testDom.js';

test('business reports reject invalid date drafts without querying the previous range', async () => {
  await withDraftDom(async ({ React, load, mount, input }) => {
    const { default: Page } = await load('/src/apps/pms/reports/pages/BusinessReports.jsx');
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js');
    const reads = [];
    const value = {
      tenantId: 'hotel-a', settings: { currency: 'VND', timezone: 'UTC' }, routeAccess: () => ({ allowed: true }),
      getBusinessReport: async (...args) => { reads.push(args); return { rows: [], currency: 'VND', basis: 'base', definitions: {} }; },
    };
    const { container } = await mount(React.createElement(MemoryRouter, null, React.createElement(PmsContext.Provider, { value }, React.createElement(Page, { report: 'source' }))));
    const start = container.querySelector('#business-report-start'), end = container.querySelector('#business-report-end');
    assert.match(start.value, /^\d{2}\/\d{2}\/\d{4}$/);
    const count = reads.length;
    await input(start, '31/02/2026');
    assert.equal(start.checkValidity(), false);
    assert.equal(reads.length, count);
    await input(end, '02/02/2028');
    assert.equal(reads.length, count);
    await input(start, '01/02/2028');
    assert.deepEqual(reads.at(-1).slice(1, 3), ['2028-02-01', '2028-02-02']);
  });
});
