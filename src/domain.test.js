import { consumeReserved } from './testFixtures/consumeReserved.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedState,
  transition,
  recipeOf,
  operationOf,
  operationsOf,
  defaultValues,
  parameterBounds,
  requirements,
  migrateState,
  validateProcess,
  scaledQty,
  isOrderBlocked,
  descendantOrders,
} from './domain.js';
import { initialInventory, initialEquipment, initialProcesses } from './catalog.js';
import { resourcePath, processLineError } from './resources.js';

function cleanPlant() {
  const s = seedState();
  s.orders = [];
  s.finished = [];
  s.shipments = [];
  s.events = [];
  s.lots = initialInventory();
  s.lines.forEach((l) => (l.status = 'ready'));
  return s;
}

test('independent lines run the same process concurrently on distinct work units', () => {
  let state = cleanPlant();
  const ids = [];
  for (const line of ['l1', 'l2']) {
    let id;
    [state, id] = create(state, { processId: 'strawberry', qty: 100, line });
    ids.push(id);
    state = transition(state, { type: 'reserve', orderId: id });
    state = transition(state, { type: 'start', orderId: id });
  }
  for (let i = 0; i < 5; i++) {
    assert.notEqual(
      operationOf(orderOf(state, ids[0])).equipmentId,
      operationOf(orderOf(state, ids[1])).equipmentId,
    );
    state = complete(state, ids[0]);
    state = complete(state, ids[1]);
  }
  for (const id of ids) state = complete(state, id);
  assert(ids.every((id) => orderOf(state, id).status === 'completed'));
  assert.equal(state.finished.length, 2);
});

test('shared work unit blocks only its current operation; waiting preserves output and does not consume twice', () => {
  let state = cleanPlant();
  state = transition(state, {
    type: 'saveEquipment',
    equipment: {
      id: 'shared',
      code: 'ОБЩ-01',
      name: 'Общий смеситель',
      classCode: 'Общее смешивание',
      parentId: 'area',
      active: true,
    },
  });
  const p = {
    id: 'shared-route',
    code: 'ТП-ОБЩ',
    name: 'Общий ресурс',
    baseQty: 10,
    shelf: 5,
    outputMaterial: 'fg-natural',
    operations: [
      {
        id: 'prepare',
        name: 'Подготовка',
        kind: 'production',
        equipmentId: '',
        inputs: [{ id: 'milk', material: 'milk', qty: 10, source: 'stock' }],
        outputs: [{ id: 'semi', material: 'semi-0', qty: 10, destination: 'process' }],
        parameters: [],
      },
      {
        id: 'mix',
        name: 'Общее смешивание',
        kind: 'production',
        equipmentId: 'shared',
        inputs: [
          { id: 'semi', material: 'semi-0', qty: 10, source: 'process' },
          { id: 'sugar', material: 'sugar', qty: 1, source: 'stock' },
        ],
        outputs: [{ id: 'fg', material: 'fg-natural', qty: 10, destination: 'stock' }],
        parameters: [],
      },
    ],
  };
  state = transition(state, { type: 'saveProcess', process: p, publish: true });
  let a, b;
  [state, a] = create(state, { processId: p.id, qty: 10, line: 'l1' });
  [state, b] = create(state, { processId: p.id, qty: 10, line: 'l2' });
  for (const id of [a, b]) {
    state = transition(state, { type: 'reserve', orderId: id });
    state = transition(state, { type: 'start', orderId: id });
  }
  state = complete(state, a);
  state = transition(state, { type: 'startOperation', orderId: a });
  const sugarBefore = state.lots.find((l) => l.material === 'sugar').qty;
  state = complete(state, b);
  assert.equal(orderOf(state, b).status, 'waiting');
  assert.match(orderOf(state, b).waitReason, /Общий смеситель.*занято заказом.*Линия 01/);
  assert.equal(orderOf(state, b).samples.length, 1);
  assert.equal(orderOf(state, b).wip['semi-0'], 10);
  assert.equal(state.lots.find((l) => l.material === 'sugar').qty, sugarBefore);
  assert.throws(() => transition(state, { type: 'resume', orderId: b }), /занято заказом/);
  const persisted = migrateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(persisted, state);
  state = complete(persisted, a);
  state = transition(state, { type: 'resume', orderId: b });
  assert.equal(orderOf(state, b).wip['semi-0'], 0);
  assert.equal(state.lots.find((l) => l.material === 'sugar').qty, sugarBefore - 1);
  state = complete(state, b);
  assert.equal(orderOf(state, b).samples.length, 2);
  assert.equal(state.finished.filter((l) => l.orderId === b)[0].qty, 10);
});

