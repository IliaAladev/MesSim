import { recipeOf, round, stockLots } from './domain.js';

const add = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};
const searchText = (...values) =>
  values
    .flat(Infinity)
    .filter((value) => value != null)
    .join(' ')
    .toLocaleLowerCase('ru');

// Index the recorded movements once. Reservations never become transformation edges.
export function createTraceIndex(state) {
  const orders = new Map(state.orders.map((order) => [order.id, order]));
  const materials = new Map(state.materials.map((material) => [material.id, material]));
  const carcasses = new Map((state.carcasses || []).map((record) => [record.id, record]));
  const slaughterBatches = new Map(
    (state.slaughterBatches || []).map((batch) => [batch.id, batch]),
  );
  const lots = new Map(stockLots(state).map((lot) => [lot.id, lot]));
  const outputs = new Map(),
    inputs = new Map(),
    consumers = new Map(),
    reservations = new Map(),
    orderReservations = new Map();
  const shipments = new Map();
  for (const lot of lots.values()) if (lot.orderId) add(outputs, lot.orderId, lot);
  for (const order of orders.values()) {
    const grouped = new Map();
    for (const allocation of order.allocations) {
      if (!allocation.consumed) {
        const row = { ...allocation, orderId: order.id };
        add(reservations, allocation.lotId, row);
        add(orderReservations, order.id, row);
        continue;
      }
      let edge = grouped.get(allocation.lotId);
      if (!edge) {
        edge = {
          lotId: allocation.lotId,
          orderId: order.id,
          material: allocation.material,
          code: allocation.lotCode || allocation.mtuCode || allocation.lotId,
          qty: 0,
          movements: [],
        };
        grouped.set(allocation.lotId, edge);
      }
      edge.qty = round(edge.qty + allocation.qty);
      edge.movements.push(allocation);
    }
    for (const edge of grouped.values()) {
      add(inputs, order.id, edge);
      add(consumers, edge.lotId, edge);
    }
  }
  for (const shipment of state.shipments) add(shipments, shipment.lotId, shipment);
  const rows = {
    lot: [...lots.values()].map((lot) => {
      const order = orders.get(lot.orderId),
        material = materials.get(lot.material);
      return {
        type: 'lot',
        id: lot.id,
        code: lot.code,
        name: lot.name || material?.name || lot.material,
        date: order?.date || lot.received || lot.producedAt?.slice(0, 10) || '',
        lot,
        order,
        search: searchText(
          lot.code,
          lot.mtuCode,
          lot.name,
          material?.name,
          lot.mark,
          carcasses.get(lot.carcassId)?.slaughterNumber,
          carcasses.get(lot.carcassId)?.carrierHistory.map((row) => row.code),
          slaughterBatches.get(lot.slaughterBatchId)?.number,
          lot.supplier,
          lot.livestock?.document,
          order?.code,
          order?.samples.map((sample) => Object.values(sample.values)),
        ),
      };
    }),
    order: [...orders.values()].map((order) => ({
      type: 'order',
      id: order.id,
      code: order.code,
      name: recipeOf(order).name,
      date: order.date,
      order,
      search: searchText(
        order.code,
        recipeOf(order).name,
        recipeOf(order).code,
        order.samples.map((sample) => Object.values(sample.values)),
      ),
    })),
  };
  for (const collection of Object.values(rows))
    collection.sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.code.localeCompare(a.code, 'ru', { numeric: true }),
    );
  return {
    orders,
    carcasses,
    slaughterBatches,
    materials,
    lots,
    outputs,
    inputs,
    consumers,
    reservations,
    orderReservations,
    shipments,
    shipmentRecords: new Map(state.shipments.map((shipment) => [shipment.id, shipment])),
    rows,
  };
}

export function traceQuantity(index, lot) {
  if (lot.orderId) return lot.qty;
  if (lot.receivedQty != null) return lot.receivedQty;
  if (lot.livestock) return lot.livestock.weight;
  // Older saves retain current stock plus all confirmed issues, rather than a receipt snapshot.
  return round(
    lot.qty + (index.consumers.get(lot.id) || []).reduce((sum, edge) => sum + edge.qty, 0),
  );
}

