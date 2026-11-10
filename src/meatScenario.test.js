import { consumeReserved } from './testFixtures/consumeReserved.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedLegacyMeatState } from './testFixtures/legacyMeatState.js';
import {
  seedState,
  transition,
  recipeOf,
  operationOf,
  operationsOf,
  defaultValues,
  scaledQty,
  validateProcess,
  isOrderBlocked,
  descendantOrders,
} from './domain.js';
import { DEMO_SELECTION_KEY, demoOf, loadDemo, saveDemo, switchDemo } from './demoStorage.js';
import { processLineError, resourcePath } from './resources.js';
import { validateOperationDraft } from './processEditing.js';

const storage = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    data,
  };
};
const valuesFor = (order) =>
  Object.fromEntries(
    operationOf(order).parameters.map((p) => [
      p.id,
      p.type === 'boolean' ? true : p.type === 'text' ? 'ДЕМО-221026' : defaultValues(order)[p.id],
    ]),
  );

const advance = (state, id, extra = {}) =>
  transition(consumeReserved(state, id), {
    type: 'advance',
    orderId: id,
    values: valuesFor(state.orders.find((o) => o.id === id)),
    ...extra,
  });
const finish = (state, id) => {
  let order = state.orders.find((o) => o.id === id);
  if (order.status === 'planned') state = transition(state, { type: 'reserve', orderId: id });
  order = state.orders.find((o) => o.id === id);
  if (order.status === 'ready') state = transition(state, { type: 'start', orderId: id });
  if (order.status === 'hold') state = transition(state, { type: 'resume', orderId: id });
  while (state.orders.find((o) => o.id === id).status !== 'completed') {
    if (['queued', 'waiting'].includes(state.orders.find((o) => o.id === id).status))
      state = transition(state, { type: 'startOperation', orderId: id });
    state = advance(state, id);
  }
  return state;
};

test('meat demo has compatible routes, separate resources, reconciled mass and no dairy materials', () => {
  const state = seedLegacyMeatState();
  assert.equal(state.processes.length, 5);
  assert.equal(state.orders.length, 8);
  assert.equal(state.lines.length, 5);
  for (const process of state.processes) {
    assert.equal(validateProcess(process, state), true);
    assert.equal(state.lines.filter((l) => !processLineError(state, process, l.id)).length, 1);
  }
  assert(!/йогурт|молоко|пастеризатор/iu.test(JSON.stringify(state)));
  const cut = state.orders.find((o) => o.id === 'order-2');
  assert.equal(
    cut.produced.reduce((sum, p) => sum + p.qty, 0),
    1956,
  );
  assert.equal(
    cut.samples.reduce((sum, s) => sum + (s.massBalance?.loss || 0), 0),
    44,
  );
  assert(cut.samples.every((s) => !s.massBalance || Math.abs(s.massBalance.difference) <= 0.01));
  assert(state.equipment.every((e) => resourcePath(state, e.id).length === 5));
});

test('all five meat processes finish and released raw products feed packing, mince and sausages', () => {
  let state = seedLegacyMeatState();
  for (const id of ['order-4', 'order-5', 'order-6', 'order-7', 'order-8'])
    state = finish(state, id);
  assert(state.orders.every((o) => o.status === 'completed'));
  assert(state.finished.some((l) => l.material === 'mince' && l.qty === 75));
  assert(state.finished.some((l) => l.material === 'sausage' && l.qty === 90));
  for (const id of ['order-2', 'order-3', 'order-4', 'order-5']) {
    assert(
      state.orders
        .find((o) => o.id === id)
        .allocations.some((a) => state.finished.some((l) => l.id === a.lotId)),
    );
  }
  assert(
    !state.orders
      .flatMap((o) => o.allocations)
      .some((a) => ['sides-q', 'sides-block', 'sides-expired'].includes(a.lotId)),
  );
});

test('joint output may exceed its own norm when other outputs compensate; mass mismatch rolls back all changes', () => {
  const state = seedLegacyMeatState();
  const order = state.orders.find((o) => o.id === 'order-6');
  assert.equal(operationOf(order).id, 'bone-ham');
  const before = JSON.stringify(state);
  assert.throws(
    () => advance(state, order.id, { outputs: { 'out-ham': 225 } }),
    /Материальный баланс/,
  );
  assert.equal(JSON.stringify(state), before);
  const next = advance(state, order.id, { outputs: { 'out-ham': 225, 'out-trim': 15 } });
  assert.equal(
    next.orders.find((o) => o.id === order.id).produced.find((p) => p.material === 'ham').qty,
    225,
  );
  const zero = advance(state, order.id, { outputs: { 'out-ham': 240, 'out-trim': 0 } });
  assert.equal(zero.orders.find((o) => o.id === order.id).samples.at(-1).massBalance.difference, 0);
});

