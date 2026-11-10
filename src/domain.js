import * as carcass from './carcassTracking.js';
import {
  initialMaterials,
  initialEquipment,
  initialProcesses,
  initialInventory,
} from './catalog.js';
import { createAgroCatalog, agroPlan, agroMaterialCaption } from './agroCatalog.js';
import { CURRENT_USER, upgradeDemoIdentity } from './identity.js';
import {
  upgradeCounterparties,
  validateCounterparty,
  requireCounterparty,
} from './counterparties.js';
import { validateMassBalance, operationMassBalance } from './materialBalance.js';
import {
  resolveEquipment,
  resourceActive,
  resourcePath,
  processLineError,
  validateResource,
  resourceNodes,
  upgradeResources,
} from './resources.js';

export const DAY = '2026-10-22';
export const STORAGE_KEY = 'food-mes-v1';
export const statusLabels = {
  planned: 'Запланирован',
  ready: 'Готов к запуску',
  queued: 'Ожидает запуска операции',
  running: 'В производстве',
  hold: 'Приостановлен',
  reinspection: 'На реинспекции',
  waiting: 'Ожидание ресурса',
  quality: 'Контроль качества',
  completed: 'Завершён',
};
export const materialKinds = {
  raw: 'Сырьё',
  packaging: 'Упаковка',
  intermediate: 'Полуфабрикат',
  finished: 'Готовая продукция',
  byproduct: 'Побочная продукция',
};
export const round = (n) => Math.round(n * 1000) / 1000;
export const uid = () => globalThis.crypto.randomUUID();
export const recipeOf = (order) => order.processSnapshot;
export const operationsOf = (order) => recipeOf(order).operations;
export const operationOf = (order) => operationsOf(order)[order.stage];
export const materialOf = (state, id) => state.materials.find((m) => m.id === id);
export const stockLots = (state) => [...state.lots, ...state.finished];
export const sourceLot = (state, id) => stockLots(state).find((l) => l.id === id);
export const stockBalance = (lot) => (lot.orderId ? lot.remaining : lot.qty);
export function isOrderBlocked(state, order, seen = new Set()) {
  if (!order || seen.has(order.id)) return false;
  seen.add(order.id);
  return order.allocations
    .filter((a) => a.consumed)
    .some((a) => {
      const lot = sourceLot(state, a.lotId);
      return (
        lot?.status === 'blocked' ||
        (lot?.orderId &&
          isOrderBlocked(
            state,
            state.orders.find((o) => o.id === lot.orderId),
            seen,
          ))
      );
    });
}
export function descendantOrders(state, lotId) {
  const pending = [lotId],
    seenLots = new Set(),
    found = new Map();
  while (pending.length) {
    const id = pending.shift();
    if (seenLots.has(id)) continue;
    seenLots.add(id);
    for (const order of state.orders.filter((o) => o.allocations.some((a) => a.lotId === id))) {
      if (found.has(order.id)) continue;
      found.set(order.id, order);
      pending.push(...state.finished.filter((l) => l.orderId === order.id).map((l) => l.id));
    }
  }
  return [...found.values()];
}
export function upstreamLots(state, order) {
  const pending = order.allocations.filter((item) => item.consumed).map((item) => item.lotId);
  const found = new Map();
  while (pending.length) {
    const id = pending.pop();
    if (found.has(id)) continue;
    const lot = sourceLot(state, id);
    if (!lot) continue;
    found.set(id, lot);
    const producer = state.orders.find((item) => item.id === lot.orderId);
    if (producer)
      pending.push(
        ...producer.allocations.filter((item) => item.consumed).map((item) => item.lotId),
      );
  }
  return [...found.values()];
}
export const orderUnit = (order) => recipeOf(order).outputUnit || 'кг';
export const availableProcesses = (state) =>
  state.processes.filter((p) => p.lifecycle === 'published');
export function scaledQty(item, order) {
  const qty = (Number(item.qty) * order.qty) / recipeOf(order).baseQty;
  return item.unit === 'шт' ? Math.ceil(qty - 1e-8) : round(qty);
}
export function operationInputQty(input, order, operation) {
  const recorded = (
    order.operationExecution?.operationId === operation.id
      ? order.operationExecution.inputs
      : order.samples.find((sample) => sample.operationId === operation.id)?.inputs
  )?.find((item) => item.id === input.id);
  if (recorded) return recorded.qty;
  if (input.source === 'process' && operation.id === operationOf(order).id) {
    let plannedAvailable = 0;
    for (const previous of operationsOf(order).slice(0, order.stage)) {
      for (const output of previous.outputs)
        if (output.destination === 'process' && output.material === input.material)
          plannedAvailable += scaledQty(output, order);
      for (const consumed of previous.inputs)
        if (consumed.source === 'process' && consumed.material === input.material)
          plannedAvailable -= scaledQty(consumed, order);
    }
    let actualAvailable = order.wip[input.material] || 0;
    if (['running', 'quality', 'hold'].includes(order.status)) {
      actualAvailable = 0;
      let recordedSupply = false;
      for (const sample of order.samples) {
        for (const output of sample.outputs)
          if (output.destination === 'process' && output.material === input.material) {
            actualAvailable += output.qty;
            recordedSupply = true;
          }
        const previous = operationsOf(order).find((op) => op.id === sample.operationId);
        for (const consumed of sample.inputs || previous?.inputs || [])
          if (consumed.source === 'process' && consumed.material === input.material)
            actualAvailable -= sample.inputs ? consumed.qty : scaledQty(consumed, order);
      }
      if (!recordedSupply) return scaledQty(input, order);
    }
    if (plannedAvailable > 0)
      return round((actualAvailable * scaledQty(input, order)) / plannedAvailable);
  }
  const allocations = order.allocations.filter(
    (item) =>
      item.consumed &&
      item.operationId === operation.id &&
      (item.inputId === input.id || (!item.inputId && item.material === input.material)),
  );
  if (input.source === 'stock') return round(allocations.reduce((sum, item) => sum + item.qty, 0));
  return allocations.length
    ? round(allocations.reduce((sum, item) => sum + item.qty, 0))
    : scaledQty(input, order);
}
export function parameterBounds(parameter, order) {
  const factor = parameter.scaled ? order.qty / recipeOf(order).baseQty : 1;
  return Object.fromEntries(
    ['min', 'max', 'target'].map((key) => [
      key,
      parameter[key] === '' || parameter[key] == null
        ? null
        : round(Number(parameter[key]) * factor),
    ]),
  );
}
export function defaultValues(order, index = order.stage) {
  return Object.fromEntries(
    operationsOf(order)[index].parameters.map((p) => [
      p.id,
      p.type === 'boolean'
        ? false
        : p.type === 'text'
          ? ''
          : (parameterBounds(p, order).target ?? ''),
    ]),
  );
}
export function requirements(order) {
  const aggregated = new Map();
  for (const op of operationsOf(order))
    for (const item of op.inputs.filter((i) => i.source === 'stock')) {
      const old = aggregated.get(item.material) || {
        material: item.material,
        name: agroMaterialCaption(item),
        unit: item.unit,
        qty: 0,
      };
      old.qty = round(old.qty + scaledQty(item, order));
      aggregated.set(item.material, old);
    }
  return [...aggregated.values()];
}
export const trackedInputKey = (op, input) => `${op.id}/${input.id}`;

export function reservationLots(state, order, input, matchQuantity = true) {
  const mode = materialOf(state, input.material)?.lotMode;
  return stockLots(state)
    .filter((lot) => {
      const available = round(stockBalance(lot) - (lot.reserved || 0));
      return (
        lot.material === input.material &&
        lot.status === 'released' &&
        lot.expires >= order.date &&
        available > 0 &&
        (mode !== 'livestock' || !lot.reserved) &&
        (mode !== 'individual' ||
          (!lot.reserved && (!matchQuantity || available === scaledQty(input, order)))) &&
        (!lot.orderId ||
          !isOrderBlocked(
            state,
            state.orders.find((o) => o.id === lot.orderId),
          ))
      );
    })
    .sort((a, b) => a.expires.localeCompare(b.expires));
}

export function orderSupply(state, order, lotChoices = {}) {
  const rows = requirements(order).map((need) => {
    const inputs = operationsOf(order).flatMap((op) =>
      op.inputs
        .filter((input) => input.source === 'stock' && input.material === need.material)
        .map((input) => ({ op, input })),
    );
    const selected = inputs
      .map(({ op, input }) => lotChoices[trackedInputKey(op, input)])
      .find(Boolean);
    const lots = reservationLots(state, order, inputs[0].input, false).filter(
      (lot) => !selected || lot.id === selected,
    );
    const individual = materialOf(state, need.material)?.lotMode === 'individual';
    const available = individual
      ? Math.max(0, ...lots.map((lot) => stockBalance(lot)))
      : round(lots.reduce((sum, lot) => sum + stockBalance(lot) - (lot.reserved || 0), 0));
    return { ...need, available, shortage: round(Math.max(0, need.qty - available)) };
  });
  const step = Number(recipeOf(order).quantityStep) || (orderUnit(order) === 'шт' ? 1 : 0.001);
  const limit = Math.min(1000000, ...rows.map((row) => (row.available / row.qty) * order.qty));
  return { rows, maxQty: round(Math.floor((limit + 1e-8) / step) * step) };
}

export const occupancy = (o) =>
  ['running', 'hold', 'waiting', 'queued', 'quality'].includes(o.status) &&
  operationsOf(o)
    .slice(o.stage)
    .some((op) => op.kind === 'production');

function log(state, message, kind = 'info', orderId = null, subject = {}) {
  const order = state.orders.find((item) => item.id === orderId);
  state.events.unshift({
    id: uid(),
    time: new Date().toISOString(),
    message,
    kind,
    orderId,
    category: order ? 'production' : 'system',
    objectType: order ? 'order' : 'system',
    objectId: orderId,
    objectCode: order?.code || '',
    operation: order ? operationOf(order)?.name : '',
    actor: CURRENT_USER.name,
    mtus: order
      ? materialAssignments(order, operationOf(order)).map((allocation) => ({
          code:
            sourceLot(state, allocation.lotId)?.mtuCode || sourceLot(state, allocation.lotId)?.code,
          batchCode: sourceLot(state, allocation.lotId)?.code,
          qty: allocation.qty,
          status: allocation.consumed ? 'consumed' : 'reserved',
          unit: materialOf(state, allocation.material)?.unit,
        }))
      : [],
    ...subject,
  });
}

