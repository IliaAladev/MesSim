import { confirmCarcassIdentity } from './confirmCarcassIdentity.js';
import { seedState, transition, operationOf, defaultValues } from '../domain.js';
import { consumeReserved } from './consumeReserved.js';

export function agroTraceState() {
  let state = seedState('agro');
  const act = (number, type, extra = {}) => {
    state = transition(state, { type, orderId: `order-${number}`, ...extra });
  };
  const complete = (number, values = {}) => {
    act(number, 'startOperation');
    state = consumeReserved(state, `order-${number}`);
    const order = state.orders.find((row) => row.id === `order-${number}`);
    const parameters = defaultValues(order);
    for (const parameter of operationOf(order).parameters)
      if (parameter.type === 'boolean') parameters[parameter.id] = true;
    state = confirmCarcassIdentity(state, `order-${number}`, values.rfid);
    act(number, 'advance', {
      values: Object.fromEntries(
        Object.entries({ ...parameters, ...values }).filter(
          ([key]) => key !== 'mark' && key !== 'rfid',
        ),
      ),
    });
  };
  state = transition(state, {
    type: 'receiveLot',
    material: 'live',
    supplierId: 'party-north',
    qty: 365,
    heads: 3,
    declaredWeight: 370,
    document: 'ТС-041',
  });
  state = transition(state, { type: 'releaseLot', lotId: state.lots[0].id });
  act(1, 'reserve');
  complete(1);
  for (const number of [2, 3, 4]) {
    const code = `ПР-261022-001${number === 2 ? '' : `-${number - 1}`}`;
    act(number, 'reserve', {
      lotChoices: { 'rfid/in-warm': state.finished.find((lot) => lot.code === code).id },
    });
    complete(number, { rfid: `R-${819 + number}` });
    if (number === 3) {
      act(number, 'startOperation');
      act(number, 'referInspection', { reason: 'Уточнить результат осмотра' });
      continue;
    }
    complete(number, { vet: `ВЕТ-00${number}` });
    complete(number);
    complete(number);
  }
  act(5, 'reserve', {
    lotChoices: { 'cut/in-cold': state.finished.find((lot) => lot.orderId === 'order-2').id },
  });
  complete(5);
  complete(5);
  act(6, 'reserve');
  complete(6);
  act(7, 'reserve');
  complete(7);
  complete(7);
  act(8, 'reserve');
  complete(8);
  complete(8);
  const pallet = state.finished.find((lot) => lot.material === 'pallet');
  state = transition(state, { type: 'acceptWarehouse', lotId: pallet.id });
  return transition(state, {
    type: 'ship',
    lotId: pallet.id,
    qty: 20,
    customerId: 'party-crossroads',
  });
}
