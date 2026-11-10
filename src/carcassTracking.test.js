import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { seedState, transition, defaultValues, operationOf, validateProcess } from './domain.js';
import { consumeReserved } from './testFixtures/consumeReserved.js';
import { confirmCarcassIdentity } from './testFixtures/confirmCarcassIdentity.js';
import {
  carcassForOrder,
  markingFor,
  carcassQrText,
  resolveCarcassLot,
  carcassGradeLabel,
  carcassClassificationData,
} from './carcassTracking.js';
import { operatorTasks, taskVolume } from './operatorTasks.js';
import { carcassLabelSvg, carcassQrMatrix } from './carcassLabel.js';
import { loadDemo } from './demoStorage.js';

const order = (state, id = 'order-2') => state.orders.find((row) => row.id === id);
const act = (state, type, extra = {}, id = 'order-2') =>
  transition(state, { type, orderId: id, ...extra });
const identity = (state) => carcassForOrder(state, order(state));

const configuredRule = {
  id: 'customer-grade',
  code: 'C-01',
  name: 'Категория из НСИ',
  minWeight: 80,
  maxWeight: 130,
  minLean: 55,
  maxLean: 100,
  allowFindings: false,
};

function initial(gradeRules = []) {
  let state = seedState('agro');
  state.processes.find((row) => row.id === 'carcass').carcassGradeRules =
    structuredClone(gradeRules);
  for (const row of state.orders.filter((row) => row.recipe === 'carcass'))
    row.processSnapshot.carcassGradeRules = structuredClone(gradeRules);
  state = transition(state, {
    type: 'receiveLot',
    material: 'live',
    supplierId: 'party-north',
    qty: 365,
    heads: 3,
    declaredWeight: 370,
    document: 'ТС-041',
  });
  state = transition(state, { type: 'releaseLot', lotId: state.lots[0].id });
  state = act(state, 'reserve', {}, 'order-1');
  state = act(state, 'startOperation', {}, 'order-1');
  state = consumeReserved(state, 'order-1');
  state = act(state, 'advance', { values: { stun: true, loss: 0 } }, 'order-1');
  const warm = state.finished.find((lot) => lot.material === 'warm');
  state = act(state, 'reserve', { lotChoices: { 'rfid/in-warm': warm.id } });
  return { state: act(state, 'startOperation'), warmId: warm.id };
}
function identify(state, warmId, rfid = 'R-821') {
  return act(state, 'identifyCarcass', { sourceCode: warmId, rfid, confirmConsumption: true });
}
function print(state) {
  state = act(state, 'simulatePrimaryClassification');
  const carcassId = identity(state).id;
  state = transition(state, { type: 'exportCarcassMark', carcassId });
  return transition(state, { type: 'confirmCarcassMark', carcassId });
}
function finish(state, values = {}, extra = {}) {
  if (['ready', 'queued', 'waiting'].includes(order(state).status))
    state = act(state, 'startOperation');
  const current = order(state),
    entered = defaultValues(current);
  for (const p of operationOf(current).parameters) if (p.type === 'boolean') entered[p.id] = true;
  return act(state, 'advance', { values: { ...entered, ...values }, ...extra });
}

test('batch generation, explicit identification and marking occur in order before veterinary inspection', () => {
  let { state, warmId } = initial();
  assert.equal(state.slaughterBatches[0].number, '126000001');
  assert.equal(state.finished.find((lot) => lot.id === warmId).remaining, 100);
  assert.equal(state.carcasses.length, 0);
  assert.throws(() => finish(state), /Подтвердите списание/);
  state = identify(state, warmId);
  assert.equal(state.finished.find((lot) => lot.id === warmId).remaining, 0);
  assert.equal(identity(state).slaughterNumber, null);
  assert.throws(() => finish(state), /AutoFom/);
  state = act(state, 'simulatePrimaryClassification');
  assert.equal(identity(state).slaughterNumber, 'УБ-26-000001');
  const job = markingFor(state, identity(state));
  assert.equal(job.target, 'AutoMarker-II');
  assert.throws(
    () => transition(state, { type: 'confirmCarcassMark', carcassId: identity(state).id }),
    /скачайте/,
  );
  assert.throws(() => finish(state), /нанесение/);
  state = transition(state, { type: 'exportCarcassMark', carcassId: identity(state).id });
  assert.equal(markingFor(state, identity(state)).status, 'exported');
  assert.throws(() => finish(state), /нанесение/);
  state = transition(state, { type: 'confirmCarcassMark', carcassId: identity(state).id });
  state = finish(state);
  assert.equal(operationOf(order(state)).kind, 'quality');
  assert.equal(order(state).samples[0].carcass.slaughterNumber, 'УБ-26-000001');
  assert.equal(order(state).samples[0].carcass.rfid, 'R-821');
});

