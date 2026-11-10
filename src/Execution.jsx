import { CarcassPanel } from './CarcassPanel.jsx';
import {
  carcassForOrder,
  carcassOperationError,
  carcassGradeLabel,
  carcassClassificationData,
} from './carcassTracking.js';
import { agroMaterialCaption } from './agroCatalog.js';
import React, { useEffect, useState } from 'react';
import { operationMassBalance } from './materialBalance.js';
import { OperationMaterials } from './OperationMaterials.jsx';
import {
  operationOf,
  operationsOf,
  recipeOf,
  defaultValues,
  parameterBounds,
  scaledQty,
  operationInputQty,
  operationAvailability,
  operationMaterialAvailability,
  round,
} from './domain.js';
import { Product, Modal, Field, SectionHead, fmt, timeFmt } from './ui.jsx';

export function OperationRecord({ order, index }) {
  const operation = operationsOf(order)[index],
    sample = order.samples.find((s) => s.operationId === operation.id);
  if (!sample) return null;
  return (
    <section className="operation-record">
      <SectionHead
        title={operation.name}
        meta={operation.kind === 'quality' ? 'Контроль качества' : 'Производство'}
      />
      <dl className="details-list">
        {operation.parameters.map((p) => (
          <div key={p.id}>
            <dt>{p.name}</dt>
            <dd>
              {p.type === 'boolean'
                ? sample.values[p.id]
                  ? 'Подтверждено'
                  : 'Не подтверждено'
                : sample.values[p.id] == null || sample.values[p.id] === ''
                  ? 'Не заполнено'
                  : `${sample.values[p.id]} ${p.unit || ''}`}
            </dd>
          </div>
        ))}
        {sample.carcass && (
          <>
            <div>
              <dt>Номер убоя</dt>
              <dd>{sample.carcass.slaughterNumber || 'Не присвоен'}</dd>
            </div>
            <div>
              <dt>RFID на момент операции</dt>
              <dd>{sample.carcass.rfid || 'Разнога освобождена'}</dd>
            </div>
            {operation.carcassGrading && carcassGradeLabel(sample.carcass.finalClassification) && (
              <div>
                <dt>Итоговая классификация</dt>
                <dd>{carcassGradeLabel(sample.carcass.finalClassification)}</dd>
              </div>
            )}
            {operation.carcassGrading && sample.carcass.finalClassification?.reason && (
              <div>
                <dt>Причина повторного измерения</dt>
                <dd>{sample.carcass.finalClassification.reason}</dd>
              </div>
            )}
          </>
        )}
        {sample.inputs?.map((input) => (
          <div key={input.id}>
            <dt>Потреблено · {agroMaterialCaption(input)}</dt>
            <dd>
              {fmt(input.qty, 3)} {input.unit}
              {input.mtus?.map((mtu) => (
                <small key={mtu.movementId || mtu.lotId}>
                  {mtu.code} · {fmt(mtu.qty, 3)} {input.unit}
                </small>
              ))}
            </dd>
          </div>
        ))}
        {sample.outputs.map((out) => (
          <div key={out.id}>
            <dt>{agroMaterialCaption(out)}</dt>
            <dd>
              {fmt(out.qty, 3)} {out.unit}
            </dd>
          </div>
        ))}
        {operation.carcassGrading && sample.carcass?.finalClassification && (
          <div>
            <dt>Источник постности</dt>
            <dd>
              {sample.carcass.finalClassification.source === 'manual'
                ? 'Повторное измерение'
                : sample.carcass.finalClassification.source}
            </dd>
          </div>
        )}
        {sample.massBalance && (
          <>
            <div>
              <dt>Материальный баланс</dt>
              <dd>
                {fmt(sample.massBalance.input, 3)} = {fmt(sample.massBalance.output, 3)} +{' '}
                {fmt(sample.massBalance.loss, 3)} кг потерь
              </dd>
            </div>
            <div>
              <dt>Потери · план / факт</dt>
              <dd>
                {fmt(
                  parameterBounds(
                    operation.parameters.find((p) => p.id === operation.lossParameter),
                    order,
                  ).target,
                  3,
                )}
                {' / '}
                {fmt(sample.massBalance.loss, 3)} кг
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>Исполнитель</dt>
          <dd>{sample.operator}</dd>
        </div>
        <div>
          <dt>Начало</dt>
          <dd>
            {sample.execution?.startedAt ? timeFmt(sample.execution.startedAt) : 'Не зафиксировано'}
          </dd>
        </div>
        <div>
          <dt>Завершение</dt>
          <dd>{timeFmt(sample.time)}</dd>
        </div>
        {sample.execution?.pauses.map((pause, i) => (
          <div key={i}>
            <dt>Пауза {i + 1}</dt>
            <dd>
              {timeFmt(pause.startedAt)}
              {pause.endedAt ? `–${timeFmt(pause.endedAt)}` : ''} · {pause.reason}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function OperationForm({ store, order, act, busy, onComplete }) {
  const operation = operationOf(order);
  const tracked = carcassForOrder(store, order);
  const classification = operation.carcassGrading ? carcassClassificationData(store, order) : null;
  const leanParameter = operation.parameters.find((p) => p.id === 'lean');
  const [manualClassification, setManualClassification] = useState(false),
    [classificationReason, setClassificationReason] = useState('');
  const trackingError = carcassOperationError(store, order);
  const emptyValues = () =>
    Object.fromEntries(operation.parameters.map((p) => [p.id, p.type === 'boolean' ? false : '']));
  const [values, setValues] = useState(emptyValues);
  const [outputs, setOutputs] = useState(() =>
    Object.fromEntries(
      operation.outputs.map((out) => [out.id, operation.massBalance ? '' : scaledQty(out, order)]),
    ),
  );
  useEffect(() => {
    setValues(emptyValues());
    setManualClassification(false);
    setClassificationReason('');
    setOutputs(
      Object.fromEntries(
        operation.outputs.map((out) => [
          out.id,
          operation.massBalance ? '' : scaledQty(out, order),
        ]),
      ),
    );
  }, [order.id, order.stage]);
  const boundsText = (p) => {
    const bounds = parameterBounds(p, order);
    return [
      bounds.target != null ? `Норма ${fmt(bounds.target, 3)} ${p.unit || ''}` : '',
      bounds.min != null ? `от ${fmt(bounds.min, 3)}` : '',
      bounds.max != null ? `до ${fmt(bounds.max, 3)} ${p.unit || ''}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  };
  const materialPending = operationMaterialAvailability(store, order);
  const hasActualOutputs = operation.outputs.every(
    (out) =>
      outputs[out.id] !== '' &&
      outputs[out.id] != null &&
      Number.isFinite(Number(outputs[out.id])) &&
      Number(outputs[out.id]) >= 0,
  );
  const balance =
    operation.massBalance && hasActualOutputs && !materialPending
      ? operationMassBalance(
          operation,
          order.qty / recipeOf(order).baseQty,
          values,
          outputs,
          Object.fromEntries(
            operation.inputs.map((input) => [input.id, operationInputQty(input, order, operation)]),
          ),
        )
      : null;
  const actualLoss = balance ? round(balance.input - balance.output) : null;
  const lossParameter = operation.parameters.find((p) => p.id === operation.lossParameter);
  const plannedLoss = lossParameter ? parameterBounds(lossParameter, order).target : null;
  const lossDeviation = actualLoss == null ? null : round(actualLoss - plannedLoss);
  const lossBounds = lossParameter ? parameterBounds(lossParameter, order) : {};
  const lossInBounds =
    actualLoss != null &&
    actualLoss >= (lossBounds.min ?? 0) &&
    (lossBounds.max == null || actualLoss <= lossBounds.max);
  const visibleParameters = operation.parameters.filter(
    (p) =>
      (!operation.massBalance || p.id !== operation.lossParameter) &&
      (!operation.carcassGrading || p.id !== 'lean'),
  );
  return (
    <form
      className="execution-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await act(
            {
              type: 'advance',
              orderId: order.id,
              operationId: operation.id,
              outputs,
              manualClassification,
              classificationReason,
              values: {
                ...values,
                ...(operation.carcassGrading && !manualClassification
                  ? { lean: tracked?.primaryClassification?.lean ?? '' }
                  : {}),
                ...(operation.massBalance ? { [operation.lossParameter]: actualLoss ?? '' } : {}),
              },
            },
            'Результаты операции сохранены',
          )
        )
          onComplete?.();
      }}
    >
      {operation.carcassGrading && (
        <div className="classification-mode">
          <h3 className="subheading">Данные классификации</h3>
          <dl className="carcass-facts classification-facts">
            <div>
              <dt>Постность · AutoFom III</dt>
              <dd>
                {classification.lean == null ? 'Нет данных' : `${fmt(classification.lean, 3)} %`}
              </dd>
            </div>
            <div>
              <dt>Масса туши</dt>
              <dd>{fmt(classification.weight, 3)} кг</dd>
            </div>
            <div>
              <dt>Ветеринарный допуск</dt>
              <dd>{classification.admitted ? 'Допущена' : 'Не подтверждён'}</dd>
            </div>
            {classification.findings.length > 0 && (
              <div>
                <dt>Ветеринарные примечания</dt>
                <dd>{classification.findings.join('; ')}</dd>
              </div>
            )}
          </dl>
          <button
            type="button"
            className="text-button classification-repeat"
            aria-expanded={manualClassification}
            aria-controls={`repeat-measurement-${order.id}`}
            disabled={busy || order.status === 'hold'}
            onClick={() => {
              setManualClassification(!manualClassification);
              setValues({ ...values, lean: '' });
              setClassificationReason('');
            }}
          >
            {manualClassification ? 'Отменить повторное измерение' : 'Повторное измерение'}
          </button>
          {manualClassification && (
            <div id={`repeat-measurement-${order.id}`} className="execution-parameters">
              <Field label="Постность по повторному измерению, %">
                <input
                  aria-label="Постность по повторному измерению"
                  type="number"
                  step="any"
                  min={leanParameter?.min ?? 0}
                  max={leanParameter?.max ?? 100}
                  required
                  value={values.lean ?? ''}
                  disabled={busy}
                  onChange={(event) => setValues({ ...values, lean: event.target.value })}
                />
              </Field>
              <Field label="Причина повторного измерения">
                <input
                  aria-label="Причина повторного измерения"
                  required
                  value={classificationReason}
                  disabled={busy}
                  onChange={(event) => setClassificationReason(event.target.value)}
                />
              </Field>
            </div>
          )}
        </div>
      )}
      {visibleParameters.length > 0 && (
        <>
          <h3 className="subheading">Параметры операции</h3>
          <div className="execution-parameters">
            {visibleParameters.map((p) =>
              p.type === 'boolean' ? (
                <label className="check-control" key={p.id}>
                  <input
                    type="checkbox"
                    checked={values[p.id] === true}
                    disabled={busy || order.status === 'hold'}
                    onChange={(e) => setValues({ ...values, [p.id]: e.target.checked })}
                  />
                  <span>
                    {p.name}
                    {p.required ? ' *' : ''}
                  </span>
                </label>
              ) : (
                <Field
                  key={p.id}
                  label={`${p.type === 'number' ? 'Факт · ' : ''}${p.name}${p.required ? ' *' : ''}`}
                  hint={p.type === 'number' ? boundsText(p) : undefined}
                >
                  <div className="parameter-entry">
                    <input
                      aria-label={p.name}
                      type={p.type === 'number' ? 'number' : 'text'}
                      step="any"
                      required={p.required}
                      disabled={busy || order.status === 'hold'}
                      value={values[p.id] ?? ''}
                      onChange={(e) => setValues({ ...values, [p.id]: e.target.value })}
                    />
                    {p.unit && <span>{p.unit}</span>}
                  </div>
                </Field>
              ),
            )}
          </div>
        </>
      )}
      {operation.inputs.some((input) => input.source === 'process') && (
        <>
          <h3 className="subheading">Потребление</h3>
          <div className="table-scroll">
            <table className="data-table operation-materials">
              <thead>
                <tr>
                  <th>Материал</th>
                  <th>Источник</th>
                  <th className="numeric">Количество</th>
                  <th>Состояние</th>
                </tr>
              </thead>
              <tbody>
                {operation.inputs
                  .filter((input) => input.source === 'process')
                  .map((input) => (
                    <tr key={input.id}>
                      <td>
                        {agroMaterialCaption(input)}
                        {order.operationExecution?.inputs
                          ?.find((item) => item.id === input.id)
                          ?.mtus?.map((mtu) => (
                            <small key={mtu.movementId || mtu.lotId}>
                              {mtu.code} · {fmt(mtu.qty, 3)} {input.unit}
                            </small>
                          ))}
                      </td>
                      <td>{input.source === 'stock' ? 'Склад' : 'Предыдущие операции'}</td>
                      <td className="numeric">
                        {fmt(operationInputQty(input, order, operation), 3)} {input.unit}
                      </td>
                      <td>Списано в операцию</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {operation.outputs.length > 0 && (
        <>
          <SectionHead title="Выпуск">
            <button
              className="text-button"
              type="button"
              disabled={busy || order.status === 'hold'}
              onClick={() => {
                setValues({
                  ...defaultValues(order),
                  ...Object.fromEntries(
                    operation.parameters
                      .filter((p) => p.type !== 'number')
                      .map((p) => [p.id, values[p.id]]),
                  ),
                });
                setOutputs(
                  Object.fromEntries(
                    operation.outputs.map((out) => [out.id, scaledQty(out, order)]),
                  ),
                );
              }}
            >
              Заполнить по плану
            </button>
          </SectionHead>
          <div className="table-scroll">
            <table className="data-table operation-materials">
              <thead>
                <tr>
                  <th>Материал</th>
                  <th>Назначение</th>
                  <th className="numeric">План</th>
                  <th className="numeric">Факт</th>
                </tr>
              </thead>
              <tbody>
                {operation.outputs.map((out, index) => (
                  <tr key={out.id}>
                    <td>
                      {agroMaterialCaption(out)}
                      {operation.outputs.filter((item) => item.material === out.material).length >
                        1 && <small>Позиция {index + 1}</small>}
                    </td>
                    <td>
                      {out.destination === 'stock'
                        ? 'На склад после завершения процесса'
                        : 'В следующие операции'}
                    </td>
                    <td className="numeric">
                      {fmt(scaledQty(out, order), 3)} {out.unit}
                    </td>
                    <td className="numeric">
                      {out.destination === 'stock' || operation.massBalance ? (
                        <label className="output-actual">
                          <input
                            aria-label={`Фактический выпуск: ${out.name}`}
                            type="number"
                            step={out.unit === 'шт' ? '1' : '0.001'}
                            min={operation.massBalance ? '0' : out.unit === 'шт' ? '1' : '0.001'}
                            max={operation.massBalance ? undefined : scaledQty(out, order)}
                            required
                            disabled={busy || order.status === 'hold'}
                            value={outputs[out.id] ?? scaledQty(out, order)}
                            onChange={(e) => setOutputs({ ...outputs, [out.id]: e.target.value })}
                          />
                          <span>{out.unit}</span>
                        </label>
                      ) : (
                        `${fmt(scaledQty(out, order), 3)} ${out.unit}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {operation.parameters.length === 0 &&
        operation.inputs.length === 0 &&
        operation.outputs.length === 0 && (
          <p className="plain-note">Операция не содержит настраиваемых параметров и материалов.</p>
        )}
      {operation.massBalance && (
        <div
          className={`mass-balance-note ${actualLoss == null ? 'pending' : lossInBounds ? 'balanced' : 'unbalanced'}`}
          role="status"
        >
          <strong>Технологические потери</strong>
          <span>Норма {fmt(plannedLoss, 3)} кг</span>
          {balance ? (
            <>
              <span>
                Факт {fmt(actualLoss, 3)} кг · отклонение {lossDeviation > 0 ? '+' : ''}
                {fmt(lossDeviation, 3)} кг
              </span>
              <small>
                {actualLoss < 0
                  ? `Выход превышает вход на ${fmt(-actualLoss, 3)} кг. Проверьте фактические количества.`
                  : !lossInBounds
                    ? `Потери вне допуска · ${boundsText(lossParameter)}`
                    : `Вход ${fmt(balance.input, 3)} кг − выход ${fmt(balance.output, 3)} кг = потери ${fmt(actualLoss, 3)} кг`}
              </small>
            </>
          ) : (
            <small>
              Факт потерь рассчитывается после списания сырья и ввода фактического выпуска.
            </small>
          )}
        </div>
      )}
      {materialPending && (
        <p className="plain-note" role="status">
          {operation.carcassIdentification
            ? 'Для завершения подтвердите подачу и идентификацию туши, затем нанесение маркировки.'
            : 'Для завершения операции подтвердите MTU и спишите сырьё в разделе «Списание сырья».'}
        </p>
      )}
      {trackingError && !materialPending && (
        <p className="plain-note" role="status">
          {trackingError}
        </p>
      )}
      <div className="execution-submit">
        <button
          className="button primary"
          disabled={
            busy ||
            order.status === 'hold' ||
            materialPending ||
            !!trackingError ||
            (operation.massBalance && (!hasActualOutputs || !lossInBounds))
          }
        >
          {busy
            ? 'Сохранение…'
            : operation.kind === 'quality'
              ? 'Подтвердить контроль'
              : 'Завершить операцию'}
        </button>
      </div>
    </form>
  );
}

export function QualityForm({ order, store, act, busy, onClose }) {
  const pending = ['ready', 'queued', 'waiting'].includes(order.status);
  const paused = ['hold', 'reinspection'].includes(order.status);
  const [reason, setReason] = useState('');
  const rfid = order.samples.find((sample) => sample.values.rfid)?.values.rfid;
  const unavailable = operationAvailability(store, order);
  return (
    <Modal title={operationOf(order).name} wide onClose={onClose}>
      <div className="modal-content">
        <div className="quality-context">
          <Product order={order} />
          <span>{order.code}</span>
        </div>
        {rfid && !order.carcassId && <p className="plain-note">RFID разноги · {rfid}</p>}
        <CarcassPanel {...{ store, order, act, busy }} />
        <OperationMaterials
          store={store}
          order={order}
          operation={operationOf(order)}
          act={act}
          busy={busy}
        />
        {unavailable && <p className="warning-banner">{unavailable}</p>}
        {pending ? (
          <p className="plain-note">
            Контроль готов к выполнению. Запустите операцию для фиксации начала.
          </p>
        ) : paused ? (
          <p className="warning-banner">{order.holdReason}</p>
        ) : null}
        {pending || paused ? (
          <button
            className="button primary"
            disabled={busy || !!unavailable}
            onClick={() =>
              act(
                {
                  type: paused ? 'resume' : 'startOperation',
                  orderId: order.id,
                  operationId: operationOf(order).id,
                },
                'Контроль запущен',
              )
            }
          >
            {order.status === 'reinspection'
              ? 'Начать повторный осмотр'
              : paused
                ? 'Возобновить контроль'
                : 'Начать контроль'}
          </button>
        ) : (
          <>
            <OperationForm store={store} order={order} act={act} busy={busy} onComplete={onClose} />
            {operationOf(order).reinspection && (
              <div className="execution-form">
                <Field label="Причина направления на реинспекцию">
                  <input value={reason} onChange={(event) => setReason(event.target.value)} />
                </Field>
                <button
                  className="button secondary"
                  disabled={busy || !reason.trim()}
                  onClick={async () => {
                    if (
                      await act(
                        {
                          type: 'referInspection',
                          orderId: order.id,
                          operationId: operationOf(order).id,
                          reason,
                        },
                        'Туша направлена на реинспекцию',
                      )
                    )
                      onClose();
                  }}
                >
                  Направить на реинспекцию
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