test('new hierarchy, resources and entirely new route execute without any built-in process or material', () => {
  let s = {
    version: 3,
    structure: [],
    lines: [],
    equipment: [],
    processes: [],
    materials: [],
    lots: [],
    orders: [],
    finished: [],
    shipments: [],
    events: [],
  };
  for (const n of [
    { id: 'ent-x', code: 'E-X', name: 'Завод напитков', type: 'enterprise', parentId: '' },
    { id: 'site-x', code: 'S-X', name: 'Площадка X', type: 'site', parentId: 'ent-x' },
    { id: 'area-x', code: 'A-X', name: 'Цех напитков', type: 'area', parentId: 'site-x' },
    {
      id: 'line-x',
      code: 'L-X',
      name: 'Линия напитков',
      type: 'line',
      parentId: 'area-x',
      capacity: 300,
    },
  ])
    s = transition(s, { type: 'saveNode', node: n });
  s = transition(s, {
    type: 'saveEquipment',
    equipment: {
      id: 'tank-x',
      code: 'T-X',
      name: 'Котёл напитков',
      classCode: 'Варка напитка',
      parentId: 'line-x',
      active: true,
    },
  });
  for (const [id, kind] of [
    ['juice-raw', 'raw'],
    ['juice-semi', 'intermediate'],
    ['juice-final', 'finished'],
  ])
    s = transition(s, {
      type: 'saveMaterial',
      material: { id, code: id, name: id, kind, unit: 'л' },
    });
  s = transition(s, {
    type: 'saveCounterparty',
    counterparty: {
      id: 'juice-supplier',
      code: 'SUP-JUICE',
      name: 'Поставщик сока',
      isSupplier: true,
    },
  });
  s = transition(s, {
    type: 'receiveLot',
    material: 'juice-raw',
    qty: 100,
    supplierId: 'juice-supplier',
    expires: '2026-12-01',
  });
  const rawId = s.lots[0].id;
  s = transition(s, { type: 'releaseLot', lotId: rawId });
  const p = {
    id: 'juice',
    code: 'ТП-СОК',
    name: 'Сок нового вида',
    baseQty: 10,
    shelf: 4,
    outputMaterial: 'juice-final',
    operations: [
      {
        id: 'cook-x',
        name: 'Варка',
        kind: 'production',
        equipmentClass: 'Варка напитка',
        inputs: [{ id: 'i', material: 'juice-raw', qty: 10, source: 'stock' }],
        outputs: [{ id: 'o', material: 'juice-semi', qty: 10, destination: 'process' }],
        parameters: [
          {
            id: 'temp-x',
            name: 'Нагрев',
            type: 'number',
            min: 60,
            target: 65,
            max: 70,
            required: true,
            unit: '°C',
          },
        ],
      },
      {
        id: 'qc-x',
        name: 'Промежуточный контроль',
        kind: 'quality',
        inputs: [],
        outputs: [],
        parameters: [{ id: 'protocol-x', name: 'Протокол', type: 'text', required: true }],
      },
      {
        id: 'release-x',
        name: 'Розлив',
        kind: 'production',
        inputs: [{ id: 'i', material: 'juice-semi', qty: 10, source: 'process' }],
        outputs: [{ id: 'o', material: 'juice-final', qty: 10, destination: 'stock' }],
        parameters: [{ id: 'seal-x', name: 'Герметичность', type: 'boolean', required: true }],
      },
    ],
  };
  s = transition(s, { type: 'saveProcess', process: p, publish: true });
  let id;
  [s, id] = create(s, { processId: 'juice', qty: 20, line: 'line-x' });
  assert.equal(operationOf(orderOf(s, id)).equipmentId, 'tank-x');
  assert.equal(resourcePath(s, 'tank-x').length, 5);
  assert.match(operationOf(orderOf(s, id)).equipmentPath, /Завод напитков.*Котёл напитков/);
  s = transition(s, { type: 'reserve', orderId: id });
  s = transition(s, { type: 'start', orderId: id });
  assert.throws(() => complete(s, id, { values: { 'temp-x': 80 } }), /вне допуска/);
  s = complete(s, id);
  s = transition(s, { type: 'startOperation', orderId: id });
  assert.equal(orderOf(s, id).status, 'quality');
  s = complete(s, id);
  s = complete(s, id);
  assert.equal(s.lots[0].qty, 80);
  assert.equal(s.finished[0].qty, 20);
  assert.equal(s.finished[0].expires, '2026-10-26');
  assert(descendantOrders(s, rawId).some((o) => o.id === id));
  s = transition(s, {
    type: 'ship',
    lotId: s.finished[0].id,
    qty: 7,
    customerId: 'party-crossroads',
  });
  assert.equal(s.finished[0].remaining, 13);
});

