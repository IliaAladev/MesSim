import { confirmCarcassIdentity } from './testFixtures/confirmCarcassIdentity.js';
import { consumeReserved } from './testFixtures/consumeReserved.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultValues,
  operationOf,
  recipeOf,
  seedState,
  transition,
  upstreamLots,
  orderSupply,
  operationInputQty,
  scaledQty,
  reservationLots,
  stockBalance,
  operationMaterialAvailability,
} from './domain.js';
import { demoOf, loadDemo } from './demoStorage.js';

const orderId = (number) => `order-${number}`;
const order = (state, number) => state.orders.find((item) => item.id === orderId(number));
const act = (state, type, number, extra) =>
  transition(state, { type, orderId: orderId(number), ...extra });
const receive = (state, qty = 365, heads = 3) =>
  transition(state, {
    type: 'receiveLot',
    material: 'live',
    supplierId: 'party-north',
    qty,
    heads,
    declaredWeight: 370,
    document: 'ТС-041',
  });
const admit = (state) => transition(state, { type: 'releaseLot', lotId: state.lots[0].id });
const complete = (state, number, values = {}, outputs) => {
  const current = order(state, number);
  const defaults = defaultValues(current);
  for (const parameter of operationOf(current).parameters) {
    if (parameter.type === 'boolean') defaults[parameter.id] = true;
  }
  return act(
    confirmCarcassIdentity(
      consumeReserved(act(state, 'startOperation', number), orderId(number)),
      orderId(number),
      values.rfid,
    ),
    'advance',
    number,
    {
      values: Object.fromEntries(
        Object.entries({ ...defaults, ...values }).filter(
          ([key]) => key !== 'mark' && key !== 'rfid',
        ),
      ),
      outputs,
    },
  );
};

