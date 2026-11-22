import { useEffect, useState } from 'react';

export function useChannexQuery(request, arrayFields) {
  const [revision, setRevision] = useState(0), [result, setResult] = useState(null);
  useEffect(() => {
    let current = true;
    request().then(data => {
      if (!data || arrayFields?.split(',').some(field => !Array.isArray(data[field]))) {
        throw new Error('Dữ liệu Channex chưa hợp lệ. Vui lòng tải lại.');
      }
      if (current) setResult({ request, revision, data });
    }).catch(error => { if (current) setResult({ request, revision, error }); });
    return () => { current = false; };
  }, [request, arrayFields, revision]);
  const loading = result?.request !== request || result?.revision !== revision;
  return { loading, data: loading ? null : result.data, error: loading ? null : result.error, refresh: () => setRevision(value => value + 1) };
}
