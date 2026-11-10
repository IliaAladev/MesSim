import { configureCarcassProcess } from './carcassTracking.js';
import { DEMO_SUPPLIERS } from './counterparties.js';

const input = (material, qty, source = 'stock') => ({
  id: `in-${material}`,
  material,
  qty,
  source,
});
const output = (material, qty, destination = 'stock', id = material) => ({
  id: `out-${id}`,
  material,
  qty,
  destination,
});
const confirm = (id, name) => ({ id, name, type: 'boolean', required: true });
const text = (id, name) => ({ id, name, type: 'text', required: true });
const numeric = (id, name, unit, min, target, max, scaled = false) => ({
  id,
  name,
  unit,
  min,
  target,
  max,
  scaled,
  type: 'number',
  required: true,
});
const operation = (id, name, equipmentClass, inputs, outputs, parameters = [], loss) => ({
  id,
  name,
  equipmentClass,
  inputs,
  outputs,
  parameters: [
    ...parameters,
    ...(loss === undefined
      ? []
      : [numeric('loss', 'Технологические потери', 'кг', 0, loss, undefined, true)]),
  ],
  kind: 'production',
  ...(loss === undefined ? {} : { massBalance: true, lossParameter: 'loss' }),
});
const quality = (id, name, equipmentClass, parameters) => ({
  ...operation(id, name, equipmentClass, [], [], parameters),
  kind: 'quality',
});

const nodes = [
  ['enterprise', 'МПК', 'ООО «АГРОЭКО-ЮГ»', 'enterprise', ''],
  ['site', 'МПК-01', 'МПК «АГРОЭКО-ЮГ»', 'site', 'enterprise'],
  ['area-slaughter', 'Ц-01', 'Цех убоя', 'area', 'site'],
  ['area-cutting', 'Ц-02', 'Цех обвалки', 'area', 'site'],
  ['area-pu', 'Ц-03', 'Потребительская упаковка', 'area', 'site'],
  ['area-ctp', 'Ц-04', 'Цех термической переработки', 'area', 'site'],
];
const workCenters = [
  ['slaughter', 'Убой', 'area-slaughter', [['stun', 'Оглушение и убой · КТ4']]],
  [
    'carcass',
    'Контроль и охлаждение туш',
    'area-slaughter',
    [
      ['rfid', 'Идентификация · КТ8'],
      ['inspection', 'Ветеринарный осмотр · КТ12–КТ17'],
      ['grade', 'Классификация · КТ19'],
      ['cool', 'Камера охлаждения · КТ20/21'],
      ['sale', 'Передача полутуш · КТ101'],
    ],
  ],
  [
    'cutting',
    'Разделка и обвалка',
    'area-cutting',
    [
      ['cut', 'Разделка · КТ105/110'],
      ['debone', 'Регистрация выхода · КТ111'],
    ],
  ],
  [
    'pu',
    'Фарш и потребительская упаковка',
    'area-pu',
    [
      ['mix', 'Фаршесоставление · КТ204'],
      ['pack', 'Упаковка и формирование поддонов · КТ216'],
    ],
  ],
  [
    'ctp',
    'ЦТП · линия 2',
    'area-ctp',
    [
      ['receive-waste', 'Приёмка сырья · КТ301/302'],
      ['render', 'Переработка отходов убоя · КТ305–КТ307'],
    ],
  ],
];

export const agroPlan = [
  ['slaughter', 'slaughter', '08:00', '08:30'],
  ['carcass', 'carcass', '08:30', '12:30'],
  ['carcass', 'carcass', '08:30', '12:30'],
  ['carcass', 'carcass', '08:30', '12:30'],
  ['cutting', 'cutting', '13:00', '14:00'],
  ['sale', 'carcass', '13:00', '14:00'],
  ['mince', 'pu', '14:00', '16:00'],
  ['rendering', 'ctp', '14:00', '18:00'],
];

