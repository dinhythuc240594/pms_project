import { useCallback, useEffect, useState } from 'react';

export function useChannels(requestTenant, tenantId, path = '/channels', enabled = true, refreshKey = 0) {
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    let pending = false, latestData = null;
    async function fetchSnapshot() {
      if (pending) return;
      pending = true;
      try {
        const data = await requestTenant(path);
        latestData = data;
        if (current) setResult({ requestTenant, tenantId, path, revision, refreshKey, data, error: '' });
      } catch (err) {
        if (current) setResult({ requestTenant, tenantId, path, revision, refreshKey, data: latestData, error: err.message });
      } finally { pending = false; }
    }
    fetchSnapshot();
    return () => { current = false; };
  }, [requestTenant, tenantId, path, revision, enabled, refreshKey]);
  const loaded = enabled && result?.requestTenant === requestTenant && result?.tenantId === tenantId && result?.path === path && result?.revision === revision && result?.refreshKey === refreshKey;
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return { data: loaded ? result.data : null, error: loaded ? result.error : '', loading: enabled && !loaded, refresh, revision };
}
