import { operationOf, operationsOf, operationInputQty, scaledQty, orderUnit } from './domain.js';

export const operationTaskId = (order, op) => `${order.id}/${op.id}`;
export const workplaceOf = (order, op) => op.equipmentId || `manual:${order.line}`;

// Only the released operation and completed records belong to the task queue.
// The route is sequential; future operations are not executable assignments.
export function operatorTasks(state) {
  return state.orders.flatMap((order) => {
    if (order.status === 'planned') return [];
    return operationsOf(order).flatMap((operation, index) => {
      if (operation.kind !== 'production') return [];
      const sample = order.samples.find((s) => s.operationId === operation.id);
      const current = order.status !== 'completed' && index === order.stage;
      if (!sample && !current) return [];
      return [
        {
          id: operationTaskId(order, operation),
          order,
          operation,
          index,
          sample,
          workplace: workplaceOf(order, operation),
          status: sample
            ? 'completed'
            : ['queued', 'ready'].includes(order.status)
              ? 'ready'
              : order.status,
        },
      ];
    });
  });
}

export function taskVolume(task) {
  if (task.operation.carcassGrading) {
    const identification = operationsOf(task.order).find((op) => op.carcassIdentification);
    if (identification) {
      const mass = identification.inputs
        .filter((input) => input.unit === 'кг')
        .reduce((sum, input) => sum + operationInputQty(input, task.order, identification), 0);
      if (mass > 0) return mass;
    }
  }
  const rows = task.operation.inputs.filter((r) => r.unit === 'кг');
  const mass = (rows.length ? rows : task.operation.outputs.filter((r) => r.unit === 'кг')).reduce(
    (sum, row) =>
      sum +
      (rows.length
        ? row.source === 'stock'
          ? Math.max(operationInputQty(row, task.order, task.operation), scaledQty(row, task.order))
          : operationInputQty(row, task.order, task.operation)
        : scaledQty(row, task.order)),
    0,
  );
  return mass || task.order.qty;
}
export const taskUnit = (task) =>
  [...task.operation.inputs, ...task.operation.outputs].some((r) => r.unit === 'кг')
    ? 'кг'
    : orderUnit(task.order);

export function qualityPending(order) {
  return !['planned', 'completed'].includes(order.status) && operationOf(order)?.kind === 'quality';
}
