import test from 'node:test';
import assert from 'node:assert/strict';
import { agroTraceState } from './testFixtures/agroTraceState.js';
import {
  createTraceIndex,
  buildTrace,
  traceSearch,
  traceSelection,
  traceQuantity,
  buildTraceTree,
  visibleTraceNodes,
} from './genealogy.js';
import { transition, seedState } from './domain.js';

test('origin tree preserves both mixing inputs and references their shared production ancestry', () => {
  const state = agroTraceState(),
    index = createTraceIndex(state);
  const pallet = state.finished.find((lot) => lot.material === 'pallet');
  const tree = buildTraceTree(index, { type: 'lot', id: pallet.id });
  const graph = buildTrace(index, { type: 'lot', id: pallet.id });
  assert.equal(tree.nodes[0].id, pallet.id);
  assert.equal(tree.byKey.get(tree.nodes[0].children[0]).id, 'order-7');
  const mixing = tree.byKey.get(tree.first.get('order/order-7'));
  const ingredients = mixing.children.map((key) => tree.byKey.get(key));
  assert.ok(ingredients.some((node) => node.record.material === 'trim' && node.qty === 16));
  assert.ok(ingredients.some((node) => node.record.material === 'fat' && node.qty === 3.6));
  const cutting = tree.nodes.filter((node) => node.type === 'order' && node.id === 'order-5');
  assert.equal(cutting.length, 2);
  assert.equal(cutting.filter((node) => node.children.length).length, 1);
  assert.equal(cutting[1].reference, cutting[0].key);
  assert.deepEqual(
    new Set(tree.nodes.filter((node) => node.type === 'order').map((node) => node.id)),
    graph.orderIds,
  );
  assert.deepEqual(
    new Set(tree.nodes.filter((node) => node.type === 'lot').map((node) => node.id)),
    graph.lotIds,
  );
});

test('forward tree includes incomplete consumers and shipment leaves but excludes reservations', () => {
  const state = agroTraceState(),
    index = createTraceIndex(state);
  const live = state.lots.find((lot) => lot.material === 'live');
  const tree = buildTraceTree(index, { type: 'lot', id: live.id }, 'forward');
  const inspection = tree.byKey.get(tree.first.get('order/order-3'));
  assert.equal(inspection.record.status, 'reinspection');
  assert.equal(inspection.children.length, 0);
  const shipment = tree.nodes.find((node) => node.type === 'shipment');
  assert.equal(shipment.record.customer, 'РЦ «Перекрёсток»');
  assert.equal(tree.byKey.get(shipment.parentKey).id, shipment.record.lotId);
  const prepared = seedState('agro');
  const preparedIndex = createTraceIndex(prepared);
  const planned = buildTraceTree(preparedIndex, { type: 'order', id: prepared.orders[0].id });
  assert.equal(planned.nodes.length, 1);
});

test('tree search reveals ancestors of hidden matches without changing disclosure state', () => {
  const state = agroTraceState(),
    index = createTraceIndex(state);
  const pallet = state.finished.find((lot) => lot.material === 'pallet');
  const tree = buildTraceTree(index, { type: 'lot', id: pallet.id });
  const expanded = new Set();
  assert.equal(visibleTraceNodes(tree, expanded).length, 1);
  const found = visibleTraceNodes(tree, expanded, 'СЕВЕРНЫЙ');
  assert.equal(found[0].id, pallet.id);
  assert.ok(found.some((node) => node.record?.supplier === 'СК Северный'));
  assert.ok(
    found.every((node) => !node.parentKey || found.some((parent) => parent.key === node.parentKey)),
  );
  assert.ok(
    visibleTraceNodes(tree, expanded, 'Тримминг').some((node) => node.record?.material === 'trim'),
  );
  assert.equal(visibleTraceNodes(tree, expanded, 'несуществующая-партия').length, 0);
  assert.equal(expanded.size, 0);
});

test('tree keeps missing sources visible and terminates cyclic links with a reference', () => {
  const state = agroTraceState();
  const cutting = state.orders.find((order) => order.id === 'order-5');
  const output = state.finished.find((lot) => lot.orderId === cutting.id);
  cutting.allocations.push({ ...cutting.allocations[0], lotId: output.id });
  cutting.allocations.push({
    ...cutting.allocations[0],
    lotId: 'missing-lot',
    lotCode: 'LOST-MTU',
  });
  const index = createTraceIndex(state);
  const tree = buildTraceTree(index, { type: 'lot', id: output.id });
  assert.ok(tree.nodes.length < 30);
  assert.ok(
    tree.nodes.some((node) => node.id === output.id && node.reference === tree.nodes[0].key),
  );
  const missing = tree.nodes.find((node) => node.id === 'missing-lot');
  assert.equal(missing.missing, true);
  assert.equal(missing.code, 'LOST-MTU');
  assert.ok(
    visibleTraceNodes(tree, new Set(), 'LOST-MTU').some((node) => node.id === 'missing-lot'),
  );
});

