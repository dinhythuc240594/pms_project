const reloadGuards = new Set();
const RELOAD_KEY_PREFIX = 'loha:route-chunk-reload:';

// Guards are checked before the failed lazy tree unmounts, while its draft and
// pending-write refs are still registered with the provider.
export function registerChunkReloadGuard(hasBlockers) {
  reloadGuards.add(hasBlockers);
  return () => reloadGuards.delete(hasBlockers);
}

function hasReloadBlockers() {
  for (const hasBlockers of reloadGuards) {
    try { if (hasBlockers()) return true; }
    catch { return true; }
  }
  return false;
}

export function isChunkLoadError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  return error?.name === 'ChunkLoadError' || /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk .+ failed|Unable to preload CSS for/i.test(message);
}

export class RouteChunkLoadError extends Error {
  constructor(cause) {
    super('The requested application module could not be loaded.', { cause });
    this.name = 'RouteChunkLoadError';
    this.reloadBlocked = hasReloadBlockers();
  }
}

export function isRouteChunkLoadError(error) {
  return error instanceof RouteChunkLoadError;
}

export function wrapRouteImport(importer) {
  return async () => {
    try { return await importer(); }
    catch (error) {
      // Syntax errors and exceptions thrown by module code keep their normal
      // error boundary behavior; only transport/preload failures need refresh.
      if (isChunkLoadError(error)) throw new RouteChunkLoadError(error);
      throw error;
    }
  };
}

function markReload(storage, location) {
  // Deliberately independent of the entry chunk hash. A cached shell, repeated
  // deployment, or failing CDN cannot reset the limit and create a reload loop.
  const key = RELOAD_KEY_PREFIX + location.href;
  if (storage.getItem(key)) return false;
  storage.setItem(key, '1');
  return storage.getItem(key) === '1';
}

export function attemptChunkReload(error, options = {}) {
  if (!isRouteChunkLoadError(error) || error.reloadBlocked || hasReloadBlockers()) return false;
  const online = options.online ?? globalThis.navigator?.onLine;
  if (online === false) return false;
  try {
    const browser = globalThis.window;
    const location = options.location ?? browser?.location;
    const storage = options.storage ?? browser?.sessionStorage;
    // If durable session state is unavailable, leave recovery to the explicit
    // retry button. An in-memory flag would disappear on the next reload.
    if (!location || !storage || !markReload(storage, location)) return false;
    location.reload();
    return true;
  } catch { return false; }
}

export function reloadCurrentRoute() {
  // Keep the complete URL (including return-to, query filters and anchors).
  window.location.reload();
}
