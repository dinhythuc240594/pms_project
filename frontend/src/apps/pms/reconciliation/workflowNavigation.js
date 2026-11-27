import { addDays, today } from '../data/model.js'

const scope = (pms) => JSON.stringify([pms.tenantId, pms.user?.id, pms.authGeneration])

// Carry only workflow filters; OAuth callbacks and other URL data stay behind.
function returnPath(location) {
  const params = new URLSearchParams(location.search),
    saved = new URLSearchParams()
  let keys
  if (location.pathname === '/id/reports/reconciliation') keys = ['date', 'auditDate']
  else if (
    location.pathname === '/id/settings' &&
    params.get('section') === 'channels' &&
    params.get('tab') === 'history'
  )
    keys = ['section', 'tab', 'reviewId', 'reviewPage']
  else return null
  for (const key of keys) if (params.has(key)) saved.set(key, params.get(key))
  return location.pathname + (saved.size ? '?' + saved : '')
}

export function workflowLink(to, target, pms, location) {
  let source = location
  if (location.pathname === '/id/reports/reconciliation') {
    const params = new URLSearchParams(location.search),
      day = today(pms.settings.timezone)
    if (!params.has('date')) params.set('date', day)
    if (!params.has('auditDate')) params.set('auditDate', addDays(day, -1))
    source = { ...location, search: params.toString() }
  }
  const previous = location.state?.workflowReturn
  const parent =
    previous && workflowReturnTarget(location, previous.target, pms)
      ? {
          scope: previous.scope,
          target: previous.target,
          path: workflowReturnTarget(location, previous.target, pms),
        }
      : undefined
  return {
    to,
    state: {
      workflowReturn: {
        scope: scope(pms),
        target,
        path: returnPath(source),
        ...(parent ? { parent } : {}),
      },
    },
  }
}

export function workflowReturnTarget(location, target, pms) {
  const saved = location.state?.workflowReturn
  if (
    !saved ||
    saved.scope !== scope(pms) ||
    saved.target !== target ||
    typeof saved.path !== 'string' ||
    saved.path.length > 2048
  )
    return null
  const [pathname, search = ''] = saved.path.split('?')
  return returnPath({ pathname, search })
}

export function workflowReturnState(location, target, pms) {
  const parent = location.state?.workflowReturn?.parent
  if (!parent || !workflowReturnTarget(location, target, pms)) return undefined
  const path = workflowReturnTarget({ state: { workflowReturn: parent } }, parent.target, pms)
  return path ? { workflowReturn: { scope: scope(pms), target: parent.target, path } } : undefined
}
