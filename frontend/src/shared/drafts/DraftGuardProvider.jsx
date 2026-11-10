import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useBlocker } from 'react-router-dom';
import { createDraftGuardManager } from './guardManager.js';
import { registerChunkReloadGuard } from '../lib/chunkRecovery.js';
import './DraftGuard.css';

const DraftGuardContext = createContext(null);
const unguardedNavigation = {
  requestLeave(action) { action(); return true; },
  clearDrafts() {},
};

function DraftConfirmation({ manager, pending }) {
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    function handleEscape(event) {
      if (event.key !== 'Escape') return;
      // Underlying legacy overlays also listen on document. An Escape here
      // dismisses this confirmation only, leaving the edited form open.
      event.preventDefault();
      event.stopImmediatePropagation();
      manager.cancel();
    }
    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('keydown', handleEscape, true);
      dialog.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [manager]);

  return <dialog ref={ref} className="draft-confirmation" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); manager.cancel(); }} onMouseDown={event => { if (event.target === event.currentTarget) manager.cancel(); }}>
    <section className="draft-confirmation-content">
      <h2 id={titleId}>Bạn có thay đổi chưa lưu</h2>
      <p id={descriptionId}>{pending ? 'Đang lưu thay đổi. Vui lòng chờ yêu cầu hoàn tất trước khi rời khỏi biểu mẫu.' : 'Bạn muốn tiếp tục sửa hay bỏ bản nháp để rời khỏi biểu mẫu?'}</p>
      <div className="draft-confirmation-actions">
        <button type="button" autoFocus onClick={manager.cancel}>Tiếp tục sửa</button>
        <button type="button" className="draft-confirmation-discard" disabled={pending} onClick={manager.discard}>Bỏ bản nháp</button>
      </div>
    </section>
  </dialog>;
}

export function DraftGuardProvider({ children }) {
  const [manager] = useState(createDraftGuardManager);
  const { confirmation } = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);

  useLayoutEffect(() => registerChunkReloadGuard(manager.hasBlockers), [manager]);

  useEffect(() => {
    function beforeUnload(event) {
      if (!manager.hasBlockers()) return;
      event.preventDefault();
      event.returnValue = '';
    }
    // Always evaluate live refs, including writes started before a rerender.
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [manager]);

  return <DraftGuardContext.Provider value={manager}>
    {children}
    {confirmation && <DraftConfirmation key={confirmation.id} manager={manager} pending={confirmation.pending} />}
  </DraftGuardContext.Provider>;
}

export function useDraftNavigation() {
  return useContext(DraftGuardContext) || unguardedNavigation;
}

// A group scopes a form-close action. Route and tenant navigation use the
// provider's global requestLeave and protect every registered form and write.
// dirty/pending accept booleans or live getter functions.
export function useDraftGuard({ dirty = false, pending = false, onDiscard, group, persistent = false } = {}) {
  const manager = useContext(DraftGuardContext);
  const [id] = useState(() => Symbol('draft guard'));
  const ownGroup = group ?? id;
  const latest = useRef({ dirty, pending, onDiscard, group: ownGroup, persistent });

  useLayoutEffect(() => { latest.current = { dirty, pending, onDiscard, group: ownGroup, persistent }; });
  useLayoutEffect(() => manager?.register(id, () => latest.current), [manager, id]);
  useLayoutEffect(() => { manager?.refresh(); });

  const requestLeave = useCallback(action => manager ? manager.requestLeave(action, { group: ownGroup }) : unguardedNavigation.requestLeave(action), [manager, ownGroup]);
  return { requestLeave };
}

export function DraftRouteGuard() {
  const manager = useContext(DraftGuardContext);
  const [owner] = useState(() => Symbol('draft route navigation'));
  const shouldBlock = useCallback(({ currentLocation, nextLocation }) => Boolean(manager?.hasBlockers()) && (
    currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search || currentLocation.hash !== nextLocation.hash
  ), [manager]);
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    manager.requestLeave(() => blocker.proceed(), { onCancel: () => blocker.reset(), owner });
  }, [manager, blocker, owner]);

  return null;
}