test('hierarchy rejects invalid parents, missing line resources and unsafe moves, and permits new node deletion', () => {
  let s = cleanPlant();
  assert.throws(
    () =>
      transition(s, {
        type: 'saveNode',
        node: { id: 'bad', code: 'BAD', name: 'Bad', type: 'line', parentId: 'site', capacity: 1 },
      }),
    /Родитель/,
  );
  const p = structuredClone(s.processes[0]);
  p.id = 'wrong-line';
  p.code = 'WRONG';
  p.operations[0].equipmentId = 'mix-1';
  p.operations[0].equipmentClass = '';
  s = transition(s, { type: 'saveProcess', process: p, publish: true });
  assert.match(processLineError(s, p, 'l2'), /нет доступного оборудования/);
  assert.throws(() => create(s, { processId: p.id, line: 'l2' }), /нет доступного оборудования/);
  let id;
  [s, id] = create(s, { processId: 'strawberry', line: 'l1', qty: 100 });
  s = transition(s, { type: 'reserve', orderId: id });
  assert.throws(
    () =>
      transition(s, {
        type: 'saveEquipment',
        equipment: { ...s.equipment.find((e) => e.id === 'mix-1'), parentId: 'l2' },
      }),
    /активным заказом/,
  );
  assert.throws(() => transition(s, { type: 'deleteResource', id: 'l1' }), /дочерние/);
  s = transition(s, {
    type: 'saveNode',
    node: {
      id: 'unused',
      code: 'UNUSED',
      name: 'Новая линия',
      type: 'line',
      parentId: 'area',
      capacity: 10,
    },
  });
  s = transition(s, { type: 'deleteResource', id: 'unused' });
  assert(!s.lines.some((l) => l.id === 'unused'));
  s = transition(s, {
    type: 'saveNode',
    node: { ...s.structure.find((n) => n.id === 'site'), active: false },
  });
  assert.match(processLineError(s, p, 'l1'), /недоступны/);
});

test('v2 migration fixes line equipment assignments without changing accounting or custom data', () => {
  const s = seedState();
  const raw = structuredClone(s);
  raw.version = 2;
  delete raw.structure;
  raw.lines = raw.lines.map(({ id, name, status, capacity }) => ({ id, name, status, capacity }));
  raw.equipment = structuredClone(initialEquipment);
  raw.processes = initialProcesses();
  for (const o of raw.orders)
    for (const op of operationsOf(o)) {
      op.equipmentId = initialProcesses()
        .find((p) => p.id === o.recipe)
        .operations.find((x) => x.id === op.id).equipmentId;
      delete op.equipmentClass;
      delete op.equipmentPath;
    }
  const next = migrateState(raw);
  assert.equal(next.version, 3);
  assert.equal(next.equipment.length, 15);
  assert.deepEqual(next.lots, raw.lots);
  assert.deepEqual(next.finished, raw.finished);
  assert.deepEqual(next.shipments, raw.shipments);
  for (const o of next.orders) {
    const old = orderOf(raw, o.id);
    assert.deepEqual(o.samples, old.samples);
    assert.deepEqual(o.allocations, old.allocations);
    assert.deepEqual(o.wip, old.wip);
  }
  assert.notEqual(
    operationsOf(orderOf(next, 'order-4'))[3].equipmentId,
    operationsOf(orderOf(next, 'order-5'))[3].equipmentId,
  );
  assert.equal(complete(next, 'order-4').orders.find((o) => o.id === 'order-4').stage, 3);
  assert.deepEqual(migrateState(next), next);
});

