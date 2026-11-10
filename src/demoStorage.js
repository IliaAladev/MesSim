import { upgradeCarcassTracking } from './carcassTracking.js';
import { STORAGE_KEY, migrateState, seedState } from './domain.js';
import { upgradeAgroState } from './agroCatalog.js';

export const DEMO_SELECTION_KEY = 'food-mes-active-demo';
export const demos = [
  {
    id: 'dairy',
    name: 'Молочное производство',
    description: 'Йогурты: подготовка смеси, пастеризация, сквашивание и фасовка.',
    key: STORAGE_KEY,
  },
  {
    id: 'agro',
    name: 'АГРОЭКО-ЮГ',
    description: 'Приёмка живка, убой, ветконтроль, обвалка, фарш, приёмка на СГП и учёт ЦТП.',
    key: 'food-mes-agro-v1',
  },
];
export const demoOf = (id) => demos.find((d) => d.id === (id === 'meat' ? 'agro' : id)) || demos[1];
export function loadDemo(storage, id) {
  const demo = demoOf(id);
  const saved = storage.getItem(demo.key);
  if (!saved) return seedState(demo.id);
  const raw = JSON.parse(saved);
  if (!raw || !Array.isArray(raw.orders) || !Array.isArray(raw.lots))
    throw new Error('Неверная структура сохранения');
  if (
    raw.version === 3 &&
    [
      'materials',
      'equipment',
      'processes',
      'lines',
      'structure',
      'finished',
      'shipments',
      'events',
    ].some((key) => !Array.isArray(raw[key]))
  )
    throw new Error('Неполное сохранение: отсутствуют справочники или производственные данные');
  return upgradeCarcassTracking(upgradeAgroState({ ...migrateState(raw), scenarioId: demo.id }));
}
export function saveDemo(storage, state) {
  storage.setItem(demoOf(state.scenarioId).key, JSON.stringify(state));
}
export function switchDemo(storage, current, id, preserveCurrent = true) {
  const demo = demoOf(id);
  // Read before writing: a broken destination never replaces either saved scenario.
  const next = loadDemo(storage, demo.id);
  if (preserveCurrent) saveDemo(storage, current);
  storage.setItem(DEMO_SELECTION_KEY, demo.id);
  return next;
}
