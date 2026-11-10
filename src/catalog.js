export const initialMaterials = [
  {
    id: 'milk',
    code: 'СМ-001',
    name: 'Молоко нормализованное 3,2%',
    unit: 'кг',
    kind: 'raw',
    allergen: 'Молоко',
  },
  { id: 'sugar', code: 'СМ-002', name: 'Сахар-песок', unit: 'кг', kind: 'raw', allergen: 'Нет' },
  {
    id: 'strawberry',
    code: 'СМ-003',
    name: 'Наполнитель «Клубника»',
    unit: 'кг',
    kind: 'raw',
    allergen: 'Нет',
  },
  {
    id: 'blueberry',
    code: 'СМ-004',
    name: 'Наполнитель «Черника»',
    unit: 'кг',
    kind: 'raw',
    allergen: 'Нет',
  },
  {
    id: 'culture',
    code: 'СМ-005',
    name: 'Закваска термофильная YF-L812',
    unit: 'кг',
    kind: 'raw',
    allergen: 'Молоко',
  },
  {
    id: 'cup',
    code: 'УМ-001',
    name: 'Стакан с крышкой 150 г',
    unit: 'шт',
    kind: 'packaging',
    allergen: 'Нет',
  },
  ...['Смесь', 'Пастеризованная смесь', 'Сквашенная основа', 'Йогурт до фасовки'].map(
    (name, i) => ({
      id: `semi-${i}`,
      code: `ПФ-00${i + 1}`,
      name,
      unit: 'кг',
      kind: 'intermediate',
      allergen: 'Молоко',
    }),
  ),
  ...[
    ['strawberry', 'Клубника'],
    ['natural', 'Натуральный'],
    ['blueberry', 'Черника'],
  ].map(([id, name], i) => ({
    id: `fg-${id}`,
    code: `ГП-00${i + 1}`,
    name: `Йогурт «${name}» 150 г`,
    unit: 'кг',
    kind: 'finished',
    allergen: 'Молоко',
  })),
];

export const initialEquipment = [
  { id: 'mix-1', code: 'СМ-01', name: 'Смеситель СМ-01', area: 'Подготовка смеси', active: true },
  {
    id: 'pasteurizer',
    code: 'П-01',
    name: 'Пастеризатор П-01',
    area: 'Термический участок',
    active: true,
  },
  {
    id: 'fermenter',
    code: 'ТФ-02',
    name: 'Танк ферментации ТФ-02',
    area: 'Сквашивание',
    active: true,
  },
  { id: 'mix-2', code: 'СМ-02', name: 'Смеситель СМ-02', area: 'Смешивание', active: true },
  { id: 'filler', code: 'ФА-01', name: 'Фасовочный автомат ФА-01', area: 'Фасовка', active: true },
];

const input = (id, material, qty, source = 'process') => ({ id, material, qty, source });
const output = (id, material, qty, destination = 'process') => ({ id, material, qty, destination });
const numeric = (id, name, unit, min, target, max, scaled = false) => ({
  id,
  name,
  type: 'number',
  unit,
  min,
  target,
  max,
  scaled,
  required: true,
});
const confirm = (id, name) => ({ id, name, type: 'boolean', required: true });

