import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { withDraftDom } from '../../../../shared/drafts/testDom.js'

const event = (id, network = {}) => ({
  id,
  tenantId: 'hotel-a',
  userId: 'admin',
  userName: 'Quản trị viên',
  event: 'tenant.updated',
  entityType: 'tenant',
  entityId: 'hotel-a',
  createdAt: '2026-11-08T03:00:00Z',
  details: { changed: ['name'], name: `Hotel ${id}` },
  ...network,
})
const auditLogs = [
  event('ipv4', {
    ipAddress: '8.8.8.8',
    ipInfo: { version: 4, scope: 'public', source: 'trusted_proxy' },
    status: 'source-status',
    severity: 'source-level',
  }),
  event('ipv6', {
    ipAddress: '2606:4700:4700::1111',
    ipInfo: { version: 6, scope: 'public', source: 'direct' },
  }),
  event('private', {
    ipAddress: '10.20.30.40',
    ipInfo: { version: 4, scope: 'private', source: 'direct' },
  }),
  event('legacy'),
  event('background', {
    ipAddress: null,
    ipInfo: { version: null, scope: 'unknown', source: 'unknown' },
  }),
]
const buttonWithText = (container, text) =>
  [...container.querySelectorAll('button')].find((button) => button.textContent.includes(text))

async function withLogs(check) {
  await withDraftDom(async (tools) => {
    const { React, load, mount } = tools
    const { default: AdminLogs } = await load('/src/apps/manager/logs/pages/AdminLogs.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { setLocale, t } = await load('/src/shared/i18n/store.js')
    setLocale('vi')
    const value = { workspace: { auditLogs, tenants: [{ id: 'hotel-a', name: 'Khách sạn A' }] } }
    const { container } = await mount(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(PmsContext.Provider, { value }, React.createElement(AdminLogs)),
      ),
    )
    const rows = () => [...container.querySelectorAll('tbody tr')]
    await check({ ...tools, container, rows, t })
  })
}

test('system logs display actual IPv4 and IPv6 addresses and mark legacy or background addresses as unknown', async () => {
  await withLogs(async ({ container, rows }) => {
    assert.equal(rows().length, 5)
    assert.deepEqual(
      [...container.querySelectorAll('.admin-logs-metric > strong')].map(
        (value) => value.textContent,
      ),
      ['3', '2', '1', '2'],
    )
    for (const [index, address] of ['8.8.8.8', '2606:4700:4700::1111', '10.20.30.40'].entries()) {
      assert.ok(rows()[index].children[5].textContent.includes(address))
    }
    for (const row of rows().slice(3)) {
      const cell = row.children[5].textContent
      assert.match(cell, /chưa|không|unknown/i)
      assert.doesNotMatch(cell, /127\.0\.0\.1|8\.8\.8\.8|IPv[46]/)
    }
  })
})

test('IP search and IP scope filters work together and include logs without an IP', async () => {
  await withLogs(async ({ container, rows, input }) => {
    const search = container.querySelector('input[type="search"]')
    const filter = container.querySelector('select[aria-label="Lọc loại địa chỉ IP"]')
    await input(search, '2606:4700')
    assert.equal(rows().length, 1)
    assert.match(rows()[0].textContent, /2606:4700:4700::1111/)
    await input(filter, 'private')
    assert.ok(container.querySelector('.admin-logs-empty'))
    await input(search, '')
    assert.equal(rows().length, 1)
    assert.match(rows()[0].textContent, /10\.20\.30\.40/)
    await input(filter, 'unknown')
    assert.equal(rows().length, 2)
    assert.doesNotMatch(
      rows()
        .map((row) => row.textContent)
        .join(' '),
      /10\.20\.30\.40|8\.8\.8\.8|2606:/,
    )
    await input(filter, 'ALL')
    assert.equal(rows().length, 5)
  })
})