test('produced lots feed other processes; reserves prevent shipping and blocking propagates across orders', () => {
  let [state, parentId] = create(setup());
  state = transition(state, { type: 'reserve', orderId: parentId });
  state = transition(state, { type: 'start', orderId: parentId });
  state = complete(state, parentId);
  state = complete(state, parentId);
  state = complete(state, parentId);
  const parentLot = state.finished.find(
    (l) => l.orderId === parentId && l.material === 'custom-product',
  );
  const process = {
    id: 'rework',
    code: 'ПР-ПЕРЕРАБОТКА',
    name: 'Перефасовка',
    outputMaterial: 'custom-product',
    baseQty: 98,
    shelf: 4,
    operations: [
      {
        id: 'repack',
        name: 'Перефасовка',
        kind: 'production',
        equipmentId: '',
        inputs: [{ id: 'input', material: 'custom-product', qty: 98, source: 'stock' }],
        outputs: [{ id: 'output', material: 'custom-product', qty: 98, destination: 'stock' }],
        parameters: [],
      },
    ],
  };
  state = transition(state, { type: 'saveProcess', process, publish: true });
  let childId;
  [state, childId] = create(state, { processId: 'rework', qty: 98 });
  state = transition(state, { type: 'reserve', orderId: childId });
  assert.equal(state.finished.find((l) => l.id === parentLot.id).reserved, 98);
  assert.throws(
    () =>
      transition(state, {
        type: 'ship',
        lotId: parentLot.id,
        qty: 150,
        customerId: 'party-crossroads',
      }),
    /превышает/,
  );
  state = transition(state, { type: 'start', orderId: childId });
  state = complete(state, childId);
  assert.equal(state.finished.find((l) => l.id === parentLot.id).remaining, 98);
  assert.equal(state.finished.find((l) => l.id === parentLot.id).reserved, 0);
  state = transition(state, { type: 'blockLot', lotId: 'milk-1' });
  assert.equal(isOrderBlocked(state, orderOf(state, childId)), true);
  assert(descendantOrders(state, 'milk-1').some((o) => o.id === childId));
  const childLot = state.finished.find((l) => l.orderId === childId);
  assert.throws(
    () =>
      transition(state, {
        type: 'ship',
        lotId: childLot.id,
        qty: 1,
        customerId: 'party-crossroads',
      }),
    /заблокирована/,
  );
});