export function materialAssignments(order, operation) {
  return order.allocations
    .filter((item) => item.operationId === operation.id)
    .map((item) => ({
      ...item,
      inputId:
        item.inputId ||
        operation.inputs.find(
          (input) => input.source === 'stock' && input.material === item.material,
        )?.id,
    }));
}

export function operationMaterialAvailability(state, order) {
  const operation = operationOf(order);
  for (const input of operation.inputs.filter((item) => item.source === 'stock')) {
    const assigned = materialAssignments(order, operation).filter(
      (item) => item.inputId === input.id && item.consumed,
    );
    const total = round(assigned.reduce((sum, item) => sum + item.qty, 0));
    const mode = materialOf(state, input.material)?.lotMode;
    if (total <= 0 || (mode !== 'livestock' && Math.abs(total - scaledQty(input, order)) > 0.0005))
      return `Подтвердите списание «${input.name}»: требуется ${scaledQty(input, order)} ${input.unit}, списано ${total} ${input.unit}`;
    for (const allocation of assigned) {
      const lot = sourceLot(state, allocation.lotId);
      if (!lot || lot.status !== 'released' || lot.expires < order.date)
        return `MTU ${lot?.code || allocation.lotId} недоступна к потреблению`;
      if (
        lot.orderId &&
        isOrderBlocked(
          state,
          state.orders.find((item) => item.id === lot.orderId),
        )
      )
        return `Исходное сырьё MTU ${lot.code} заблокировано`;
    }
  }
  return '';
}

function releaseReservations(state, order, predicate) {
  order.allocations = order.allocations.filter((row) => {
    if (row.consumed || !predicate(row)) return true;
    const lot = sourceLot(state, row.lotId);
    if (lot) lot.reserved = round(Math.max(0, (lot.reserved || 0) - row.qty));
    return false;
  });
}

function reserveMaterials(state, order, rows) {
  if (!Array.isArray(rows)) throw new Error('Проверьте строки резервирования');
  for (const row of rows) {
    const operation = operationsOf(order).find((item) => item.id === row.operationId);
    const input = operation?.inputs.find(
      (item) => item.id === row.inputId && item.source === 'stock',
    );
    const lot = sourceLot(state, row.lotId);
    const qty = round(Number(row.qty));
    if (!input || !lot || !finitePositive(qty) || (input.unit === 'шт' && !Number.isInteger(qty)))
      throw new Error('Проверьте MTU, материал и количество резерва');
    if (!reservationLots(state, order, input, false).some((item) => item.id === lot.id))
      throw new Error(`MTU ${lot.code} не соответствует материалу, статусу или сроку годности`);
    const mode = materialOf(state, input.material)?.lotMode;
    const assigned = materialAssignments(order, operation)
      .filter((item) => item.inputId === input.id)
      .reduce((sum, item) => sum + item.qty, 0);
    if (mode === 'livestock') {
      const heads = operationsOf(order)
        .flatMap((item) => item.outputs)
        .filter(
          (out) =>
            out.destination === 'stock' &&
            materialOf(state, out.material)?.lotMode === 'individual',
        ).length;
      if (qty !== stockBalance(lot) || assigned > 0 || lot.livestock?.heads !== heads)
        throw new Error('Партия живка резервируется целиком с соответствующим числом голов');
    } else if (assigned + qty > scaledQty(input, order) + 0.0005)
      throw new Error(
        `Резерв «${input.name}» превышает потребность ${scaledQty(input, order)} ${input.unit}`,
      );
    if (mode === 'individual' && qty !== stockBalance(lot))
      throw new Error('Туша резервируется целиком. Пересчитайте план по её массе.');
    if (qty > stockBalance(lot) - (lot.reserved || 0) + 0.0005)
      throw new Error(`В MTU ${lot.code} недостаточно свободного остатка`);
    lot.reserved = round((lot.reserved || 0) + qty);
    order.allocations.push({
      lotId: lot.id,
      lotCode: lot.code,
      mtuCode: lot.mtuCode || lot.code,
      material: input.material,
      qty,
      inputId: input.id,
      operationId: operation.id,
      consumed: false,
      assignedAt: new Date().toISOString(),
      assignedBy: CURRENT_USER.name,
    });
  }
}
const finitePositive = (value) =>
  value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
const unique = (values, label) => {
  if (new Set(values).size !== values.length) throw new Error(`Повторяются ${label}`);
};

export function validateProcess(process, state) {
  if (!process.name?.trim() || !process.code?.trim())
    throw new Error('Укажите код и наименование процесса');
  if (!finitePositive(process.baseQty)) throw new Error('Базовый объём должен быть больше нуля');
  if (process.quantityStep != null && !finitePositive(process.quantityStep))
    throw new Error('Шаг объёма выпуска должен быть больше нуля');
  if (
    process.quantityStep &&
    Math.abs(
      Number(process.baseQty) / process.quantityStep -
        Math.round(Number(process.baseQty) / process.quantityStep),
    ) > 0.00001
  )
    throw new Error('Базовый объём должен быть кратен шагу выпуска');
  if (!Number.isInteger(Number(process.shelf)) || Number(process.shelf) < 1)
    throw new Error('Укажите срок годности в целых сутках');
  const mainMaterial = materialOf(state, process.outputMaterial);
  if (!mainMaterial || mainMaterial.active === false)
    throw new Error('Выберите действующий выпускаемый материал');
  if (!process.operations?.length) throw new Error('Добавьте хотя бы одну операцию');
  unique(
    process.operations.map((op) => op.id),
    'идентификаторы операций',
  );
  if (process.operations.some((op) => op.carcassGrading)) {
    const identification = process.operations.findIndex((op) => op.carcassIdentification);
    const grading = process.operations.findIndex((op) => op.carcassGrading);
    if (
      identification < 0 ||
      identification >= grading ||
      !process.operations
        .slice(identification + 1, grading)
        .some(
          (op) =>
            op.kind === 'quality' &&
            op.parameters.some((p) => p.id === 'admission' && p.type === 'boolean' && p.required),
        )
    )
      throw new Error(
        'Порядок туши: идентификация и маркировка → ветеринарный допуск → итоговая классификация',
      );
    if (
      process.operations.filter((op) => op.carcassIdentification).length !== 1 ||
      process.operations.filter((op) => op.carcassGrading).length !== 1
    )
      throw new Error(
        'В маршруте одной туши должна быть одна идентификация и одна итоговая классификация',
      );
    const gradeRules = carcass.carcassGradeRules(process);
    unique(
      gradeRules.map((rule) => String(rule.code || '').trim()),
      'коды грейдов',
    );
    for (const rule of gradeRules) {
      if (
        !rule.code?.trim() ||
        !rule.name?.trim() ||
        ['minWeight', 'maxWeight', 'minLean', 'maxLean'].some(
          (key) => rule[key] === '' || !Number.isFinite(Number(rule[key])) || Number(rule[key]) < 0,
        ) ||
        Number(rule.minWeight) > Number(rule.maxWeight) ||
        Number(rule.minLean) > Number(rule.maxLean) ||
        Number(rule.maxLean) > 100
      )
        throw new Error('Проверьте название и диапазоны правил классификации туш');
    }
  }
  const wip = {};
  let primaryOutput = 0;
  for (const [index, op] of process.operations.entries()) {
    const prefix = `Операция ${index + 1}`;
    if (
      op.carcassIdentification &&
      (op.primaryLeanTarget === '' ||
        !Number.isFinite(Number(op.primaryLeanTarget)) ||
        Number(op.primaryLeanTarget) < 0 ||
        Number(op.primaryLeanTarget) > 100)
    )
      throw new Error(`${prefix}: укажите постность для имитации AutoFom в диапазоне 0–100 %`);
    if (!op.name?.trim()) throw new Error(`${prefix}: укажите наименование`);
    if (!['production', 'quality'].includes(op.kind)) throw new Error(`${prefix}: выберите тип`);
    if (
      op.equipmentId &&
      !state.equipment.some((e) => e.id === op.equipmentId && resourceActive(state, e.id))
    )
      throw new Error(`${prefix}: оборудование недоступно`);
    if (op.equipmentClass && op.equipmentId)
      throw new Error(`${prefix}: выберите класс или конкретный ресурс`);
    if (
      op.equipmentClass &&
      !state.equipment.some((e) => e.classCode === op.equipmentClass && resourceActive(state, e.id))
    )
      throw new Error(`${prefix}: нет доступного оборудования класса «${op.equipmentClass}»`);
    if (!Array.isArray(op.inputs) || !Array.isArray(op.outputs) || !Array.isArray(op.parameters))
      throw new Error(`${prefix}: неполная конфигурация`);
    if (
      op.lotMarkParameter &&
      !op.parameters.some((p) => p.id === op.lotMarkParameter && p.type === 'text' && p.required)
    )
      throw new Error(`${prefix}: номер партии должен быть обязательным текстовым параметром`);
    unique(
      [...op.inputs, ...op.outputs].map((i) => i.id),
      `строки материалов в операции ${index + 1}`,
    );
    for (const input of op.inputs) {
      const m = materialOf(state, input.material);
      if (!m || m.active === false || !finitePositive(input.qty))
        throw new Error(`${prefix}: проверьте потребляемые материалы и количество`);
      if (!['stock', 'process'].includes(input.source))
        throw new Error(`${prefix}: укажите источник материала`);
      if (input.source === 'process') {
        wip[m.id] = round((wip[m.id] || 0) - Number(input.qty));
        if (wip[m.id] < -0.001)
          throw new Error(
            `${prefix}: «${m.name}» не выпущен в нужном количестве предыдущими операциями`,
          );
      }
    }
    for (const out of op.outputs) {
      const m = materialOf(state, out.material);
      if (!m || m.active === false || !finitePositive(out.qty))
        throw new Error(`${prefix}: проверьте выпускаемые материалы и количество`);
      if (!['stock', 'process'].includes(out.destination))
        throw new Error(`${prefix}: укажите назначение выпуска`);
      if (out.shelf != null && (!Number.isInteger(Number(out.shelf)) || Number(out.shelf) < 1))
        throw new Error(
          `${prefix}: срок годности выхода должен быть целым числом суток больше нуля`,
        );
      if (out.destination === 'process') wip[m.id] = round((wip[m.id] || 0) + Number(out.qty));
      if (out.destination === 'stock' && out.material === process.outputMaterial)
        primaryOutput += Number(out.qty);
    }
    unique(
      op.parameters.map((p) => p.id),
      `атрибуты в операции ${index + 1}`,
    );
    for (const p of op.parameters) {
      if (!p.name?.trim() || !['number', 'text', 'boolean'].includes(p.type))
        throw new Error(`${prefix}: заполните наименование и тип каждого атрибута`);
      if (p.type === 'number') {
        const bounds = ['min', 'target', 'max'].filter((key) => p[key] !== '' && p[key] != null);
        if (bounds.some((key) => !Number.isFinite(Number(p[key]))))
          throw new Error(`${prefix}: «${p.name}» содержит некорректное число`);
        if (
          p.min !== '' &&
          p.min != null &&
          p.max !== '' &&
          p.max != null &&
          Number(p.min) > Number(p.max)
        )
          throw new Error(`${prefix}: нижний допуск больше верхнего у «${p.name}»`);
        if (
          p.target !== '' &&
          p.target != null &&
          ((p.min !== '' && p.min != null && Number(p.target) < Number(p.min)) ||
            (p.max !== '' && p.max != null && Number(p.target) > Number(p.max)))
        )
          throw new Error(`${prefix}: номинал вне допуска у «${p.name}»`);
      }
    }
    validateMassBalance(op, state.materials);
  }
  if (Math.abs(primaryOutput - Number(process.baseQty)) > 0.001)
    throw new Error(
      'Суммарный выпуск основного материала на склад должен совпадать с базовым объёмом процесса',
    );
  for (const [material, qty] of Object.entries(wip))
    if (Math.abs(qty) > 0.001)
      throw new Error(
        `В маршруте остаётся ${round(qty)} ${materialOf(state, material).unit} полуфабриката «${materialOf(state, material).name}». Укажите его потребление или выпуск на склад.`,
      );
  if (!state.lines.some((l) => !processLineError(state, process, l.id)))
    throw new Error(
      'Нет линии, совместимой со всем маршрутом процесса. Проверьте структуру и требования операций',
    );
  return true;
}

