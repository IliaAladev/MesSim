import React, { useState } from 'react';
import { DAY, occupancy, recipeOf, operationOf, isOrderBlocked } from './domain.js';
import { qualityPending } from './operatorTasks.js';
import { resourceActive } from './resources.js';
import { Badge, Empty, EventList, SectionHead, fmt } from './ui.jsx';

export function DispatchView({ store, onDetail, navigate }) {
  const [date, setDate] = useState(DAY);
  const orders = store.orders.filter((order) => order.date === date);
  const attention = orders.filter(
    (order) =>
      ['hold', 'waiting', 'reinspection'].includes(order.status) ||
      qualityPending(order) ||
      isOrderBlocked(store, order),
  );
  const summaries = new Map();
  for (const order of orders) {
    const process = recipeOf(order);
    const key = `${process.id}/${process.revision}`;
    const row = summaries.get(key) || {
      key,
      name: process.name,
      revision: process.revision,
      unit: process.outputUnit,
      plan: 0,
      actual: 0,
      completed: 0,
      count: 0,
    };
    row.plan += order.qty;
    row.count += 1;
    if (order.status === 'completed') {
      row.actual += order.actual;
      row.completed += 1;
    }
    summaries.set(key, row);
  }
  return (
    <>
      <div className="dispatch-toolbar">
        <label>
          Плановая дата{' '}
          <input
            aria-label="Дата диспетчерской"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <button className="button secondary" onClick={() => navigate('orders')}>
          Производственные заказы
        </button>
        <button className="button secondary" onClick={() => navigate('reports')}>
          Отчёты
        </button>
      </div>
      <div className="metrics simple-metrics">
        {[
          ['Заказов', orders.length],
          ['Выполнено', orders.filter((order) => order.status === 'completed').length],
          [
            'В исполнении',
            orders.filter((order) => ['running', 'quality', 'queued'].includes(order.status))
              .length,
          ],
          ['Требуют внимания', attention.length],
        ].map(([label, value]) => (
          <div className="metric" key={label}>
            <span className="metric-label">{label}</span>
            <strong className="metric-value">{value}</strong>
          </div>
        ))}
      </div>
      <SectionHead title="Состояние линий" />
      <div className="table-scroll">
        <table className="data-table history-table">
          <thead>
            <tr>
              <th>Линия</th>
              <th>Состояние</th>
              <th>Заказ</th>
              <th>Текущая операция</th>
              <th>Выполнено операций</th>
            </tr>
          </thead>
          <tbody>
            {store.lines.map((line) => {
              const order = store.orders.find((item) => item.line === line.id && occupancy(item));
              return (
                <tr key={line.id}>
                  <td>{line.name}</td>
                  <td>
                    <Badge
                      status={
                        !resourceActive(store, line.id) ? 'blocked' : order?.status || 'ready'
                      }
                    >
                      {!resourceActive(store, line.id)
                        ? 'Недоступна'
                        : line.status === 'cip'
                          ? 'Санобработка'
                          : order
                            ? undefined
                            : 'Свободна'}
                    </Badge>
                  </td>
                  <td>
                    {order ? (
                      <button className="order-link" onClick={() => onDetail(order.id)}>
                        {order.code}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{order ? operationOf(order).name : '—'}</td>
                  <td>
                    {order ? `${order.samples.length} / ${recipeOf(order).operations.length}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {attention.length > 0 && (
        <>
          <SectionHead title="Требуют внимания" meta={`${attention.length}`} />
          <div className="table-scroll">
            <table className="data-table history-table">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Процесс</th>
                  <th>Статус</th>
                  <th>Причина / действие</th>
                </tr>
              </thead>
              <tbody>
                {attention.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <button className="order-link" onClick={() => onDetail(order.id)}>
                        {order.code}
                      </button>
                    </td>
                    <td>{recipeOf(order).name}</td>
                    <td>
                      <Badge status={order.status} />
                    </td>
                    <td>
                      {isOrderBlocked(store, order)
                        ? 'Заблокировано исходное сырьё'
                        : order.waitReason || order.holdReason || 'Ожидает контроля качества'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <SectionHead title="Выполнение плана" />
      <div className="table-scroll">
        <table className="data-table history-table">
          <thead>
            <tr>
              <th>Процесс</th>
              <th>План</th>
              <th>Выпущено</th>
              <th>Завершено заказов</th>
            </tr>
          </thead>
          <tbody>
            {[...summaries.values()].map((row) => (
              <tr key={row.key}>
                <td>
                  {row.name}
                  <small>Версия {row.revision}</small>
                </td>
                <td>
                  {fmt(row.plan, 3)} {row.unit}
                </td>
                <td>
                  {fmt(row.actual, 3)} {row.unit}
                </td>
                <td>
                  {row.completed} / {row.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!orders.length && <Empty title="Заказов на выбранную дату нет" text="" />}
      </div>
      <SectionHead title="Последние события">
        <button className="text-button" onClick={() => navigate('events')}>
          Открыть журнал
        </button>
      </SectionHead>
      <EventList events={store.events} limit={6} onOrder={onDetail} />
    </>
  );
}