function customProcess() {
  return {
    id: 'custom',
    code: 'ПР-ТЕСТ',
    name: 'Новый продукт',
    outputMaterial: 'custom-product',
    baseQty: 98,
    shelf: 9,
    operations: [
      {
        id: 'heat',
        name: 'Нагрев',
        kind: 'production',
        equipmentId: 'custom-tank',
        inputs: [
          { id: 'milk-in', material: 'milk', qty: 99, source: 'stock' },
          { id: 'sugar-in', material: 'sugar', qty: 1, source: 'stock' },
        ],
        outputs: [{ id: 'semi-out', material: 'semi-0', qty: 100, destination: 'process' }],
        parameters: [
          {
            id: 'temperature',
            name: 'Температура',
            type: 'number',
            unit: '°C',
            min: 70,
            target: 75,
            max: 80,
            required: true,
          },
          {
            id: 'mass',
            name: 'Масса',
            type: 'number',
            unit: 'кг',
            min: 98,
            target: 100,
            max: 102,
            scaled: true,
            required: true,
          },
          { id: 'sample', name: 'Номер пробы', type: 'text', required: true },
        ],
      },
      {
        id: 'test',
        name: 'Межоперационный контроль',
        kind: 'quality',
        equipmentId: '',
        inputs: [],
        outputs: [],
        parameters: [
          {
            id: 'duration',
            name: 'Время',
            type: 'number',
            unit: 'с',
            min: 60,
            target: 65,
            max: 90,
            required: true,
          },
          { id: 'accept', name: 'Соответствие', type: 'boolean', required: true },
        ],
      },
      {
        id: 'pack',
        name: 'Упаковка',
        kind: 'production',
        equipmentId: '',
        inputs: [
          { id: 'semi-in', material: 'semi-0', qty: 100, source: 'process' },
          { id: 'cups', material: 'cup', qty: 100, source: 'stock' },
        ],
        outputs: [
          { id: 'product-out', material: 'custom-product', qty: 98, destination: 'stock' },
          { id: 'waste-out', material: 'custom-waste', qty: 2, destination: 'stock' },
        ],
        parameters: [],
      },
    ],
  };
}
function setup() {
  let state = seedState();
  for (const material of [
    { id: 'custom-product', code: 'ГП-ТЕСТ', name: 'Новый продукт', kind: 'finished', unit: 'кг' },
    {
      id: 'custom-waste',
      code: 'ПФ-ТЕСТ',
      name: 'Побочный продукт',
      kind: 'intermediate',
      unit: 'кг',
    },
  ])
    state = transition(state, { type: 'saveMaterial', material });
  state = transition(state, {
    type: 'saveEquipment',
    equipment: { id: 'custom-tank', code: 'ОБ-ТЕСТ', name: 'Новый танк', active: true },
  });
  state = transition(state, { type: 'saveProcess', process: customProcess(), publish: true });
  state = transition(state, { type: 'finishCip', lineId: 'l3' });
  return state;
}
function create(state, extra = {}) {
  const next = transition(state, {
    type: 'createOrder',
    processId: 'custom',
    qty: 196,
    line: 'l3',
    date: '2026-10-22',
    start: '15:00',
    due: '19:00',
    ...extra,
  });
  return [next, next.orders.at(-1).id];
}
const orderOf = (state, id) => state.orders.find((o) => o.id === id);
function complete(state, id, patch = {}) {
  if (['ready', 'queued', 'waiting'].includes(orderOf(state, id).status))
    state = transition(state, { type: 'startOperation', orderId: id });
  state = consumeReserved(state, id);
  const order = orderOf(state, id),
    values = defaultValues(order);
  for (const p of operationOf(order).parameters) {
    if (p.type === 'boolean') values[p.id] = true;
    if (p.type === 'text') values[p.id] = 'ЛБ-42';
  }
  return transition(state, { type: 'advance', orderId: id, values, ...patch });
}

test('custom process controls operations, per-operation consumption, quality, coproducts and shipments', () => {
  let [state, id] = create(setup());
  const milkBefore = state.lots.find((l) => l.id === 'milk-1').qty,
    cupsBefore = state.lots.find((l) => l.id === 'cup-1').qty;
  state = transition(state, { type: 'reserve', orderId: id });
  assert.equal(requirements(orderOf(state, id)).find((i) => i.material === 'milk').qty, 198);
  assert.equal(orderOf(state, id).allocations.filter((a) => a.consumed).length, 0);
  state = transition(state, { type: 'start', orderId: id });
  assert.equal(state.lots.find((l) => l.id === 'milk-1').qty, milkBefore);
  state = consumeReserved(state, id);
  assert.equal(state.lots.find((l) => l.id === 'milk-1').qty, milkBefore - 198);
  assert.equal(state.lots.find((l) => l.id === 'cup-1').qty, cupsBefore);
  assert.equal(
    parameterBounds(operationOf(orderOf(state, id)).parameters[1], orderOf(state, id)).target,
    200,
  );
  state = complete(state, id);
  assert.equal(orderOf(state, id).status, 'queued');
  state = transition(state, { type: 'startOperation', orderId: id });
  assert.equal(orderOf(state, id).status, 'quality');
  assert.equal(operationOf(orderOf(state, id)).name, 'Межоперационный контроль');
  state = complete(state, id);
  assert.equal(orderOf(state, id).status, 'queued');
  assert.equal(state.lots.find((l) => l.id === 'cup-1').qty, cupsBefore);
  state = transition(state, { type: 'startOperation', orderId: id });
  assert.equal(orderOf(state, id).status, 'running');
  assert.equal(state.lots.find((l) => l.id === 'cup-1').qty, cupsBefore);
  state = consumeReserved(state, id);
  assert.equal(state.lots.find((l) => l.id === 'cup-1').qty, cupsBefore - 200);
  state = complete(state, id);
  assert.equal(orderOf(state, id).status, 'completed');
  const lots = state.finished.filter((l) => l.orderId === id);
  assert.equal(lots.length, 2);
  assert.equal(lots.find((l) => l.material === 'custom-product').qty, 196);
  assert.equal(lots.find((l) => l.material === 'custom-waste').qty, 4);
  assert.equal(lots[0].expires, '2026-10-31');
  state = transition(state, {
    type: 'ship',
    lotId: lots.find((l) => l.material === 'custom-product').id,
    qty: 100,
    customerId: 'party-crossroads',
  });
  assert.equal(state.shipments[0].qty, 100);
  assert.equal(orderOf(state, id).samples.length, 3);
});