test('live arrival starts the production chain, isolates one carcass and traces the pallet and CTP output to the farm', () => {
  let state = seedState('agro');
  assert.equal(
    state.lots.some((lot) => lot.material === 'live'),
    false,
  );
  assert.equal(
    state.orders.every(
      (item) =>
        item.status === 'planned' &&
        recipeOf(item).revision ===
          state.processes.find((process) => process.id === item.recipe).revision,
    ),
    true,
  );
  assert.throws(() => act(state, 'reserve', 1), /Недостаточно/);

  state = receive(state, 368);
  const liveId = state.lots[0].id;
  assert.equal(state.lots[0].livestock.heads, 3);
  assert.throws(() => act(state, 'reserve', 1), /Недостаточно/);
  state = act(admit(state), 'reserve', 1);
  assert.equal(state.lots[0].reserved, 368);
  assert.equal(state.lots[0].location, 'ЗПС');
  state = complete(state, 1, {}, { 'out-slaughter-waste': 37 });
  assert.equal(state.lots[0].qty, 0);
  assert.equal(order(state, 1).samples[0].massBalance.input, 368);

  const carcasses = state.finished.filter((item) => item.material === 'warm').reverse();
  assert.equal(carcasses.length, 3);
  assert.throws(() => act(state, 'reserve', 2), /конкретную партию/);
  const reserveCarcass = (state, number) =>
    act(state, 'reserve', number, {
      lotChoices: { 'rfid/in-warm': carcasses[number - 2].id },
    });
  state = complete(reserveCarcass(state, 2), 2, { rfid: 'R-821' });
  state = complete(state, 2, { vet: 'В-01' });
  state = complete(state, 2, { mark: 'УБ-26-000001' });
  state = complete(state, 2);
  assert.equal(order(state, 2).samples.at(-1).massBalance.loss, 1.2);

  state = complete(reserveCarcass(state, 3), 3, { rfid: 'R-822' });
  state = act(act(state, 'startOperation', 3), 'referInspection', 3, {
    reason: 'Повторный осмотр',
  });
  assert.equal(order(state, 3).status, 'reinspection');
  assert.throws(() => act(state, 'advance', 3), /не находится/);
  assert.equal(
    state.finished.some((item) => item.orderId === orderId(3)),
    false,
  );

  state = complete(reserveCarcass(state, 4), 4, { rfid: 'R-823' });
  state = complete(state, 4, { vet: 'В-03' });
  const grade = act(state, 'startOperation', 4);
  assert.throws(
    () => act(grade, 'advance', 4, { values: { mark: 'УБ-26-000001', lean: 57 } }),
    /назначает MES/,
  );
  state = complete(state, 4, { mark: 'УБ-26-000003', lean: 56 });
  state = complete(state, 4);

  const selectCold = (state, number, mark, input) =>
    act(state, 'reserve', number, {
      lotChoices: { [input]: state.finished.find((item) => item.mark === mark).id },
    });
  state = complete(selectCold(state, 5, 'УБ-26-000001', 'cut/in-cold'), 5);
  state = complete(state, 5);
  state = complete(selectCold(state, 6, 'УБ-26-000003', 'sale/in-cold'), 6);
  state = complete(act(state, 'reserve', 7), 7);
  state = complete(state, 7);
  const pallet = state.finished.find((item) => item.material === 'pallet');
  const ship = (state, qty = 20) =>
    transition(state, { type: 'ship', lotId: pallet.id, qty, customerId: 'party-crossroads' });
  assert.equal(pallet.status, 'inTransit');
  assert.throws(() => ship(state), /не принята/);
  state = transition(state, { type: 'acceptWarehouse', lotId: pallet.id });
  assert.throws(
    () => transition(state, { type: 'acceptWarehouse', lotId: pallet.id }),
    /не ожидает/,
  );
  assert.equal(ship(state).shipments[0].qty, 20);
  state = ship(state, 8);
  assert.equal(state.finished.find((lot) => lot.id === pallet.id).remaining, 12);
  state = ship(state, 12);
  assert.equal(state.finished.find((lot) => lot.id === pallet.id).remaining, 0);
  assert.equal(state.shipments.filter((row) => row.lotId === pallet.id).length, 2);
  assert.equal(
    state.shipments.reduce((sum, row) => sum + row.qty, 0),
    20,
  );
  assert.ok(upstreamLots(state, order(state, 7)).some((lot) => lot.material === 'live'));

  state = complete(act(state, 'reserve', 8), 8);
  state = complete(state, 8);
  for (const [number, mark] of [
    [6, 'УБ-26-000003'],
    [7, 'УБ-26-000001'],
    [8, 'УБ-26-000001'],
  ]) {
    const origin = upstreamLots(state, order(state, number));
    assert.deepEqual(
      [...new Set(origin.filter((item) => item.mark).map((item) => item.mark))],
      [mark],
    );
    assert.ok(origin.some((item) => item.id === liveId));
  }
  assert.equal(state.finished.find((item) => item.material === 'meal').qty, 5.3);
  assert.equal(state.finished.find((item) => item.material === 'tech-fat').qty, 3.2);
});

test('livestock count must match the configured individual outputs and legacy demo data is bypassed', () => {
  const previous = 'food-mes-meat-v1';
  const disk = { getItem: (key) => (key === previous ? '{legacy}' : null) };
  assert.equal(demoOf('meat').id, 'agro');
  const state = admit(receive(loadDemo(disk, 'meat'), 365, 4));
  assert.throws(() => act(state, 'reserve', 1), /4 гол.*3/);
  assert.equal(state.lots[0].reserved, 0);
});

function beforeDeboning(cutOutputs) {
  let state = act(admit(receive(seedState('agro'))), 'reserve', 1);
  state = complete(state, 1);
  const warm = state.finished.find((lot) => lot.material === 'warm');
  state = act(state, 'reserve', 2, { lotChoices: { 'rfid/in-warm': warm.id } });
  state = complete(state, 2, { rfid: 'R-821' });
  state = complete(state, 2, { vet: 'V-1' });
  state = complete(state, 2, { mark: 'C-1' });
  state = complete(state, 2);
  state = act(state, 'reserve', 5);
  return complete(state, 5, { loss: '' }, cutOutputs);
}

