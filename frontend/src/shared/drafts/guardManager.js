const ALL_GROUPS = Symbol('all draft groups');

const readFlag = value => Boolean(typeof value === 'function' ? value() : value);

// Values may be getters so a write started in the same event is guarded before
// React has rendered its pending state. No draft contents leave component memory.
export function createDraftGuardManager() {
  const guards = new Map();
  const listeners = new Set();
  let confirmation = null;
  let snapshot = { confirmation: null };
  let nextConfirmationId = 0;
  let bypassDepth = 0;

  const entries = group => [...guards.values()].map(getValue => getValue()).filter(entry => group === ALL_GROUPS || entry.group === group);
  const hasPending = () => entries(ALL_GROUPS).some(entry => readFlag(entry.pending));
  const hasBlockers = (group = ALL_GROUPS) => bypassDepth === 0 && (hasPending() || entries(group).some(entry => readFlag(entry.dirty)));

  function publish() {
    const next = confirmation ? { id: confirmation.id, pending: hasPending() } : null;
    if (snapshot.confirmation?.id === next?.id && snapshot.confirmation?.pending === next?.pending) return;
    snapshot = { confirmation: next };
    listeners.forEach(listener => listener());
  }

  function run(action) {
    // Discard setters may not have rendered yet. The accepted action must be
    // allowed through the router once, without opening a second confirmation.
    bypassDepth += 1;
    try { action(); } finally { bypassDepth -= 1; }
  }

  function refresh() {
    if (confirmation && !hasBlockers(confirmation.group)) {
      const { action } = confirmation;
      confirmation = null;
      publish();
      run(action);
    } else publish();
  }

  function cancel() {
    if (!confirmation) return;
    const { onCancel } = confirmation;
    confirmation = null;
    publish();
    onCancel?.();
  }

  function requestLeave(action, { group = ALL_GROUPS, onCancel, owner } = {}) {
    if (!hasBlockers(group)) {
      run(action);
      return true;
    }
    // A native dialog makes its background inert; keep only the first action
    // from another caller. Repeated router attempts replace their own blocked
    // transition, so discard and cancel always act on the live router blocker.
    if (confirmation) {
      if (owner && confirmation.owner === owner) {
        confirmation = { ...confirmation, group, action, onCancel };
        publish();
        return false;
      }
      onCancel?.();
      return false;
    }
    confirmation = { id: ++nextConfirmationId, group, action, onCancel, owner };
    publish();
    return false;
  }

  function discard() {
    if (!confirmation) return false;
    // Recheck live refs: a pending request can begin after the dialog rendered.
    if (hasPending()) {
      publish();
      return false;
    }
    const accepted = confirmation;
    const dirtyEntries = entries(accepted.group).filter(entry => readFlag(entry.dirty));
    confirmation = null;
    publish();
    dirtyEntries.forEach(entry => entry.onDiscard?.());
    run(accepted.action);
    return true;
  }

  function clearDrafts() {
    cancel();
    // Session/tenant changes invalidate form guards as well as their contents.
    // A stale pending ref must not block the login route or chunk recovery.
    // The provider's persistent guard continues to track current-session writes.
    for (const [id, getValue] of guards) {
      const entry = getValue();
      entry.onDiscard?.();
      if (!entry.persistent) guards.delete(id);
    }
    refresh();
  }

  return {
    requestLeave,
    hasBlockers,
    cancel,
    discard,
    clearDrafts,
    refresh,
    register(id, getValue) {
      guards.set(id, getValue);
      refresh();
      return () => { guards.delete(id); refresh(); };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
  };
}
