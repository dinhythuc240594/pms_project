import test from 'node:test';
import assert from 'node:assert/strict';
import { withDraftDom } from '../drafts/testDom.js';

test('date fields retain invalid drafts, block submission, and emit only valid ISO values', async () => {
  await withDraftDom(async ({ React, load, mount, input, click, act }) => {
    const { default: DateInput } = await load('/src/shared/components/DateInput.jsx');
    const changes = [];
    let writes = 0;
    function Form() {
      const [value, setValue] = React.useState('2028-02-29');
      return React.createElement('form', { onSubmit: event => { event.preventDefault(); writes++; } },
        React.createElement('label', null, 'Test date', React.createElement(DateInput, { value, min: '2028-02-01', max: '2028-03-31', required: true, onChange: next => { changes.push(next); setValue(next); } })),
        React.createElement('button', { type: 'submit' }, 'Save'));
    }
    const { container } = await mount(React.createElement(Form));
    const field = container.querySelector('input[type="text"]');
    assert.equal(field.value, '29/02/2028');
    for (const value of ['31/02/2028', '31/01/2028', '01/04/2028', '02/29/2028']) {
      await input(field, value);
      assert.equal(field.value, value);
      assert.equal(field.checkValidity(), false);
      await click(container.querySelector('[type="submit"]'));
    }
    assert.equal(writes, 0);
    assert.deepEqual(changes, []);
    await input(field, '01/03/2028');
    assert.equal(field.checkValidity(), true);
    assert.deepEqual(changes, ['2028-03-01']);
    let calendarOpened = false;
    container.querySelector('input[type="date"]').showPicker = () => { calendarOpened = true; };
    await click(container.querySelector('.date-input-picker'));
    assert.equal(calendarOpened, true);
    await input(container.querySelector('input[type="date"]'), '2028-03-02');
    assert.equal(field.value, '02/03/2028');
    await act(async () => container.querySelector('form').requestSubmit());
    assert.equal(writes, 1);
    await input(field, '');
    assert.equal(field.checkValidity(), false);
    assert.equal(changes.at(-1), '');
  });
});

test('date validity callbacks can guard actions outside forms without stale ISO writes', async () => {
  await withDraftDom(async ({ React, load, mount, input, click }) => {
    const { default: DateInput } = await load('/src/shared/components/DateInput.jsx');
    const saved = [], validity = [];
    function Filter() {
      const [value, setValue] = React.useState('2028-02-29');
      const [valid, setValid] = React.useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement(DateInput, { value, required: true, onChange: setValue, onValidityChange: next => { validity.push(next); setValid(next); } }),
        React.createElement('button', { type: 'button', disabled: !valid, onClick: () => saved.push(value) }, 'Apply'));
    }
    const { container } = await mount(React.createElement(Filter));
    const field = container.querySelector('input[type="text"]'), apply = [...container.querySelectorAll('button')].at(-1);
    assert.equal(apply.disabled, false);
    await input(field, '31/02/2028');
    assert.equal(apply.disabled, true);
    await click(apply);
    assert.deepEqual(saved, []);
    await input(field, '30/02/2028');
    assert.deepEqual(validity, [true, false]);
    await input(field, '01/03/2028');
    await click(apply);
    assert.deepEqual(saved, ['2028-03-01']);
    await input(field, '');
    assert.equal(apply.disabled, true);
  });
});
