import { consumeReserved } from './consumeReserved.js';
import { DAY, transition, operationOf, defaultValues } from '../domain.js';
import { createMeatCatalog } from './legacyMeatCatalog.js';

function startSeedOperation(state, id) {
  state = ['queued', 'waiting'].includes(state.orders.find((o) => o.id === id)?.status)
    ? transition(state, { type: 'startOperation', orderId: id })
    : state;
  return consumeReserved(state, id);
}

export function seedLegacyMeatState() {
  let state = {
    version: 3,
    scenarioId: 'meat',
    ...createMeatCatalog(),
    orders: [],
    finished: [],
    shipments: [],
    events: [],
  };
  for (const p of state.processes)
    if (['pork-cutting', 'pork-pack', 'pork-mince'].includes(p.id)) p.preserveExpiry = true;
  const make = (processId, qty, line, count = -1) => {
    state = transition(state, {
      type: 'createOrder',
      processId,
      qty,
      line,
      date: DAY,
      start: '08:00',
      due: '20:00',
    });
    const id = state.orders.at(-1).id;
    if (count >= 0) state = transition(state, { type: 'reserve', orderId: id });
    if (count > 0) state = transition(state, { type: 'start', orderId: id });
    for (let i = 0; i < count; i++) {
      state = startSeedOperation(state, id);
      const order = state.orders.find((o) => o.id === id);
      const values = defaultValues(order);
      for (const p of operationOf(order).parameters) {
        if (p.type === 'boolean') values[p.id] = true;
        if (p.type === 'text') values[p.id] = 'ДЕМО-ВЕТ-221026-01';
      }
      state = transition(state, { type: 'advance', orderId: id, values });
    }
    if (count > 0) state = startSeedOperation(state, id);
    return id;
  };
  make('pork-primary', 2940, 'slaughter', 8);
  make('pork-cutting', 440, 'cutting', 10);
  make('pork-pack', 218, 'packing', 5);
  make('pork-mince', 75, 'mince', 2);
  const sausage = make('pork-sausage', 90, 'sausage', 4);
  state = transition(state, {
    type: 'pause',
    orderId: sausage,
    reason: 'Проверка температурной записи перед охлаждением',
  });
  make('pork-cutting', 220, 'cutting', 3);
  make('pork-pack', 109, 'packing', 0);
  make('pork-primary', 980, 'slaughter');
  // Fix the demo history to the simulated shift, as in the dairy seed.
  for (const order of state.orders)
    order.samples.forEach((sample, i) => {
      sample.time = new Date(
        Date.parse(`${DAY}T08:00:00+04:00`) + (i + 1) * 15 * 60000,
      ).toISOString();
    });
  state.events = [
    {
      id: 'meat-demo',
      time: `${DAY}T08:50:00Z`,
      kind: 'info',
      message:
        'Мясопереработка: открывайте генеалогию заказа разделки, чтобы проследить выходы и последующую переработку.',
      orderId: 'order-2',
    },
    ...state.events.slice(0, 14).map((event, i) => ({
      ...event,
      time: new Date(Date.parse(`${DAY}T08:45:00Z`) - i * 60000).toISOString(),
    })),
  ];
  return state;
}
