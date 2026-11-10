// The simulator has one signed-in user. All new records use the same identity
// as the application header, independently of the operation's production role.
export const CURRENT_USER = Object.freeze({ id: 'ilya-aladyev', name: 'Илья Аладьев' });

export function upgradeDemoIdentity(state) {
  const correct = (record, field) => {
    if (record?.[field] === 'Елена Смирнова' || record?.[field] === 'Елена Смирнова · ОТК')
      record[field] = CURRENT_USER.name;
  };
  for (const order of state.orders) {
    correct(order, 'operator');
    correct(order.quality, 'inspector');
    for (const sample of order.samples || []) correct(sample, 'operator');
    for (const allocation of order.allocations || []) {
      correct(allocation, 'assignedBy');
      correct(allocation, 'consumedBy');
    }
  }
  for (const event of state.events || []) {
    correct(event, 'actor');
    if (!event.actor && /^seed-/.test(event.id)) event.actor = CURRENT_USER.name;
  }
  return state;
}
