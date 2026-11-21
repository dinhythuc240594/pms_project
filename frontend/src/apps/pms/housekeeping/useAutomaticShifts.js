import { useCallback, useEffect, useState } from 'react'
import { automaticPlanShiftPaths } from './automaticPlan'

export function useAutomaticShifts({ start, end, requestTenant, knownRange, knownShifts, source }) {
  const [loaded, setLoaded] = useState(null),
    [revision, setRevision] = useState(0)
  const pathKey = automaticPlanShiftPaths(start, end).join('|')
  const covered = Boolean(
    pathKey && knownRange && start >= knownRange.start && end < knownRange.end,
  )
  useEffect(() => {
    if (!pathKey || covered) return
    let current = true
    const controller = new AbortController()
    const timer = setTimeout(() => {
      Promise.all(
        pathKey.split('|').map((path) => requestTenant(path, { signal: controller.signal })),
      )
        .then((results) => {
          if (current)
            setLoaded({
              pathKey,
              requestTenant,
              source,
              revision,
              shifts: results.flatMap((result) => result.shifts),
              error: '',
            })
        })
        .catch((error) => {
          if (current)
            setLoaded({
              pathKey,
              requestTenant,
              source,
              revision,
              shifts: [],
              error: error.message,
            })
        })
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [pathKey, covered, requestTenant, source, revision])
  const ready =
    loaded?.pathKey === pathKey &&
    loaded?.requestTenant === requestTenant &&
    loaded?.source === source &&
    loaded?.revision === revision
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  return {
    shifts: covered ? knownShifts : ready ? loaded.shifts : [],
    loading: Boolean(pathKey) && !covered && !ready,
    error: !covered && ready ? loaded.error : '',
    refresh,
  }
}