test('repeated registration, data receipt, exports and confirmations never renumber or deduct twice; reload preserves them', () => {
  let { state, warmId } = initial();
  state = print(identify(state, warmId));
  const id = identity(state).id,
    number = identity(state).slaughterNumber,
    payload = markingFor(state, identity(state)).qrText;
  state = identify(state, warmId);
  state = act(state, 'simulatePrimaryClassification');
  state = transition(state, { type: 'exportCarcassMark', carcassId: id });
  state = transition(state, { type: 'confirmCarcassMark', carcassId: id });
  state = loadDemo({ getItem: () => JSON.stringify(state) }, 'agro');
  assert.equal(identity(state).id, id);
  assert.equal(identity(state).slaughterNumber, number);
  assert.equal(state.carcasses.length, 1);
  assert.equal(state.markingJobs.length, 1);
  assert.equal(markingFor(state, identity(state)).qrText, payload);
  assert.equal(markingFor(state, identity(state)).exports.length, 2);
  assert.equal(state.finished.find((lot) => lot.id === warmId).remaining, 0);
  assert.equal(order(state).allocations.filter((row) => row.consumed).length, 1);
});

test('carrier replacement preserves identity, QR and audit history; unknown carriers and paused operations are rejected atomically', () => {
  let { state, warmId } = initial();
  const before = JSON.stringify(state);
  assert.throws(() => identify(state, warmId, 'UNKNOWN'), /не зарегистрирован/);
  assert.equal(JSON.stringify(state), before);
  state = print(identify(state, warmId));
  const payload = carcassQrText(identity(state)),
    number = identity(state).slaughterNumber;
  assert.throws(() => act(state, 'rebindCarcassCarrier', { rfid: 'R-824', reason: '' }), /причину/);
  state = act(state, 'rebindCarcassCarrier', {
    rfid: 'R-824',
    reason: 'Замена разноги после сбоя считывания',
  });
  assert.equal(identity(state).slaughterNumber, number);
  assert.equal(carcassQrText(identity(state)), payload);
  assert.equal(identity(state).carrierHistory[0].code, 'R-821');
  assert.ok(identity(state).carrierHistory[0].releasedAt);
  assert.equal(identity(state).carrierHistory[1].code, 'R-824');
  state = act(state, 'pause', { reason: 'Пауза' });
  assert.throws(() => identify(state, warmId), /выполняемой/);
  assert.throws(() => act(state, 'simulatePrimaryClassification'), /недоступна/);
});

test('the same carrier cannot hold two active carcasses', () => {
  let { state, warmId } = initial();
  state = finish(print(identify(state, warmId)));
  state = finish(state);
  state = finish(state);
  state = finish(state);
  const warm = state.finished.find((lot) => lot.material === 'warm' && lot.remaining > 0);
  state = act(state, 'reserve', { lotChoices: { 'rfid/in-warm': warm.id } }, 'order-3');
  state = act(state, 'startOperation', {}, 'order-3');
  assert.throws(
    () =>
      act(
        state,
        'identifyCarcass',
        { sourceCode: warm.id, rfid: 'R-821', confirmConsumption: true },
        'order-3',
      ),
    /занята другой тушей/,
  );
  assert.equal(state.finished.find((lot) => lot.id === warm.id).remaining, 100);
});