// These are editable starting records, not execution rules.
export function initialProcesses() {
  return [
    ['strawberry', 'Клубника'],
    ['natural', 'Натуральный'],
    ['blueberry', 'Черника'],
  ].map(([id, name], i) => {
    const natural = id === 'natural';
    const mix = natural ? 999 : 950;
    return {
      id,
      code: `ПР-00${i + 1}`,
      name: `Йогурт «${name}»`,
      description: `${name} · 150 г`,
      revision: 1,
      lifecycle: 'published',
      outputMaterial: `fg-${id}`,
      baseQty: 1000,
      shelf: 21,
      operations: [
        {
          id: 'prepare',
          name: 'Подготовка смеси',
          kind: 'production',
          equipmentId: 'mix-1',
          inputs: [
            input('milk', 'milk', natural ? 959 : 910, 'stock'),
            input('sugar', 'sugar', 40, 'stock'),
          ],
          outputs: [output('mix', 'semi-0', mix)],
          parameters: [
            numeric('mass', 'Масса загруженного сырья', 'кг', mix * 0.98, mix, mix * 1.02, true),
            confirm('check', 'Дозирование и идентификация сырья выполнены'),
          ],
        },
        {
          id: 'pasteurize',
          name: 'Пастеризация',
          kind: 'production',
          equipmentId: 'pasteurizer',
          inputs: [input('mix', 'semi-0', mix)],
          outputs: [output('heated', 'semi-1', mix)],
          parameters: [
            numeric('temperature', 'Температура выдержки', '°C', 92, 94, 96),
            confirm('check', 'Режим выдержки соблюдён'),
          ],
        },
        {
          id: 'ferment',
          name: 'Сквашивание',
          kind: 'production',
          equipmentId: 'fermenter',
          inputs: [input('heated', 'semi-1', mix), input('culture', 'culture', 1, 'stock')],
          outputs: [output('base', 'semi-2', mix + 1)],
          parameters: [
            numeric('ph', 'Кислотность', 'pH', 4.3, 4.5, 4.6),
            confirm('check', 'Структура сгустка соответствует нормативу'),
          ],
        },
        {
          id: 'blend',
          name: 'Смешивание и охлаждение',
          kind: 'production',
          equipmentId: 'mix-2',
          inputs: [
            input('base', 'semi-2', mix + 1),
            ...(!natural ? [input('fruit', id, 49, 'stock')] : []),
          ],
          outputs: [output('yogurt', 'semi-3', 1000)],
          parameters: [
            numeric('temperature', 'Температура продукта', '°C', 18, 21, 24),
            confirm('check', 'Однородность смеси проверена'),
          ],
        },
        {
          id: 'pack',
          name: 'Фасовка и упаковка',
          kind: 'production',
          equipmentId: 'filler',
          inputs: [input('yogurt', 'semi-3', 1000), input('cups', 'cup', 1000 / 0.15, 'stock')],
          outputs: [output('finished', `fg-${id}`, 1000, 'stock')],
          parameters: [
            numeric('weight', 'Масса нетто стакана', 'г', 147, 150, 153),
            confirm('check', 'Маркировка и герметичность упаковки проверены'),
          ],
        },
        {
          id: 'release',
          name: 'Выпускной контроль',
          kind: 'quality',
          equipmentId: '',
          inputs: [],
          outputs: [],
          parameters: [
            numeric('ph', 'Кислотность готового продукта', 'pH', 4.3, 4.5, 4.6),
            numeric('temperature', 'Температура готового продукта', '°C', 2, 4, 6),
            confirm('organoleptic', 'Органолептические показатели соответствуют спецификации'),
          ],
        },
      ],
    };
  });
}

export function initialInventory() {
  return [
    [
      'milk-1',
      'МЛ-221026-01',
      'milk',
      18000,
      'Агрофирма «Рассвет»',
      '2026-10-24',
      'released',
      'Танк Т-01',
    ],
    [
      'milk-2',
      'МЛ-221026-02',
      'milk',
      8000,
      'АО «Молочные фермы»',
      '2026-10-25',
      'quarantine',
      'Танк Т-03',
    ],
    [
      'sugar-1',
      'СХ-201026-04',
      'sugar',
      1800,
      'ООО «Продснаб»',
      '2027-04-20',
      'released',
      'Склад А',
    ],
    [
      'fruit-1',
      'КЛ-191026-12',
      'strawberry',
      900,
      'ООО «Фрутекс»',
      '2027-01-19',
      'released',
      'Склад Б',
    ],
    [
      'fruit-2',
      'ЧР-201026-08',
      'blueberry',
      500,
      'ООО «Фрутекс»',
      '2027-01-20',
      'released',
      'Склад Б',
    ],
    [
      'culture-1',
      'ЗК-151026-03',
      'culture',
      35,
      'ООО «Биокультура»',
      '2027-06-15',
      'released',
      'Холодильник Х-01',
    ],
    ['cup-1', 'УП-181026-01', 'cup', 160000, 'АО «УпакПласт»', '2028-10-18', 'released', 'Склад В'],
  ].map(([id, code, material, qty, supplier, expires, status, location]) => ({
    id,
    code,
    material,
    qty,
    reserved: 0,
    supplier,
    expires,
    status,
    location,
    received: '2026-10-22',
  }));
}
