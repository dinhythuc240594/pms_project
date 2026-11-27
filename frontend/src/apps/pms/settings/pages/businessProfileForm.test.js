import test from 'node:test'
import assert from 'node:assert/strict'
import { businessProfileInput } from './businessProfileForm.js'

const draft = {
  name: ' Hotel ',
  phone: '+84 900 123 456',
  contactEmail: ' Hotel+Desk@EXAMPLE.test ',
  website: 'https://example.test',
  logoUrl: 'https://example.test/logo.png',
  taxCode: '0101234567-001',
  timezone: 'Asia/Ho_Chi_Minh',
  bankAccount: 'ABC-001',
}

test('hotel contact values normalize contacts while retaining bank identifiers and optional blanks', () => {
  const result = businessProfileInput(draft)
  assert.equal(result.name, 'Hotel')
  assert.equal(result.contactEmail, 'hotel+desk@example.test')
  assert.equal(result.bankAccount, draft.bankAccount)
  assert.equal(
    businessProfileInput({ ...draft, phone: '', contactEmail: '', taxCode: '' }).phone,
    '',
  )
})

test('hotel profile rejects bad contacts, tax IDs and unsafe URLs before saving', () => {
  for (const invalid of [
    { name: ' ' },
    { phone: '0901234567A' },
    { contactEmail: 'a..b@example.test' },
    { taxCode: 'ABC123' },
    { website: 'ftp://example.test' },
    { logoUrl: 'http://example.test/logo.png' },
    { logoUrl: 'https://user:pass@example.test/logo.png' },
    { website: 'https://example.test/a b' },
    { timezone: 'Not/AZone' },
  ])
    assert.throws(() => businessProfileInput({ ...draft, ...invalid }))
  assert.equal(businessProfileInput({ ...draft, taxCode: '1'.repeat(80) }).taxCode.length, 80)
})