test('veterinary document is optional, final classification uses measured data and manual changes need a reason', () => {
  let { state, warmId } = initial();
  state = finish(print(identify(state, warmId)));
  state = finish(state, { admission: true, vet: '' });
  state = act(state, 'startOperation');
  assert.equal(
    taskVolume(operatorTasks(state).find((task) => task.order.id === 'order-2' && !task.sample)),
    100,
  );
  assert.deepEqual(carcassClassificationData(state, order(state)), {
    lean: 57,
    weight: 100,
    admitted: true,
    findings: [],
  });
  assert.throws(
    () => act(state, 'advance', { values: { mark: 'FORGED', lean: 57 } }),
    /назначает MES/,
  );
  assert.throws(
    () => act(state, 'advance', { values: { lean: 45 }, manualClassification: true }),
    /причину/,
  );
  const automatic = act(state, 'advance', { values: { lean: 1 } });
  assert.equal(identity(automatic).finalClassification.lean, 57);
  assert.equal(identity(automatic).finalClassification.gradeCode, undefined);
  assert.equal(identity(automatic).finalClassification.weight, 100);
  const manual = act(state, 'advance', {
    values: { lean: 45 },
    manualClassification: true,
    classificationReason: 'Результат ручного измерения',
  });
  assert.equal(identity(manual).finalClassification.lean, 45);
  assert.equal(identity(manual).finalClassification.gradeCode, undefined);
  assert.equal(identity(manual).finalClassification.reason, 'Результат ручного измерения');
  assert.equal(identity(manual).primaryClassification.lean, 57);
  assert.equal(identity(manual).finalClassification.source, 'manual');
  assert.equal(identity(automatic).finalClassification.source, 'AutoFom III');
});

test('identity passes to chilled stock; a scanned QR consumes that MTU and disassembly frees the carrier', () => {
  let { state, warmId } = initial();
  state = finish(print(identify(state, warmId)));
  state = finish(state);
  state = finish(state);
  state = finish(state);
  const record = identity(state),
    payload = carcassQrText(record);
  const cold = state.finished.find((lot) => lot.material === 'cold');
  assert.equal(cold.carcassId, record.id);
  assert.equal(cold.mark, record.slaughterNumber);
  assert.equal(resolveCarcassLot(state, payload, 'cold').id, cold.id);
  state = act(state, 'prepareOrder', {}, 'order-5');
  state = act(state, 'startOperation', {}, 'order-5');
  state = act(
    state,
    'consumeMaterial',
    { inputId: 'in-cold', code: payload, qty: 98.8 },
    'order-5',
  );
  assert.equal(order(state, 'order-5').carcassId, record.id);
  state = act(state, 'advance', { values: { loss: 0 } }, 'order-5');
  assert.equal(state.carcasses.find((row) => row.id === record.id).currentRfid, null);
  assert.equal(state.finished.find((lot) => lot.id === cold.id).remaining, 0);
  assert.equal(order(state, 'order-5').samples[0].carcass.rfid, 'R-821');
});

test('QR is independently decodable, includes no mutable RFID and SVG text is escaped', () => {
  let { state, warmId } = initial();
  state = print(identify(state, warmId));
  const job = markingFor(state, identity(state)),
    matrix = carcassQrMatrix(job),
    scale = 6,
    width = (matrix.size + 8) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let row = 0; row < matrix.size; row++)
    for (let col = 0; col < matrix.size; col++)
      if (matrix.data[row * matrix.size + col])
        for (let y = 0; y < scale; y++)
          for (let x = 0; x < scale; x++) {
            const offset = (((row + 4) * scale + y) * width + (col + 4) * scale + x) * 4;
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
          }
  assert.equal(jsQR(pixels, width, width).data, job.qrText);
  assert.ok(!job.qrText.includes('R-821'));
  const svg = carcassLabelSvg({ ...job, slaughterNumber: '<script>"bad"</script>' });
  assert.match(svg, /width="90mm" height="55mm"/);
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
});

