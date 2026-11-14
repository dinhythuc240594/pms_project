// A confirmation can outlive the session that opened it. Only its original
// tenant scope may commit the selection, and no scope/data changes occur while
// the user is still deciding whether to discard a draft.
export function requestTenantSelection({ id, tenantId, hotels, scope, requestLeave, clearDrafts, apply, fail }) {
  if (id === tenantId) return false;
  if (!hotels.some(hotel => hotel.id === id)) return fail(new Error('Bạn không có quyền vào khách sạn này.'));
  const token = scope.current();
  return requestLeave(() => {
    if (!scope.isCurrent(token)) return;
    clearDrafts();
    scope.select(id);
    apply(id);
  });
}
