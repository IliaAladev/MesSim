import { CURRENT_USER } from './identity.js';

const uuid = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
const ops = (order) => order.processSnapshot.operations;
const lots = (state) => [...state.lots, ...state.finished];
const actual = (order) => order.allocations.filter((row) => row.consumed);
const trackingProcess = (process) =>
  process?.id === 'carcass' && process.operations.some((op) => op.id === 'rfid');

// Old demo rules are not a customer's classifier. Keep historical records intact,
// but never apply or present these placeholders as an actual grade.
const placeholderGrade = (rule) =>
  ['demo-standard', 'demo-other'].includes(rule?.id || rule?.ruleId) &&
  ['ДЕМО-1', 'ДЕМО-2'].includes(rule?.code || rule?.gradeCode);

export const carcassGradeRules = (process) =>
  (process.carcassGradeRules || []).filter((rule) => !placeholderGrade(rule));

export function carcassGradeLabel(classification) {
  if (!classification?.gradeCode || placeholderGrade(classification)) return '';
  return [classification.gradeCode, classification.gradeName].filter(Boolean).join(' · ');
}

export function carcassClassificationData(state, order) {
  const record = carcassForOrder(state, order);
  const weight = actual(order)
    .filter((row) => row.lotId === record?.sourceLotId)
    .reduce((sum, row) => sum + row.qty, 0);
  return {
    lean: record?.primaryClassification?.lean,
    weight: Math.round(weight * 1000) / 1000,
    admitted: order.samples.some((sample) => sample.values.admission === true),
    findings: order.samples.map((sample) => sample.values.findings?.trim()).filter(Boolean),
  };
}

function upgradeCarcassClassifier(state) {
  if (state.carcassTrackingVersion >= 2) return state;
  for (const process of state.processes) {
    if (!trackingProcess(process)) continue;
    const rules = carcassGradeRules(process);
    if (rules.length !== process.carcassGradeRules?.length) {
      process.carcassGradeRules = rules;
      process.revision += 1;
    }
    delete process.carcassGradeRulesNote;
  }
  state.carcassTrackingVersion = 2;
  return state;
}

export function configureCarcassProcess(process, from = 0) {
  if (!trackingProcess(process)) return;
  process.operations.forEach((op, position) => {
    if (position < from) return;
    if (op.id === 'rfid') {
      op.name = 'Идентификация и маркировка туши · КТ8';
      op.carcassIdentification = true;
      op.primaryLeanTarget = 57;
      op.parameters = op.parameters.filter((p) => p.id !== 'rfid');
    }
    if (op.id === 'inspection') {
      for (const p of op.parameters)
        if (p.id === 'vet') {
          p.required = false;
          p.name = 'Документ ветосмотра';
        }
      if (!op.parameters.some((p) => p.id === 'findings'))
        op.parameters.push({
          id: 'findings',
          name: 'Ветеринарные примечания',
          type: 'text',
          required: false,
        });
    }
    if (op.id === 'grade') {
      op.name = 'Итоговая классификация туши · КТ19';
      op.carcassGrading = true;
      delete op.lotMarkParameter;
      op.parameters = op.parameters.filter((p) => p.id !== 'mark');
    }
  });
  process.carcassGradeRules ||= [];
}

export function upgradeCarcassTracking(state) {
  if (state.scenarioId !== 'agro') return state;
  if (state.carcassTrackingVersion >= 1) return upgradeCarcassClassifier(state);
  state.carcasses ||= [];
  state.slaughterBatches ||= [];
  state.markingJobs ||= [];
  state.trackingCounters ||= {};
  state.railCarriers ||= Array.from({ length: 20 }, (_, index) => ({
    code: `R-${821 + index}`,
    active: true,
  }));
  for (const process of state.processes) {
    if (trackingProcess(process) && process.revision === 1) {
      configureCarcassProcess(process);
      process.revision = 2;
    }
  }
  for (const order of state.orders) {
    if (
      trackingProcess(order.processSnapshot) &&
      order.processSnapshot.revision <= 1 &&
      order.status !== 'completed'
    ) {
      configureCarcassProcess(order.processSnapshot, order.stage);
      if (!order.samples.length) order.processSnapshot.revision = 2;
    }
    if (order.recipe === 'slaughter' && actual(order).length) {
      state.slaughterBatches.push({
        id: `legacy-batch-${order.id}`,
        orderId: order.id,
        number: null,
        date: order.date,
        sourceLotIds: actual(order).map((row) => row.lotId),
        origin: 'legacy',
      });
    }
  }
  // Preserve recorded values and timestamps. Never claim that a legacy number was printed.
  for (const order of state.orders.filter((row) => trackingProcess(row.processSnapshot))) {
    const source = actual(order)
      .map((row) => lots(state).find((lot) => lot.id === row.lotId))
      .find((lot) => lot?.material === 'warm');
    const rfidSample = order.samples.find((sample) => sample.values.rfid);
    const markSample = order.samples.find((sample) => sample.values.mark);
    if (!source || (!rfidSample && !markSample)) continue;
    const cold = state.finished.find((lot) => lot.orderId === order.id && lot.material === 'cold');
    const removed =
      cold &&
      state.orders.find(
        (row) =>
          ['cutting', 'sale'].includes(row.recipe) &&
          actual(row).some((allocation) => allocation.lotId === cold.id) &&
          row.samples.length,
      );
    const code = rfidSample?.values.rfid;
    const record = {
      id: `carcass-${source.id}`,
      sourceLotId: source.id,
      identityOrderId: order.id,
      slaughterBatchId: state.slaughterBatches.find((batch) => batch.orderId === source.orderId)
        ?.id,
      slaughterNumber: markSample?.values.mark || cold?.mark || null,
      currentRfid: removed ? null : code || null,
      origin: 'legacy',
      carrierHistory: code
        ? [
            {
              code,
              assignedAt: rfidSample.time,
              releasedAt: removed?.samples.at(-1)?.time || null,
              origin: 'legacy',
            },
          ]
        : [],
      createdAt: rfidSample?.time || markSample?.time,
    };
    state.carcasses.push(record);
    order.carcassId = record.id;
    source.carcassId = record.id;
    if (record.slaughterNumber) source.mark = record.slaughterNumber;
    if (cold) {
      cold.carcassId = record.id;
      if (record.slaughterNumber) cold.mark = record.slaughterNumber;
    }
    if (code && !state.railCarriers.some((carrier) => carrier.code === code))
      state.railCarriers.push({ code, active: true, origin: 'legacy' });
  }
  for (const record of state.carcasses) if (record.slaughterNumber) prepareMarking(state, record);
  state.carcassTrackingVersion = 1;
  return upgradeCarcassClassifier(state);
}