test('actual losses of 1.5, zero and nonzero intermediate losses follow factual masses through the route', () => {
  const state = beforeDeboning();
  for (const [loss, meat] of [
    [1.5, 64.7],
    [0, 66.2],
  ]) {
    const next = complete(state, 5, { loss: '' }, { 'out-meat': meat });
    const sample = order(next, 5).samples.at(-1);
    assert.equal(sample.values.loss, loss);
    assert.equal(sample.massBalance.loss, loss);
    assert.equal(sample.massBalance.difference, 0);
  }
  let changed = beforeDeboning({ 'out-front': 29 });
  assert.equal(order(changed, 5).samples[0].values.loss, 1);
  const nextOp = operationOf(order(changed, 5));
  assert.equal(operationInputQty(nextOp.inputs[0], order(changed, 5), nextOp), 29);
  changed = complete(changed, 5, { loss: '' }, { 'out-meat': 64.1 });
  assert.equal(order(changed, 5).samples.at(-1).massBalance.input, 97.8);
  assert.equal(order(changed, 5).samples.at(-1).massBalance.loss, 1.1);
  assert.equal(
    Object.values(order(changed, 5).wip).reduce((a, b) => a + b, 0),
    0,
  );
  changed = act(changed, 'reserve', 7);
  changed = complete(changed, 7, { loss: '' }, { 'out-mix': 19 });
  const packed = complete(changed, 7, { loss: '' }, { 'out-pallet': 18.5 });
  const record = order(packed, 7).samples.at(-1);
  assert.equal(record.massBalance.input, 19);
  assert.equal(record.massBalance.loss, 0.5);
  assert.equal(record.inputs.find((item) => item.material === 'mix').qty, 19);
});

test('legacy completed cutting remains factual and a short mince order can be resized and reserved atomically', () => {
  let state = complete(beforeDeboning(), 5, {}, { 'out-meat': 65, 'out-trim': 15.4 });
  delete state.agroCatalogRevision;
  const cut = state.processes.find((process) => process.id === 'cutting');
  cut.baseQty = 65;
  cut.revision = 1;
  for (const row of cut.operations[1].outputs) {
    if (row.material === 'meat') row.qty = 65;
    if (row.material === 'trim') row.qty = 15.4;
  }
  const snapshot = recipeOf(order(state, 5));
  snapshot.baseQty = 65;
  snapshot.revision = 1;
  snapshot.operations[1].outputs.find((item) => item.material === 'meat').qty = 65;
  snapshot.operations[1].outputs.find((item) => item.material === 'trim').qty = 15.4;
  state = transition(state, {
    type: 'createOrder',
    processId: 'cutting',
    qty: 65,
    line: 'cutting',
    date: '2026-10-22',
  });
  const untouched = JSON.parse(JSON.stringify(order(state, 5)));
  const inventory = JSON.parse(JSON.stringify(state.finished));
  const storage = { getItem: () => JSON.stringify(state) };
  const loaded = loadDemo(storage, 'agro');
  assert.deepEqual(order(loaded, 5), untouched);
  assert.deepEqual(loaded.finished, inventory);
  assert.equal(loaded.processes.find((item) => item.id === 'cutting').revision, 2);
  assert.equal(order(loaded, 9).qty, 64.4);
  assert.equal(recipeOf(order(loaded, 9)).revision, 2);
  assert.deepEqual(loadDemo({ getItem: () => JSON.stringify(loaded) }, 'agro'), loaded);

  const supply = orderSupply(loaded, order(loaded, 7));
  assert.equal(supply.rows.find((row) => row.material === 'trim').shortage, 0.6);
  assert.equal(supply.maxQty, 19.2);
  const before = JSON.stringify(loaded);
  assert.throws(() => act(loaded, 'reserve', 7), /не хватает 0.6/);
  assert.equal(JSON.stringify(loaded), before);
  state = act(loaded, 'resizeOrder', 7, { qty: supply.maxQty });
  state = act(state, 'reserve', 7);
  assert.equal(order(state, 7).allocations.find((item) => item.material === 'trim').qty, 15.36);
  assert.equal(order(state, 7).allocations.find((item) => item.material === 'tray').qty, 48);
  assert.equal(order(state, 7).allocations.find((item) => item.material === 'box').qty, 5);
  assert.throws(() => act(state, 'resizeOrder', 7, { qty: 20 }), /до резервирования/);
});

