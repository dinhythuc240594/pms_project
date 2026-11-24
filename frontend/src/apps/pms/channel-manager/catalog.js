export function mappingCatalogState(catalog, mappings, draft, currency) {
  const current = mappings.find((row) => row.roomTypeId === draft?.roomTypeId)
  const others = mappings.filter((row) => row.roomTypeId !== draft?.roomTypeId)
  const roomTypes = (catalog?.roomTypes || []).map((room) => ({
    ...room,
    available: !others.some((row) => row.channexRoomTypeId === room.id),
  }))
  const ratePlans = (catalog?.ratePlans || [])
    .filter((rate) => rate.roomTypeId === draft?.channexRoomTypeId)
    .map((rate) => ({
      ...rate,
      available: rate.supported && !others.some((row) => row.channexRatePlanId === rate.id),
    }))
  const unchanged =
    current &&
    current.channexRoomTypeId === draft?.channexRoomTypeId &&
    current.channexRatePlanId === draft?.channexRatePlanId
  const validChoice =
    roomTypes.some((room) => room.id === draft?.channexRoomTypeId && room.available) &&
    ratePlans.some((rate) => rate.id === draft?.channexRatePlanId && rate.available)
  const inboundPlans = (catalog?.ratePlans || [])
    .filter(
      (rate) =>
        rate.roomTypeId === draft?.channexRoomTypeId &&
        rate.id !== draft?.channexRatePlanId &&
        (!currency || rate.currency === currency),
    )
    .map((rate) => ({
      ...rate,
      available: !others.some(
        (row) => row.channexRatePlanId === rate.id || row.inboundRatePlanIds?.includes(rate.id),
      ),
    }))
  const inbound = draft?.inboundRatePlanIds || [],
    previous = current?.inboundRatePlanIds || []
  const inboundUnchanged =
    inbound.length === previous.length && previous.every((id) => inbound.includes(id))
  const inboundValid =
    new Set(inbound).size === inbound.length &&
    inbound.every((id) => inboundPlans.some((rate) => rate.id === id && rate.available)) &&
    (!current?.targetLocked || previous.every((id) => inbound.includes(id)))
  return {
    roomTypes,
    ratePlans,
    inboundPlans,
    canSave: Boolean(
      draft?.roomTypeId &&
      !current?.pauseRequested &&
      (unchanged || (!current?.targetLocked && validChoice)) &&
      (inboundUnchanged || (catalog && inboundValid)),
    ),
  }
}