test('a pallet shows the complete actual farm-to-product chain and no unrelated carcass or coproduct branch', () => {
  const state = agroTraceState(),
    index = createTraceIndex(state);
  const pallet = state.finished.find((lot) => lot.material === 'pallet');
  const graph = buildTrace(index, { type: 'lot', id: pallet.id });
  assert.deepEqual(
    graph.orders.map((order) => order.id),
    ['order-1', 'order-2', 'order-5', 'order-7'],
  );
  assert.deepEqual(
    graph.orders.map((order) => graph.depth.get(order.id)),
    [0, 1, 2, 3],
  );
  assert.equal(graph.outputsFor('order-1').length, 1);
  assert.equal(graph.outputsFor('order-1')[0].code, 'ПР-261022-001');
  assert.deepEqual(
    graph
      .outputsFor('order-5')
      .map((lot) => lot.material)
      .sort(),
    ['fat', 'trim'],
  );
  assert.equal(graph.edges.find((edge) => edge.orderId === 'order-1').qty, 365);
  assert.equal(
    graph.edges.find((edge) => edge.orderId === 'order-7' && edge.material === 'trim').qty,
    16,
  );
  assert.equal(graph.shipments[0].customer, 'РЦ «Перекрёсток»');
  assert.equal(graph.reservations.length, 0);
  assert.equal(graph.cyclic, false);
  assert.equal(graph.missing.length, 0);
  assert.ok(graph.roots.some((id) => index.lots.get(id).livestock));
});

test('forward trace includes actual recipients and shipments, including an unfinished inspection, but never follows reservations', () => {
  let state = agroTraceState();
  state = transition(state, {
    type: 'createOrder',
    processId: 'mince',
    qty: 20,
    line: state.orders[6].line,
    date: '2026-10-22',
  });
  const seasoning = state.lots.find((lot) => lot.material === 'seasoning');
  state = transition(state, {
    type: 'prepareOrder',
    orderId: 'order-9',
    reservations: [{ operationId: 'mix', inputId: 'in-seasoning', lotId: seasoning.id, qty: 0.4 }],
  });
  const index = createTraceIndex(state),
    live = state.lots.find((lot) => lot.material === 'live');
  const graph = buildTrace(index, { type: 'lot', id: live.id }, 'forward');
  assert.equal(graph.orders.length, 8);
  assert.equal(graph.orders.find((order) => order.id === 'order-3').status, 'reinspection');
  assert.equal(graph.outputsFor('order-3').length, 0);
  assert.ok(!graph.orderIds.has('order-9'));
  assert.equal(graph.shipments.length, 1);
  const supply = buildTrace(index, { type: 'lot', id: seasoning.id }, 'forward');
  assert.deepEqual(
    supply.orders.map((order) => order.id),
    ['order-7'],
  );
  assert.equal(supply.reservations[0].orderId, 'order-9');
  const prepared = buildTrace(index, { type: 'order', id: 'order-9' });
  assert.equal(prepared.edges.length, 0);
  assert.equal(prepared.lotIds.size, 0);
  assert.equal(prepared.reservations.length, 1);
});

test('search finds MTUs, carcass numbers, RFID, farm, products and order codes without a full dropdown', () => {
  const state = agroTraceState(),
    index = createTraceIndex(state);
  assert.equal(traceSearch(index, 'lot', 'СЕВЕРНЫЙ')[0].lot.material, 'live');
  assert.equal(
    traceSearch(index, 'lot', 'УБ-26-000001').some((row) => row.lot.material === 'cold'),
    true,
  );
  assert.ok(traceSearch(index, 'lot', 'R-821').some((row) => row.lot.material === 'cold'));
  assert.equal(traceSearch(index, 'lot', 'ПЗ-2610-007')[0].lot.material, 'pallet');
  assert.equal(traceSearch(index, 'lot', 'фарша палета')[0].lot.material, 'pallet');
  assert.equal(traceSearch(index, 'order', 'ПЗ-2610-008')[0].order.recipe, 'rendering');
  assert.equal(traceSearch(index, 'order', '', '2026-10-23').length, 0);
  assert.equal(traceSearch(index, 'lot', 'неттакогокода').length, 0);
  assert.deepEqual(traceSelection(index, 'order-7'), { type: 'order', id: 'order-7' });
  assert.equal(traceSelection(index, { type: 'lot', id: 'unknown' }), null);
});

test('partial MTU issues combine once per transformation while keeping their individual movements', () => {
  const state = agroTraceState(),
    order = state.orders.find((order) => order.id === 'order-8');
  const allocation = order.allocations[0];
  allocation.qty = 5;
  order.allocations.push({ ...allocation, qty: 8, movementId: 'second-issue' });
  const index = createTraceIndex(state),
    graph = buildTrace(index, { type: 'order', id: order.id });
  const edge = graph.edges.find((edge) => edge.orderId === order.id);
  assert.equal(edge.qty, 13);
  assert.deepEqual(
    edge.movements.map((row) => row.qty),
    [5, 8],
  );
  assert.deepEqual(
    graph.orders.map((row) => row.id),
    ['order-1', 'order-2', 'order-5', 'order-8'],
  );
});

