import test from 'node:test'
import assert from 'node:assert/strict'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

test('catalog price displays keep exact VND formatting across UI languages and raw edit values', async () => {
  await withDraftDom(async ({ React, load, mount, click, act }) => {
    const { MasterGrid } = await load('/src/apps/pms/settings/pages/SettingsCatalogs.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const store = await load('/src/shared/i18n/store.js')
    const previousLocale = store.getLocale()
    const row = {
      id: 'room-type',
      name: 'Room type',
      capacity: 2,
      tax: '10.25',
      price: '1250000.1234',
    }
    const value = {
      settings: { currency: 'VND' },
      access: () => ({ allowed: true }),
      roomTypes: [row],
    }
    const fields = [
      { key: 'name', label: 'Name' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'tax', label: 'VAT (%)', type: 'number' },
      { key: 'price', label: 'Price', type: 'number' },
    ]
    try {
      for (const locale of ['vi', 'en-US', 'zh-CN']) {
        await act(async () => store.setLocale(locale))
        const view = await mount(
          React.createElement(
            PmsContext.Provider,
            { value },
            React.createElement(MasterGrid, { catalog: 'roomTypes', title: 'Room types', fields }),
          ),
        )
        try {
          const cells = view.container.querySelectorAll('tbody tr td')
          assert.equal(cells[1].textContent, '2', locale)
          assert.equal(cells[2].textContent, locale === 'vi' ? '10,25' : '10.25', locale)
          assert.equal(cells[3].textContent, '1.250.000,1234 ₫', locale)
          await click(view.container.querySelector('.pms-catalog-edit'))
          assert.equal(view.container.querySelector('input[id$="-price"]').value, row.price, locale)
        } finally {
          await view.unmount()
        }
      }
    } finally {
      await act(async () => store.setLocale(previousLocale))
    }
  })
})

test('foreign catalog prices follow their currency format and retain exact raw edit values across UI languages', async () => {
  await withDraftDom(async ({ React, load, mount, click, act }) => {
    const { MasterGrid } = await load('/src/apps/pms/settings/pages/SettingsCatalogs.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const store = await load('/src/shared/i18n/store.js')
    const previousLocale = store.getLocale()
    const fields = [
      { key: 'name', label: 'Name' },
      { key: 'price', label: 'Price', type: 'number' },
    ]
    const cases = [
      ['USD', '1234567.0000', '1,234,567.00 USD'],
      ['EUR', '1234567.0000', '1.234.567,00 EUR'],
      ['JPY', '1234567.0000', '1,234,567 JPY'],
      ['KRW', '1234567.0000', '1,234,567 KRW'],
      ['INR', '1234567.0000', '12,34,567.00 INR'],
      ['JPY', '1234.2500', '1,234.25 JPY'],
    ]
    try {
      for (const locale of ['vi', 'en-US', 'zh-CN']) {
        await act(async () => store.setLocale(locale))
        for (const [currency, price, expected] of cases) {
          const row = { id: 'room-type', name: 'Room type', price }
          const value = {
            settings: { currency },
            access: () => ({ allowed: true }),
            roomTypes: [row],
          }
          const view = await mount(
            React.createElement(
              PmsContext.Provider,
              { value },
              React.createElement(MasterGrid, {
                catalog: 'roomTypes',
                title: 'Room types',
                fields,
              }),
            ),
          )
          try {
            assert.equal(
              view.container.querySelectorAll('tbody tr td')[1].textContent,
              expected,
              `${locale}: ${currency} ${price}`,
            )
            await click(view.container.querySelector('.pms-catalog-edit'))
            assert.equal(
              view.container.querySelector('input[id$="-price"]').value,
              price,
              `${locale}: ${currency} raw price`,
            )
          } finally {
            await view.unmount()
          }
        }
      }
    } finally {
      await act(async () => store.setLocale(previousLocale))
    }
  })
})

test('hotel profile and catalog inputs enforce contact and numeric formats', async () => {
  await withDraftDom(async ({ React, load, mount, input, click }) => {
    const { BusinessProfile } = await load('/src/apps/pms/settings/pages/BusinessSettings.jsx')
    const { MasterGrid } = await load('/src/apps/pms/settings/pages/SettingsCatalogs.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const value = {
      settings: { name: 'Hotel', timezone: 'Asia/Ho_Chi_Minh' },
      access: () => ({ allowed: true }),
      saveSettings: async (input) => input,
      roomTypes: [],
    }
    const profile = await mount(
      React.createElement(PmsContext.Provider, { value }, React.createElement(BusinessProfile)),
    )
    const phone = profile.container.querySelector('input[type="tel"]')
    await input(phone, '0901234567')
    await input(phone, '0901234567A')
    assert.equal(phone.value, '0901234567')
    await input(phone, '123')
    assert.equal(phone.checkValidity(), false)
    const email = profile.container.querySelector('input[type="email"]')
    await input(email, 'a..b@example.test')
    assert.equal(email.checkValidity(), false)
    await profile.unmount()
    const catalog = await mount(
      React.createElement(
        PmsContext.Provider,
        { value },
        React.createElement(MasterGrid, {
          catalog: 'roomTypes',
          title: 'Room types',
          fields: [
            { key: 'name', label: 'Name' },
            { key: 'capacity', label: 'Capacity', type: 'number', default: 2 },
            { key: 'price', label: 'Price', type: 'number' },
          ],
        }),
      ),
    )
    await click(
      [...catalog.container.querySelectorAll('button')].find((button) =>
        button.textContent.includes('Thêm'),
      ),
    )
    const price = catalog.container.querySelector('input[inputmode="decimal"]')
    await input(price, '1e3')
    assert.equal(price.checkValidity(), false)
    await input(price, '123.4500')
    assert.equal(price.checkValidity(), true)
  })
})

test('hotel check-in policies use 24-hour HH:mm and reject malformed times before saving', async () => {
  await withDraftDom(async ({ React, load, mount, input, act, window }) => {
    const { BusinessPolicies } = await load('/src/apps/pms/settings/pages/BusinessSettings.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const calls = []
    const value = {
      settings: { checkInTime: '14:00', checkOutTime: '12:00' },
      access: () => ({ allowed: true }),
      saveSettings: async (data) => {
        calls.push(data)
      },
    }
    const view = await mount(
      React.createElement(PmsContext.Provider, { value }, React.createElement(BusinessPolicies)),
    )
    const field = view.container.querySelector('#policy-checkin'),
      form = view.container.querySelector('form')
    assert.equal(field.type, 'text')
    assert.equal(field.placeholder, 'HH:mm')
    for (const time of ['24:00', '09:60', '9:05', '2 PM']) {
      await input(field, time)
      assert.equal(field.checkValidity(), false, time)
      await act(async () =>
        form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
      )
      assert.equal(calls.length, 0)
    }
    await input(field, '09:05')
    await act(async () => form.requestSubmit())
    assert.equal(calls.length, 1)
    assert.equal(calls[0].checkInTime, '09:05')
  })
})
