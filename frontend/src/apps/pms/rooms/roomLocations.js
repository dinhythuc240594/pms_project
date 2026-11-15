const locationCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function roomLocationValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Empty string means all locations. JSON distinguishes unassigned values from
// configured names such as "null", and keeps delimiter characters collision safe.
export function roomLocationFilterValue(value) {
  return JSON.stringify(roomLocationValue(value));
}

function compareLocationValues(left, right) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return locationCollator.compare(left, right) || left.localeCompare(right);
}

export function roomLocationOptions(rooms, field) {
  return [...new Set(rooms.map(room => roomLocationValue(room[field])))]
    .sort(compareLocationValues)
    .map(value => ({ value, filterValue: roomLocationFilterValue(value) }));
}

export function matchesRoomLocationFilters(room, { area = '', floor = '' } = {}) {
  return (!area || roomLocationFilterValue(room.area) === area)
    && (!floor || roomLocationFilterValue(room.floor) === floor);
}

export function groupRoomsByLocation(rooms) {
  const groups = new Map();
  for (const room of rooms) {
    const area = roomLocationValue(room.area);
    const floor = roomLocationValue(room.floor);
    const key = JSON.stringify([area, floor]);
    if (!groups.has(key)) groups.set(key, { key, area, floor, rooms: [] });
    groups.get(key).rooms.push(room);
  }
  return [...groups.values()]
    .sort((left, right) => compareLocationValues(left.area, right.area) || compareLocationValues(left.floor, right.floor))
    .map(group => ({
      ...group,
      rooms: group.rooms.toSorted((left, right) => compareLocationValues(String(left.number ?? left.id), String(right.number ?? right.id))),
    }));
}