test('network details and JSON view, copy and download preserve the server record without fabricated network facts', async () => {
  await withLogs(async ({ container, rows, click, window }) => {
    const copied = [],
      downloads = []
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => copied.push(text) },
    })
    const previousClick = window.HTMLAnchorElement.prototype.click
    window.HTMLAnchorElement.prototype.click = function () {
      downloads.push({ href: this.href, filename: this.download })
    }
    try {
      await click(rows()[0].querySelector('button'))
      const dialog = container.querySelector('[role="dialog"]')
      assert.match(dialog.textContent, /8\.8\.8\.8/)
      assert.match(dialog.textContent, /IPv4/)
      assert.match(dialog.textContent, /proxy/i)
      assert.doesNotMatch(dialog.textContent, /Cloud Gateway v2|TLSv1\.3/)
      await click(buttonWithText(dialog, 'Raw JSON'))
      const payload = JSON.parse(dialog.querySelector('pre').textContent)
      assert.deepEqual(payload, auditLogs[0])
      assert.equal(payload.network, undefined)
      await click(buttonWithText(dialog, 'Sao chép JSON'))
      assert.deepEqual(JSON.parse(copied[0]), auditLogs[0])
      await click(buttonWithText(dialog, 'Xuất JSON'))
      assert.equal(downloads.length, 1)
      assert.equal(downloads[0].filename, 'audit_log_ipv4.json')
      assert.deepEqual(
        JSON.parse(decodeURIComponent(downloads[0].href.split(',').slice(1).join(','))),
        auditLogs[0],
      )
    } finally {
      window.HTMLAnchorElement.prototype.click = previousClick
    }
  })
})

test('a clipboard failure reports the failure without claiming the JSON was copied', async () => {
  await withLogs(async ({ container, rows, click, window, t }) => {
    let attempts = 0
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          attempts++
          throw new Error('Clipboard permission denied')
        },
      },
    })
    await click(rows()[0].querySelector('button'))
    const dialog = container.querySelector('[role="dialog"]')
    await click(buttonWithText(dialog, 'Raw JSON'))
    await click(buttonWithText(dialog, 'Sao chép JSON'))
    assert.equal(attempts, 1)
    assert.equal(container.querySelector('[role="status"]').textContent, t('auditIp.copyFailed'))
    assert.ok(buttonWithText(dialog, 'Sao chép JSON'))
    assert.doesNotMatch(dialog.textContent, /Đã sao chép!/)
    assert.deepEqual(JSON.parse(dialog.querySelector('pre').textContent), auditLogs[0])
  })
})

test('severity and status dropdowns are absent and status column header and badges do not appear in table or detail overview', async () => {
  await withLogs(async ({ container, rows, click }) => {
    // No severity/status filter selects
    const selects = [...container.querySelectorAll('select')]
    for (const sel of selects) {
      assert.doesNotMatch(
        sel.getAttribute('aria-label') || '',
        /mức độ|trạng thái sự kiện|severity|status/i,
      )
    }
    // No status column header in thead
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent)
    for (const h of headers) {
      assert.doesNotMatch(h, /^(Success|Warning|Failed|Trạng thái)$/i)
    }
    // 7 columns total
    assert.equal(headers.length, 7)
    // No status badge text in any row
    for (const row of rows()) {
      assert.doesNotMatch(row.textContent, /\bSuccess\b|\bFailed\b/)
    }
    // Open modal – no status/severity ribbon
    await click(rows()[0].querySelector('button'))
    const dialog = container.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.doesNotMatch(dialog.textContent, /Low Severity|High Severity|Medium Severity/)
    assert.doesNotMatch(dialog.textContent, /Trạng thái:.*Success|Mức độ:/)
    assert.ok(!dialog.querySelector('.admin-logs-dialog-status'))
  })
})

test('original server metadata with status and severity fields is faithfully preserved in JSON tab, copy and download', async () => {
  await withLogs(async ({ container, rows, click, window }) => {
    const copied = [],
      downloads = []
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => copied.push(text) },
    })
    const previousClick = window.HTMLAnchorElement.prototype.click
    window.HTMLAnchorElement.prototype.click = function () {
      downloads.push(this.href)
    }
    try {
      await click(rows()[0].querySelector('button'))
      const dialog = container.querySelector('[role="dialog"]')
      await click(buttonWithText(dialog, 'Raw JSON'))
      const payload = JSON.parse(dialog.querySelector('pre').textContent)
      assert.deepEqual(payload, auditLogs[0])
      assert.equal(payload.status, 'source-status')
      assert.equal(payload.severity, 'source-level')
      await click(buttonWithText(dialog, 'Sao chép JSON'))
      assert.deepEqual(JSON.parse(copied[0]), auditLogs[0])
      await click(buttonWithText(dialog, 'Xuất JSON'))
      assert.equal(downloads.length, 1)
      const decoded = JSON.parse(decodeURIComponent(downloads[0].split(',').slice(1).join(',')))
      assert.deepEqual(decoded, auditLogs[0])
    } finally {
      window.HTMLAnchorElement.prototype.click = previousClick
    }
  })
})