test('draft changes do not affect published selection; publication creates a new immutable order snapshot', () => {
  let state = setup();
  let id;
  [state, id] = create(state);
  const edited = customProcess();
  edited.name = 'Новый продукт V2';
  edited.operations[0].parameters[0].max = 90;
  edited.operations.push({
    id: 'last',
    name: 'Дополнительный контроль',
    kind: 'quality',
    equipmentId: '',
    inputs: [],
    outputs: [],
    parameters: [],
  });
  state = transition(state, { type: 'saveProcess', process: edited, publish: false });
  assert.equal(state.processes.find((p) => p.id === 'custom').revision, 1);
  assert.equal(state.processes.find((p) => p.id === 'custom').draft.operations.length, 4);
  let prePublishId;
  [state, prePublishId] = create(state);
  assert.equal(operationsOf(orderOf(state, prePublishId)).length, 3);
  state = transition(state, { type: 'saveProcess', process: edited, publish: true });
  let newerId;
  [state, newerId] = create(state);
  assert.equal(recipeOf(orderOf(state, id)).revision, 1);
  assert.equal(operationsOf(orderOf(state, id)).length, 3);
  assert.equal(operationsOf(orderOf(state, id))[0].parameters[0].max, 80);
  assert.equal(recipeOf(orderOf(state, newerId)).revision, 2);
  assert.equal(operationsOf(orderOf(state, newerId)).length, 4);
});

test('publication rejects invalid flow, tolerance, resource, duplicate identifiers and missing main output', () => {
  const state = setup();
  for (const [mutate, pattern] of [
    [(p) => (p.operations[2].inputs[0].qty = 101), /не выпущен/],
    [(p) => (p.operations[0].parameters[0].min = 85), /нижний допуск|Номинал|номинал/],
    [(p) => (p.operations[0].equipmentId = 'missing'), /оборудование/],
    [(p) => (p.operations[2].outputs[0].qty = 97), /базовым объёмом/],
    [(p) => (p.operations[1].id = p.operations[0].id), /идентификаторы/],
  ]) {
    const p = customProcess();
    mutate(p);
    assert.throws(() => validateProcess(p, state), pattern);
  }
});

test('typed attributes reject missing text, false confirmations and numeric deviations atomically', () => {
  let [state, id] = create(setup());
  state = transition(state, { type: 'reserve', orderId: id });
  state = transition(state, { type: 'start', orderId: id });
  const snapshot = structuredClone(state);
  assert.throws(
    () => complete(state, id, { values: { temperature: 90, mass: 200, sample: '42' } }),
    /вне допуска/,
  );
  assert.throws(
    () => complete(state, id, { values: { temperature: 75, mass: 200, sample: '' } }),
    /Номер пробы/,
  );
  assert.deepEqual(state, snapshot);
  state = complete(state, id);
  assert.throws(
    () => complete(state, id, { values: { duration: 65, accept: false } }),
    /Подтвердите/,
  );
  assert.equal(orderOf(state, id).status, 'queued');
});

test('a quality operation can be first or final and a process may have just one operation', () => {
  let state = setup();
  const p = customProcess();
  p.operations = [
    {
      ...p.operations[2],
      inputs: [{ id: 'raw', material: 'milk', qty: 100, source: 'stock' }],
      kind: 'quality',
      parameters: [{ id: 'ok', name: 'Проверка', type: 'boolean', required: true }],
    },
  ];
  state = transition(state, { type: 'saveProcess', process: p, publish: true });
  let id;
  [state, id] = create(state);
  state = transition(state, { type: 'reserve', orderId: id });
  state = transition(state, { type: 'start', orderId: id });
  assert.equal(orderOf(state, id).status, 'quality');
  state = complete(state, id);
  assert.equal(orderOf(state, id).status, 'completed');
  assert.equal(orderOf(state, id).samples.length, 1);
});

