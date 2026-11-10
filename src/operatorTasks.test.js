import { consumeReserved } from './testFixtures/consumeReserved.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedLegacyMeatState } from './testFixtures/legacyMeatState.js';
import { transition, operationOf, defaultValues, migrateState, occupancy } from './domain.js';
import { operatorTasks, operationTaskId, qualityPending } from './operatorTasks.js';

const orderOf = (state, id) => state.orders.find((o) => o.id === id);
const record = (state, id) => {
  state = consumeReserved(state, id);
  const order = orderOf(state, id),
    values = defaultValues(order);
  for (const p of operationOf(order).parameters) {
    if (p.type === 'boolean') values[p.id] = true;
    if (p.type === 'text') values[p.id] = 'ТЕСТ-01';
  }
  return transition(state, {
    type: 'advance',
    orderId: id,
    operationId: operationOf(order).id,
    values,
  });
};

test('completion releases exactly one next task at its work unit without starting or consuming it', () => {
  const original = seedLegacyMeatState(),
    id = 'order-4';
  const originalTask = operatorTasks(original).find((t) => t.order.id === id && !t.sample);
  const traysBefore = original.lots.find((l) => l.material === 'tray').qty;
  const state = record(original, id),
    order = orderOf(state, id);
  assert.equal(order.status, 'queued');
  assert.equal(operationOf(order).id, 'pack');
  assert.equal(order.wip['mixed-mince'], 75);
  assert.equal(state.lots.find((l) => l.material === 'tray').qty, traysBefore);
  assert(order.allocations.filter((a) => a.material === 'tray').every((a) => !a.consumed));
  assert.equal(order.operationExecution, undefined);
  const current = operatorTasks(state).filter((t) => t.order.id === id && !t.sample);
  assert.equal(current.length, 1);
  assert.equal(current[0].operation.id, 'pack');
  assert.notEqual(current[0].workplace, originalTask.workplace);
  assert(operatorTasks(state).some((t) => t.id === originalTask.id && t.sample));
  assert.throws(() => record(state, id), /не находится в исполнении/);
  assert.equal(orderOf(original, id).status, 'running');
});

test('start leaves stock reserved, explicit consumption deducts once and pause/resume retain it', () => {
  let state = record(seedLegacyMeatState(), 'order-4');
  const id = 'order-4',
    opId = operationOf(orderOf(state, id)).id;
  const before = state.lots.find((l) => l.material === 'tray').qty;
  const action = (type) => ({ type, orderId: id, operationId: opId });
  state = transition(state, action('startOperation'));
  const started = orderOf(state, id).operationExecution.startedAt;
  assert.equal(orderOf(state, id).wip['mixed-mince'], 0);
  assert.equal(state.lots.find((l) => l.material === 'tray').qty, before);
  state = consumeReserved(state, id);
  assert.equal(state.lots.find((l) => l.material === 'tray').qty, before - 150);
  assert.throws(() => transition(state, action('startOperation')), /не готова/);
  state = transition(state, { ...action('pause'), reason: 'Проверка шва' });
  assert.throws(() => record(state, id), /не находится/);
  state = migrateState(JSON.parse(JSON.stringify(state)));
  state = transition(state, action('resume'));
  assert.equal(orderOf(state, id).operationExecution.startedAt, started);
  assert.equal(state.lots.find((l) => l.material === 'tray').qty, before - 150);
  state = record(state, id);
  const sample = orderOf(state, id).samples.at(-1);
  assert.equal(sample.execution.startedAt, started);
  assert.equal(sample.execution.pauses[0].reason, 'Проверка шва');
  assert(sample.execution.pauses[0].endedAt);
});

test('operator queue contains production only, excludes future and unreserved operations, and retains per-operation history', () => {
  const state = seedLegacyMeatState(),
    tasks = operatorTasks(state);
  assert(tasks.every((t) => t.operation.kind === 'production'));
  assert(!tasks.some((t) => t.order.id === 'order-8'));
  assert(!tasks.some((t) => t.order.id === 'order-7')); // first stage is a quality gate
  assert(!tasks.some((t) => t.order.id === 'order-6' && t.operation.id === 'bone-shoulder'));
  assert(tasks.filter((t) => t.order.id === 'order-2').every((t) => t.sample));
  assert(new Set(tasks.map((t) => t.id)).size === tasks.length);
  assert(
    tasks
      .filter((t) => t.workplace === 'cutting-deboning' && !t.sample)
      .every((t) => t.operation.equipmentId === 'cutting-deboning'),
  );
});

test('stale commands cannot act on the next operation after a handoff', () => {
  const original = seedLegacyMeatState(),
    id = 'order-4',
    previous = operationOf(orderOf(original, id)).id;
  const state = record(original, id),
    snapshot = JSON.stringify(state);
  for (const type of ['startOperation', 'advance', 'pause', 'resume']) {
    assert.throws(
      () => transition(state, { type, orderId: id, operationId: previous, reason: 'Стоп' }),
      /Операция уже сменилась/,
    );
    assert.equal(JSON.stringify(state), snapshot);
  }
});

test('quality gate has its own explicit start and releases production to a different queue', () => {
  let state = seedLegacyMeatState(),
    id = 'order-7';
  assert(qualityPending(orderOf(state, id)));
  assert(!operatorTasks(state).some((t) => t.order.id === id));
  state = transition(state, { type: 'startOperation', orderId: id, operationId: 'admission' });
  assert.equal(orderOf(state, id).status, 'quality');
  state = record(state, id);
  assert.equal(orderOf(state, id).status, 'queued');
  assert(!qualityPending(orderOf(state, id)));
  const task = operatorTasks(state).find((t) => t.order.id === id && !t.sample);
  assert.equal(task.operation.id, 'portion');
  assert.equal(task.workplace, 'packing-portioner');
});

test('manual operations remain assigned to their own line and old active saves continue without recounting material', () => {
  let state = seedLegacyMeatState(),
    id = 'order-4';
  const order = orderOf(state, id);
  const count = order.allocations.filter((a) => a.consumed).length;
  delete order.operationExecution;
  operationOf(order).equipmentId = '';
  operationOf(order).equipment = '';
  state = migrateState(JSON.parse(JSON.stringify(state)));
  const task = operatorTasks(state).find(
    (t) => t.id === operationTaskId(order, operationOf(order)),
  );
  assert.equal(task.workplace, 'manual:mince');
  assert.equal(orderOf(state, id).allocations.filter((a) => a.consumed).length, count);
  state = record(state, id);
  assert.equal(orderOf(state, id).status, 'queued');
});

test('a final quality gate frees the production line while keeping stock unreleased until control completes', () => {
  let state = seedLegacyMeatState(),
    id = 'order-4';
  state = record(state, id); // mixture completed
  state = transition(state, { type: 'startOperation', orderId: id });
  state = record(state, id); // packaging completed
  state = transition(state, { type: 'startOperation', orderId: id });
  state = record(state, id); // detector completed
  assert(qualityPending(orderOf(state, id)));
  assert.equal(orderOf(state, id).status, 'queued');
  assert.equal(occupancy(orderOf(state, id)), false);
  assert(!state.finished.some((l) => l.orderId === id));
  state = transition(state, { type: 'startOperation', orderId: id });
  state = record(state, id);
  assert(state.finished.some((l) => l.orderId === id));
});
