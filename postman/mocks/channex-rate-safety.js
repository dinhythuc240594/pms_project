// Synthetic ARI contract: https://docs.channex.io/api-v.1-documentation/ari
// Process-local state only; no guest records, credentials or upstream calls.
const http = require('node:http');
const id = number => `00000000-0000-0000-0000-${number.toString(16).padStart(12, '0')}`;
const states = new Map();
http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const [scenario, api, version, resource, action] = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
  if (!['ok', 'rate_fail', 'stale_rate', 'close_fail'].includes(scenario) || api !== 'api' || version !== 'v1') return send(501, { errors: { code: 'unmodeled_endpoint' } });
  if (req.headers['user-api-key'] !== 'fixture-api-key') return send(401, { errors: { code: 'unauthorized' } });
  if (!states.has(scenario)) states.set(scenario, { events: [], availability: {}, restrictions: {} });
  const state = states.get(scenario);
  if (resource === '_test') {
    if (req.method === 'POST' && action === 'reset') {
      states.delete(scenario);
      return send(200, { meta: { message: 'Success' } });
    }
    if (req.method === 'GET' && action === 'state') return send(200, { data: state });
  }
  state.events.push(`${req.method} ${resource}`);
  if (req.method === 'GET' && ['room_types', 'rate_plans'].includes(resource)) {
    const room = resource === 'room_types';
    return send(200, { data: [{
      id: id(room ? 2 : 3), type: room ? 'room_type' : 'rate_plan',
      attributes: room ? { title: 'Standard' } : { title: 'Manual', currency: 'VND', sell_mode: 'per_room', rate_mode: 'manual', inherit_rate: false },
      relationships: { property: { data: { id: id(1) } }, ...(!room ? { room_type: { data: { id: id(2) } } } : {}) },
    }], meta: { total: 1 } });
  }
  if (req.method === 'POST' && ['availability', 'restrictions'].includes(resource)) {
    let body = '';
    for await (const part of req) body += part;
    let values;
    try { values = JSON.parse(body).values; } catch { return send(400, { errors: { code: 'invalid_json' } }); }
    if (!Array.isArray(values) || !values.length || values.some(value => value.property_id !== id(1) || !value.date)) return send(400, { errors: { code: 'invalid_values' } });
    if ((scenario === 'rate_fail' && resource === 'restrictions') || (scenario === 'close_fail' && resource === 'availability')) return send(503, { errors: { code: 'unavailable' } });
    for (const value of values) {
      const key = resource === 'availability' ? value.room_type_id : value.rate_plan_id;
      const target = state[resource];
      target[key] ||= {};
      target[key][value.date] = resource === 'availability' ? value.availability : { rate: value.rate, stop_sell: value.stop_sell };
    }
    return send(200, { data: [{ id: id(10), type: 'task' }], meta: { message: 'Success', warnings: [] } });
  }
  if (req.method === 'GET' && ['availability', 'restrictions'].includes(resource)) {
    const data = structuredClone(state[resource]);
    if (scenario === 'stale_rate' && resource === 'restrictions') {
      for (const dates of Object.values(data)) for (const value of Object.values(dates)) value.rate = '1';
    }
    return send(200, { data });
  }
  return send(501, { errors: { code: 'unmodeled_endpoint' } });
}).listen(process.env.PORT, '127.0.0.1');