function nextNumber(state, kind, date) {
  const year = date.slice(0, 4),
    key = `${kind}:${year}`;
  let value = state.trackingCounters[key] || 0,
    number;
  do {
    value++;
    number =
      kind === 'batch'
        ? `1${year.slice(2)}${String(value).padStart(6, '0')}`
        : `УБ-${year.slice(2)}-${String(value).padStart(6, '0')}`;
  } while (
    kind === 'batch'
      ? state.slaughterBatches.some((batch) => batch.number === number)
      : state.carcasses.some((carcass) => carcass.slaughterNumber === number)
  );
  state.trackingCounters[key] = value;
  return number;
}

export function ensureSlaughterBatch(state, order) {
  if (state.scenarioId !== 'agro' || order.recipe !== 'slaughter') return null;
  let batch = state.slaughterBatches.find((row) => row.orderId === order.id);
  if (!batch) {
    batch = {
      id: uuid(),
      orderId: order.id,
      date: order.date,
      sourceLotIds: actual(order).map((row) => row.lotId),
      createdAt: now(),
      origin: 'mes',
    };
    state.slaughterBatches.push(batch);
  }
  if (!batch.number) {
    batch.number = nextNumber(state, 'batch', order.date);
    batch.numberAssignedAt = now();
  }
  order.slaughterBatchId = batch.id;
  for (const lot of state.finished.filter((lot) => lot.orderId === order.id))
    lot.slaughterBatchId = batch.id;
  return batch;
}

export const carcassForOrder = (state, order) =>
  state.carcasses?.find((row) => row.id === order?.carcassId);
export const markingFor = (state, carcass) =>
  state.markingJobs?.findLast((job) => job.carcassId === carcass?.id);
export const freeCarriers = (state) =>
  (state.railCarriers || []).filter(
    (carrier) =>
      carrier.active && !state.carcasses.some((record) => record.currentRfid === carrier.code),
  );

export function checkCarrier(state, code, carcassId) {
  const carrier = state.railCarriers.find(
    (row) => row.code.toLocaleLowerCase() === String(code).trim().toLocaleLowerCase(),
  );
  if (!carrier?.active) throw new Error('RFID разноги не зарегистрирован или разнога недоступна');
  if (state.carcasses.some((row) => row.id !== carcassId && row.currentRfid === carrier.code))
    throw new Error(`Разнога ${carrier.code} занята другой тушей`);
  return carrier.code;
}

export function identifyCarcass(state, order, source, code) {
  let record = state.carcasses.find((row) => row.sourceLotId === source.id);
  if (record && record.identityOrderId !== order.id)
    throw new Error('Эта туша уже идентифицирована в другом заказе');
  code = checkCarrier(state, code, record?.id);
  if (record?.currentRfid && record.currentRfid !== code)
    throw new Error('Для другой разноги используйте действие «Сменить разногу»');
  if (!record) {
    const producer = state.orders.find((row) => row.id === source.orderId);
    const batch = producer && ensureSlaughterBatch(state, producer);
    record = {
      id: uuid(),
      sourceLotId: source.id,
      identityOrderId: order.id,
      slaughterBatchId: batch?.id,
      slaughterNumber: null,
      carrierHistory: [],
      origin: 'mes',
      createdAt: now(),
    };
    state.carcasses.push(record);
  }
  if (!record.currentRfid)
    record.carrierHistory.push({
      code,
      assignedAt: now(),
      assignedBy: CURRENT_USER.name,
      releasedAt: null,
    });
  record.currentRfid = code;
  source.carcassId = record.id;
  order.carcassId = record.id;
  return record;
}

