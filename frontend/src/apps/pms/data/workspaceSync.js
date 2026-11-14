// Track drafts for explicit refreshes without scheduling background requests.
export function watchWorkspace(refresh, { doc = document, isBlocked = () => false } = {}) {
  let alive = true, running = false;
  const drafts = new Set();
  const rememberDraft = event => {
    const target = event.target;
    if (target?.closest?.('.pms-content form, .pms-content [data-workspace-draft]')) drafts.add(target);
  };
  const canApply = () => {
    for (const target of drafts) if (!target.isConnected) drafts.delete(target);
    const focused = doc.activeElement;
    return alive && !isBlocked() && !drafts.size && doc.visibilityState !== 'hidden'
      && !doc.querySelector('[role="dialog"], dialog[open]')
      && !focused?.matches?.('input, textarea, select, [contenteditable="true"]');
  };
  async function refreshNow() {
    if (running || !canApply()) return false;
    running = true;
    try { await refresh(canApply); } catch { /* The provider exposes sync errors; keep the last data for retry. */ }
    finally { running = false; }
    return true;
  }
  doc.addEventListener('input', rememberDraft); doc.addEventListener('change', rememberDraft);
  return {
    refresh: refreshNow,
    resetDrafts() { drafts.clear(); },
    stop() {
      alive = false; drafts.clear();
      doc.removeEventListener('input', rememberDraft); doc.removeEventListener('change', rememberDraft);
    },
  };
}