test('reservation shortage is atomic and quarantine or expired stock is excluded', () => {
  let [state, id] = create(setup());
  const milk = state.lots.find((l) => l.id === 'milk-1');
  milk.qty = milk.reserved + 1;
  const before = structuredClone(state);
  assert.throws(() => transition(state, { type: 'reserve', orderId: id }), /Недостаточно/);
  assert.deepEqual(state, before);
  state.lots.find((l) => l.id === 'milk-2').status = 'released';
  state.lots.find((l) => l.id === 'milk-2').expires = '2026-10-21';
  assert.throws(() => transition(state, { type: 'reserve', orderId: id }), /Недостаточно/);
});

test('FEFO can split one operation across eligible lots', () => {
  let [state, id] = create(setup());
  const milk = state.lots.find((l) => l.id === 'milk-1');
  milk.qty = milk.reserved + 100;
  state.lots.find((l) => l.id === 'milk-2').status = 'released';
  state = transition(state, { type: 'reserve', orderId: id });
  assert.deepEqual(
    orderOf(state, id)
      .allocations.filter((a) => a.material === 'milk')
      .map((a) => [a.lotId, a.qty]),
    [
      ['milk-1', 100],
      ['milk-2', 98],
    ],
  );
});

test('equipment conflicts and unavailable equipment prevent entering an operation', () => {
  let [state, id] = create(setup());
  state = transition(state, { type: 'reserve', orderId: id });
  state = transition(state, {
    type: 'saveEquipment',
    equipment: { ...state.equipment.find((e) => e.id === 'custom-tank'), active: false },
  });
  assert.throws(() => transition(state, { type: 'start', orderId: id }), /недоступно/);
  state = transition(state, {
    type: 'saveEquipment',
    equipment: { ...state.equipment.find((e) => e.id === 'custom-tank'), active: true },
  });
  state = transition(state, { type: 'start', orderId: id });
  assert.throws(
    () =>
      transition(state, {
        type: 'saveEquipment',
        equipment: { ...state.equipment.find((e) => e.id === 'custom-tank'), active: false },
      }),
    /активным заказом/,
  );
  // The old implementation incorrectly shared CM-02 between lines 1 and 2.
  const initial = seedState();
  const next = complete(initial, 'order-4');
  assert.equal(orderOf(next, 'order-4').stage, orderOf(initial, 'order-4').stage + 1);
  assert.notEqual(
    operationOf(orderOf(next, 'order-4')).equipmentId,
    operationOf(orderOf(next, 'order-5')).equipmentId,
  );
});

test('CIP and line occupancy remain enforced, including quality in the middle of a process', () => {
  let state = setup();
  state.lines[2].status = 'cip';
  let id;
  [state, id] = create(state);
  state = transition(state, { type: 'reserve', orderId: id });
  assert.throws(() => transition(state, { type: 'start', orderId: id }), /санитарной/);
  state = transition(state, { type: 'finishCip', lineId: 'l3' });
  state = transition(state, { type: 'start', orderId: id });
  state = complete(state, id);
  let next;
  [state, next] = create(state);
  state = transition(state, { type: 'reserve', orderId: next });
  assert.throws(() => transition(state, { type: 'start', orderId: next }), /Линия занята/);
});

test('pause blocks recording and resume returns to the configured operation type', () => {
  let [state, id] = create(setup());
  state = transition(state, { type: 'reserve', orderId: id });
  state = transition(state, { type: 'start', orderId: id });
  state = complete(state, id);
  state = transition(state, { type: 'startOperation', orderId: id });
  state = transition(state, { type: 'pause', orderId: id, reason: 'Проверка' });
  assert.throws(() => complete(state, id), /не находится/);
  state = transition(state, { type: 'resume', orderId: id });
  assert.equal(orderOf(state, id).status, 'quality');
});

