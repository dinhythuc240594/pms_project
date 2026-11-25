export function visibleChannelFields(fields = [], values = {}) {
  return fields.filter(
    (field) =>
      field.type !== 'hidden' &&
      !field.rules?.some(
        (rule) => rule.apply === 'hidden' && values[rule.influenceField] === rule.when,
      ),
  )
}

export function channelSettingsDraft(fields = [], values = {}) {
  return Object.fromEntries(
    fields
      .filter((field) => field.type !== 'hidden' && !field.secret)
      .map((field) => {
        const value = values[field.key] ?? field.default ?? (field.type === 'boolean' ? false : '')
        return [
          field.key,
          ['string', 'slug', 'select', 'switch'].includes(field.type) ? String(value) : value,
        ]
      }),
  )
}

function inputError(message) {
  return Object.assign(new Error(message), { status: 422 })
}

export function channelSettingsInput(fields = [], values = {}, previousDraft) {
  const entries = visibleChannelFields(fields, values)
    .filter(
      (field) =>
        values[field.key] != null &&
        (values[field.key] !== '' || (!field.secret && ['string', 'slug'].includes(field.type))),
    )
    .map((field) => {
      const value = values[field.key]
      if (field.type === 'integer') {
        if (!/^-?\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
          throw inputError(`${field.label}: cần nhập số nguyên.`)
        return [field.key, Number(value)]
      }
      if (field.type === 'number') {
        if (
          !/^-?\d+(\.\d+)?$/.test(String(value)) ||
          !Number.isFinite(Number(value)) ||
          Math.abs(Number(value)) > 1e12
        )
          throw inputError(`${field.label}: cần nhập số hợp lệ.`)
        return [field.key, Number(value)]
      }
      return [field.key, field.type === 'boolean' ? value === true : value]
    })
  if (previousDraft === undefined) return Object.fromEntries(entries)
  const previous = channelSettingsInput(fields, previousDraft)
  return Object.fromEntries(
    entries.filter(
      ([key, value]) =>
        fields.find((field) => field.key === key)?.secret || !Object.is(previous[key], value),
    ),
  )
}

export function channelMappingInput(mappings, fields, previousMappings) {
  return mappings.flatMap((mapping) => {
    const previous = previousMappings?.find((row) => mapping.id && row.id === mapping.id)
    const settings = mapping.removed
      ? null
      : channelSettingsInput(
          fields,
          mapping.settings,
          previous ? channelSettingsDraft(fields, previous.settings) : undefined,
        )
    if (
      previous &&
      settings !== null &&
      !Object.keys(settings).length &&
      mapping.ratePlanId === previous.ratePlanId
    )
      return []
    return [{ ...(mapping.id ? { id: mapping.id } : {}), ratePlanId: mapping.ratePlanId, settings }]
  })
}

export function otaMappingOptions(field, values, mapping) {
  const room = mapping?.rooms?.find((item) => item.id === values.room_type_code)
  const rate = room?.rates?.find((item) => item.id === values.rate_plan_code)
  if (field.key === 'room_type_code' && mapping?.rooms)
    return mapping.rooms.map((item) => ({ value: item.id, label: item.name }))
  if (field.key === 'rate_plan_code' && mapping?.rooms)
    return (room?.rates || []).map((item) => ({ value: item.id, label: item.name }))
  if (field.key === 'occupancy' && rate?.occupancies?.length)
    return rate.occupancies.map((value) => ({ value: String(value), label: String(value) }))
  return (field.options || []).map((value) => ({ value, label: value }))
}

export function uncertainChannelWrite(error) {
  return !error.status || error.status >= 500
}
