import test from 'node:test';
import assert from 'node:assert/strict';
import { moveOperation, validateOperationDraft } from './processEditing.js';
import { baseStructure } from './resources.js';

const store = {
  structure: baseStructure(),
  lines: [{ id: 'line', parentId: 'area', active: true }],
  equipment: [{ id: 'tank', parentId: 'line', active: true, classCode: 'Нагрев' }],
  materials: [
    { id: 'milk', active: true },
    { id: 'semi', active: true },
  ],
};
const operation = () => ({
  id: 'cook',
  name: 'Нагрев',
  kind: 'production',
  equipmentId: '',
  equipmentClass: 'Нагрев',
  inputs: [{ id: 'i', material: 'milk', qty: 10, source: 'stock' }],
  outputs: [{ id: 'o', material: 'semi', qty: 10, destination: 'process' }],
  parameters: [{ id: 't', name: 'Температура', type: 'number', min: 70, target: 75, max: 80 }],
});

test('reordering retains all operations, supports moving in either direction and leaves original order untouched', () => {
  const original = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(
    moveOperation(original, 'a', 2).map((op) => op.id),
    ['b', 'c', 'a'],
  );
  assert.deepEqual(
    moveOperation(original, 'c', 0).map((op) => op.id),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    original.map((op) => op.id),
    ['a', 'b', 'c'],
  );
  assert.throws(() => moveOperation(original, 'missing', 0), /позиция/);
  assert.throws(() => moveOperation(original, 'a', 3), /позиция/);
});

test('individual operation validation accepts intermediate output and checks material and resource references', () => {
  assert.equal(validateOperationDraft(operation(), store, 'class'), true);
  const noName = operation();
  noName.name = ' ';
  assert.throws(() => validateOperationDraft(noName, store, 'class'), /наименование/);
  const noResource = operation();
  noResource.equipmentClass = '';
  assert.throws(() => validateOperationDraft(noResource, store, 'class'), /класс/);
  const badMaterial = operation();
  badMaterial.inputs[0].material = 'unknown';
  assert.throws(
    () => validateOperationDraft(badMaterial, store, 'class'),
    (error) => error.section === 'materials',
  );
  const noAmount = operation();
  noAmount.outputs[0].qty = 0;
  assert.throws(() => validateOperationDraft(noAmount, store, 'class'), /больше нуля/);
  const disabled = structuredClone(store);
  disabled.lines[0].active = false;
  assert.throws(
    () => validateOperationDraft(operation(), disabled, 'class'),
    /доступного оборудования/,
  );
});

test('parameter validation reports the parameter section and prevents invalid control limits from being applied', () => {
  const reversed = operation();
  reversed.parameters[0].min = 90;
  assert.throws(
    () => validateOperationDraft(reversed, store, 'class'),
    (error) => error.section === 'parameters' && /больше верхнего/.test(error.message),
  );
  const outside = operation();
  outside.parameters[0].target = 81;
  assert.throws(() => validateOperationDraft(outside, store, 'class'), /вне допуска/);
  const invalid = operation();
  invalid.parameters[0].min = 'abc';
  assert.throws(() => validateOperationDraft(invalid, store, 'class'), /числовые/);
  const missing = operation();
  missing.parameters[0].name = '';
  assert.throws(() => validateOperationDraft(missing, store, 'class'), /наименование и тип/);
});