export function createAgroCatalog() {
  const materials = [
    ['live', 'Свиньи · живая масса', 'raw', 'кг', 'livestock'],
    ['warm', 'Туша', 'intermediate', 'кг', 'individual'],
    ['cold', 'Туша охлаждённая', 'intermediate', 'кг', 'individual'],
    ['offal', 'Субпродукты убоя · отдельный поток', 'byproduct'],
    ['blood', 'Кровь техническая', 'byproduct'],
    ['slaughter-waste', 'Непищевые продукты убоя', 'byproduct'],
    ['front', 'Передний отруб на кости', 'intermediate'],
    ['middle', 'Средний отруб на кости', 'intermediate'],
    ['rear', 'Задний отруб на кости', 'intermediate'],
    ['meat', 'Бескостные отрубы', 'intermediate'],
    ['trim', 'Тримминг свиной', 'intermediate'],
    ['fat', 'Шпик свиной', 'intermediate'],
    ['bone', 'Кость · сырьё для ЦТП', 'byproduct'],
    ['seasoning', 'Вспомогательная смесь РЦ-04', 'raw'],
    ['tray', 'Лоток с плёнкой', 'packaging', 'шт'],
    ['box', 'Гофрокороб', 'packaging', 'шт'],
    ['mix', 'Замес фарша РЦ-04', 'intermediate'],
    ['pallet', 'Палета фарша свиного охлаждённого', 'finished', 'кг', 'pallet'],
    ['sides', 'Полутуши на реализацию', 'finished'],
    ['tech-fat', 'Технический жир', 'finished'],
    ['meal', 'Кормовая мука', 'finished'],
  ].map(([id, name, kind, unit = 'кг', lotMode], i) => ({
    id,
    name,
    kind,
    unit,
    lotMode,
    code: `М-${String(i + 1).padStart(3, '0')}`,
    internal: !['raw', 'packaging'].includes(kind),
  }));

  const processes = [
    [
      'slaughter',
      'Убой · партия живка',
      'warm',
      300,
      [
        operation(
          'stun',
          'Оглушение и убой · КТ4',
          'stun',
          [input('live', 365)],
          [
            output('warm', 100, 'stock', 'carcass-1'),
            output('warm', 100, 'stock', 'carcass-2'),
            output('warm', 100, 'stock', 'carcass-3'),
            output('offal', 20),
            output('blood', 11),
            output('slaughter-waste', 34),
          ],
          [confirm('stun', 'Обработка партии убоя завершена')],
          0,
        ),
      ],
      'Учебная партия из 3 голов. Укрупнённый учёт убоя и побочных выходов.',
    ],
    [
      'carcass',
      'Ветконтроль и охлаждение туши',
      'cold',
      98.8,
      [
        operation(
          'rfid',
          'Идентификация и маркировка туши · КТ8',
          'rfid',
          [input('warm', 100)],
          [output('warm', 100, 'process')],
          [],
        ),
        {
          ...quality('inspection', 'Ветеринарный осмотр туши · КТ12/13', 'inspection', [
            { ...text('vet', 'Документ ветосмотра'), required: false },
            confirm('admission', 'Туша допущена по результату осмотра'),
          ]),
          reinspection: true,
        },
        {
          ...operation(
            'grade',
            'Итоговая классификация туши · КТ19',
            'grade',
            [],
            [],
            [numeric('lean', 'Постность', '%', 0, 57, 100)],
          ),
          carcassGrading: true,
        },
        operation(
          'cool',
          'Охлаждение и повторное взвешивание · КТ20/21',
          'cool',
          [input('warm', 100, 'process')],
          [output('cold', 98.8)],
          [numeric('temperature', 'Температура в толще', '°C', 0, 3, 4)],
          1.2,
        ),
      ],
      'Один заказ на одну тушу. Учебные параметры охлаждения.',
    ],
    [
      'cutting',
      'Разделка и обвалка туши',
      'meat',
      64.4,
      [
        operation(
          'cut',
          'Передача на обвалку и разделка · КТ101/105/110',
          'cut',
          [input('cold', 98.8)],
          [
            output('front', 30, 'process'),
            output('middle', 28.8, 'process'),
            output('rear', 40, 'process'),
          ],
          [],
          0,
        ),
        operation(
          'debone',
          'Обвалка и взвешивание выходов · КТ111',
          'debone',
          [
            input('front', 30, 'process'),
            input('middle', 28.8, 'process'),
            input('rear', 40, 'process'),
          ],
          [output('meat', 64.4), output('trim', 16), output('fat', 3.6), output('bone', 13)],
          [],
          1.8,
        ),
      ],
      'Вход — одна охлаждённая туша. План задаётся по выходу бескостных отрубов.',
    ],
    [
      'sale',
      'Полутуши на реализацию',
      'sides',
      98.8,
      [
        operation(
          'sale',
          'Передача на реализацию полутушами · КТ101',
          'sale',
          [input('cold', 98.8)],
          [output('sides', 98.8)],
          [confirm('label', 'Полутуши идентифицированы и направлены на реализацию')],
          0,
        ),
      ],
      'Альтернативное направление охлаждённой туши.',
    ],
    [
      'mince',
      'Фарш РЦ-04 · потребительская упаковка',
      'pallet',
      20,
      [
        operation(
          'mix',
          'Фаршесоставление · КТ204',
          'mix',
          [input('trim', 16), input('fat', 3.6), input('seasoning', 0.4)],
          [output('mix', 20, 'process')],
          [],
          0,
        ),
        operation(
          'pack',
          'Фасовка, маркировка и формирование палеты · КТ216',
          'pack',
          [input('mix', 20, 'process'), input('tray', 50), input('box', 5)],
          [output('pallet', 20)],
          [confirm('pack', 'Упаковка и этикетка палеты проверены')],
          0,
        ),
      ],
      'Учебная спецификация РЦ-04. При плане 20 кг — 50 лотков по 400 г и 5 коробов.',
    ],
    [
      'rendering',
      'Переработка кости · ЦТП',
      'meal',
      5.3,
      [
        operation(
          'receive-waste',
          'Приёмка кости · КТ301/302',
          'receive-waste',
          [input('bone', 13)],
          [output('bone', 13, 'process')],
          [confirm('weight', 'Категория и масса сырья при передаче подтверждены')],
          0,
        ),
        operation(
          'render',
          'Переработка и регистрация выходов · КТ305–КТ307',
          'render',
          [input('bone', 13, 'process')],
          [output('tech-fat', 3.2), output('meal', 5.3)],
          [],
          4.5,
        ),
      ],
      'Учебная доля загрузки линии 2. Потери отражают отвод влаги.',
    ],
  ].map(([id, name, outputMaterial, baseQty, operations, description], i) => ({
    id,
    code: `АГ-${String(i + 1).padStart(2, '0')}`,
    name,
    outputMaterial,
    baseQty,
    operations,
    description,
    shelf: id === 'rendering' ? 30 : 2,
    preserveExpiry: ['carcass', 'cutting', 'sale', 'mince'].includes(id),
    revision: ['cutting', 'mince'].includes(id) ? 2 : 1,
    lifecycle: 'published',
    ...(id === 'mince' ? { quantityStep: 0.4 } : {}),
  }));

  for (const process of processes)
    if (process.id === 'carcass') {
      configureCarcassProcess(process);
      process.revision = 2;
    }

  return {
    materials,
    processes,
    structure: nodes.map(([id, code, name, type, parentId]) => ({
      id,
      code,
      name,
      type,
      parentId,
      active: true,
    })),
    lines: workCenters.map(([id, name, parentId], i) => ({
      id,
      code: `Л-${i + 1}`,
      name,
      parentId,
      status: 'ready',
      active: true,
    })),
    equipment: workCenters.flatMap(([line, , , items]) =>
      items.map(([classCode, name], i) => ({
        id: `${line}-${classCode}`,
        code: `${line.toUpperCase()}-${i + 1}`,
        name,
        classCode,
        parentId: line,
        active: true,
      })),
    ),
    lots: [
      ['seasoning', 4, DEMO_SUPPLIERS.ingredients],
      ['tray', 500, DEMO_SUPPLIERS.packaging],
      ['box', 50, DEMO_SUPPLIERS.packaging],
    ].map(([material, qty, supplier], i) => ({
      id: `agro-supply-${i + 1}`,
      code: `МАТ-00${i + 1}`,
      material,
      qty,
      reserved: 0,
      supplier,
      expires: '2026-11-22',
      received: '2026-10-22',
      status: 'released',
      location: 'Склад материалов',
    })),
  };
}

