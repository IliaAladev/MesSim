import { CarcassPanel } from './CarcassPanel.jsx';
import React, { useEffect, useState } from 'react';
import { operationAvailability, operationInputQty, recipeOf } from './domain.js';
import { operatorTasks, taskVolume, taskUnit } from './operatorTasks.js';
import { equipmentFitsLine } from './resources.js';
import { OperationMaterials } from './OperationMaterials.jsx';
import { RegistryFilters, Pagination, usePagination, inPeriod, dateTime } from './registries.jsx';
import { OperationForm, OperationRecord } from './Execution.jsx';
import { Badge, Empty, Field, Modal, SectionHead, fmt, timeFmt } from './ui.jsx';

const taskLabels = {
  ready: 'К запуску',
  running: 'Выполняется',
  hold: 'На паузе',
  waiting: 'Ожидание ресурса',
  completed: 'Выполнена',
};

export function OperatorView({ store, selectedId, setSelectedId, act, busy, onDetail }) {
  const tasks = operatorTasks(store);
  const [workplace, setWorkplace] = useState('');
  const [line, setLine] = useState('');
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [tab, setTab] = useState('current');
  const [query, setQuery] = useState('');
  const [pause, setPause] = useState(false);
  const [reason, setReason] = useState('');
  const task = tasks.find((t) => t.id === selectedId);
  useEffect(() => {
    setPause(false);
    setReason('');
  }, [selectedId]);
  const scope = tasks.filter(
    (t) => (!line || t.order.line === line) && (!workplace || t.workplace === workplace),
  );
  const matchesTab = (t, id) =>
    id === 'completed'
      ? !!t.sample
      : id === 'ready'
        ? ['ready', 'waiting'].includes(t.status)
        : !t.sample;
  const rows = scope
    .filter(
      (t) =>
        matchesTab(t, tab) &&
        (tab !== 'completed' || inPeriod(t.sample.time, from, to)) &&
        `${t.order.code} ${t.operation.name} ${recipeOf(t.order).name} ${
          t.sample?.inputs
            ?.flatMap((input) => input.mtus || [])
            .map((mtu) => mtu.code)
            .join(' ') || ''
        }`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        ({ running: 0, hold: 1, ready: 2, waiting: 3, completed: 4 })[a.status] -
          { running: 0, hold: 1, ready: 2, waiting: 3, completed: 4 }[b.status] ||
        (tab === 'completed'
          ? b.sample.time.localeCompare(a.sample.time)
          : a.order.start.localeCompare(b.order.start)) ||
        a.order.seq - b.order.seq,
    );
  const pagination = usePagination(rows, JSON.stringify([query, line, workplace, tab, from, to]));
  const manualLines = store.lines.filter((l) =>
    store.orders.some(
      (o) =>
        o.line === l.id &&
        o.processSnapshot.operations.some((op) => op.kind === 'production' && !op.equipmentId),
    ),
  );
  const resourceName = (t) =>
    t.operation.equipment ||
    `Ручное рабочее место · ${store.lines.find((l) => l.id === t.order.line)?.name || ''}`;

  if (!task)
    return (
      <>
        <section className="operator-context">
          <Field label="Линия">
            <select
              aria-label="Линия заданий"
              value={line}
              onChange={(e) => {
                setLine(e.target.value);
                setWorkplace('');
              }}
            >
              <option value="">Все линии</option>
              {store.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Рабочее место">
            <select
              aria-label="Рабочее место оператора"
              value={workplace}
              onChange={(e) => setWorkplace(e.target.value)}
            >
              <option value="">Все рабочие места</option>
              {store.equipment
                .filter((eq) => !line || equipmentFitsLine(store, eq, line))
                .map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.code} · {eq.name}
                  </option>
                ))}
              {manualLines
                .filter((l) => !line || l.id === line)
                .map((l) => (
                  <option key={l.id} value={`manual:${l.id}`}>
                    Ручное рабочее место · {l.name}
                  </option>
                ))}
            </select>
          </Field>
        </section>
        <div className="task-toolbar operation-task-toolbar">
          <div className="tabs">
            {[
              ['current', 'Текущие операции'],
              ['ready', 'К запуску'],
              ['completed', 'Выполненные'],
            ].map(([id, name]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                {name}
                <span>{scope.filter((t) => matchesTab(t, id)).length}</span>
              </button>
            ))}
          </div>
        </div>
        <RegistryFilters
          query={query}
          onQuery={setQuery}
          placeholder="Операция, заказ или продукт"
          {...(tab === 'completed' ? { from, to, onFrom: setFrom, onTo: setTo } : {})}
        />
        <div className="table-scroll">
          <table className="data-table operation-task-table">
            <thead>
              <tr>
                <th>Операция / заказ</th>
                <th>Процесс</th>
                <th>Рабочее место</th>
                <th className="numeric">Объём</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pagination.rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <button className="order-link" onClick={() => setSelectedId(t.id)}>
                      {t.operation.name}
                    </button>
                    <small>
                      {t.order.code} · операция {t.index + 1}
                    </small>
                  </td>
                  <td>
                    {recipeOf(t.order).name}
                    <small>{store.lines.find((l) => l.id === t.order.line)?.name}</small>
                  </td>
                  <td>
                    {resourceName(t)}
                    {t.sample && <small>{dateTime(t.sample.time)}</small>}
                  </td>
                  <td className="numeric">
                    {fmt(taskVolume(t), 3)} {taskUnit(t)}
                  </td>
                  <td>
                    <Badge status={t.status}>{taskLabels[t.status]}</Badge>
                  </td>
                  <td>
                    <button
                      className="button secondary compact"
                      onClick={() => setSelectedId(t.id)}
                    >
                      Открыть
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty
              title="Нет операций"
              text="Для выбранного рабочего места и условий нет доступных заданий."
            />
          )}
        </div>
        <Pagination state={pagination} />
      </>
    );

  const { order, operation, index, sample } = task;
  const unavailable = sample ? '' : operationAvailability(store, order);
  const action = (type) => ({ type, orderId: order.id, operationId: operation.id });
  const nextLocal = tasks.find(
    (t) =>
      t.order.id === order.id &&
      !t.sample &&
      (t.workplace === task.workplace || store.scenarioId === 'agro'),
  );
  const execution = sample ? sample.execution : order.operationExecution;
  return (
    <>
      <div className="execution-nav">
        <button className="text-button" onClick={() => setSelectedId(null)}>
          ← К очереди операций
        </button>
        <button className="text-button" onClick={() => onDetail(order.id)}>
          Карточка заказа
        </button>
      </div>
      <div className="execution-order">
        <div>
          <span className="order-code">
            {order.code} · операция {index + 1}
          </span>
          <h2>{operation.name}</h2>
        </div>
        <Badge status={task.status}>{taskLabels[task.status]}</Badge>
      </div>
      <div className="operator-operation-context">
        <div>
          <span>Рабочее место</span>
          <strong>{resourceName(task)}</strong>
        </div>
        <div>
          <span>Процесс</span>
          <strong>{recipeOf(order).name}</strong>
          <small>
            {recipeOf(order).code} · версия {recipeOf(order).revision}
          </small>
        </div>
        <div>
          <span>Объём операции</span>
          <strong>
            {fmt(taskVolume(task), 3)} {taskUnit(task)}
          </strong>
          <small>
            {execution?.startedAt
              ? `Запуск ${timeFmt(execution.startedAt)}`
              : sample || ['running', 'hold'].includes(task.status)
                ? 'Время запуска не зафиксировано'
                : 'Не запущена'}
          </small>
        </div>
      </div>
      {!sample && index === order.stage && !operation.carcassIdentification && (
        <OperationMaterials
          store={store}
          order={order}
          operation={operation}
          act={act}
          busy={busy}
        />
      )}
      {!sample && <CarcassPanel {...{ store, order, act, busy }} />}
      <section className="operator-operation-body">
        {sample ? (
          <>
            <OperationRecord order={order} index={index} />
            <div className="operation-complete-actions">
              <button className="button secondary" onClick={() => setSelectedId(null)}>
                К очереди операций
              </button>
              {nextLocal && (
                <button className="button primary" onClick={() => setSelectedId(nextLocal.id)}>
                  Открыть следующую операцию
                </button>
              )}
            </div>
          </>
        ) : ['ready', 'waiting'].includes(task.status) ? (
          <>
            {unavailable && (
              <p className="warning-banner" role="status">
                {unavailable}
              </p>
            )}
            {operation.inputs.some((input) => input.source === 'process') && (
              <>
                <SectionHead title="Полуфабрикаты предыдущих операций" />
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Потребляемый материал</th>
                        <th>Источник</th>
                        <th className="numeric">Количество</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operation.inputs
                        .filter((input) => input.source === 'process')
                        .map((input) => (
                          <tr key={input.id}>
                            <td>{input.name}</td>
                            <td>
                              {input.source === 'stock'
                                ? 'Зарезервированные партии'
                                : 'Предыдущие операции'}
                            </td>
                            <td className="numeric">
                              {fmt(operationInputQty(input, order, operation), 3)} {input.unit}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="operation-start-actions">
              <span className="plain-note">
                После запуска подтвердите MTU и количество фактически поданного сырья.
              </span>
              <button
                className="button primary"
                disabled={busy || !!unavailable}
                onClick={() => act(action('startOperation'), 'Операция запущена')}
              >
                Запустить операцию
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="operation-state-actions">
              <span>{order.status === 'hold' ? order.holdReason : 'Операция выполняется'}</span>
              {order.status === 'hold' ? (
                <button
                  className="button secondary"
                  disabled={busy || !!unavailable}
                  onClick={() => act(action('resume'), 'Операция возобновлена')}
                >
                  Возобновить операцию
                </button>
              ) : (
                <button className="button secondary" disabled={busy} onClick={() => setPause(true)}>
                  Приостановить
                </button>
              )}
            </div>
            {order.status === 'hold' && unavailable && (
              <p className="warning-banner">{unavailable}</p>
            )}
            <OperationForm store={store} key={task.id} order={order} act={act} busy={busy} />
          </>
        )}
      </section>
      {pause && (
        <Modal title="Приостановка операции" onClose={() => setPause(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ ...action('pause'), reason }, 'Операция приостановлена')) {
                setPause(false);
                setReason('');
              }
            }}
          >
            <div className="modal-content">
              <Field label="Причина остановки">
                <input
                  aria-label="Причина остановки"
                  autoFocus
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            </div>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setPause(false)}>
                Отмена
              </button>
              <button className="button primary" disabled={busy}>
                Приостановить
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