function snapshotProcess(process, state, lineId) {
  const snapshot = structuredClone(process);
  delete snapshot.draft;
  snapshot.outputUnit = materialOf(state, snapshot.outputMaterial).unit;
  snapshot.outputName = materialOf(state, snapshot.outputMaterial).name;
  snapshot.operations = snapshot.operations.map((op) => ({
    ...op,
    equipment: state.equipment.find((e) => e.id === op.equipmentId)?.name || '',
    inputs: op.inputs.map((i) => ({
      ...i,
      name: materialOf(state, i.material).name,
      unit: materialOf(state, i.material).unit,
    })),
    outputs: op.outputs.map((i) => ({
      ...i,
      name: materialOf(state, i.material).name,
      unit: materialOf(state, i.material).unit,
    })),
  }));
  if (lineId)
    snapshot.operations = snapshot.operations.map((op) => {
      const eq = resolveEquipment(state, op, lineId);
      return {
        ...op,
        equipmentId: eq?.id || '',
        equipment: eq?.name || '',
        equipmentPath: eq
          ? resourcePath(state, eq.id)
              .map((n) => n.name)
              .join(' / ')
          : '',
      };
    });
  return snapshot;
}

function checkEquipment(state, order) {
  const op = operationOf(order);
  if (!op.equipmentId) return;
  const equipment = state.equipment.find((e) => e.id === op.equipmentId);
  if (!equipment || !resourceActive(state, equipment.id))
    throw new Error(`Оборудование «${op.equipment}» недоступно`);
  // Location is part of the frozen assignment. Moving an assigned resource is forbidden.
  if (
    equipment.parentId &&
    !resourcePath(state, order.line).some((n) => n.id === equipment.parentId)
  )
    throw new Error(`Оборудование «${equipment.name}» не относится к линии заказа`);
  const other = state.orders.find(
    (o) =>
      o.id !== order.id &&
      ['running', 'hold', 'quality'].includes(o.status) &&
      operationOf(o).equipmentId === op.equipmentId,
  );
  if (other)
    throw new Error(
      `Оборудование «${equipment.name}» занято заказом ${other.code} · ${state.lines.find((l) => l.id === other.line)?.name}`,
    );
}

export function operationAvailability(state, order) {
  try {
    if (isOrderBlocked(state, order)) throw new Error('Исходное сырьё заказа заблокировано');
    if (!resourceActive(state, order.line))
      throw new Error('Линия или родительский узел недоступны');
    checkEquipment(state, order);
    if (occupancy(order)) {
      const other = state.orders.find(
        (o) => o.id !== order.id && o.line === order.line && occupancy(o),
      );
      if (other)
        throw new Error(
          `${state.lines.find((l) => l.id === order.line)?.name} занята заказом ${other.code}`,
        );
      if (state.lines.find((l) => l.id === order.line)?.status !== 'ready')
        throw new Error('Линия на санитарной обработке');
    }
    // Ready orders have not entered yet, but need the same line checks.
    if (order.status === 'ready' && operationsOf(order).some((op) => op.kind === 'production')) {
      const other = state.orders.find(
        (o) => o.id !== order.id && o.line === order.line && occupancy(o),
      );
      if (other) throw new Error(`Линия занята заказом ${other.code}`);
      if (state.lines.find((l) => l.id === order.line)?.status !== 'ready')
        throw new Error('Линия на санитарной обработке');
    }
    return '';
  } catch (e) {
    return e.message;
  }
}

function enterOperation(state, order) {
  const op = operationOf(order);
  const unavailable = operationAvailability(state, order);
  if (unavailable) throw new Error(unavailable);
  const inputs = op.inputs.map((input) => ({
    ...input,
    qty: operationInputQty(input, order, op),
    ...(input.source === 'stock'
      ? {
          mtus: materialAssignments(order, op)
            .filter((item) => item.inputId === input.id && item.consumed)
            .map((item) => ({
              lotId: item.lotId,
              code: sourceLot(state, item.lotId)?.mtuCode || sourceLot(state, item.lotId)?.code,
              qty: item.qty,
            })),
        }
      : {}),
  }));
  for (const input of inputs.filter((i) => i.source === 'process')) {
    const needed = input.qty;
    if ((order.wip[input.material] || 0) + 0.001 < needed)
      throw new Error(`Недостаточно полуфабриката «${input.name}» для операции «${op.name}»`);
    order.wip[input.material] = round(order.wip[input.material] - needed);
  }
  order.status = op.kind === 'quality' ? 'quality' : 'running';
  order.waitReason = '';
  order.operationExecution = {
    operationId: op.id,
    inputs,
    startedAt: new Date().toISOString(),
    pauses: [],
  };
}

function finishOrder(state, order) {
  const liveInputs = order.allocations
    .filter(
      (allocation) =>
        allocation.consumed && materialOf(state, allocation.material)?.lotMode === 'livestock',
    )
    .map((allocation) => sourceLot(state, allocation.lotId));
  if (liveInputs.length) {
    const heads = liveInputs.reduce((sum, lot) => sum + lot.livestock.heads, 0);
    const carcasses = order.produced.filter(
      (output) => output.qty > 0 && materialOf(state, output.material)?.lotMode === 'individual',
    ).length;
    if (heads !== carcasses)
      throw new Error(`Принято ${heads} гол. Выпуск должен содержать ${heads} отдельных туш.`);
  }
  releaseReservations(state, order, () => true);
  order.status = 'completed';
  delete order.operationExecution;
  order.actual = round(
    order.produced
      .filter((p) => p.material === recipeOf(order).outputMaterial)
      .reduce((n, p) => n + p.qty, 0),
  );
  const identity = carcass.carcassForOrder(state, order);
  const inheritedIds = [
    ...new Set(
      order.allocations
        .filter((row) => row.consumed)
        .flatMap((row) => {
          const lot = sourceLot(state, row.lotId);
          return [lot?.carcassId, ...(lot?.sourceCarcassIds || [])].filter(Boolean);
        }),
    ),
  ];
  const mark =
    identity?.slaughterNumber ||
    operationsOf(order)
      .map(
        (op) =>
          order.samples.find((sample) => sample.operationId === op.id)?.values[op.lotMarkParameter],
      )
      .find(Boolean);
  for (const [index, output] of order.produced.entries()) {
    if (output.qty === 0) continue;
    const mode = materialOf(state, output.material)?.lotMode;
    const expires = new Date(`${order.date}T12:00:00Z`);
    expires.setUTCDate(expires.getUTCDate() + Number(output.shelf ?? recipeOf(order).shelf));
    if (recipeOf(order).preserveExpiry) {
      for (const a of order.allocations.filter((a) => a.consumed)) {
        if (materialOf(state, a.material)?.kind === 'packaging') continue;
        const source = sourceLot(state, a.lotId);
        if (source?.expires && source.expires < expires.toISOString().slice(0, 10))
          expires.setTime(Date.parse(`${source.expires}T12:00:00Z`));
      }
    }
    state.finished.unshift({
      id: `fg-${order.seq}${index ? `-${index}` : ''}`,
      code: `${mode === 'pallet' ? 'ПЛ' : state.scenarioId === 'agro' ? 'ПР' : 'ГП'}-${order.date.slice(2).replaceAll('-', '')}-${String(order.seq).padStart(3, '0')}${index ? `-${index + 1}` : ''}`,
      material: output.material,
      name: agroMaterialCaption(output),
      unit: output.unit,
      operationId: output.operationId,
      orderId: order.id,
      qty: output.qty,
      remaining: output.qty,
      reserved: 0,
      status: mode === 'pallet' ? 'inTransit' : 'released',
      ...(mark && mode === 'individual' ? { mark } : {}),
      ...(order.slaughterBatchId ? { slaughterBatchId: order.slaughterBatchId } : {}),
      expires: expires.toISOString().slice(0, 10),
      producedAt: new Date().toISOString(),
      ...(mode === 'individual' && identity
        ? { carcassId: identity.id, slaughterBatchId: identity.slaughterBatchId }
        : {}),
      ...(inheritedIds.length ? { sourceCarcassIds: inheritedIds } : {}),
    });
  }
  log(
    state,
    `Завершён ${order.code}. Выпуск: ${order.actual} ${orderUnit(order)}`,
    'success',
    order.id,
  );
}