test('raw lot blocking prevents future consumption and descendant shipments', () => {
  let [state, id] = create(setup());
  state = transition(state, { type: 'reserve', orderId: id });
  state = transition(state, { type: 'blockLot', lotId: 'milk-1' });
  const started = transition(state, { type: 'start', orderId: id });
  assert.throws(() => consumeReserved(started, id), /не допущена|заблокировано/);
  state = transition(state, { type: 'blockLot', lotId: 'milk-1' });
  state = transition(state, { type: 'start', orderId: id });
  state = complete(state, id);
  state = complete(state, id);
  state = complete(state, id);
  state = transition(state, { type: 'blockLot', lotId: 'milk-1' });
  const lot = state.finished.find((l) => l.orderId === id);
  assert.throws(
    () =>
      transition(state, { type: 'ship', lotId: lot.id, qty: 1, customerId: 'party-crossroads' }),
    /заблокирована/,
  );
});

test('unit changes on accounted materials, duplicate codes, and unpublished or archived processes are rejected', () => {
  let state = setup();
  assert.throws(
    () =>
      transition(state, { type: 'saveMaterial', material: { ...state.materials[0], unit: 'л' } }),
    /единицу измерения/,
  );
  assert.throws(
    () =>
      transition(state, {
        type: 'saveMaterial',
        material: { ...state.materials[0], id: 'another' },
      }),
    /Код материала/,
  );
  state = transition(state, { type: 'archiveProcess', processId: 'custom' });
  assert.throws(() => create(state), /опубликованный/);
});

test('legacy migration preserves balances, history, reservations and can continue a running order', () => {
  const lots = initialInventory(),
    allocations = [
      ['milk-1', 'milk', 910],
      ['sugar-1', 'sugar', 40],
      ['fruit-1', 'strawberry', 49],
      ['culture-1', 'culture', 1],
      ['cup-1', 'cup', 6667],
    ].map(([lotId, material, qty]) => ({ lotId, material, qty }));
  for (const a of allocations) lots.find((l) => l.id === a.lotId).qty -= a.qty;
  const legacy = {
    version: 1,
    lines: [{ id: 'l1', name: 'Линия 01', status: 'ready' }],
    lots,
    orders: [
      {
        id: 'order-1',
        seq: 1,
        code: 'ПЗ-2610-001',
        recipe: 'strawberry',
        qty: 1000,
        line: 'l1',
        date: '2026-10-22',
        start: '08:00',
        due: '12:00',
        status: 'running',
        stage: 2,
        samples: [
          { stage: 0, value: 1000, time: '2026-10-22T05:00:00Z' },
          { stage: 1, value: 94, time: '2026-10-22T06:00:00Z' },
        ],
        allocations,
        actual: 0,
        operator: 'Оператор',
      },
    ],
    finished: [],
    shipments: [],
    events: [],
  };
  let state = migrateState(legacy);
  assert.deepEqual(
    state.lots.map(({ supplierId, ...lot }) => lot),
    lots,
  );
  assert.ok(
    state.lots.every((lot) =>
      state.counterparties.some(
        (party) => party.id === lot.supplierId && party.name === lot.supplier,
      ),
    ),
  );
  assert.equal(state.orders[0].samples.length, 2);
  assert.equal(state.orders[0].allocations.filter((a) => a.consumed).length, 5);
  const before = state.lots.map((l) => l.qty);
  while (state.orders[0].status !== 'completed') state = complete(state, 'order-1');
  assert.deepEqual(
    state.lots.map((l) => l.qty),
    before,
  );
  assert.equal(state.finished.length, 1);
  assert.equal(state.orders[0].samples.length, 6);
  assert.equal(legacy.version, 1);
});

test('configured output limits and fractional pieces prevent incorrect inventory entries', () => {
  let [state, id] = create(setup());
  state = transition(state, { type: 'reserve', orderId: id });
  state = transition(state, { type: 'start', orderId: id });
  state = complete(state, id);
  state = complete(state, id);
  assert.throws(() => complete(state, id, { outputs: { 'product-out': 197 } }), /не больше/);
  assert.equal(state.finished.filter((l) => l.orderId === id).length, 0);
  const process = customProcess();
  process.outputMaterial = 'cup';
  process.baseQty = 100;
  process.operations = [
    {
      id: 'produce',
      name: 'Упаковка',
      kind: 'production',
      equipmentId: '',
      inputs: [],
      outputs: [{ id: 'cup', material: 'cup', qty: 100, destination: 'stock' }],
      parameters: [],
    },
  ];
  state = transition(state, { type: 'saveProcess', process, publish: true });
  assert.throws(() => create(state, { qty: 1.5 }), /целым/);
});
