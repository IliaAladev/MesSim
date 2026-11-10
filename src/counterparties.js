const normalize = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru');

export const DEMO_SUPPLIERS = {
  ingredients: 'ООО «АгроИнгредиент»',
  packaging: 'ООО «АгроУпак»',
};
const legacySupplierNames = new Map([
  [normalize('Демо · вспомогательное сырьё'), DEMO_SUPPLIERS.ingredients],
  [normalize('Демо · упаковочные материалы'), DEMO_SUPPLIERS.packaging],
]);

export function nextCounterpartyCode(state) {
  let number = 1;
  const codes = new Set(state.counterparties.map((party) => normalize(party.code)));
  while (codes.has(normalize(`КА-${String(number).padStart(3, '0')}`))) number++;
  return `КА-${String(number).padStart(3, '0')}`;
}

// Upgrade once from the labels saved by earlier versions. Document names remain
// snapshots: renaming or archiving an organisation never rewrites old receipts.
export function upgradeCounterparties(state) {
  const importing = !Array.isArray(state.counterparties);
  if (importing) state.counterparties = [];
  const correctDemoNames = !state.counterpartyCatalogRevision;
  if (correctDemoNames) {
    for (const party of state.counterparties) {
      const name = legacySupplierNames.get(normalize(party.name));
      if (!name || !party.isSupplier) continue;
      // Keep each identity and its document links, even if a namesake was added manually.
      party.name = state.counterparties.some(
        (other) => other.id !== party.id && normalize(other.name) === normalize(name),
      )
        ? `${name} (${party.code})`
        : name;
    }
  }
  const add = (name, role, id) => {
    if (!normalize(name)) return null;
    if (role === 'isSupplier' && correctDemoNames)
      name = legacySupplierNames.get(normalize(name)) || name;
    let party = state.counterparties.find((row) => normalize(row.name) === normalize(name));
    if (!party && importing) {
      party = {
        id: id || `party-import-${state.counterparties.length + 1}`,
        code: nextCounterpartyCode(state),
        name: name.trim(),
        isSupplier: false,
        isCustomer: false,
        active: true,
      };
      state.counterparties.push(party);
    }
    if (party && importing) party[role] = true;
    return party;
  };
  if (importing) {
    if (state.scenarioId === 'agro') add('СК Северный', 'isSupplier', 'party-north');
    add('РЦ «Перекрёсток»', 'isCustomer', 'party-crossroads');
  }
  for (const lot of state.lots) {
    if (lot.supplierId) continue;
    const party = add(lot.supplier, 'isSupplier');
    if (party) lot.supplierId = party.id;
  }
  for (const shipment of state.shipments || []) {
    if (shipment.customerId) continue;
    const party = add(shipment.customer, 'isCustomer');
    if (party) shipment.customerId = party.id;
  }
  if (correctDemoNames) state.counterpartyCatalogRevision = 1;
  return state;
}

export function validateCounterparty(state, candidate) {
  const party = {
    id: candidate.id,
    code: String(candidate.code || '').trim(),
    name: String(candidate.name || '').trim(),
    isSupplier: Boolean(candidate.isSupplier),
    isCustomer: Boolean(candidate.isCustomer),
    active: candidate.active !== false,
  };
  if (!party.id || !party.code || !party.name)
    throw new Error('Укажите код и наименование контрагента');
  if (!party.isSupplier && !party.isCustomer)
    throw new Error('Выберите роль: поставщик или потребитель');
  if (
    state.counterparties.some(
      (row) => row.id !== party.id && normalize(row.code) === normalize(party.code),
    )
  )
    throw new Error('Код контрагента уже используется');
  if (
    state.counterparties.some(
      (row) => row.id !== party.id && normalize(row.name) === normalize(party.name),
    )
  )
    throw new Error('Контрагент с таким наименованием уже есть. Измените его роли в справочнике');
  return party;
}

export function requireCounterparty(state, id, role) {
  const party = state.counterparties.find((row) => row.id === id);
  if (!party || !party.active || !party[role])
    throw new Error(
      role === 'isSupplier'
        ? 'Выберите действующего поставщика из справочника'
        : 'Выберите действующего потребителя из справочника',
    );
  return party;
}