test('a cooled carcass with a different actual weight can be selected after resizing the planned cutting order', () => {
  const state = beforeDeboning();
  const raw = structuredClone(state);
  const current = order(raw, 5);
  for (const allocation of current.allocations) {
    const lot = raw.finished.find((lot) => lot.id === allocation.lotId);
    lot.remaining += allocation.qty;
  }
  current.allocations = [];
  current.samples = [];
  current.wip = {};
  current.stage = 0;
  current.status = 'planned';
  const cold = raw.finished.find((lot) => lot.material === 'cold');
  cold.qty = 99.3;
  cold.remaining = 99.3;
  const input = recipeOf(current).operations[0].inputs[0];
  const qty = Math.round((99.3 / input.qty) * recipeOf(current).baseQty * 1000) / 1000;
  let resized = act(raw, 'resizeOrder', 5, { qty });
  assert.equal(scaledQty(input, order(resized, 5)), 99.3);
  resized = act(resized, 'reserve', 5);
  assert.equal(order(resized, 5).allocations[0].qty, 99.3);
});

test('default cutting, mince and rendering quantities complete without changing any factual output from its planned value', () => {
  let state = complete(beforeDeboning(), 5);
  assert.equal(
    orderSupply(state, order(state, 7)).rows.some((row) => row.shortage > 0),
    false,
  );
  state = complete(act(state, 'reserve', 7), 7);
  state = complete(state, 7);
  state = complete(act(state, 'reserve', 8), 8);
  state = complete(state, 8);
  assert.equal(order(state, 7).actual, 20);
  assert.equal(order(state, 8).actual, 5.3);
  assert.equal(state.finished.find((lot) => lot.material === 'trim').remaining, 0);
  assert.equal(state.finished.find((lot) => lot.material === 'fat').remaining, 0);
  assert.equal(state.finished.find((lot) => lot.material === 'bone').remaining, 0);
});

test('optional reservations stay on stock until an explicit operator confirmation and preserve the consumed identity', () => {
  let state = complete(beforeDeboning(), 5);
  const bone = state.finished.find((lot) => lot.material === 'bone');
  const trim = state.finished.find((lot) => lot.material === 'trim');
  const balance = bone.remaining;
  state = act(state, 'releaseToOperator', 8);
  assert.equal(order(state, 8).status, 'ready');
  assert.equal(order(state, 8).allocations.length, 0);
  const noReserve = act(state, 'startOperation', 8);
  assert.equal(order(noReserve, 8).status, 'running');
  assert.equal(noReserve.finished.find((lot) => lot.id === bone.id).remaining, balance);
  assert.throws(() => act(noReserve, 'advance', 8), /Подтвердите списание/);
  const assign = (source, rows) =>
    act(source, 'assignOperationMaterials', 8, {
      operationId: 'receive-waste',
      assignments: rows,
    });
  const row = (lotId, qty) => ({ inputId: 'in-bone', lotId, qty });
  const before = JSON.stringify(state);
  assert.throws(() => assign(state, [row(trim.id, 13)]), /не соответствует/);
  assert.throws(() => assign(state, [row(bone.id, 14)]), /превышает/);
  assert.equal(JSON.stringify(state), before);
  state = assign(state, [row(bone.id, 5)]);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 5);
  const partial = act(state, 'startOperation', 8);
  assert.equal(partial.finished.find((lot) => lot.id === bone.id).reserved, 5);
  const damaged = structuredClone(state);
  damaged.finished.find((lot) => lot.id === bone.id).expires = '2026-10-01';
  assert.throws(() => assign(damaged, [row(bone.id, 13)]), /не соответствует/);
  assert.equal(damaged.finished.find((lot) => lot.id === bone.id).reserved, 5);
  state = assign(state, [row(bone.id, 13)]);
  state = assign(state, [row(bone.id, 13)]);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 13);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).remaining, balance);
  state = act(state, 'startOperation', 8);
  assert.throws(() => assign(state, []), /до запуска/);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).remaining, balance);
  assert.throws(() => act(state, 'advance', 8), /Подтвердите списание/);
  state = consumeReserved(state, orderId(8));
  state = act(state, 'advance', 8, { values: { weight: true, loss: 0 } });
  const input = order(state, 8).samples[0].inputs[0];
  assert.equal(input.mtus[0].code, bone.code);
  assert.equal(input.mtus[0].qty, 13);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).remaining, 0);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 0);
});

