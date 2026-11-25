import test from 'node:test'
import assert from 'node:assert/strict'
import {
  channelMappingInput,
  channelSettingsDraft,
  channelSettingsInput,
  otaMappingOptions,
  uncertainChannelWrite,
  visibleChannelFields,
} from './channelForms.js'

test('channel form never recalls stored secrets or sends blank replacement secrets', () => {
  const fields = [
    { key: 'hotel_id', type: 'string' },
    { key: 'password', type: 'password', secret: true },
    { key: 'internal', type: 'hidden' },
  ]
  assert.deepEqual(
    channelSettingsDraft(fields, { hotel_id: '12', password: 'private', internal: 'hidden' }),
    { hotel_id: '12' },
  )
  assert.deepEqual(
    channelSettingsInput(fields, { hotel_id: '12', password: '', internal: 'hidden' }),
    { hotel_id: '12' },
  )
  assert.deepEqual(channelSettingsInput(fields, { hotel_id: '12', password: 'replacement' }), {
    hotel_id: '12',
    password: 'replacement',
  })
})

test('clearing public text is explicit while local input errors never imply an uncertain write', () => {
  const fields = [
    { key: 'email', type: 'string' },
    { key: 'password', type: 'password', secret: true },
    { key: 'count', type: 'integer', label: 'Số khách' },
  ]
  assert.deepEqual(channelSettingsInput(fields, { email: '', password: '', count: '' }), {
    email: '',
  })
  assert.throws(
    () => channelSettingsInput(fields, { count: 'invalid' }),
    (error) => error.status === 422 && !uncertainChannelWrite(error),
  )
  assert.equal(uncertainChannelWrite({ status: 503 }), true)
})

test('descriptor rules hide conditional settings while booleans and integers keep their types', () => {
  const fields = [
    { key: 'notify', type: 'boolean' },
    {
      key: 'email',
      type: 'string',
      rules: [{ apply: 'hidden', when: false, influenceField: 'notify' }],
    },
    { key: 'occupancy', label: 'Sức chứa', type: 'integer' },
  ]
  assert.equal(visibleChannelFields(fields, { notify: false }).length, 2)
  assert.deepEqual(
    channelSettingsInput(fields, { notify: false, email: 'old@example.com', occupancy: '2' }),
    { notify: false, occupancy: 2 },
  )
  assert.throws(() => channelSettingsInput(fields, { occupancy: '2.5' }))
  assert.throws(() => channelSettingsInput(fields, { occupancy: '9007199254740993' }))
})

test('mapping edits preserve IDs and remove only explicitly marked entries', () => {
  const fields = [{ key: 'room_type_code', type: 'string' }]
  assert.deepEqual(
    channelMappingInput(
      [
        { id: 'mapping-1', ratePlanId: 'rate-1', settings: { room_type_code: 'ota-1' } },
        { id: 'mapping-2', ratePlanId: 'rate-2', removed: true },
      ],
      fields,
    ),
    [
      { id: 'mapping-1', ratePlanId: 'rate-1', settings: { room_type_code: 'ota-1' } },
      { id: 'mapping-2', ratePlanId: 'rate-2', settings: null },
    ],
  )
})

test('OTA rate choices are scoped to selected room and occupancy to selected rate', () => {
  const mapping = {
    rooms: [
      { id: 'r1', name: 'Room one', rates: [{ id: 'p1', name: 'Standard', occupancies: [1, 2] }] },
      { id: 'r2', name: 'Room two', rates: [] },
    ],
  }
  assert.deepEqual(
    otaMappingOptions({ key: 'rate_plan_code' }, { room_type_code: 'r1' }, mapping),
    [{ value: 'p1', label: 'Standard' }],
  )
  assert.deepEqual(
    otaMappingOptions({ key: 'rate_plan_code' }, { room_type_code: 'r2' }, mapping),
    [],
  )
  assert.deepEqual(
    otaMappingOptions(
      { key: 'occupancy' },
      { room_type_code: 'r1', rate_plan_code: 'p1' },
      mapping,
    ),
    [
      { value: '1', label: '1' },
      { value: '2', label: '2' },
    ],
  )
})

test('descriptor numeric values keep finite number controls and OTA identifiers stay strings', () => {
  const fields = [
    { key: 'hotel_id', type: 'string' },
    { key: 'adjustment', label: 'Điều chỉnh', type: 'number' },
  ]
  assert.deepEqual(channelSettingsDraft(fields, { hotel_id: 12345 }), {
    hotel_id: '12345',
    adjustment: '',
  })
  assert.deepEqual(channelSettingsInput(fields, { hotel_id: '12345', adjustment: '-1.25' }), {
    hotel_id: '12345',
    adjustment: -1.25,
  })
  assert.throws(() => channelSettingsInput(fields, { adjustment: 'Infinity' }))
  assert.throws(() => channelSettingsInput(fields, { adjustment: '1000000000001' }))
})

test('editing a channel name does not write descriptor defaults or unchanged mappings', () => {
  const fields = [
    { key: 'hotel_id', type: 'string' },
    { key: 'send_email_notifications', type: 'boolean', default: false },
    { key: 'password', type: 'password', secret: true },
  ]
  const stored = { hotel_id: 123 }
  const initial = channelSettingsDraft(fields, stored)
  assert.deepEqual(channelSettingsInput(fields, initial, initial), {})
  assert.deepEqual(
    channelSettingsInput(fields, { ...initial, password: 'new-password' }, initial),
    { password: 'new-password' },
  )
  assert.deepEqual(channelSettingsInput(fields, { ...initial, hotel_id: '456' }, initial), {
    hotel_id: '456',
  })
  const mappingFields = [
    { key: 'room_type_code', type: 'string' },
    { key: 'readonly', type: 'boolean', default: false },
  ]
  const mappings = [
    { id: 'mapping-1', ratePlanId: 'rate-1', settings: { room_type_code: 'room-1' } },
  ]
  const draft = mappings.map((row) => ({
    ...row,
    settings: channelSettingsDraft(mappingFields, row.settings),
  }))
  assert.deepEqual(channelMappingInput(draft, mappingFields, mappings), [])
  assert.deepEqual(channelMappingInput([{ ...draft[0], removed: true }], mappingFields, mappings), [
    { id: 'mapping-1', ratePlanId: 'rate-1', settings: null },
  ])
  assert.deepEqual(
    channelMappingInput(
      [{ ...draft[0], settings: { ...draft[0].settings, room_type_code: 'room-2' } }],
      mappingFields,
      mappings,
    ),
    [{ id: 'mapping-1', ratePlanId: 'rate-1', settings: { room_type_code: 'room-2' } }],
  )
})

test('new mappings send their full input while edits retain explicit clearing and numeric normalization', () => {
  const fields = [
    { key: 'code', type: 'string' },
    { key: 'occupancy', type: 'integer' },
    { key: 'readonly', type: 'boolean', default: false },
  ]
  const stored = { code: 'old', occupancy: 2 }
  const initial = channelSettingsDraft(fields, stored)
  assert.deepEqual(channelSettingsInput(fields, { ...initial, occupancy: '2' }, initial), {})
  assert.deepEqual(channelSettingsInput(fields, { ...initial, code: '' }, initial), { code: '' })
  assert.deepEqual(
    channelMappingInput(
      [{ ratePlanId: 'new-rate', settings: { code: 'new', occupancy: '1', readonly: false } }],
      fields,
      [],
    ),
    [{ ratePlanId: 'new-rate', settings: { code: 'new', occupancy: 1, readonly: false } }],
  )
})