export function traceSearch(index, type, query = '', from = '', to = '') {
  const words = query.trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean);
  return index.rows[type].filter(
    (row) =>
      (!from || row.date >= from) &&
      (!to || row.date <= to) &&
      words.every((word) => row.search.includes(word)),
  );
}

export function traceSelection(index, value) {
  const selection = typeof value === 'string' ? { type: 'order', id: value } : value;
  if (!selection || !['order', 'lot'].includes(selection.type)) return null;
  return (selection.type === 'lot' ? index.lots : index.orders).has(selection.id)
    ? selection
    : null;
}

export function buildTrace(index, selection, direction = 'backward') {
  const lotIds = new Set(),
    orderIds = new Set(),
    expanded = new Set();
  const seedOrder = selection.type === 'order' ? index.orders.get(selection.id) : null;
  const selectedLots = new Set(
    selection.type === 'lot'
      ? [selection.id]
      : (index.outputs.get(selection.id) || []).map((lot) => lot.id),
  );
  const pending = [...selectedLots];
  if (seedOrder) {
    orderIds.add(seedOrder.id);
    if (direction === 'backward')
      pending.push(...(index.inputs.get(seedOrder.id) || []).map((edge) => edge.lotId));
  }
  // Iterative traversal also supports old or malformed saves without recursive overflow.
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const id = pending[cursor];
    if (expanded.has(id)) continue;
    expanded.add(id);
    lotIds.add(id);
    if (direction === 'backward') {
      const producer = index.lots.get(id)?.orderId;
      if (!producer || !index.orders.has(producer)) continue;
      if (!orderIds.has(producer)) {
        orderIds.add(producer);
        pending.push(...(index.inputs.get(producer) || []).map((edge) => edge.lotId));
      }
    } else {
      for (const edge of index.consumers.get(id) || []) {
        if (orderIds.has(edge.orderId)) continue;
        orderIds.add(edge.orderId);
        pending.push(...(index.outputs.get(edge.orderId) || []).map((lot) => lot.id));
      }
    }
  }
  // Keep incoming side materials visible even in a forward investigation, without following their ancestors.
  const edges = [...orderIds].flatMap((id) => index.inputs.get(id) || []);
  if (direction === 'backward') for (const id of selectedLots) lotIds.add(id);
  const relatedReservations = [
    ...new Set([
      ...[...lotIds].flatMap((id) => index.reservations.get(id) || []),
      ...(seedOrder ? index.orderReservations.get(seedOrder.id) || [] : []),
    ]),
  ];
  const parents = new Map(),
    children = new Map(),
    indegree = new Map(),
    depth = new Map();
  for (const id of orderIds) {
    parents.set(id, new Set());
    children.set(id, new Set());
    depth.set(id, 0);
  }
  for (const edge of edges) {
    const parent = index.lots.get(edge.lotId)?.orderId;
    if (orderIds.has(parent)) {
      parents.get(edge.orderId).add(parent);
      children.get(parent).add(edge.orderId);
    }
  }
  for (const id of orderIds) indegree.set(id, parents.get(id).size);
  const ready = [...orderIds].filter((id) => !indegree.get(id)),
    sorted = [];
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const id = ready[cursor];
    sorted.push(id);
    for (const child of children.get(id)) {
      depth.set(child, Math.max(depth.get(child), depth.get(id) + 1));
      indegree.set(child, indegree.get(child) - 1);
      if (!indegree.get(child)) ready.push(child);
    }
  }
  const cyclic = sorted.length !== orderIds.size;
  if (cyclic) sorted.push(...[...orderIds].filter((id) => !sorted.includes(id)));
  const missing = edges.filter((edge) => !index.lots.has(edge.lotId));
  const brokenProducers = [...lotIds].filter((id) => {
    const lot = index.lots.get(id);
    return lot?.orderId && !index.orders.has(lot.orderId);
  });
  const roots = [...lotIds].filter((id) => !orderIds.has(index.lots.get(id)?.orderId));
  const shipments = [...lotIds].flatMap((id) => index.shipments.get(id) || []);
  return {
    lotIds,
    orderIds,
    selectedLots,
    edges,
    roots,
    orders: sorted.map((id) => index.orders.get(id)),
    depth,
    reservations: relatedReservations,
    shipments,
    cyclic,
    missing,
    brokenProducers,
    outputsFor: (id) => (index.outputs.get(id) || []).filter((lot) => lotIds.has(lot.id)),
  };
}

