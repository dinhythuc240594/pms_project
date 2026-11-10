import { lazy } from 'react';
import { wrapRouteImport } from './chunkRecovery.js';

export function lazyRoute(importer) {
  return lazy(wrapRouteImport(importer));
}