export function upgradeAgroState(previous) {
  if (previous.scenarioId !== 'agro') return previous;
  if (previous.agroCatalogRevision >= 2) return upgradeAgroNames(previous);
  const state = structuredClone(previous);
  const originalCutting = (process) =>
    process?.id === 'cutting' &&
    process.revision === 1 &&
    Number(process.baseQty) === 65 &&
    process.operations.length === 2 &&
    process.operations[1].outputs.length === 4 &&
    process.operations[1].outputs.every(
      (row) => Number(row.qty) === { meat: 65, trim: 15.4, fat: 3.6, bone: 13 }[row.material],
    );
  const originalMince = (process) =>
    process?.id === 'mince' &&
    process.revision === 1 &&
    Number(process.baseQty) === 20 &&
    process.operations.length === 2 &&
    process.operations[0].inputs.length === 3 &&
    process.operations[0].inputs.every(
      (row) => Number(row.qty) === { trim: 16, fat: 3.6, seasoning: 0.4 }[row.material],
    ) &&
    process.operations[1].inputs.some((row) => row.material === 'tray' && Number(row.qty) === 50);
  const update = (process) => {
    if (originalCutting(process)) {
      process.baseQty = 64.4;
      for (const row of process.operations[1].outputs) {
        if (row.material === 'meat') row.qty = 64.4;
        if (row.material === 'trim') row.qty = 16;
      }
      process.revision = 2;
    } else if (originalMince(process)) {
      process.quantityStep = 0.4;
      process.revision = 2;
    }
  };
  for (const process of state.processes) if (process.lifecycle === 'published') update(process);
  for (const order of state.orders) {
    if (order.status !== 'planned' || order.samples.length || order.allocations.length) continue;
    if (originalCutting(order.processSnapshot)) {
      order.qty = Math.round(((order.qty * 64.4) / 65) * 1000) / 1000;
    }
    update(order.processSnapshot);
  }
  state.agroCatalogRevision = 2;
  state.events.unshift({
    id: 'agro-norms-2',
    time: new Date().toISOString(),
    kind: 'info',
    message:
      'Уточнены плановые выходы обвалки и шаг выпуска фарша. Доступен пересчёт незапущенных заказов по остаткам.',
  });
  return upgradeAgroNames(state);
}

// Correct the standard material caption without changing custom names or recorded production facts.
export function agroMaterialCaption(row) {
  return row?.material === 'warm' && row.name === 'Туша после убоя' ? 'Туша' : row?.name;
}

function upgradeAgroNames(previous) {
  if (previous.agroCatalogRevision >= 3) return previous;
  const state = structuredClone(previous);
  const material = state.materials.find((row) => row.id === 'warm');
  if (material?.name === 'Туша после убоя') material.name = 'Туша';
  for (const process of state.processes) {
    for (const operation of process.operations || [])
      for (const row of [...(operation.inputs || []), ...(operation.outputs || [])])
        if (row.material === 'warm' && row.name === 'Туша после убоя') row.name = 'Туша';
  }
  for (const lot of [...state.lots, ...state.finished]) {
    if (lot.material === 'warm' && lot.name === 'Туша после убоя') lot.name = 'Туша';
  }
  state.agroCatalogRevision = 3;
  return state;
}