test('MTU reservations made by another order cannot be stolen and a reassignment releases only its own reserve', () => {
  let state = complete(beforeDeboning(), 5);
  const bone = state.finished.find((lot) => lot.material === 'bone');
  state = transition(state, {
    type: 'createOrder',
    processId: 'rendering',
    qty: 5.3,
    line: 'ctp',
    date: '2026-10-22',
  });
  state = act(state, 'releaseToOperator', 8);
  state = act(state, 'releaseToOperator', 9);
  const assign = (state, n, qty) =>
    act(state, 'assignOperationMaterials', n, {
      assignments: qty ? [{ inputId: 'in-bone', lotId: bone.id, qty }] : [],
    });
  state = assign(state, 8, 5);
  assert.throws(() => assign(state, 9, 13), /недостаточно свободного остатка/);
  state = assign(state, 8, 0);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 0);
  state = assign(state, 9, 13);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 13);
});

test('the event history keeps more than 150 records and remains intact after serialization', () => {
  let state = seedState('agro');
  const initialIds = state.events.map((event) => event.id);
  for (let i = 0; i < 180; i++) state = act(state, 'resizeOrder', 7, { qty: i % 2 ? 20 : 20.4 });
  assert.equal(state.events.length, initialIds.length + 180);
  assert.ok(initialIds.every((id) => state.events.some((event) => event.id === id)));
  const restored = loadDemo({ getItem: () => JSON.stringify(state) }, 'agro');
  assert.deepEqual(restored.events, state.events);
});

test('the whole agro demo executes without prior reservations, with scans at every stock operation', () => {
  let state = admit(receive(seedState('agro')));
  const execute = (number) => {
    state = act(state, 'startOperation', number);
    const current = order(state, number),
      operation = operationOf(current);
    for (const input of operation.inputs.filter((item) => item.source === 'stock')) {
      const lot = reservationLots(state, current, input).find(
        (item) => ![5, 6].includes(number) || item.orderId === orderId(number === 5 ? 2 : 4),
      );
      assert.ok(lot, input.name);
      state = act(state, 'consumeMaterial', number, {
        inputId: input.id,
        code: lot.mtuCode || lot.code,
        qty: input.material === 'live' ? stockBalance(lot) : scaledQty(input, current),
      });
    }
    const values = defaultValues(current);
    for (const p of operation.parameters) {
      if (p.type === 'boolean') values[p.id] = true;
      if (p.type === 'text') values[p.id] = `AG-${number}-${operation.id}`;
    }
    state = confirmCarcassIdentity(state, orderId(number));
    state = act(state, 'advance', number, { values });
  };
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    state = act(state, 'prepareOrder', n);
    assert.equal(order(state, n).allocations.length, 0);
    if (n === 3) {
      execute(n);
      state = act(act(state, 'startOperation', n), 'referInspection', n, { reason: 'Осмотр' });
      continue;
    }
    while (order(state, n).status !== 'completed') execute(n);
  }
  assert.equal(state.finished.find((lot) => lot.material === 'pallet').qty, 20);
  assert.equal(state.finished.find((lot) => lot.material === 'meal').qty, 5.3);
  assert.ok(state.orders.every((item) => item.allocations.every((row) => row.consumed)));
  assert.ok([...state.lots, ...state.finished].every((lot) => !lot.reserved));
  assert.deepEqual(
    [
      ...new Set(
        upstreamLots(state, order(state, 7))
          .filter((lot) => lot.mark)
          .map((lot) => lot.mark),
      ),
    ],
    ['УБ-26-000001'],
  );
});

function ctpFixture(reserve = 0) {
  let state = complete(beforeDeboning(), 5);
  const bone = state.finished.find((lot) => lot.material === 'bone');
  const second = {
    ...structuredClone(bone),
    id: 'bone-second',
    code: 'BONE-SECOND',
    mtuCode: 'MTU-BONE-2',
    qty: 20,
    remaining: 20,
    orderId: bone.orderId,
    reserved: 0,
  };
  state.finished.push(second);
  state = act(state, 'prepareOrder', 8, {
    reservations: reserve
      ? [{ operationId: 'receive-waste', inputId: 'in-bone', lotId: bone.id, qty: reserve }]
      : [],
  });
  return { state, bone, second };
}
const consumeBone = (state, code, qty, extra = {}) =>
  act(state, 'consumeMaterial', 8, { inputId: 'in-bone', code, qty, ...extra });