// A graph may merge branches or contain cycles. Expand each entity once and keep
// later occurrences as navigable references, rather than inventing a hierarchy.
export function buildTraceTree(index, selection, direction = 'backward') {
  const nodes = [],
    byKey = new Map(),
    first = new Map();
  const pending = [{ ...selection, parentKey: null, depth: 0, position: 1, siblings: 1 }];
  while (pending.length) {
    const item = pending.pop();
    const entityKey = `${item.type}/${item.id}`;
    const record =
      item.type === 'lot'
        ? index.lots.get(item.id)
        : item.type === 'order'
          ? index.orders.get(item.id)
          : item.shipment;
    const name =
      item.type === 'lot'
        ? record?.name || index.materials.get(record?.material)?.name
        : item.type === 'order' && record
          ? recipeOf(record).name
          : record?.customer;
    const node = {
      ...item,
      name,
      key: `trace-node-${nodes.length}`,
      children: [],
      record,
      missing: !record,
      reference: first.get(entityKey) || null,
    };
    nodes.push(node);
    byKey.set(node.key, node);
    if (node.parentKey) byKey.get(node.parentKey).children.push(node.key);
    if (node.reference) continue;
    first.set(entityKey, node.key);
    if (!record) continue;
    let children = [];
    if (item.type === 'lot') {
      children =
        direction === 'backward'
          ? record.orderId
            ? [{ type: 'order', id: record.orderId }]
            : []
          : [
              ...(index.consumers.get(item.id) || []).map((edge) => ({
                type: 'order',
                id: edge.orderId,
                qty: edge.qty,
                unit: record.unit || index.materials.get(record.material)?.unit,
              })),
              ...(index.shipments.get(item.id) || []).map((shipment) => ({
                type: 'shipment',
                id: shipment.id,
                shipment,
                qty: shipment.qty,
                unit: shipment.unit || record.unit || index.materials.get(record.material)?.unit,
              })),
            ];
    } else if (item.type === 'order') {
      children =
        direction === 'backward'
          ? (index.inputs.get(item.id) || []).map((edge) => ({
              type: 'lot',
              id: edge.lotId,
              qty: edge.qty,
              unit: index.lots.get(edge.lotId)?.unit || index.materials.get(edge.material)?.unit,
              code: edge.code,
            }))
          : (index.outputs.get(item.id) || []).map((lot) => ({
              type: 'lot',
              id: lot.id,
              qty: lot.qty,
              unit: lot.unit || index.materials.get(lot.material)?.unit,
            }));
    }
    // Keep the material path ahead of auxiliary packaging in an origin tree.
    if (direction === 'backward')
      children.sort(
        (a, b) =>
          Number(index.materials.get(index.lots.get(a.id)?.material)?.kind === 'packaging') -
          Number(index.materials.get(index.lots.get(b.id)?.material)?.kind === 'packaging'),
      );
    for (let i = children.length - 1; i >= 0; i--)
      pending.push({
        ...children[i],
        parentKey: node.key,
        depth: node.depth + 1,
        position: i + 1,
        siblings: children.length,
      });
  }
  return { nodes, byKey, first };
}

export function visibleTraceNodes(tree, expanded, query = '') {
  const words = query.trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean);
  if (words.length) {
    const matches = new Set();
    for (const node of tree.nodes) {
      const record = node.record;
      const text = searchText(
        node.name,
        node.code,
        record?.code,
        record?.mtuCode,
        record?.name,
        record?.supplier,
        record?.mark,
        record?.customer,
        node.type === 'order' && record ? recipeOf(record).name : '',
      );
      if (!words.every((word) => text.includes(word))) continue;
      let current = node;
      while (current && !matches.has(current.key)) {
        matches.add(current.key);
        current = tree.byKey.get(current.parentKey);
      }
    }
    return tree.nodes.filter((node) => matches.has(node.key));
  }
  const visible = new Set();
  return tree.nodes.filter((node) => {
    if (node.parentKey && (!visible.has(node.parentKey) || !expanded.has(node.parentKey)))
      return false;
    visible.add(node.key);
    return true;
  });
}