export function transition(previous, action) {
  let state = carcass.upgradeCarcassTracking(upgradeCounterparties(structuredClone(previous)));
  let order = state.orders.find((o) => o.id === action.orderId);
  const requireOrder = () => {
    if (!order) throw new Error('Заказ не найден');
    if (action.operationId && action.operationId !== operationOf(order)?.id)
      throw new Error('Операция уже сменилась. Обновите очередь заданий');
  };
  switch (action.type) {
    case 'saveCounterparty': {
      const party = validateCounterparty(state, {
        ...action.counterparty,
        id: action.counterparty.id || uid(),
      });
      const position = state.counterparties.findIndex((row) => row.id === party.id);
      if (position < 0) state.counterparties.push(party);
      else state.counterparties[position] = party;
      log(state, `Сохранён контрагент ${party.code} · ${party.name}`, 'info', null, {
        category: 'master',
        objectType: 'counterparty',
        objectId: party.id,
        objectCode: party.code,
      });
      break;
    }
    case 'saveNode': {
      const node = {
        ...action.node,
        id: action.node.id || uid(),
        active: action.node.active !== false,
      };
      if (!['enterprise', 'site', 'area', 'line'].includes(node.type))
        throw new Error('Выберите уровень структуры');
      validateResource(state, node);
      node.name = node.name.trim();
      node.code = node.code.trim();
      const collection = node.type === 'line' ? state.lines : state.structure;
      const index = collection.findIndex((n) => n.id === node.id);
      if (node.type === 'line') {
        node.capacity = Number(node.capacity);
        node.status ||= 'ready';
      }
      if (index < 0) collection.push(node);
      else collection[index] = node;
      log(state, `Сохранён узел структуры ${node.code}`, 'info', null, {
        category: 'master',
        objectType: 'resource',
        objectId: node.id,
        objectCode: node.code,
      });
      break;
    }
    case 'deleteResource': {
      const node = resourceNodes(state).find((n) => n.id === action.id);
      if (!node) throw new Error('Узел не найден');
      if (resourceNodes(state).some((n) => n.parentId === node.id))
        throw new Error('Сначала удалите или перенесите дочерние узлы');
      if (
        state.orders.some(
          (o) => o.line === node.id || operationsOf(o).some((op) => op.equipmentId === node.id),
        ) ||
        state.processes.some((p) =>
          [p, p.draft]
            .filter(Boolean)
            .some((v) =>
              v.operations.some(
                (op) =>
                  op.equipmentId === node.id ||
                  (op.equipmentClass && op.equipmentClass === node.classCode),
              ),
            ),
        )
      )
        throw new Error('Узел используется в процессах или заказах. Отключите его вместо удаления');
      state.structure = state.structure.filter((n) => n.id !== node.id);
      state.lines = state.lines.filter((n) => n.id !== node.id);
      state.equipment = state.equipment.filter((n) => n.id !== node.id);
      log(state, `Удалён узел ${node.code}`, 'info', null, {
        category: 'master',
        objectType: 'resource',
        objectId: node.id,
        objectCode: node.code,
      });
      break;
    }
    case 'saveProcess': {
      const candidate = structuredClone(action.process);
      delete candidate.draft;
      if (!candidate.name?.trim() || !candidate.code?.trim())
        throw new Error('Укажите код и наименование процесса');
      const existing = state.processes.find((p) => p.id === candidate.id);
      if (
        state.processes.some(
          (p) =>
            p.id !== candidate.id &&
            p.code.trim().toLowerCase() === candidate.code.trim().toLowerCase(),
        )
      )
        throw new Error('Код процесса уже используется');
      if (existing?.lifecycle === 'archived')
        throw new Error('Архивный процесс недоступен для изменения');
      candidate.id ||= uid();
      candidate.code = candidate.code.trim();
      candidate.name = candidate.name.trim();
      candidate.baseQty = Number(candidate.baseQty);
      candidate.shelf = Number(candidate.shelf);
      candidate.revision =
        existing?.lifecycle === 'published' ? existing.revision + 1 : existing?.revision || 1;
      candidate.lifecycle = action.publish ? 'published' : 'draft';
      if (action.publish) validateProcess(candidate, state);
      if (existing && !action.publish && existing.lifecycle === 'published')
        existing.draft = candidate;
      else if (existing) state.processes[state.processes.indexOf(existing)] = candidate;
      else state.processes.push(candidate);
      log(
        state,
        `${action.publish ? 'Опубликован процесс' : 'Сохранён черновик'} ${candidate.code} · версия ${candidate.revision}`,
        'info',
        null,
        {
          category: 'master',
          objectType: 'process',
          objectId: candidate.id,
          objectCode: candidate.code,
        },
      );
      break;
    }
    case 'archiveProcess': {
      const process = state.processes.find((p) => p.id === action.processId);
      if (!process) throw new Error('Процесс не найден');
      process.lifecycle = 'archived';
      delete process.draft;
      log(state, `Процесс ${process.code} перемещён в архив`, 'info', null, {
        category: 'master',
        objectType: 'process',
        objectId: process.id,
        objectCode: process.code,
      });
      break;
    }
    case 'saveMaterial': {
      const material = {
        ...action.material,
        id: action.material.id || uid(),
        active: action.material.active !== false,
      };
      if (
        !material.code?.trim() ||
        !material.name?.trim() ||
        !['кг', 'л', 'шт', 'г'].includes(material.unit) ||
        !materialKinds[material.kind]
      )
        throw new Error('Заполните код, наименование, тип и единицу измерения материала');
      material.code = material.code.trim();
      material.name = material.name.trim();
      if (
        state.materials.some(
          (m) => m.id !== material.id && m.code.toLowerCase() === material.code.toLowerCase(),
        )
      )
        throw new Error('Код материала уже используется');
      const old = materialOf(state, material.id);
      const referenced =
        state.lots.some((l) => l.material === material.id) ||
        state.finished.some((l) => l.material === material.id) ||
        state.orders.some((o) =>
          operationsOf(o).some((op) =>
            [...op.inputs, ...op.outputs].some((i) => i.material === material.id),
          ),
        );
      const usedInProcess = state.processes.some(
        (p) =>
          p.lifecycle === 'published' &&
          p.operations.some((op) =>
            [...op.inputs, ...op.outputs].some((i) => i.material === material.id),
          ),
      );
      if (old && old.unit !== material.unit && (referenced || usedInProcess))
        throw new Error('Нельзя менять единицу измерения материала, участвующего в учёте');
      if (old) state.materials[state.materials.indexOf(old)] = material;
      else state.materials.push(material);
      log(state, `Сохранён материал ${material.code}`, 'info', null, {
        category: 'master',
        objectType: 'material',
        objectId: material.id,
        objectCode: material.code,
      });
      break;
    }
    case 'saveEquipment': {
      const equipment = {
        ...action.equipment,
        id: action.equipment.id || uid(),
        active: Boolean(action.equipment.active),
      };
      if (!equipment.code?.trim() || !equipment.name?.trim())
        throw new Error('Укажите код и наименование оборудования');
      equipment.code = equipment.code.trim();
      equipment.name = equipment.name.trim();
      const oldResource = state.equipment.find((e) => e.id === equipment.id);
      equipment.parentId ||= oldResource?.parentId || 'area';
      equipment.classCode ||= oldResource?.classCode || equipment.area || equipment.code;
      equipment.classCode = equipment.classCode.trim();
      validateResource(state, { ...equipment, type: 'equipment' });
      if (
        state.equipment.some(
          (e) => e.id !== equipment.id && e.code.toLowerCase() === equipment.code.toLowerCase(),
        )
      )
        throw new Error('Код оборудования уже используется');
      if (
        !equipment.active &&
        state.orders.some(
          (o) =>
            ['running', 'hold', 'quality'].includes(o.status) &&
            operationOf(o).equipmentId === equipment.id,
        )
      )
        throw new Error('Оборудование используется активным заказом');
      const old = state.equipment.find((e) => e.id === equipment.id);
      if (old) state.equipment[state.equipment.indexOf(old)] = equipment;
      else state.equipment.push(equipment);
      log(state, `Сохранено оборудование ${equipment.code}`, 'info', null, {
        category: 'master',
        objectType: 'resource',
        objectId: equipment.id,
        objectCode: equipment.code,
      });
      break;
    }
    case 'createOrder': {
      const process = state.processes.find((p) => p.id === (action.processId || action.recipe));
      if (!process || process.lifecycle !== 'published')
        throw new Error('Выберите опубликованный процесс');
      validateProcess(process, state);
      const qty = Number(action.qty);
      if (!finitePositive(qty) || qty > 1000000)
        throw new Error('Укажите объём больше нуля и не больше 1 000 000');
      if (materialOf(state, process.outputMaterial).unit === 'шт' && !Number.isInteger(qty))
        throw new Error('Количество в штуках должно быть целым');
      if (
        process.quantityStep &&
        Math.abs(qty / process.quantityStep - Math.round(qty / process.quantityStep)) > 0.00001
      )
        throw new Error(
          `Объём должен быть кратен ${process.quantityStep} ${materialOf(state, process.outputMaterial).unit}`,
        );
      const lineError = processLineError(state, process, action.line);
      if (lineError) throw new Error(lineError);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(action.date) ||
        !Number.isFinite(Date.parse(action.date)) ||
        action.date < DAY
      )
        throw new Error('Укажите плановую дату не раньше 22.10.2026');
      const start = action.start || '14:00',
        due = action.due || '20:00';
      if (due <= start) throw new Error('Время окончания должно быть позже начала');
      const seq = Math.max(0, ...state.orders.map((o) => o.seq)) + 1;
      const created = {
        id: `order-${seq}`,
        seq,
        code: `ПЗ-${action.date.slice(2, 7).replace('-', '')}-${String(seq).padStart(3, '0')}`,
        recipe: process.id,
        processSnapshot: snapshotProcess(process, state, action.line),
        qty,
        line: action.line,
        date: action.date,
        start,
        due,
        priority: action.priority || 'normal',
        status: 'planned',
        stage: 0,
        samples: [],
        allocations: [],
        wip: {},
        produced: [],
        actual: 0,
        operator: CURRENT_USER.name,
      };
      state.orders.push(created);
      log(
        state,
        `Создан ${created.code} · ${process.name} · ${qty} ${orderUnit(created)}`,
        'info',
        created.id,
      );
      break;
    }
    case 'resizeOrder': {
      requireOrder();
      if (order.status !== 'planned' || order.allocations.length || order.samples.length)
        throw new Error('Изменить объём можно до резервирования материалов');
      const qty = Number(action.qty);
      const step = Number(recipeOf(order).quantityStep) || (orderUnit(order) === 'шт' ? 1 : 0.001);
      if (
        !finitePositive(qty) ||
        qty > 1000000 ||
        Math.abs(qty / step - Math.round(qty / step)) > 0.00001
      )
        throw new Error(`Укажите объём больше нуля, кратный ${step} ${orderUnit(order)}`);
      const previousQty = order.qty;
      order.qty = round(qty);
      log(
        state,
        `Изменён план ${order.code}: ${previousQty} → ${order.qty} ${orderUnit(order)}`,
        'info',
        order.id,
      );
      break;
    }
    case 'prepareOrder':
    case 'releaseToOperator': {
      requireOrder();
      if (order.status !== 'planned' || order.allocations.length)
        throw new Error('Заказ уже подготовлен к исполнению');
      reserveMaterials(state, order, action.reservations || []);
      order.status = 'ready';
      delete order.materialAssignment;
      log(
        state,
        `Подготовлен ${order.code} · резервов MTU: ${order.allocations.length}`,
        'success',
        order.id,
      );
      break;
    }
    case 'assignOperationMaterials': {
      requireOrder();
      if (!['ready', 'queued', 'waiting'].includes(order.status))
        throw new Error('Резерв можно изменить до запуска операции');
      const operation = operationOf(order);
      if (materialAssignments(order, operation).some((item) => item.consumed))
        throw new Error('Материалы операции уже списаны');
      releaseReservations(state, order, (item) => item.operationId === operation.id);
      reserveMaterials(
        state,
        order,
        action.assignments?.map((row) => ({ ...row, operationId: operation.id })),
      );
      log(state, `Изменён резерв для «${operation.name}» · ${order.code}`, 'info', order.id, {
        category: 'materials',
      });
      break;
    }
    case 'consumeMaterial': {
      requireOrder();
      const operation = operationOf(order);
      const input = operation.inputs.find(
        (item) => item.source === 'stock' && item.id === action.inputId,
      );
      const token = String(action.code || '')
        .trim()
        .toLocaleLowerCase();
      if (!token) throw new Error('Введите или отсканируйте MTU фактически поданного сырья');
      const lot =
        stockLots(state).find((item) =>
          [item.id, item.code, item.mtuCode].some((code) => code?.toLocaleLowerCase() === token),
        ) || carcass.resolveCarcassLot(state, action.code, input?.material, true);
      const qty = round(Number(action.qty));
      const existing = order.allocations.find(
        (item) => item.movementId && item.movementId === action.movementId,
      );
      if (existing) {
        if (
          existing.operationId !== operation.id ||
          existing.inputId !== action.inputId ||
          existing.lotId !== lot?.id ||
          existing.qty !== qty
        )
          throw new Error('Номер списания уже использован с другими данными');
        return previous;
      }
      if (!['running', 'quality'].includes(order.status))
        throw new Error('Списание доступно во время выполнения операции');
      if (!input || !lot || lot.material !== input.material)
        throw new Error('MTU не соответствует материалу операции');
      if (!finitePositive(qty) || (input.unit === 'шт' && !Number.isInteger(qty)))
        throw new Error('Укажите корректное количество списания');
      if (lot.status !== 'released' || lot.expires < order.date)
        throw new Error(`MTU ${lot.code} не допущена к потреблению или истёк срок годности`);
      if (
        isOrderBlocked(state, order) ||
        (lot.orderId &&
          isOrderBlocked(
            state,
            state.orders.find((item) => item.id === lot.orderId),
          ))
      )
        throw new Error('Исходное сырьё заблокировано');
      const rows = materialAssignments(order, operation).filter(
        (item) => item.inputId === input.id,
      );
      const consumed = round(
        rows.filter((item) => item.consumed).reduce((sum, item) => sum + item.qty, 0),
      );
      const reserved = rows.filter((item) => !item.consumed);
      const ownReserve = round(
        reserved.filter((item) => item.lotId === lot.id).reduce((sum, item) => sum + item.qty, 0),
      );
      const totalReserve = round(reserved.reduce((sum, item) => sum + item.qty, 0));
      const mode = materialOf(state, input.material)?.lotMode;
      const need = scaledQty(input, order);
      if (mode === 'livestock') {
        const heads = operationsOf(order)
          .flatMap((item) => item.outputs)
          .filter(
            (out) =>
              out.destination === 'stock' &&
              materialOf(state, out.material)?.lotMode === 'individual',
          ).length;
        if (consumed || qty !== stockBalance(lot) || lot.livestock?.heads !== heads)
          throw new Error(`Списание партии живка целиком; маршрут рассчитан на ${heads} гол.`);
      } else if (qty + consumed > need + 0.0005)
        throw new Error(
          `Списание превышает потребность «${input.name}»: осталось ${round(need - consumed)} ${input.unit}`,
        );
      if (
        mode === 'individual' &&
        (consumed || qty !== stockBalance(lot) || Math.abs(qty - need) > 0.0005)
      )
        throw new Error('Туша списывается целиком. Масса должна соответствовать плану заказа.');
      const available = round(stockBalance(lot) - (lot.reserved || 0) + ownReserve);
      if (qty > available + 0.0005)
        throw new Error(
          `В MTU ${lot.code} доступно ${available} ${input.unit}; учтены резервы других операций и заказов`,
        );
      const reserveUsed = Math.min(qty, ownReserve);
      const replacement =
        mode === 'livestock'
          ? totalReserve - ownReserve
          : round(Math.max(0, totalReserve + qty - reserveUsed - (need - consumed)));
      if (replacement > 0.0005 && action.replaceReservation !== true)
        throw new Error('MTU отличается от резерва. Подтвердите замену резерва перед списанием');
      let takeOwn = reserveUsed,
        releaseOther = replacement;
      const released = [];
      order.allocations = order.allocations.filter((row) => {
        if (
          row.consumed ||
          row.operationId !== operation.id ||
          (row.inputId || operation.inputs.find((i) => i.material === row.material)?.id) !==
            input.id
        )
          return true;
        const release = Math.min(row.qty, row.lotId === lot.id ? takeOwn : releaseOther);
        if (!release) return true;
        if (row.lotId === lot.id) takeOwn = round(takeOwn - release);
        else {
          releaseOther = round(releaseOther - release);
          released.push({
            code: row.mtuCode || sourceLot(state, row.lotId)?.code,
            qty: release,
            unit: input.unit,
          });
        }
        const reservedLot = sourceLot(state, row.lotId);
        reservedLot.reserved = round(Math.max(0, (reservedLot.reserved || 0) - release));
        row.qty = round(row.qty - release);
        return row.qty > 0;
      });
      if (lot.orderId) lot.remaining = round(lot.remaining - qty);
      else lot.qty = round(lot.qty - qty);
      const movement = {
        movementId: action.movementId || uid(),
        operationId: operation.id,
        inputId: input.id,
        lotId: lot.id,
        lotCode: lot.code,
        mtuCode: lot.mtuCode || lot.code,
        material: input.material,
        qty,
        consumed: true,
        consumedAt: new Date().toISOString(),
        consumedBy: CURRENT_USER.name,
      };
      order.allocations.push(movement);
      if (lot.carcassId && mode === 'individual' && !operation.carcassIdentification)
        order.carcassId = lot.carcassId;
      if (mode === 'livestock') carcass.ensureSlaughterBatch(state, order);
      if (!order.operationExecution)
        order.operationExecution = {
          operationId: operation.id,
          pauses: [],
          inputs: operation.inputs.map((item) => ({
            ...item,
            qty: operationInputQty(item, order, operation),
          })),
        };
      const actual = order.operationExecution.inputs.find((item) => item.id === input.id);
      const facts = materialAssignments(order, operation).filter(
        (item) => item.consumed && item.inputId === input.id,
      );
      actual.qty = round(facts.reduce((sum, item) => sum + item.qty, 0));
      actual.mtus = facts.map((item) => ({
        movementId: item.movementId,
        lotId: item.lotId,
        code: item.mtuCode || sourceLot(state, item.lotId)?.code,
        qty: item.qty,
      }));
      log(
        state,
        `Списано ${qty} ${input.unit} · ${input.name} · MTU ${movement.mtuCode}${released.length ? ' · замена резерва' : ''}`,
        'success',
        order.id,
        {
          category: 'materials',
          mtus: [
            {
              code: movement.mtuCode,
              batchCode: lot.code,
              qty,
              unit: input.unit,
              status: 'consumed',
            },
          ],
          releasedReservations: released,
        },
      );
      break;
    }
    case 'reserve': {
      requireOrder();
      if (order.status !== 'planned') throw new Error('Материалы уже зарезервированы');
      for (const op of operationsOf(order))
        for (const input of op.inputs.filter((i) => i.source === 'stock')) {
          let remaining = scaledQty(input, order);
          const selected = action.lotChoices?.[trackedInputKey(op, input)];
          const candidates = reservationLots(state, order, input);
          const mode = materialOf(state, input.material)?.lotMode;
          if (!selected && candidates.length > 1 && (mode === 'livestock' || mode === 'individual'))
            throw new Error(`Выберите конкретную партию: ${input.name}`);
          for (const lot of candidates.filter((item) => !selected || item.id === selected)) {
            if (mode === 'livestock') {
              const plannedHeads = operationsOf(order)
                .flatMap((operation) => operation.outputs)
                .filter(
                  (out) =>
                    out.destination === 'stock' &&
                    materialOf(state, out.material)?.lotMode === 'individual',
                ).length;
              if (lot.livestock.heads !== plannedHeads)
                throw new Error(
                  `В партии ${lot.livestock.heads} гол., маршрут рассчитан на ${plannedHeads}.`,
                );
            }
            const qty =
              mode === 'livestock'
                ? stockBalance(lot)
                : round(Math.min(remaining, stockBalance(lot) - (lot.reserved || 0)));
            if (qty <= 0) continue;
            lot.reserved = round((lot.reserved || 0) + qty);
            remaining = mode === 'livestock' ? 0 : round(remaining - qty);
            order.allocations.push({
              lotId: lot.id,
              material: input.material,
              qty,
              operationId: op.id,
              inputId: input.id,
              consumed: false,
            });
            if (remaining <= 0) break;
          }
          if (remaining > 0.0005)
            throw new Error(
              `Недостаточно материала «${input.name}» для операции «${op.name}»: требуется ${scaledQty(input, order)} ${input.unit}, не хватает ${remaining} ${input.unit}`,
            );
        }
      order.status = 'ready';
      delete order.materialAssignment;
      log(state, `Зарезервированы материалы ${order.code}`, 'success', order.id);
      break;
    }
    case 'identifyCarcass': {
      requireOrder();
      const op = operationOf(order);
      if (!op.carcassIdentification || order.status !== 'running')
        throw new Error('Идентификация доступна на выполняемой операции КТ8');
      const input = op.inputs.find(
        (row) =>
          row.source === 'stock' && materialOf(state, row.material)?.lotMode === 'individual',
      );
      const assigned = materialAssignments(order, op).filter((row) => row.inputId === input?.id);
      let source = action.sourceCode
        ? sourceLot(state, action.sourceCode) ||
          stockLots(state).find((lot) => [lot.code, lot.mtuCode].includes(action.sourceCode.trim()))
        : sourceLot(state, assigned.find((row) => row.consumed)?.lotId);
      if (!input || !source || source.material !== input.material)
        throw new Error('Выберите учётную единицу туши для идентификации');
      const known = state.carcasses.find((row) => row.sourceLotId === source.id);
      const code = carcass.checkCarrier(state, action.rfid, known?.id);
      if (known?.identityOrderId === order.id && known.currentRfid === code) return previous;
      if (known && known.identityOrderId !== order.id)
        throw new Error('Туша уже идентифицирована в другом заказе');
      const confirmed = assigned.filter((row) => row.consumed);
      if (confirmed.length && confirmed.some((row) => row.lotId !== source.id))
        throw new Error('В операцию уже подана другая туша');
      if (!confirmed.length) {
        if (action.confirmConsumption !== true)
          throw new Error('Подтвердите фактическую подачу туши');
        const sourceId = source.id;
        state = transition(state, {
          type: 'consumeMaterial',
          orderId: order.id,
          operationId: op.id,
          inputId: input.id,
          code: source.id,
          qty: stockBalance(source),
          replaceReservation: action.replaceReservation,
          movementId: `identify-${order.id}-${source.id}`,
        });
        order = state.orders.find((row) => row.id === action.orderId);
        source = sourceLot(state, sourceId);
      }
      const record = carcass.identifyCarcass(state, order, source, code);
      log(state, `Идентифицирована туша · ${source.code} · разнога ${code}`, 'success', order.id, {
        category: 'materials',
        carcassId: record.id,
        rfid: code,
      });
      break;
    }
    case 'simulatePrimaryClassification': {
      requireOrder();
      const record = carcass.carcassForOrder(state, order),
        op = operationOf(order);
      if (
        !['running', 'quality'].includes(order.status) ||
        (!op.carcassIdentification && record?.origin !== 'legacy')
      )
        throw new Error('Первичная классификация недоступна на этой операции');
      if (record?.primaryClassification && record.slaughterNumber) return previous;
      const job = carcass.primaryClassification(state, order, op.primaryLeanTarget ?? 57);
      log(
        state,
        `Получены данные AutoFom III (имитация) · присвоен номер убоя ${record.slaughterNumber}`,
        'success',
        order.id,
        {
          category: 'production',
          carcassId: record.id,
          slaughterNumber: record.slaughterNumber,
          markingJobId: job.id,
        },
      );
      break;
    }
    case 'prepareCarcassMark':
    case 'exportCarcassMark':
    case 'confirmCarcassMark': {
      const record = state.carcasses?.find((row) => row.id === action.carcassId);
      if (!record) throw new Error('Туша не найдена');
      const job = carcass.prepareMarking(state, record);
      if (action.jobId && job.id !== action.jobId)
        throw new Error('Задание маркировки изменилось. Обновите карточку');
      if (action.type === 'exportCarcassMark') {
        job.exports.push({ at: new Date().toISOString(), actor: CURRENT_USER.name });
        if (job.status !== 'applied') job.status = 'exported';
        log(
          state,
          `Подготовлен файл QR · № убоя ${record.slaughterNumber}`,
          'info',
          record.identityOrderId,
          { category: 'production', carcassId: record.id, markingJobId: job.id },
        );
      } else if (action.type === 'confirmCarcassMark') {
        const identityOrder = state.orders.find((row) => row.id === record.identityOrderId);
        if (!identityOrder || !['running', 'quality'].includes(identityOrder.status))
          throw new Error('Подтверждение нанесения доступно при выполнении операции');
        if (!job.exports.length) throw new Error('Сначала скачайте файл QR для маркировки');
        if (job.status === 'applied') return previous;
        job.status = 'applied';
        job.appliedAt = new Date().toISOString();
        job.appliedBy = CURRENT_USER.name;
        log(
          state,
          `Подтверждено нанесение маркировки · № убоя ${record.slaughterNumber}`,
          'success',
          record.identityOrderId,
          { category: 'production', carcassId: record.id, markingJobId: job.id },
        );
      }
      break;
    }
    case 'rebindCarcassCarrier': {
      requireOrder();
      const record = carcass.carcassForOrder(state, order);
      if (!record || order.status === 'completed')
        throw new Error('Смена разноги недоступна для этой туши');
      carcass.rebindCarrier(state, record, action.rfid, action.reason);
      log(
        state,
        `Смена разноги · № убоя ${record.slaughterNumber || 'не присвоен'} · ${record.currentRfid} · ${action.reason.trim()}`,
        'warning',
        order.id,
        { carcassId: record.id },
      );
      break;
    }
    case 'startOperation':
    case 'start': {
      requireOrder();
      if (!['ready', 'queued', 'waiting'].includes(order.status))
        throw new Error('Операция не готова к запуску. Проверьте её состояние');
      enterOperation(state, order);
      log(state, `Запущен ${order.code} · ${operationOf(order).name}`, 'success', order.id);
      break;
    }
    case 'advance': {
      requireOrder();
      if (isOrderBlocked(state, order)) throw new Error('Исходное сырьё заказа заблокировано');
      if (!['running', 'quality'].includes(order.status))
        throw new Error('Операция не находится в исполнении');
      const materialError = operationMaterialAvailability(state, order);
      if (materialError) throw new Error(materialError);
      const op = operationOf(order),
        values = {};
      const enteredValues = { ...action.values };
      const tracked = carcass.carcassForOrder(state, order);
      const trackingError = carcass.carcassOperationError(state, order);
      if (trackingError) throw new Error(trackingError);
      if (op.carcassGrading) {
        if (action.values?.mark)
          throw new Error('Номер убоя назначает MES. Ручная подмена недоступна');
        if (!tracked?.slaughterNumber)
          throw new Error('У туши отсутствует номер убоя. Восстановите идентификацию');
        if (action.manualClassification) {
          if (!action.classificationReason?.trim())
            throw new Error('Укажите причину повторного измерения');
        } else {
          if (!tracked.primaryClassification)
            throw new Error('Нет данных первичной классификации. Получите показания AutoFom III');
          enteredValues.lean = tracked.primaryClassification.lean;
        }
      }
      if (
        op.massBalance &&
        (enteredValues[op.lossParameter] === '' || enteredValues[op.lossParameter] == null)
      ) {
        const balance = operationMassBalance(
          op,
          order.qty / recipeOf(order).baseQty,
          enteredValues,
          action.outputs || {},
          Object.fromEntries(
            op.inputs.map((input) => [input.id, operationInputQty(input, order, op)]),
          ),
        );
        enteredValues[op.lossParameter] = round(balance.input - balance.output);
      }
      for (const p of op.parameters) {
        const value = enteredValues[p.id],
          bounds = parameterBounds(p, order);
        if (p.type === 'boolean') {
          if (p.required && value !== true) throw new Error(`Подтвердите: ${p.name}`);
          values[p.id] = value === true;
        } else if (p.type === 'text') {
          if (p.required && !String(value || '').trim()) throw new Error(`Заполните: ${p.name}`);
          values[p.id] = String(value || '').trim();
        } else {
          if (value === '' || value == null) {
            if (p.required) throw new Error(`Укажите: ${p.name}`);
            values[p.id] = null;
            continue;
          }
          if (
            !Number.isFinite(Number(value)) ||
            (bounds.min != null && Number(value) < bounds.min) ||
            (bounds.max != null && Number(value) > bounds.max)
          )
            throw new Error(
              `«${p.name}»: значение вне допуска ${bounds.min ?? '−∞'}…${bounds.max ?? '+∞'} ${p.unit || ''}`,
            );
          values[p.id] = Number(value);
        }
      }
      if (
        op.lotMarkParameter &&
        state.orders.some(
          (other) =>
            other.id !== order.id &&
            operationsOf(other).some(
              (step) =>
                step.lotMarkParameter &&
                other.samples.some(
                  (sample) =>
                    sample.operationId === step.id &&
                    sample.values[step.lotMarkParameter]?.toLowerCase() ===
                      values[op.lotMarkParameter].toLowerCase(),
                ),
            ),
        )
      )
        throw new Error('Этот номер убоя уже зарегистрирован');
      const outputs = [];
      for (const output of op.outputs) {
        const planned = scaledQty(output, order);
        const actual = action.outputs?.[output.id] ?? planned;
        if (
          (op.massBalance
            ? actual === '' || !Number.isFinite(Number(actual)) || Number(actual) < 0
            : !finitePositive(actual)) ||
          (!op.massBalance && Number(actual) > planned + 0.001) ||
          (output.unit === 'шт' && !Number.isInteger(Number(actual)))
        )
          throw new Error(
            op.massBalance
              ? `«${output.name}»: укажите фактический выпуск от нуля в ${output.unit}`
              : `«${output.name}»: выпуск должен быть больше нуля и не больше ${planned} ${output.unit}`,
          );
        outputs.push({ ...output, qty: round(Number(actual)) });
        if (output.destination === 'process')
          order.wip[output.material] = round((order.wip[output.material] || 0) + Number(actual));
        else order.produced.push({ ...output, qty: round(Number(actual)), operationId: op.id });
      }
      const massBalance = op.massBalance
        ? operationMassBalance(
            op,
            order.qty / recipeOf(order).baseQty,
            values,
            Object.fromEntries(outputs.map((o) => [o.id, o.qty])),
            Object.fromEntries(
              op.inputs.map((input) => [input.id, operationInputQty(input, order, op)]),
            ),
          )
        : null;
      if (
        massBalance &&
        (!Number.isFinite(massBalance.difference) || Math.abs(massBalance.difference) > 0.01)
      )
        throw new Error(
          `Материальный баланс: вход ${massBalance.input} кг = выход ${massBalance.output} кг + потери ${massBalance.loss} кг. Расхождение ${massBalance.difference} кг`,
        );
      const time = new Date().toISOString();
      if (op.carcassGrading) {
        const {
          weight: sourceQty,
          admitted,
          findings,
        } = carcass.carcassClassificationData(state, order);
        if (!finitePositive(sourceQty)) throw new Error('Не зарегистрирована масса туши');
        if (!admitted) throw new Error('Нет допуска по результатам ветеринарного осмотра');
        const gradeRules = carcass.carcassGradeRules(recipeOf(order));
        const rule = gradeRules.find(
          (rule) =>
            sourceQty >= rule.minWeight &&
            sourceQty <= rule.maxWeight &&
            values.lean >= rule.minLean &&
            values.lean <= rule.maxLean &&
            (rule.allowFindings || !findings.length),
        );
        if (gradeRules.length && !rule)
          throw new Error('Нет подходящего правила классификации в версии процесса');
        tracked.finalClassification = {
          lean: values.lean,
          weight: sourceQty,
          ...(rule ? { gradeCode: rule.code, gradeName: rule.name, ruleId: rule.id } : {}),
          classifiedAt: time,
          source: action.manualClassification ? 'manual' : 'AutoFom III',
          reason: action.manualClassification ? action.classificationReason.trim() : '',
          actor: CURRENT_USER.name,
        };
      }
      const operationRfid = tracked?.currentRfid;
      if (tracked && ['cutting', 'sale'].includes(order.recipe))
        carcass.releaseCarrier(state, tracked, 'Снятие туши с разноги');
      for (const allocation of order.allocations.filter(
        (row) => row.operationId === op.id && row.consumed,
      )) {
        const sourceRecord = state.carcasses?.find(
          (record) => record.id === sourceLot(state, allocation.lotId)?.carcassId,
        );
        if (sourceRecord && ['cutting', 'sale'].includes(order.recipe))
          carcass.releaseCarrier(state, sourceRecord, 'Снятие туши с разноги');
      }
      order.samples.push({
        stage: order.stage,
        operationId: op.id,
        kind: op.kind,
        name: op.name,
        values,
        inputs: structuredClone(
          order.operationExecution?.inputs ||
            op.inputs.map((input) => ({ ...input, qty: operationInputQty(input, order, op) })),
        ),
        outputs,
        ...(tracked
          ? {
              carcass: {
                id: tracked.id,
                slaughterNumber: tracked.slaughterNumber,
                rfid: operationRfid,
                primaryClassification: structuredClone(tracked.primaryClassification),
                finalClassification: structuredClone(tracked.finalClassification),
              },
            }
          : {}),
        ...(massBalance ? { massBalance } : {}),
        time,
        ...(order.operationExecution?.operationId === op.id
          ? { execution: structuredClone(order.operationExecution) }
          : {}),
        operator: CURRENT_USER.name,
        equipmentId: op.equipmentId,
        equipment: op.equipment,
      });
      order.actual = round(
        order.produced
          .filter((p) => p.material === recipeOf(order).outputMaterial)
          .reduce((s, p) => s + p.qty, 0),
      );
      releaseReservations(state, order, (row) => row.operationId === op.id);
      log(state, `Завершена операция «${op.name}» · ${order.code}`, 'success', order.id);
      if (order.stage === operationsOf(order).length - 1) finishOrder(state, order);
      else {
        order.stage += 1;
        delete order.operationExecution;
        order.status = 'queued';
        const unavailable = operationAvailability(state, order);
        if (unavailable) {
          order.status = 'waiting';
          order.waitReason = unavailable;
          log(state, `${order.code} · ожидание: ${unavailable}`, 'warning', order.id);
        } else order.waitReason = '';
      }
      break;
    }
    case 'referInspection':
    case 'pause':
      requireOrder();
      if (
        action.type === 'referInspection' &&
        (order.status !== 'quality' || !operationOf(order).reinspection)
      )
        throw new Error('Реинспекция недоступна для этой операции');
      if (!['running', 'quality'].includes(order.status))
        throw new Error('Операция не находится в исполнении');
      if (!action.reason?.trim()) throw new Error('Укажите причину остановки');
      order.status = action.type === 'referInspection' ? 'reinspection' : 'hold';
      order.holdReason = action.reason.trim();
      if (order.operationExecution)
        order.operationExecution.pauses.push({
          startedAt: new Date().toISOString(),
          reason: order.holdReason,
        });
      log(
        state,
        `${order.status === 'reinspection' ? 'Реинспекция' : 'Остановка'} ${order.code}: ${order.holdReason}`,
        'warning',
        order.id,
      );
      break;
    case 'resume':
      requireOrder();
      if (order.status === 'waiting') {
        enterOperation(state, order);
        order.waitReason = '';
        log(
          state,
          `Начата операция «${operationOf(order).name}» · ${order.code}`,
          'success',
          order.id,
        );
        break;
      }
      if (!['hold', 'reinspection'].includes(order.status))
        throw new Error('Заказ не приостановлен');
      order.status = operationOf(order).kind === 'quality' ? 'quality' : 'running';
      const unavailable = operationAvailability(state, order);
      if (unavailable) throw new Error(unavailable);
      order.holdReason = '';
      if (
        order.operationExecution?.pauses.at(-1) &&
        !order.operationExecution.pauses.at(-1).endedAt
      )
        order.operationExecution.pauses.at(-1).endedAt = new Date().toISOString();
      log(state, `Возобновлён ${order.code}`, 'success', order.id);
      break;
    case 'blockLot': {
      const lot = state.lots.find((l) => l.id === action.lotId);
      if (!lot || lot.status === 'quarantine')
        throw new Error('Партия не допущена входным контролем');
      lot.status = lot.status === 'blocked' ? 'released' : 'blocked';
      log(
        state,
        `${lot.status === 'blocked' ? 'Заблокирована' : 'Разблокирована'} партия ${lot.code}`,
        'warning',
        null,
        { category: 'materials', objectType: 'lot', objectId: lot.id, objectCode: lot.code },
      );
      break;
    }
    case 'receiveLot': {
      const material = materialOf(state, action.material),
        qty = Number(action.qty);
      const live = material?.lotMode === 'livestock';
      if (
        !material ||
        material.active === false ||
        material.internal ||
        !finitePositive(qty) ||
        (material.unit === 'шт' && !Number.isInteger(qty)) ||
        (!live && (!action.expires || action.expires <= DAY))
      )
        throw new Error('Проверьте материал, количество, поставщика и срок годности');
      const supplier = requireCounterparty(state, action.supplierId, 'isSupplier');
      const heads = Number(action.heads);
      const declaredWeight = Number(action.declaredWeight);
      const document = action.document?.trim();
      const mtuCode = action.mtuCode?.trim();
      if (
        mtuCode &&
        stockLots(state).some((lot) =>
          [lot.mtuCode, lot.code, lot.id].some(
            (value) => value?.toLocaleLowerCase() === mtuCode.toLocaleLowerCase(),
          ),
        )
      )
        throw new Error('Код MTU уже используется');
      if (
        live &&
        (!Number.isInteger(heads) || heads < 1 || !finitePositive(declaredWeight) || !document)
      )
        throw new Error('Укажите число голов, массу по документам и номер ТСДок');
      state.lots.unshift({
        id: uid(),
        code: `${live ? 'ЖВ' : 'СМ'}-261022-${String(state.lots.length + 1).padStart(3, '0')}`,
        material: material.id,
        qty: live ? round(qty) : qty,
        receivedQty: live ? round(qty) : qty,
        reserved: 0,
        supplierId: supplier.id,
        supplier: supplier.name,
        ...(mtuCode ? { mtuCode } : {}),
        expires: live ? DAY : action.expires,
        received: DAY,
        receivedAt: new Date().toISOString(),
        status: 'quarantine',
        location: live ? 'Приёмка живка · КТ1/КТ2' : 'Зона приёмки',
        ...(live ? { livestock: { heads, declaredWeight, weight: round(qty), document } } : {}),
      });
      log(
        state,
        `Принята партия ${state.lots[0].code}: ${material.name} · ${qty} ${material.unit}`,
        'info',
        null,
        {
          category: 'materials',
          objectType: 'lot',
          objectId: state.lots[0].id,
          objectCode: state.lots[0].code,
        },
      );
      break;
    }
    case 'releaseLot': {
      const lot = state.lots.find((l) => l.id === action.lotId);
      if (!lot || lot.status !== 'quarantine')
        throw new Error('Партия не ожидает входного контроля');
      lot.status = 'released';
      lot.location = lot.livestock ? 'ЗПС' : 'Склад материалов';
      log(state, `Входной контроль пройден · ${lot.code}`, 'success', null, {
        category: 'materials',
        objectType: 'lot',
        objectId: lot.id,
        objectCode: lot.code,
      });
      break;
    }
    case 'acceptWarehouse': {
      const lot = state.finished.find((item) => item.id === action.lotId);
      if (!lot || lot.status !== 'inTransit') throw new Error('Палета не ожидает приёмки на СГП');
      if (
        isOrderBlocked(
          state,
          state.orders.find((o) => o.id === lot.orderId),
        )
      )
        throw new Error('Приёмка запрещена: исходная партия заблокирована');
      lot.status = 'released';
      lot.acceptedAt = new Date().toISOString();
      log(state, `СГП принял палету ${lot.code} · ${lot.qty} ${lot.unit}`, 'success', lot.orderId, {
        category: 'warehouse',
        objectType: 'lot',
        objectId: lot.id,
        objectCode: lot.code,
      });
      break;
    }
    case 'ship': {
      const lot = state.finished.find((l) => l.id === action.lotId),
        qty = Number(action.qty);
      if (
        !lot ||
        !finitePositive(qty) ||
        qty > lot.remaining - (lot.reserved || 0) ||
        (lot.unit === 'шт' && !Number.isInteger(qty))
      )
        throw new Error(
          'Количество отгрузки превышает остаток или не соответствует единице измерения',
        );
      if (lot.status !== 'released') throw new Error('Партия ещё не принята на склад');
      if (state.scenarioId === 'agro' && materialOf(state, lot.material)?.kind !== 'finished')
        throw new Error('Отгрузка производственной партии недоступна');
      if (
        isOrderBlocked(
          state,
          state.orders.find((o) => o.id === lot.orderId),
        )
      )
        throw new Error('Отгрузка запрещена: исходная партия сырья заблокирована');
      const customer = requireCounterparty(state, action.customerId, 'isCustomer');
      lot.remaining = round(lot.remaining - qty);
      state.shipments.unshift({
        id: uid(),
        lotId: lot.id,
        lotCode: lot.code,
        materialName: lot.name,
        unit: lot.unit,
        orderId: lot.orderId,
        orderCode: state.orders.find((item) => item.id === lot.orderId)?.code,
        qty,
        customerId: customer.id,
        customer: customer.name,
        time: new Date().toISOString(),
      });
      log(
        state,
        `Отгружено ${qty} ${lot.unit} · ${lot.code} · ${customer.name}`,
        'success',
        lot.orderId,
        {
          category: 'shipping',
          objectType: 'shipment',
          objectId: state.shipments[0].id,
          objectCode: lot.code,
        },
      );
      break;
    }
    case 'finishCip': {
      const line = state.lines.find((l) => l.id === action.lineId);
      if (!line || line.status !== 'cip') throw new Error('Санобработка уже завершена');
      line.status = 'ready';
      log(state, `Санобработка завершена · ${line.name}`, 'success');
      break;
    }
    default:
      throw new Error('Неизвестная операция');
  }
  return state;
}

