import { dateRangeParams } from '../../../shared/lib/dateRangeQuery.js';

export const channelHistoryFilters = { status: '', kind: '', revisionId: '', dateFrom: '', dateTo: '' };

function normalizeFilters(filters) {
  return Object.fromEntries(Object.keys(channelHistoryFilters).map(key => [key, String(filters[key] || '').trim()]));
}

export function createChannelHistory() {
  return { filters: { ...channelHistoryFilters }, cursors: [null], index: 0, revision: 0 };
}

export function channelHistoryReducer(state, action) {
  if (action.type === 'filter' || action.type === 'refresh') {
    return { filters: action.type === 'filter' ? normalizeFilters(action.filters) : state.filters, cursors: [null], index: 0, revision: state.revision + 1 };
  }
  if (action.type === 'next' && action.index === state.index && action.currentCursor && action.nextCursor) {
    const cursors = state.cursors.slice(0, state.index + 1);
    cursors[state.index] = action.currentCursor;
    return { ...state, cursors: [...cursors, action.nextCursor], index: state.index + 1 };
  }
  if (action.type === 'previous' && state.index > 0) return { ...state, index: state.index - 1 };
  return state;
}

export function channelHistoryPath(state) {
  const params = dateRangeParams({ pageSize: '25', ...state.filters }, { startKey: 'dateFrom', endKey: 'dateTo' });
  if (state.cursors[state.index]) params.set('cursor', state.cursors[state.index]);
  return `/channels/jobs?${params}`;
}