test('partial consumption protects remaining reserves, is idempotent and survives reload before completion', () => {
  let { state, bone } = ctpFixture(13);
  const initial = state.finished.find((lot) => lot.id === bone.id).remaining;
  state = act(state, 'startOperation', 8);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).remaining, initial);
  state = consumeBone(state, bone.code, 5, { movementId: 'scan-1' });
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 8);
  assert.equal(
    operationInputQty(
      operationOf(order(state, 8)).inputs[0],
      order(state, 8),
      operationOf(order(state, 8)),
    ),
    5,
  );
  const saved = JSON.stringify(state);
  assert.equal(JSON.stringify(consumeBone(state, bone.code, 5, { movementId: 'scan-1' })), saved);
  assert.throws(
    () => consumeBone(state, bone.code, 6, { movementId: 'scan-1' }),
    /другими данными/,
  );
  assert.throws(() => act(state, 'advance', 8), /списано 5/);
  state = loadDemo({ getItem: () => saved }, 'agro');
  state = consumeBone(state, bone.code, 8, { movementId: 'scan-2' });
  assert.equal(operationMaterialAvailability(state, order(state, 8)), '');
  state = act(state, 'advance', 8, { values: { weight: true, loss: 0 } });
  assert.deepEqual(
    order(state, 8).samples[0].inputs[0].mtus.map((mtu) => mtu.qty),
    [5, 8],
  );
  assert.equal(state.finished.find((lot) => lot.id === bone.id).remaining, initial - 13);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 0);
});

test('substitution requires explicit confirmation and lineage contains consumed MTUs only', () => {
  let { state, bone, second } = ctpFixture(13);
  state = act(state, 'startOperation', 8);
  const before = JSON.stringify(state);
  assert.throws(() => consumeBone(state, second.mtuCode, 13), /Подтвердите замену/);
  assert.equal(JSON.stringify(state), before);
  state = consumeBone(state, second.mtuCode, 13, { replaceReservation: true });
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 0);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).remaining, 13);
  assert.equal(state.finished.find((lot) => lot.id === second.id).remaining, 7);
  assert.equal(order(state, 8).allocations.length, 1);
  assert.deepEqual(
    order(state, 8).allocations.map((row) => row.lotId),
    [second.id],
  );
  assert.ok(!upstreamLots(state, order(state, 8)).some((lot) => lot.id === bone.id));
  assert.equal(state.events[0].releasedReservations[0].code, bone.code);
});

test('unreserved part can be consumed from another MTU without replacing the existing partial reserve', () => {
  let { state, bone, second } = ctpFixture(5);
  state = act(state, 'startOperation', 8);
  state = consumeBone(state, second.code, 8);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 5);
  state = consumeBone(state, bone.code, 5);
  assert.equal(operationMaterialAvailability(state, order(state, 8)), '');
  assert.deepEqual(
    order(state, 8).allocations.map((row) => row.qty),
    [8, 5],
  );
});