test('legacy active and completed records preserve stock and numbers without invented print confirmations', () => {
  let { state, warmId } = initial();
  state = consumeReserved(state, 'order-2');
  const snapshot = order(state).processSnapshot;
  // Construct the old active format: data already deducted on KТ8, no tracking subsystem.
  delete state.carcassTrackingVersion;
  delete state.carcasses;
  delete state.slaughterBatches;
  delete state.markingJobs;
  delete state.railCarriers;
  delete state.trackingCounters;
  snapshot.revision = 1;
  delete snapshot.operations[0].carcassIdentification;
  snapshot.operations[0].parameters = [{ id: 'rfid', name: 'RFID', type: 'text', required: true }];
  order(state).samples.push({
    operationId: 'rfid',
    values: { rfid: 'R-821' },
    inputs: [],
    outputs: [],
    time: '2026-10-22T06:00:00Z',
  });
  order(state).stage = 1;
  order(state).status = 'queued';
  delete order(state).operationExecution;
  const stock = JSON.stringify(state.finished);
  state = loadDemo({ getItem: () => JSON.stringify(state) }, 'agro');
  assert.equal(state.finished.find((lot) => lot.id === warmId).remaining, 0);
  assert.equal(identity(state).origin, 'legacy');
  assert.equal(identity(state).slaughterNumber, null);
  assert.equal(state.markingJobs.length, 0);
  assert.equal(order(state).samples[0].values.rfid, 'R-821');
  state = act(state, 'startOperation');
  state = print(state);
  assert.equal(state.finished.find((lot) => lot.id === warmId).remaining, 0);
  assert.ok(state.finished.length === JSON.parse(stock).length);
  const marked = JSON.parse(JSON.stringify(state));
  identity(marked).slaughterNumber = '041-0001';
  const restored = loadDemo({ getItem: () => JSON.stringify(marked) }, 'agro');
  assert.equal(identity(restored).slaughterNumber, '041-0001');
});

test('completed legacy carcasses retain the original number and accounting when QR is exported again', () => {
  let { state, warmId } = initial();
  state = finish(print(identify(state, warmId)));
  state = finish(state);
  state = finish(state);
  state = finish(state);
  const current = order(state),
    cold = state.finished.find((lot) => lot.orderId === current.id);
  current.processSnapshot.revision = 1;
  current.samples[0].values.rfid = 'R-821';
  current.samples.find((sample) => sample.operationId === 'grade').values.mark = '041-0001';
  cold.mark = '041-0001';
  for (const row of state.orders) delete row.carcassId;
  for (const lot of state.finished) {
    delete lot.carcassId;
    delete lot.slaughterBatchId;
    if (lot.material === 'warm') delete lot.mark;
  }
  for (const key of [
    'carcassTrackingVersion',
    'carcasses',
    'slaughterBatches',
    'markingJobs',
    'railCarriers',
    'trackingCounters',
  ])
    delete state[key];
  const accounting = state.finished.map((lot) => [lot.id, lot.qty, lot.remaining, lot.reserved]);
  const samples = JSON.stringify(current.samples);
  state = loadDemo({ getItem: () => JSON.stringify(state) }, 'agro');
  assert.equal(identity(state).slaughterNumber, '041-0001');
  assert.equal(markingFor(state, identity(state)).status, 'prepared');
  state = transition(state, { type: 'exportCarcassMark', carcassId: identity(state).id });
  assert.equal(markingFor(state, identity(state)).status, 'exported');
  assert.equal(markingFor(state, identity(state)).slaughterNumber, '041-0001');
  assert.deepEqual(
    state.finished.map((lot) => [lot.id, lot.qty, lot.remaining, lot.reserved]),
    accounting,
  );
  assert.equal(JSON.stringify(order(state).samples), samples);
});

