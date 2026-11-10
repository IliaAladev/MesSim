import { transition, operationOf, materialAssignments } from '../domain.js';

// Explicit stock confirmations used only to construct test history.
export function consumeReserved(state, id) {
  const order = state.orders.find((item) => item.id === id);
  if (!['running', 'quality'].includes(order.status)) return state;
  for (const row of materialAssignments(order, operationOf(order)).filter((item) => !item.consumed))
    state = transition(state, {
      type: 'consumeMaterial',
      orderId: id,
      operationId: operationOf(order).id,
      inputId: row.inputId,
      code: row.lotId,
      qty: row.qty,
    });
  return state;
}