export const carcassQrText = (record) => `MES:C1:${encodeURIComponent(record.id)}`;

export function prepareMarking(state, record) {
  if (!record?.slaughterNumber)
    throw new Error('Сначала зарегистрируйте первичную классификацию и номер убоя');
  let job = markingFor(state, record);
  if (job) {
    if (job.slaughterNumber !== record.slaughterNumber || job.qrText !== carcassQrText(record))
      throw new Error('Реквизиты задания маркировки не соответствуют туше');
    return job;
  }
  const batch = state.slaughterBatches.find((row) => row.id === record.slaughterBatchId);
  job = {
    id: uuid(),
    carcassId: record.id,
    slaughterNumber: record.slaughterNumber,
    slaughterBatchNumber: batch?.number || '',
    date: state.orders.find((row) => row.id === record.identityOrderId)?.date,
    target: 'AutoMarker-II',
    schema: 'mes.carcass-mark.v1',
    qrText: carcassQrText(record),
    createdAt: now(),
    status: 'prepared',
    exports: [],
  };
  state.markingJobs.push(job);
  return job;
}

export function primaryClassification(state, order, lean) {
  const record = carcassForOrder(state, order);
  if (!record?.currentRfid) throw new Error('Сначала идентифицируйте тушу и разногу');
  if (!Number.isFinite(Number(lean)) || Number(lean) < 0 || Number(lean) > 100)
    throw new Error('Некорректный процент постности');
  if (!record.primaryClassification)
    record.primaryClassification = {
      lean: Number(lean),
      source: 'AutoFom III',
      simulated: true,
      measuredAt: now(),
    };
  if (!record.slaughterNumber) {
    record.slaughterNumber = nextNumber(state, 'carcass', order.date);
    record.numberAssignedAt = now();
  }
  for (const lot of state.finished.filter((lot) => lot.carcassId === record.id))
    lot.mark = record.slaughterNumber;
  return prepareMarking(state, record);
}

export function identificationError(state, order) {
  const record = carcassForOrder(state, order);
  if (!record) return 'Подтвердите подачу туши и считывание RFID разноги';
  if (!record.primaryClassification || !record.slaughterNumber)
    return 'Получите данные первичной классификации AutoFom III';
  if (markingFor(state, record)?.status !== 'applied')
    return 'Скачайте QR и подтвердите нанесение маркировки';
  return '';
}

export function carcassOperationError(state, order) {
  const operation = ops(order)[order.stage],
    record = carcassForOrder(state, order);
  if (operation.carcassIdentification) return identificationError(state, order);
  if (
    order.recipe === 'carcass' &&
    operation.kind === 'quality' &&
    record &&
    !record.slaughterNumber
  )
    return 'Восстановите номер убоя и маркировку туши перед подтверждением ветосмотра';
  if (
    record?.origin === 'legacy' &&
    record.numberAssignedAt &&
    markingFor(state, record)?.status !== 'applied'
  )
    return 'Подтвердите нанесение восстановленной маркировки';
  return '';
}

export function releaseCarrier(state, record, reason) {
  if (!record?.currentRfid) return;
  const current = record.carrierHistory.findLast((row) => !row.releasedAt);
  if (current) {
    current.releasedAt = now();
    current.releasedBy = CURRENT_USER.name;
    current.reason = reason;
  }
  record.currentRfid = null;
}

export function rebindCarrier(state, record, code, reason) {
  if (!reason?.trim()) throw new Error('Укажите причину смены разноги');
  if (record.currentRfid === code) throw new Error('Эта разнога уже связана с тушей');
  code = checkCarrier(state, code, record.id);
  releaseCarrier(state, record, reason.trim());
  record.currentRfid = code;
  record.carrierHistory.push({
    code,
    assignedAt: now(),
    assignedBy: CURRENT_USER.name,
    releasedAt: null,
    reason: reason.trim(),
  });
}

export function resolveCarcassLot(state, token, inputMaterial, strict = false) {
  const normalized = String(token).trim().toLocaleLowerCase();
  let id;
  if (normalized.startsWith('mes:c1:')) {
    try {
      id = decodeURIComponent(String(token).trim().slice(7));
    } catch {
      return null;
    }
  }
  const records = state.carcasses?.filter(
    (row) =>
      row.id === id ||
      row.slaughterNumber?.toLocaleLowerCase() === normalized ||
      row.currentRfid?.toLocaleLowerCase() === normalized,
  );
  if (!records?.length) return null;
  if (records.length > 1) {
    if (strict)
      throw new Error(
        'Идентификатор связан с несколькими тушами. Уточните MTU или смените разногу',
      );
    return null;
  }
  const record = records[0];
  const candidates = state.finished.filter(
    (lot) =>
      lot.carcassId === record.id &&
      lot.remaining > 0 &&
      (!inputMaterial || lot.material === inputMaterial),
  );
  if (candidates.length > 1) {
    if (strict) throw new Error('Найдены несколько учётных единиц туши. Укажите код MTU');
    return null;
  }
  return candidates[0] || null;
}