test('NSI protects tracking sequence and grade rules; new publication leaves existing order rules immutable', () => {
  let { state } = initial([configuredRule]);
  const process = structuredClone(state.processes.find((row) => row.id === 'carcass'));
  const invalid = structuredClone(process);
  [invalid.operations[0], invalid.operations[2]] = [invalid.operations[2], invalid.operations[0]];
  assert.throws(() => validateProcess(invalid, state), /Порядок туши/);
  invalid.operations = structuredClone(process.operations);
  invalid.carcassGradeRules[0].maxLean = 101;
  assert.throws(() => validateProcess(invalid, state), /диапазоны/);
  process.carcassGradeRules[0].minLean = 60;
  state = transition(state, { type: 'saveProcess', process, publish: true });
  assert.equal(order(state).processSnapshot.carcassGradeRules[0].minLean, 55);
  state = transition(state, {
    type: 'createOrder',
    processId: 'carcass',
    qty: 98.8,
    line: 'carcass',
    date: '2026-10-22',
  });
  assert.equal(state.orders.at(-1).processSnapshot.carcassGradeRules[0].minLean, 60);
});

test('configured customer rules still assign grades and reject unmatched measurements', () => {
  let { state, warmId } = initial([configuredRule]);
  state = finish(print(identify(state, warmId)));
  state = finish(state, { admission: true });
  state = act(state, 'startOperation');
  const classified = act(state, 'advance', { values: {} });
  assert.equal(identity(classified).finalClassification.gradeCode, 'C-01');
  assert.equal(
    carcassGradeLabel(identity(classified).finalClassification),
    'C-01 · Категория из НСИ',
  );
  assert.throws(
    () =>
      act(state, 'advance', {
        values: { lean: 45 },
        manualClassification: true,
        classificationReason: 'Повторное измерение',
      }),
    /Нет подходящего правила/,
  );
});

test('old placeholder rules are retired without changing history, stock, QR or custom classifiers', () => {
  let { state, warmId } = initial();
  state = finish(print(identify(state, warmId)));
  state = finish(state, { admission: true });
  const placeholder = {
    ...configuredRule,
    id: 'demo-standard',
    code: 'ДЕМО-1',
    name: 'Стандартная туша',
  };
  state.carcassTrackingVersion = 1;
  const process = state.processes.find((row) => row.id === 'carcass');
  process.carcassGradeRules = [placeholder];
  process.carcassGradeRulesNote = 'Демонстрационная шкала процесса; не нормативная классификация.';
  order(state).processSnapshot.carcassGradeRules = [placeholder];
  const oldFact = {
    lean: 57,
    gradeCode: placeholder.code,
    gradeName: placeholder.name,
    ruleId: placeholder.id,
  };
  order(state).samples[0].carcass.finalClassification = oldFact;
  const history = JSON.stringify(order(state).samples),
    snapshot = JSON.stringify(order(state).processSnapshot),
    stock = JSON.stringify(state.finished),
    qr = JSON.stringify(state.markingJobs);
  const loaded = loadDemo({ getItem: () => JSON.stringify(state) }, 'agro');
  assert.equal(loaded.carcassTrackingVersion, 2);
  assert.deepEqual(loaded.processes.find((row) => row.id === 'carcass').carcassGradeRules, []);
  assert.equal(JSON.stringify(order(loaded).samples), history);
  assert.equal(JSON.stringify(order(loaded).processSnapshot), snapshot);
  assert.equal(JSON.stringify(loaded.finished), stock);
  assert.equal(JSON.stringify(loaded.markingJobs), qr);
  assert.equal(carcassGradeLabel(oldFact), '');
  const classified = finish(loaded);
  assert.equal(identity(classified).finalClassification.lean, 57);
  assert.equal(identity(classified).finalClassification.gradeCode, undefined);
  const custom = structuredClone(state);
  custom.processes.find((row) => row.id === 'carcass').carcassGradeRules = [configuredRule];
  const restored = loadDemo({ getItem: () => JSON.stringify(custom) }, 'agro');
  assert.deepEqual(restored.processes.find((row) => row.id === 'carcass').carcassGradeRules, [
    configuredRule,
  ]);
});
