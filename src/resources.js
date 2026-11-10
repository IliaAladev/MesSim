// Role-based production hierarchy. Work centres (lines) and work units (equipment)
// keep their existing collections so historical order references stay stable.
export const levelLabels = {
  enterprise: 'Предприятие',
  site: 'Площадка',
  area: 'Участок',
  line: 'Рабочий центр · линия',
  equipment: 'Рабочая единица · оборудование',
};
export const baseStructure = () => [
  {
    id: 'enterprise',
    code: 'ПРЕД-01',
    name: 'Молочное производство',
    type: 'enterprise',
    parentId: '',
    active: true,
  },
  {
    id: 'site',
    code: 'МК-01',
    name: 'Молочный комбинат № 1',
    type: 'site',
    parentId: 'enterprise',
    active: true,
  },
  {
    id: 'area',
    code: 'ЦЕХ-01',
    name: 'Цех кисломолочной продукции',
    type: 'area',
    parentId: 'site',
    active: true,
  },
];
export const resourceNodes = (s) => [
  ...(s.structure || []),
  ...s.lines.map((l) => ({ ...l, type: 'line' })),
  ...s.equipment.map((e) => ({ ...e, type: 'equipment' })),
];
export function resourcePath(s, id) {
  const nodes = resourceNodes(s),
    path = [],
    seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const n = nodes.find((n) => n.id === id);
    if (!n) break;
    path.unshift(n);
    id = n.parentId;
  }
  return path;
}
export const resourceActive = (s, id) => {
  const path = resourcePath(s, id);
  return path.length > 0 && path.every((n) => n.active !== false);
};
export function equipmentFitsLine(s, equipment, lineId) {
  const path = resourcePath(s, lineId);
  return (
    equipment.parentId === lineId ||
    path.some((n) => n.type === 'area' && n.id === equipment.parentId)
  );
}
export function resolveEquipment(s, op, lineId) {
  if (!op.equipmentId && !op.equipmentClass) return null;
  const candidates = s.equipment.filter(
    (e) =>
      resourceActive(s, e.id) &&
      equipmentFitsLine(s, e, lineId) &&
      (op.equipmentId ? e.id === op.equipmentId : e.classCode === op.equipmentClass),
  );
  candidates.sort(
    (a, b) =>
      Number(b.parentId === lineId) - Number(a.parentId === lineId) || a.code.localeCompare(b.code),
  );
  if (!candidates.length)
    throw new Error(
      `Операция «${op.name}»: на выбранной линии нет доступного оборудования ${op.equipmentClass || s.equipment.find((e) => e.id === op.equipmentId)?.name || op.equipmentId}`,
    );
  return candidates[0];
}
export function processLineError(s, process, lineId) {
  try {
    if (!s.lines.some((l) => l.id === lineId) || !resourceActive(s, lineId))
      throw new Error('Линия или родительский узел недоступны');
    for (const op of process.operations) resolveEquipment(s, op, lineId);
    return '';
  } catch (e) {
    return e.message;
  }
}
export function validateResource(s, node) {
  if (!node.code?.trim() || !node.name?.trim()) throw new Error('Укажите код и наименование узла');
  const nodes = resourceNodes(s);
  if (
    nodes.some((n) => n.id !== node.id && n.code?.toLowerCase() === node.code.trim().toLowerCase())
  )
    throw new Error('Код узла уже используется');
  const parents = {
    enterprise: [],
    site: ['enterprise'],
    area: ['site'],
    line: ['area'],
    equipment: ['area', 'line'],
  };
  if (!parents[node.type]) throw new Error('Неизвестный уровень структуры');
  if (node.type === 'enterprise') {
    if (node.parentId) throw new Error('Предприятие является корневым узлом');
  } else {
    const parent = nodes.find((n) => n.id === node.parentId);
    if (!parent || !parents[node.type].includes(parent.type))
      throw new Error('Родитель не соответствует уровню иерархии');
    if (resourcePath(s, node.parentId).some((n) => n.id === node.id))
      throw new Error('Цикл в иерархии');
  }
  const old = nodes.find((n) => n.id === node.id);
  if (old && old.type !== node.type) throw new Error('Уровень существующего узла менять нельзя');
  if (
    node.type === 'line' &&
    (!Number.isFinite(Number(node.capacity)) || Number(node.capacity) <= 0)
  )
    throw new Error('Укажите производительность больше нуля');
  if (node.type === 'equipment' && !node.classCode?.trim())
    throw new Error('Укажите класс оборудования');
  const changed =
    old &&
    (old.parentId !== node.parentId ||
      node.active === false ||
      (node.type === 'equipment' && old.classCode !== node.classCode));
  if (
    changed &&
    s.orders.some(
      (o) =>
        ![
          'planned',
          'completed',
          ...(old?.parentId === node.parentId && old?.classCode === node.classCode
            ? ['ready']
            : []),
        ].includes(o.status) &&
        (resourcePath(s, o.line).some((n) => n.id === node.id) ||
          o.processSnapshot.operations.some((op) =>
            resourcePath(s, op.equipmentId).some((n) => n.id === node.id),
          )),
    )
  )
    throw new Error(
      'Узел используется активным заказом: перенос, отключение или смена класса недоступны',
    );
}
export const legacyClasses = {
  'mix-1': 'Подготовка смеси',
  pasteurizer: 'Пастеризация',
  fermenter: 'Ферментация',
  'mix-2': 'Смешивание',
  filler: 'Фасовка',
};
export function upgradeResources(state) {
  state.structure = baseStructure();
  state.lines = state.lines.map((l, i) => ({
    ...l,
    code: `ЛН-${String(i + 1).padStart(2, '0')}`,
    parentId: 'area',
    active: true,
  }));
  const original = state.equipment;
  state.equipment = original.flatMap((e) =>
    legacyClasses[e.id]
      ? state.lines.map((l, i) => ({
          ...e,
          id: i ? `${e.id}-${l.id}` : e.id,
          code: i ? `${e.code}-${i + 1}` : e.code,
          name: i ? `${e.name} · ${l.name}` : e.name,
          parentId: l.id,
          classCode: legacyClasses[e.id],
        }))
      : [{ ...e, parentId: 'area', classCode: e.classCode || e.area || e.code }],
  );
  const upgradeProcess = (p) => {
    for (const op of p.operations)
      if (legacyClasses[op.equipmentId]) {
        op.equipmentClass = legacyClasses[op.equipmentId];
        op.equipmentId = '';
      }
    if (p.draft) upgradeProcess(p.draft);
  };
  state.processes.forEach(upgradeProcess);
  for (const o of state.orders)
    for (const op of o.processSnapshot.operations) {
      if (legacyClasses[op.equipmentId]) {
        const i = state.lines.findIndex((l) => l.id === o.line);
        op.equipmentClass = legacyClasses[op.equipmentId];
        if (i > 0) op.equipmentId += `-${o.line}`;
        op.equipment = state.equipment.find((e) => e.id === op.equipmentId)?.name || op.equipment;
      }
      op.equipmentPath = resourcePath(state, op.equipmentId)
        .map((n) => n.name)
        .join(' / ');
    }
  state.version = 3;
  return state;
}
