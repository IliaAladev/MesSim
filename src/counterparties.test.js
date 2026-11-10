import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, transition, migrateState, defaultValues } from './domain.js';
import { CURRENT_USER } from './identity.js';
import { DEMO_SUPPLIERS } from './counterparties.js';

const save = (state, party) => transition(state, { type: 'saveCounterparty', counterparty: party });
const receive = (state, supplierId) =>
  transition(state, {
    type: 'receiveLot',
    material: 'tray',
    qty: 100,
    expires: '2026-12-01',
    supplierId,
  });
const custom = {
  id: 'custom-party',
  code: 'CUSTOM',
  name: 'Новый контрагент',
  isSupplier: true,
  isCustomer: true,
  active: true,
};

test('legacy demo supplier descriptions become organisation names without changing document snapshots or user edits', () => {
  const old = seedState('agro');
  delete old.counterpartyCatalogRevision;
  const ingredients = old.counterparties.find((party) => party.name === DEMO_SUPPLIERS.ingredients);
  const packaging = old.counterparties.find((party) => party.name === DEMO_SUPPLIERS.packaging);
  ingredients.name = 'Мой поставщик ингредиентов';
  packaging.name = 'Демо · упаковочные материалы';
  const receipt = old.lots.find((lot) => lot.material === 'tray');
  receipt.supplier = packaging.name;
  const original = structuredClone(old);
  const migrated = migrateState(old);
  assert.deepEqual(old, original);
  assert.equal(
    migrated.counterparties.find((party) => party.id === packaging.id).name,
    DEMO_SUPPLIERS.packaging,
  );
  assert.equal(
    migrated.counterparties.find((party) => party.id === ingredients.id).name,
    ingredients.name,
  );
  assert.deepEqual(migrated.lots, original.lots);
  assert.deepEqual(migrateState(migrated), migrated);

  delete old.counterparties;
  old.lots.forEach((lot) => {
    delete lot.supplierId;
  });
  old.lots.find((lot) => lot.material === 'seasoning').supplier = 'Демо · вспомогательное сырьё';
  const imported = migrateState(old);
  const supplier = imported.counterparties.find((party) => party.name === DEMO_SUPPLIERS.packaging);
  assert.ok(supplier?.isSupplier);
  assert.equal(imported.lots.find((lot) => lot.id === receipt.id).supplierId, supplier.id);
  assert.ok(imported.counterparties.some((party) => party.name === DEMO_SUPPLIERS.ingredients));
  assert.ok(seedState('agro').counterparties.every((party) => !party.name.startsWith('Демо ·')));
});

test('counterparty roles are explicit and duplicate names and codes are rejected atomically', () => {
  const state = save(seedState('agro'), custom);
  assert.ok(state.counterparties.find((party) => party.id === custom.id).isCustomer);
  for (const candidate of [
    { ...custom, id: 'other', code: 'custom', name: 'Другое имя' },
    { ...custom, id: 'other', code: 'OTHER', name: ' новый   КОНТРАГЕНТ ' },
    { ...custom, isSupplier: false, isCustomer: false },
    { ...custom, name: '   ' },
  ]) {
    const before = structuredClone(state);
    assert.throws(() => save(state, candidate));
    assert.deepEqual(state, before);
  }
});