test('event-code search and human-label search work combined with IP scope filter', async () => {
  await withLogs(async ({ container, rows, input }) => {
    const search = container.querySelector('input[type="search"]')
    const filter = container.querySelector('select[aria-label="Lọc loại địa chỉ IP"]')
    // Event code search: all fixture logs use 'tenant.updated'
    await input(search, 'tenant.updated')
    assert.equal(rows().length, 5)
    // Narrow by IP scope 'public' → only ipv4 and ipv6 events
    await input(filter, 'public')
    assert.equal(rows().length, 2)
    assert.match(rows()[0].textContent, /8\.8\.8\.8/)
    assert.match(rows()[1].textContent, /2606:4700/)
    // Human label search: 'Cập nhật khách sạn' matches tenant.updated label
    await input(filter, 'ALL')
    await input(search, 'Cập nhật khách sạn')
    assert.equal(rows().length, 5)
    // Combine with private scope
    await input(filter, 'private')
    assert.equal(rows().length, 1)
    assert.match(rows()[0].textContent, /10\.20\.30\.40/)
    // Reset
    await input(search, '')
    await input(filter, 'ALL')
    assert.equal(rows().length, 5)
  })
})

test('global outlet search filters logs by event code and clears with empty query', async () => {
  await withDraftDom(async ({ React, act, load, mount }) => {
    const { default: AdminLogs } = await load('/src/apps/manager/logs/pages/AdminLogs.jsx')
    const { PmsContext } = await load('/src/apps/pms/data/usePms.js')
    const { setLocale } = await load('/src/shared/i18n/store.js')
    setLocale('vi')
    const value = { workspace: { auditLogs, tenants: [{ id: 'hotel-a', name: 'Khách sạn A' }] } }
    let setGlobal
    function Host() {
      const [searchQuery, setSearchQuery] = React.useState('')
      React.useEffect(() => {
        setGlobal = setSearchQuery
      }, [])
      return React.createElement(Outlet, { context: { searchQuery, isDarkMode: false } })
    }
    const { container } = await mount(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/logs'] },
        React.createElement(
          Routes,
          null,
          React.createElement(
            Route,
            { element: React.createElement(Host) },
            React.createElement(Route, {
              path: '/logs',
              element: React.createElement(
                PmsContext.Provider,
                { value },
                React.createElement(AdminLogs),
              ),
            }),
          ),
        ),
      ),
    )
    const rows = () => [...container.querySelectorAll('tbody tr')]
    assert.equal(rows().length, 5)
    // Global search by event code
    await act(async () => setGlobal('tenant.updated'))
    assert.equal(rows().length, 5)
    // Global search by operator name
    await act(async () => setGlobal('Quản trị viên'))
    assert.equal(rows().length, 5)
    // Global search matching only ipv4 IP
    await act(async () => setGlobal('8.8.8.8'))
    assert.equal(rows().length, 1)
    assert.match(rows()[0].textContent, /8\.8\.8\.8/)
    // Clearing global search restores all rows
    await act(async () => setGlobal(''))
    assert.equal(rows().length, 5)
  })
})

test('CSV export includes actual IP and network classification for only the filtered events', async () => {
  await withLogs(async ({ container, input, click, window }) => {
    const previousCreate = URL.createObjectURL,
      previousRevoke = URL.revokeObjectURL
    const previousClick = window.HTMLAnchorElement.prototype.click
    const files = []
    let blob
    URL.createObjectURL = (value) => {
      blob = value
      return 'blob:system-log-test'
    }
    URL.revokeObjectURL = () => {}
    window.HTMLAnchorElement.prototype.click = function () {
      files.push(this.download)
    }
    try {
      await input(container.querySelector('input[type="search"]'), '10.20.30.40')
      await click(container.querySelector('.admin-logs-filter-actions button'))
      assert.deepEqual(files, ['nhat-ky-he-thong.csv'])
      const content = await blob.text()
      assert.match(content, /Địa chỉ IP/)
      assert.match(content, /10\.20\.30\.40/)
      assert.doesNotMatch(content, /8\.8\.8\.8|2606:4700/)
      assert.equal(content.split('\r\n').length, 2)
      assert.match(content, /IPv4/)
    } finally {
      URL.createObjectURL = previousCreate
      URL.revokeObjectURL = previousRevoke
      window.HTMLAnchorElement.prototype.click = previousClick
    }
  })
})