test('temperature, veterinary gates and negative losses prevent progress while intermediate mass follows actual output', () => {
  const state = seedLegacyMeatState(),
    order = state.orders.find((o) => o.id === 'order-6');
  assert.throws(
    () => advance(state, order.id, { values: { ...valuesFor(order), temperature: 8 } }),
    /вне допуска/,
  );
  assert.throws(
    () => advance(state, order.id, { values: { ...valuesFor(order), loss: -1 } }),
    /вне допуска/,
  );
  let incoming = transition(state, {
    type: 'createOrder',
    processId: 'pork-cutting',
    qty: 220,
    line: 'cutting',
    date: '2026-10-22',
  });
  const id = incoming.orders.at(-1).id;
  // Release the line using the existing order, then check the first veterinary gate.
  incoming = finish(incoming, 'order-6');
  incoming = transition(incoming, { type: 'reserve', orderId: id });
  incoming = transition(incoming, { type: 'start', orderId: id });
  const gate = incoming.orders.find((o) => o.id === id);
  assert.throws(
    () => advance(incoming, id, { values: { ...valuesFor(gate), vet: '' } }),
    /Заполните/,
  );
  incoming = advance(incoming, id);
  incoming = transition(incoming, { type: 'startOperation', orderId: id });
  incoming = advance(incoming, id, {
    values: { ...valuesFor(incoming.orders.find((o) => o.id === id)), loss: 1 },
    outputs: { 'out-weighed-sides': 999 },
  });
  incoming = transition(incoming, { type: 'startOperation', orderId: id });
  const current = incoming.orders.find((o) => o.id === id);
  assert.equal(current.operationExecution.inputs[0].qty, 999);
});

test('product-specific shelf life survives snapshots; repacking cannot renew expiry or fabricate a location', () => {
  const state = seedLegacyMeatState();
  assert.equal(state.finished.find((l) => l.material === 'offal').expires, '2026-10-23');
  assert.equal(state.finished.find((l) => l.material === 'pork-sides').expires, '2026-10-25');
  assert.equal(state.finished.find((l) => l.material === 'packed-pork').expires, '2026-10-25');
  assert(state.finished.every((l) => !Object.hasOwn(l, 'location')));
  const sausage = finish(state, 'order-5');
  assert(sausage.finished.every((l) => !Object.hasOwn(l, 'location')));
});

test('raw lot recall propagates through slaughter, cutting, packaging, mince and sausage', () => {
  let state = seedLegacyMeatState();
  const source = state.lots.find((l) => l.material === 'live-pork');
  state = transition(state, { type: 'blockLot', lotId: source.id });
  const descendants = descendantOrders(state, source.id);
  for (const id of ['order-1', 'order-2', 'order-3', 'order-4', 'order-5']) {
    assert(descendants.some((o) => o.id === id));
    assert(
      isOrderBlocked(
        state,
        state.orders.find((o) => o.id === id),
      ),
    );
  }
  const packed = state.finished.find((l) => l.material === 'packed-pork');
  assert.throws(
    () =>
      transition(state, { type: 'ship', lotId: packed.id, qty: 1, customerId: 'party-crossroads' }),
    /заблокировано|заблокирована/,
  );
});

test('publishing and operation editing reject broken mass definitions and invalid per-output shelf life', () => {
  const state = seedLegacyMeatState();
  const p = structuredClone(state.processes.find((p) => p.id === 'pork-cutting'));
  p.operations[3].outputs[0].qty += 10;
  assert.throws(() => validateProcess(p, state), /Материальный баланс/);
  assert.throws(
    () => validateOperationDraft(p.operations[3], state, 'class'),
    /Материальный баланс/,
  );
  const op = structuredClone(state.processes[0].operations[1]);
  op.outputs[1].shelf = 0;
  assert.throws(() => validateOperationDraft(op, state, 'class'), /Срок годности/);
});

test('switching retains legacy dairy key, all changes in each scenario and selected scenario across reloads', () => {
  const db = storage();
  const dairy = seedState();
  delete dairy.scenarioId;
  dairy.materials[0].name = 'Изменённое молочное сырьё';
  db.setItem(demoOf('dairy').key, JSON.stringify(dairy));
  const loaded = loadDemo(db, 'dairy');
  let meat = switchDemo(db, loaded, 'agro');
  meat.materials[0].name = 'Изменённое мясное сырьё';
  const restored = switchDemo(db, meat, 'dairy');
  assert.equal(restored.materials[0].name, dairy.materials[0].name);
  meat = switchDemo(db, restored, 'agro');
  assert.equal(meat.materials[0].name, 'Изменённое мясное сырьё');
  assert.equal(db.getItem(DEMO_SELECTION_KEY), 'agro');
  assert.equal(
    loadDemo(db, db.getItem(DEMO_SELECTION_KEY)).materials[0].name,
    meat.materials[0].name,
  );
  const dairySaved = db.getItem(demoOf('dairy').key);
  saveDemo(db, seedState('agro'));
  assert.equal(db.getItem(demoOf('dairy').key), dairySaved);
});

test('corrupt target or storage failure cannot replace saved source or change active demo', () => {
  const db = storage(),
    dairy = seedState();
  saveDemo(db, dairy);
  db.setItem(DEMO_SELECTION_KEY, 'dairy');
  const original = db.getItem(demoOf('dairy').key);
  for (const broken of ['{broken', '{"orders":[],"version":3}']) {
    db.setItem(demoOf('agro').key, broken);
    assert.throws(() => switchDemo(db, dairy, 'agro'));
    assert.equal(db.getItem(demoOf('dairy').key), original);
    assert.equal(db.getItem(demoOf('agro').key), broken);
    assert.equal(db.getItem(DEMO_SELECTION_KEY), 'dairy');
  }
  const failed = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
  };
  assert.throws(() => switchDemo(failed, dairy, 'agro'), /quota/);
});