test('receipts and shipments require an active counterparty with the correct role', () => {
  let state = seedState('agro');
  assert.throws(() => receive(state, 'unknown'), /поставщика из справочника/);
  assert.throws(() => receive(state, 'party-crossroads'), /поставщика из справочника/);
  assert.throws(
    () =>
      transition(state, {
        type: 'receiveLot',
        material: 'tray',
        qty: 100,
        expires: '2026-12-01',
        supplier: 'Произвольный текст',
      }),
    /справочника/,
  );
  state = save(state, custom);
  state = receive(state, custom.id);
  assert.equal(state.lots[0].supplierId, custom.id);
  assert.equal(state.lots[0].supplier, custom.name);
  state.finished = [
    {
      id: 'ready-pallet',
      code: 'PALLET',
      material: 'pallet',
      name: 'Палета',
      qty: 20,
      remaining: 20,
      unit: 'кг',
      status: 'released',
    },
  ];
  const ship = (current, customerId) =>
    transition(current, { type: 'ship', lotId: 'ready-pallet', qty: 1, customerId });
  assert.throws(() => ship(state, 'party-north'), /потребителя из справочника/);
  state = ship(state, custom.id);
  assert.equal(state.shipments[0].customerId, custom.id);
  assert.equal(state.shipments[0].customer, custom.name);
  state = save(state, { ...custom, active: false });
  const snapshot = structuredClone(state);
  assert.throws(() => receive(state, custom.id), /действующего поставщика/);
  assert.throws(() => ship(state, custom.id), /действующего потребителя/);
  assert.deepEqual(state, snapshot);
});

test('renaming or disabling a counterparty preserves document snapshots and associations', () => {
  let state = receive(save(seedState('agro'), custom), custom.id);
  const receipt = structuredClone(state.lots[0]);
  state = save(state, { ...custom, name: 'Новое наименование', active: false });
  assert.deepEqual(state.lots[0], receipt);
  const reloaded = migrateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(reloaded.counterparties, state.counterparties);
  assert.deepEqual(reloaded.lots[0], receipt);
});

test('older saves import existing supplier/customer labels once and retain all stock facts', () => {
  const old = seedState('agro');
  delete old.counterparties;
  old.lots.forEach((lot) => {
    delete lot.supplierId;
  });
  old.lots.push({ id: 'old', supplier: 'Исторический поставщик', qty: 12.5, reserved: 1 });
  old.shipments.push({
    id: 'shipment-old',
    customer: 'Исторический поставщик',
    qty: 4.5,
    time: '2026-10-22T10:00:00Z',
  });
  const original = structuredClone(old);
  const upgraded = migrateState(old);
  assert.deepEqual(old, original);
  const party = upgraded.counterparties.find((row) => row.name === 'Исторический поставщик');
  assert.ok(party.isSupplier && party.isCustomer);
  assert.equal(upgraded.lots.at(-1).supplierId, party.id);
  assert.equal(upgraded.shipments[0].customerId, party.id);
  assert.deepEqual(
    upgraded.lots.map(({ supplierId, ...lot }) => lot),
    original.lots,
  );
  assert.deepEqual(migrateState(upgraded), upgraded);
});

test('production and quality results and journal actors use the signed-in user, not the order owner', () => {
  let state = seedState();
  for (const id of ['order-3', 'order-4']) {
    state.orders.find((order) => order.id === id).operator = 'Другой владелец заказа';
    const order = state.orders.find((row) => row.id === id);
    const values = defaultValues(order);
    order.processSnapshot.operations[order.stage].parameters
      .filter((parameter) => parameter.type === 'boolean')
      .forEach((parameter) => {
        values[parameter.id] = true;
      });
    state = transition(state, { type: 'advance', orderId: id, values });
    assert.equal(
      state.orders.find((row) => row.id === id).samples.at(-1).operator,
      CURRENT_USER.name,
    );
    assert.equal(state.events[0].actor, CURRENT_USER.name);
  }
});

test('known demo quality identity is corrected in saved results and events without changing quantities', () => {
  const old = seedState();
  old.orders[0].samples.at(-1).operator = 'Елена Смирнова';
  old.orders[0].allocations[0].consumedBy = 'Елена Смирнова';
  old.events[0].actor = 'Елена Смирнова';
  const original = structuredClone(old);
  const upgraded = migrateState(old);
  assert.equal(upgraded.orders[0].samples.at(-1).operator, CURRENT_USER.name);
  assert.equal(upgraded.orders[0].allocations[0].consumedBy, CURRENT_USER.name);
  assert.equal(upgraded.events[0].actor, CURRENT_USER.name);
  assert.deepEqual(upgraded.lots, original.lots);
  assert.deepEqual(old, original);
});
