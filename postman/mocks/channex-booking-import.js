// Contract: https://docs.channex.io/api-v.1-documentation/bookings-collection
// Synthetic cancellation cases only; no live keys, guests or upstream calls.
const http = require('node:http');
const id = number => `00000000-0000-0000-0000-${number.toString(16).padStart(12, '0')}`;
const revisions = new Map([
  [12, { booking: 4, property: 1 }], [14, { booking: 4, property: 1 }],
  [22, { booking: 404, property: 1 }], [24, { booking: 404, property: 99 }],
  [32, { booking: 500, property: 1 }],
]);
http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers['user-api-key'] !== 'fixture-api-key') return send(401, { errors: { code: 'unauthorized' } });
  const parts = new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean);
  const [api, version, resource, key, action] = parts;
  if (api !== 'api' || version !== 'v1') return send(501, { errors: { code: 'unmodeled_endpoint' } });
  if (req.method === 'GET' && resource === 'bookings') {
    if (key === id(500)) return send(503, { errors: { code: 'unavailable' } });
    const latest = key === id(4) ? 14 : key === id(404) ? 24 : null;
    return latest ? send(200, { data: { id: key, type: 'booking', attributes: { status: 'cancelled', revision_id: id(latest) } } }) : send(404, { errors: { code: 'not_found' } });
  }
  if (resource === 'booking_revisions') {
    const number = [...revisions.keys()].find(number => id(number) === key);
    if (number === undefined) return send(404, { errors: { code: 'not_found' } });
    if (req.method === 'POST' && action === 'ack') return send(200, { meta: { message: 'Success' } });
    if (req.method === 'GET' && !action) {
      const entry = revisions.get(number);
      return send(200, { data: { id: key, type: 'booking_revision', attributes: {
        booking_id: id(entry.booking), property_id: id(entry.property), status: 'cancelled',
        inserted_at: `2026-10-07T00:00:${number}Z`,
      } } });
    }
  }
  return send(501, { errors: { code: 'unmodeled_endpoint' } });
}).listen(process.env.PORT, '127.0.0.1');