test('foreign reserves, invalid MTU, expiry, blocked status and overconsumption cannot mutate stock', () => {
  let { state, bone, second } = ctpFixture();
  state = transition(state, {
    type: 'createOrder',
    processId: 'rendering',
    qty: 5.3,
    line: 'ctp',
    date: '2026-10-22',
  });
  state = act(state, 'prepareOrder', 9, {
    reservations: [{ operationId: 'receive-waste', inputId: 'in-bone', lotId: second.id, qty: 10 }],
  });
  state = act(state, 'startOperation', 8);
  const before = JSON.stringify(state);
  assert.throws(() => consumeBone(state, second.code, 11), /доступно 10/);
  assert.throws(() => consumeBone(state, 'unknown', 1), /не соответствует/);
  assert.throws(() => consumeBone(state, state.lots[0].code, 1), /не соответствует/);
  assert.throws(() => consumeBone(state, bone.code, 14), /превышает потребность/);
  assert.throws(() => consumeBone(state, bone.code, 0), /корректное количество/);
  assert.equal(JSON.stringify(state), before);
  for (const mutation of [
    { status: 'blocked' },
    { status: 'quarantine' },
    { expires: '2026-10-01' },
  ]) {
    const invalid = structuredClone(state);
    Object.assign(
      invalid.finished.find((lot) => lot.id === bone.id),
      mutation,
    );
    assert.throws(() => consumeBone(invalid, bone.code, 13), /не допущена/);
  }
  state = act(state, 'pause', 8, { reason: 'Проверка' });
  assert.throws(() => consumeBone(state, bone.code, 13), /во время выполнения/);
});

test('old active auto-consumed saves retain facts and complete without a second stock deduction', () => {
  let { state, bone } = ctpFixture(13);
  state = act(state, 'startOperation', 8);
  state = consumeReserved(state, orderId(8));
  for (const row of order(state, 8).allocations) {
    delete row.movementId;
    delete row.consumedAt;
  }
  const remaining = state.finished.find((lot) => lot.id === bone.id).remaining;
  state = loadDemo({ getItem: () => JSON.stringify(state) }, 'agro');
  assert.equal(operationMaterialAvailability(state, order(state, 8)), '');
  state = act(state, 'advance', 8, { values: { weight: true, loss: 0 } });
  assert.equal(state.finished.find((lot) => lot.id === bone.id).remaining, remaining);
  assert.equal(order(state, 8).samples[0].inputs[0].mtus[0].code, bone.code);
});

test('a one-gram remainder must be confirmed and cannot make stock negative', () => {
  let { state, bone } = ctpFixture(13);
  state = act(state, 'startOperation', 8);
  assert.throws(() => consumeBone(state, bone.code, 13.001), /превышает потребность/);
  state = consumeBone(state, bone.code, 12.999);
  assert.match(operationMaterialAvailability(state, order(state, 8)), /списано 12.999/);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 0.001);
  assert.throws(() => consumeBone(state, bone.code, 0.002), /превышает потребность/);
  state = consumeBone(state, bone.code, 0.001);
  assert.equal(operationMaterialAvailability(state, order(state, 8)), '');
  assert.equal(state.finished.find((lot) => lot.id === bone.id).remaining, 0);
  assert.equal(state.finished.find((lot) => lot.id === bone.id).reserved, 0);
});

test('standard carcass captions migrate without altering completed records, custom names or balances', () => {
  const state = beforeDeboning();
  state.agroCatalogRevision = 2;
  state.materials.find((row) => row.id === 'warm').name = 'Туша после убоя';
  for (const process of state.processes)
    for (const op of process.operations)
      for (const row of [...op.inputs, ...op.outputs])
        if (row.material === 'warm') row.name = 'Туша после убоя';
  const warm = state.finished.filter((row) => row.material === 'warm');
  warm[0].name = 'Туша после убоя';
  warm[1].name = 'Туша особой категории';
  const orders = JSON.stringify(state.orders),
    jobs = JSON.stringify(state.markingJobs);
  const accounting = state.finished.map(({ id, qty, remaining, reserved }) => ({
    id,
    qty,
    remaining,
    reserved,
  }));
  const loaded = loadDemo({ getItem: () => JSON.stringify(state) }, 'agro');
  assert.equal(loaded.materials.find((row) => row.id === 'warm').name, 'Туша');
  assert.equal(loaded.finished.find((row) => row.id === warm[0].id).name, 'Туша');
  assert.equal(loaded.finished.find((row) => row.id === warm[1].id).name, 'Туша особой категории');
  assert.equal(JSON.stringify(loaded.orders), orders);
  assert.equal(JSON.stringify(loaded.markingJobs), jobs);
  assert.deepEqual(
    loaded.finished.map(({ id, qty, remaining, reserved }) => ({ id, qty, remaining, reserved })),
    accounting,
  );
  assert.deepEqual(loadDemo({ getItem: () => JSON.stringify(loaded) }, 'agro'), loaded);
});
