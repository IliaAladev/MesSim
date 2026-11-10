import { resourceActive } from './resources.js';
import { validateMassBalance } from './materialBalance.js';

// Reordering is staged in the editor. These helpers never mutate a published route.
export function moveOperation(operations, id, position) {
  const from = operations.findIndex((op) => op.id === id);
  if (from < 0 || !Number.isInteger(position) || position < 0 || position >= operations.length)
    throw new Error('Недопустимая позиция операции');
  const result = [...operations];
  const [operation] = result.splice(from, 1);
  result.splice(position, 0, operation);
  return result;
}

export function validateOperationDraft(operation, store, resourceMode) {
  const fail = (message, section = 'general') => {
    const error = new Error(message);
    error.section = section;
    throw error;
  };
  if (!operation.name?.trim()) fail('Укажите наименование операции');
  if (!['production', 'quality'].includes(operation.kind)) fail('Выберите тип операции');
  if (resourceMode === 'class' && !operation.equipmentClass) fail('Выберите класс оборудования');
  if (resourceMode === 'fixed' && !operation.equipmentId) fail('Выберите оборудование');
  if (operation.equipmentClass && operation.equipmentId)
    fail('Укажите один способ назначения оборудования');
  if (
    operation.equipmentId &&
    !store.equipment.some((eq) => eq.id === operation.equipmentId && resourceActive(store, eq.id))
  )
    fail('Выбранное оборудование недоступно');
  if (
    operation.equipmentClass &&
    !store.equipment.some(
      (eq) => eq.classCode === operation.equipmentClass && resourceActive(store, eq.id),
    )
  )
    fail('Нет доступного оборудования выбранного класса');
  for (const [group, key, choices] of [
    ['inputs', 'source', ['stock', 'process']],
    ['outputs', 'destination', ['stock', 'process']],
  ]) {
    for (const row of operation[group]) {
      if (!store.materials.some((m) => m.id === row.material && m.active !== false))
        fail('Выберите материал в каждой строке', 'materials');
      if (row.qty === '' || !Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0)
        fail('Количество материала должно быть больше нуля', 'materials');
      if (!choices.includes(row[key]))
        fail('Укажите источник или назначение материала', 'materials');
      if (row.shelf != null && (!Number.isInteger(Number(row.shelf)) || Number(row.shelf) < 1))
        fail('Срок годности выхода должен быть целым числом суток больше нуля', 'materials');
    }
  }
  for (const parameter of operation.parameters) {
    if (!parameter.name?.trim() || !['number', 'text', 'boolean'].includes(parameter.type))
      fail('Заполните наименование и тип каждого параметра', 'parameters');
    if (parameter.type !== 'number') continue;
    const number = (key) =>
      parameter[key] === '' || parameter[key] == null ? null : Number(parameter[key]);
    const [min, target, max] = ['min', 'target', 'max'].map(number);
    if ([min, target, max].some((n) => n !== null && !Number.isFinite(n)))
      fail(`Проверьте числовые значения параметра «${parameter.name}»`, 'parameters');
    if (min !== null && max !== null && min > max)
      fail(`Нижний допуск больше верхнего у «${parameter.name}»`, 'parameters');
    if (target !== null && ((min !== null && target < min) || (max !== null && target > max)))
      fail(`Номинал вне допуска у «${parameter.name}»`, 'parameters');
  }
  // Cross-operation balances are validated when the complete process is published.
  try {
    validateMassBalance(operation, store.materials);
  } catch (e) {
    fail(e.message, 'materials');
  }
  return true;
}
