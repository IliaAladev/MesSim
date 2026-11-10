import { transition, operationOf } from '../domain.js';
import { freeCarriers } from '../carcassTracking.js';

export function confirmCarcassIdentity(state, id, preferredRfid) {
  let order = state.orders.find((row) => row.id === id);
  if (!operationOf(order).carcassIdentification) return state;
  const source = order.allocations.find(
    (row) => row.operationId === operationOf(order).id && row.consumed,
  );
  const rfid =
    freeCarriers(state).find((row) => row.code === preferredRfid)?.code ||
    freeCarriers(state)[0]?.code;
  state = transition(state, {
    type: 'identifyCarcass',
    orderId: id,
    sourceCode: source.lotId,
    rfid,
    confirmConsumption: true,
  });
  state = transition(state, { type: 'simulatePrimaryClassification', orderId: id });
  order = state.orders.find((row) => row.id === id);
  state = transition(state, { type: 'exportCarcassMark', carcassId: order.carcassId });
  return transition(state, { type: 'confirmCarcassMark', carcassId: order.carcassId });
}