test('blending from two carcasses retains both branches and expands their shared ancestor once', () => {
  const state = agroTraceState(),
    cutting = state.orders.find((order) => order.id === 'order-5');
  const secondCold = state.finished.find(
    (lot) => lot.material === 'cold' && lot.orderId === 'order-4',
  );
  state.orders.push({
    ...structuredClone(cutting),
    id: 'cut-other',
    code: 'ПЗ-OTHER',
    allocations: [{ lotId: secondCold.id, material: 'cold', qty: 98.8, consumed: true }],
  });
  state.finished.push({
    id: 'trim-other',
    code: 'TRIM-OTHER',
    material: 'trim',
    name: 'Тримминг',
    qty: 8,
    remaining: 0,
    unit: 'кг',
    orderId: 'cut-other',
  });
  const mince = state.orders.find((order) => order.id === 'order-7');
  mince.allocations.find((row) => row.material === 'trim').qty = 8;
  mince.allocations.push({ lotId: 'trim-other', material: 'trim', qty: 8, consumed: true });
  const index = createTraceIndex(state),
    graph = buildTrace(index, { type: 'order', id: mince.id });
  assert.ok(graph.orderIds.has('order-2') && graph.orderIds.has('order-4'));
  assert.equal(graph.orders.filter((order) => order.id === 'order-1').length, 1);
  assert.equal(
    graph.edges.filter((edge) => edge.orderId === mince.id && edge.material === 'trim').length,
    2,
  );
  for (const edge of graph.edges) {
    const parent = index.lots.get(edge.lotId)?.orderId;
    if (graph.orderIds.has(parent))
      assert.ok(graph.depth.get(parent) < graph.depth.get(edge.orderId));
  }
});

test('missing source records and cycles are reported without fabricating origins or looping', () => {
  const state = agroTraceState();
  const live = state.lots.find((lot) => lot.material === 'live');
  state.lots = state.lots.filter((lot) => lot.id !== live.id);
  let index = createTraceIndex(state),
    graph = buildTrace(index, { type: 'order', id: 'order-7' });
  assert.equal(graph.missing.length, 1);
  assert.equal(graph.missing[0].lotId, live.id);
  const pallet = state.finished.find((lot) => lot.material === 'pallet');
  state.orders
    .find((order) => order.id === 'order-1')
    .allocations.push({ lotId: pallet.id, material: 'pallet', qty: 1, consumed: true });
  index = createTraceIndex(state);
  graph = buildTrace(index, { type: 'lot', id: pallet.id });
  assert.equal(graph.cyclic, true);
  assert.equal(graph.orders.length, 4);
});

test('receipt quantities remain distinct from depleted stock, including legacy saves', () => {
  const state = agroTraceState(),
    index = createTraceIndex(state);
  const live = state.lots.find((lot) => lot.material === 'live'),
    trays = state.lots.find((lot) => lot.material === 'tray');
  assert.equal(live.qty, 0);
  assert.equal(traceQuantity(index, live), 365);
  assert.equal(trays.qty, 450);
  assert.equal(traceQuantity(index, trays), 500);
  delete live.receivedQty;
  assert.equal(traceQuantity(createTraceIndex(state), live), 365);
  assert.equal(
    traceQuantity(
      index,
      state.finished.find((lot) => lot.material === 'pallet'),
    ),
    20,
  );
});

test('a thousand recipients can be indexed and searched without truncating the actual genealogy', () => {
  const state = seedState('agro'),
    template = state.orders[6],
    source = state.lots[0];
  state.orders = Array.from({ length: 1000 }, (_, i) => ({
    ...structuredClone(template),
    id: `order-load-${i}`,
    code: `ПЗ-LOAD-${i}`,
    allocations: [{ lotId: source.id, material: source.material, qty: 0.001, consumed: true }],
  }));
  state.finished = state.orders.map((order, i) => ({
    id: `lot-load-${i}`,
    code: `ПЛ-LOAD-${i}`,
    orderId: order.id,
    material: 'pallet',
    name: 'Палета фарша',
    qty: 20,
    remaining: 20,
    unit: 'кг',
  }));
  const index = createTraceIndex(state),
    graph = buildTrace(index, { type: 'lot', id: source.id }, 'forward');
  assert.equal(graph.orders.length, 1000);
  assert.equal(graph.lotIds.size, 1001);
  assert.equal(graph.edges.length, 1000);
  assert.equal(traceSearch(index, 'order', 'ПЗ-LOAD-999').length, 1);
  assert.equal(traceSearch(index, 'lot', 'ПЛ-LOAD-999').length, 1);
  assert.equal(graph.orders.filter((order) => graph.depth.get(order.id) !== 0).length, 0);
  const tree = buildTraceTree(index, { type: 'lot', id: source.id }, 'forward');
  assert.equal(tree.nodes.length, 2001);
  assert.equal(tree.nodes[0].children.length, 1000);
  const found = visibleTraceNodes(tree, new Set(), 'ПЛ-LOAD-999');
  assert.equal(found.length, 3);
  assert.equal(found.at(-1).record.code, 'ПЛ-LOAD-999');
});
