import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRoomsByLocation, matchesRoomLocationFilters, roomLocationFilterValue, roomLocationOptions } from './roomLocations.js';

test('floor and area grouping uses configured metadata without inferring room number prefixes', () => {
  const rooms = [
    { id: '1001', floor: '10', area: 'Main' },
    { id: 'A101', floor: '1', area: 'Villa-A' },
    { id: 'Villa-A', floor: '1', area: 'Villa-A' },
    { id: 'B101', floor: '1', area: 'Villa-B' },
  ];
  const groups = groupRoomsByLocation(rooms);
  assert.deepEqual(groups.map(({ area, floor, rooms: members }) => [area, floor, members.map(room => room.id)]), [
    ['Main', '10', ['1001']],
    ['Villa-A', '1', ['A101', 'Villa-A']],
    ['Villa-B', '1', ['B101']],
  ]);
  assert.equal(groups[0].rooms[0], rooms[0]);
  assert.deepEqual(rooms.map(room => room.id), ['1001', 'A101', 'Villa-A', 'B101']);
});

test('missing and blank metadata have distinct unassigned groups and filters', () => {
  const rooms = [{ id: '1001' }, { id: 'A101', area: 'Villa-A' }, { id: '101', floor: '1' }, { id: '102', floor: ' ', area: null }];
  const groups = groupRoomsByLocation(rooms);
  assert.deepEqual(groups.map(({ area, floor, rooms: members }) => [area, floor, members.map(room => room.id)]), [
    ['Villa-A', null, ['A101']],
    [null, '1', ['101']],
    [null, null, ['102', '1001']],
  ]);
  assert.deepEqual(rooms.filter(room => matchesRoomLocationFilters(room, { floor: roomLocationFilterValue(null) })).map(room => room.id), ['1001', 'A101', '102']);
  assert.deepEqual(rooms.filter(room => matchesRoomLocationFilters(room, { area: roomLocationFilterValue(null), floor: roomLocationFilterValue(null) })).map(room => room.id), ['1001', '102']);
  assert.ok(rooms.every(room => matchesRoomLocationFilters(room)));
});

test('area and floor filters are independent and combined as an intersection', () => {
  const rooms = [{ id: 'A101', area: 'Villa-A', floor: '1' }, { id: 'B101', area: 'Villa-B', floor: '1' }, { id: 'A1001', area: 'Villa-A', floor: '10' }];
  const area = roomLocationFilterValue('Villa-A');
  const floor = roomLocationFilterValue('1');
  assert.deepEqual(rooms.filter(room => matchesRoomLocationFilters(room, { floor })).map(room => room.id), ['A101', 'B101']);
  assert.deepEqual(rooms.filter(room => matchesRoomLocationFilters(room, { area })).map(room => room.id), ['A101', 'A1001']);
  assert.deepEqual(rooms.filter(room => matchesRoomLocationFilters(room, { area, floor })).map(room => room.id), ['A101']);
});

test('configured sentinel-like values and delimiter characters cannot collide', () => {
  const rooms = [
    { id: '1', area: 'null', floor: 'null' },
    { id: '2', area: null, floor: null },
    { id: '3', area: 'A|B', floor: 'C' },
    { id: '4', area: 'A', floor: 'B|C' },
    { id: '5', area: '["A",null]', floor: '"quoted"' },
  ];
  const groups = groupRoomsByLocation(rooms);
  assert.equal(groups.length, 5);
  assert.equal(new Set(groups.map(group => group.key)).size, 5);
  assert.deepEqual(rooms.filter(room => matchesRoomLocationFilters(room, { floor: roomLocationFilterValue('null') })).map(room => room.id), ['1']);
  assert.deepEqual(rooms.filter(room => matchesRoomLocationFilters(room, { floor: roomLocationFilterValue(null) })).map(room => room.id), ['2']);
});

test('groups, filter choices and rooms sort naturally with unassigned locations last', () => {
  const rooms = [
    { id: 'A100', area: 'Villa-10', floor: '10' },
    { id: 'A10', area: 'Villa-2', floor: '2' },
    { id: 'A2', area: 'Villa-2', floor: '2' },
    { id: 'A1', area: 'Villa-2', floor: '10' },
    { id: 'unassigned' },
  ];
  assert.deepEqual(roomLocationOptions(rooms, 'area').map(option => option.value), ['Villa-2', 'Villa-10', null]);
  assert.deepEqual(roomLocationOptions(rooms, 'floor').map(option => option.value), ['2', '10', null]);
  assert.deepEqual(groupRoomsByLocation(rooms).map(group => group.rooms.map(room => room.id)), [['A2', 'A10'], ['A1'], ['A100'], ['unassigned']]);
});