function startSeedOperation(state, id) {
  if (['queued', 'waiting'].includes(state.orders.find((o) => o.id === id)?.status))
    state = transition(state, { type: 'startOperation', orderId: id });
  const order = state.orders.find((o) => o.id === id);
  if (['running', 'quality'].includes(order.status))
    for (const row of materialAssignments(order, operationOf(order)).filter((row) => !row.consumed))
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

export function seedState(scenario = 'dairy') {
  if (scenario === 'agro') {
    let state = {
      version: 3,
      scenarioId: 'agro',
      agroCatalogRevision: 3,
      ...createAgroCatalog(),
      orders: [],
      finished: [],
      shipments: [],
      events: [],
    };
    for (const [processId, line, start, due] of agroPlan) {
      const process = state.processes.find((item) => item.id === processId);
      state = transition(state, {
        type: 'createOrder',
        processId,
        qty: process.baseQty,
        line,
        date: DAY,
        start,
        due,
      });
    }
    return state;
  }
  let state = {
    scenarioId: 'dairy',
    version: 2,
    materials: structuredClone(initialMaterials),
    equipment: structuredClone(initialEquipment),
    processes: initialProcesses(),
    lines: [
      { id: 'l1', name: 'Линия 01', status: 'ready', capacity: 600 },
      { id: 'l2', name: 'Линия 02', status: 'ready', capacity: 450 },
      { id: 'l3', name: 'Линия 03', status: 'ready', capacity: 600 },
    ],
    lots: initialInventory(),
    orders: [],
    finished: [],
    shipments: [],
    events: [],
  };
  upgradeResources(state);
  const make = (recipe, qty, line, start, due, count = -1, priority = 'normal') => {
    state = transition(state, {
      type: 'createOrder',
      recipe,
      qty,
      line,
      date: DAY,
      start,
      due,
      priority,
    });
    const id = state.orders.at(-1).id;
    if (count >= 0) {
      state = transition(state, { type: 'reserve', orderId: id });
      if (count > 0) {
        state = transition(state, { type: 'start', orderId: id });
        for (let i = 0; i < count; i++) {
          state = startSeedOperation(state, id);
          const o = state.orders.find((o) => o.id === id),
            op = operationOf(o);
          const values = defaultValues(o);
          op.parameters
            .filter((p) => p.type === 'boolean')
            .forEach((p) => {
              values[p.id] = true;
            });
          const outputs = Object.fromEntries(
            op.outputs
              .filter((o) => o.destination === 'stock')
              .map((out) => [out.id, round(scaledQty(out, o) * 0.982)]),
          );
          state = transition(state, { type: 'advance', orderId: id, values, outputs });
        }
        state = startSeedOperation(state, id);
      }
    }
    return id;
  };
  make('strawberry', 1200, 'l1', '08:00', '10:40', 6);
  make('natural', 1000, 'l2', '08:00', '10:20', 6);
  make('blueberry', 800, 'l3', '09:00', '11:40', 5, 'high');
  const fourth = make('strawberry', 1500, 'l1', '10:45', '14:30');
  make('natural', 1200, 'l2', '10:30', '14:00', 3);
  state = transition(state, { type: 'reserve', orderId: fourth });
  state = transition(state, { type: 'start', orderId: fourth });
  for (let i = 0; i < 2; i++) {
    state = startSeedOperation(state, fourth);
    const order = state.orders.find((o) => o.id === fourth),
      values = defaultValues(order);
    operationOf(order)
      .parameters.filter((p) => p.type === 'boolean')
      .forEach((p) => {
        values[p.id] = true;
      });
    state = transition(state, { type: 'advance', orderId: fourth, values });
  }
  state = startSeedOperation(state, fourth);
  make('strawberry', 1000, 'l1', '14:30', '17:30', 0);
  make('blueberry', 900, 'l3', '14:00', '17:00');
  make('natural', 1100, 'l2', '16:00', '19:00');
  state.lines[2].status = 'cip';
  for (const o of state.orders) {
    const [h, m] = o.start.split(':').map(Number);
    o.samples.forEach((sample, index) => {
      sample.time = new Date(
        Date.parse(`${DAY}T00:00:00+04:00`) + (h * 60 + m + 15 + index * 20) * 60000,
      ).toISOString();
    });
  }
  state.events = [
    {
      id: 'seed-1',
      time: `${DAY}T08:52:00Z`,
      message: 'Линия 03 · санитарная обработка',
      kind: 'info',
      actor: CURRENT_USER.name,
    },
    ...state.orders
      .filter((o) => ['running', 'quality'].includes(o.status))
      .map((o, i) => ({
        id: `seed-${i + 2}`,
        time: `${DAY}T08:${48 - i * 5}:00Z`,
        message: `${o.code} · ${operationOf(o).name}`,
        kind: o.status === 'quality' ? 'warning' : 'info',
        orderId: o.id,
        actor: CURRENT_USER.name,
      })),
  ];
  return normalizeSeedExecutionTimes(state);
}

function normalizeSeedExecutionTimes(state) {
  for (const order of state.orders) {
    for (const sample of order.samples) {
      if (sample.execution)
        sample.execution.startedAt = new Date(Date.parse(sample.time) - 10 * 60000).toISOString();
    }
    if (order.operationExecution) {
      order.operationExecution.startedAt = order.samples.length
        ? new Date(Date.parse(order.samples.at(-1).time) + 60000).toISOString()
        : `${order.date}T${order.start}:00+04:00`;
      for (const pause of order.operationExecution.pauses) {
        pause.startedAt = new Date(
          Date.parse(order.operationExecution.startedAt) + 60000,
        ).toISOString();
      }
    }
  }
  return state;
}

export function migrateState(raw) {
  if (!raw || !Array.isArray(raw.orders) || !Array.isArray(raw.lots)) return seedState();
  if (raw.version === 3) return upgradeDemoIdentity(upgradeCounterparties(structuredClone(raw)));
  if (raw.version === 2)
    return upgradeDemoIdentity(upgradeCounterparties(upgradeResources(structuredClone(raw))));
  if (raw.version !== 1) throw new Error('Неизвестная версия сохранённых данных');
  const state = {
    ...structuredClone(raw),
    version: 2,
    materials: structuredClone(initialMaterials),
    equipment: structuredClone(initialEquipment),
    processes: initialProcesses(),
  };
  for (const order of state.orders) {
    const process = state.processes.find((p) => p.id === order.recipe);
    if (!process) throw new Error(`Невозможно перенести процесс заказа ${order.code}`);
    order.processSnapshot = snapshotProcess(process, state);
    order.processSnapshot.revision = '1 (перенесённая)';
    order.processSnapshot.operations[0].parameters[0] = {
      ...order.processSnapshot.operations[0].parameters[0],
      min: 980,
      target: 1000,
      max: 1020,
      name: 'Масса смеси',
    };
    order.wip = {};
    order.produced = [];
    const oldSamples = order.samples || [];
    order.samples = oldSamples.map((sample) => {
      const op = operationsOf(order)[sample.stage];
      return {
        ...sample,
        operationId: op.id,
        kind: op.kind,
        name: op.name,
        values: Object.fromEntries(
          op.parameters.map((p, i) => [
            p.id,
            p.type === 'boolean' ? true : i === 0 ? sample.value : '',
          ]),
        ),
        outputs: op.outputs.map((out) => ({
          ...out,
          qty: out.destination === 'stock' ? order.actual : scaledQty(out, order),
        })),
      };
    });
    if (['quality', 'completed'].includes(order.status)) order.stage = 5;
    if (order.status === 'completed' && order.quality)
      order.samples.push({
        stage: 5,
        operationId: 'release',
        kind: 'quality',
        name: 'Выпускной контроль',
        values: {
          ph: order.quality.ph,
          temperature: order.quality.temperature,
          organoleptic: true,
        },
        outputs: [],
        time: order.quality.time,
        operator: order.quality.inspector,
      });
    const hasStarted = !['planned', 'ready'].includes(order.status);
    order.allocations = order.allocations.map((a) => ({
      ...a,
      operationId: operationsOf(order).find((op) =>
        op.inputs.some((i) => i.source === 'stock' && i.material === a.material),
      )?.id,
      consumed: hasStarted,
    }));
    if (hasStarted && order.status !== 'completed')
      for (const input of operationOf(order).inputs.filter((i) => i.source === 'process'))
        order.wip[input.material] = 0;
    for (const sample of order.samples)
      for (const out of sample.outputs)
        if (out.destination === 'stock')
          order.produced.push({ ...out, operationId: sample.operationId });
    // The active legacy operation has already consumed its input; rebuild only its future output.
    for (const op of operationsOf(order).slice(order.stage + 1))
      for (const input of op.inputs.filter((i) => i.source === 'process'))
        order.wip[input.material] ||= 0;
  }
  state.finished = state.finished.map((l) => {
    const o = state.orders.find((o) => o.id === l.orderId);
    return {
      ...l,
      material: recipeOf(o).outputMaterial,
      name: recipeOf(o).outputName,
      unit: orderUnit(o),
      operationId: 'pack',
    };
  });
  return upgradeDemoIdentity(upgradeCounterparties(upgradeResources(state)));
}
