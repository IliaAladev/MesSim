import React, { useState } from 'react';
import { Badge, Empty, Modal, SectionHead, exportCsv, fmt } from './ui.jsx';
import { recipeOf, statusLabels } from './domain.js';
import {
  RegistryFilters,
  Pagination,
  containsText,
  inPeriod,
  dateTime,
  usePagination,
} from './registries.jsx';

const levels = { info: 'Информация', success: 'Выполнено', warning: 'Отклонение', error: 'Ошибка' };
const categories = {
  production: 'Производство',
  materials: 'Материалы',
  warehouse: 'Склад',
  shipping: 'Отгрузки',
  master: 'НСИ',
  system: 'Система',
};
const categoryOf = (event) => event.category || (event.orderId ? 'production' : 'system');

export function EventsView({ store, onDetail, trace }) {
  const [query, setQuery] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [kind, setKind] = useState(''),
    [category, setCategory] = useState(''),
    [selected, setSelected] = useState(null);
  const orderMap = new Map(store.orders.map((order) => [order.id, order]));
  const rows = store.events
    .filter((event) => {
      const order = orderMap.get(event.orderId);
      return (
        (!kind || event.kind === kind) &&
        (!category || categoryOf(event) === category) &&
        inPeriod(event.time, from, to) &&
        containsText(
          query,
          event.message,
          event.objectCode,
          event.actor,
          event.operation,
          ...(event.releasedReservations || []).map((mtu) => mtu.code),
          ...(event.mtus || []).map((mtu) => `${mtu.code} ${mtu.batchCode || ''}`),
          order?.code,
          order ? recipeOf(order).name : '',
        )
      );
    })
    .sort((a, b) => b.time.localeCompare(a.time));
  const pagination = usePagination(rows, JSON.stringify([query, from, to, kind, category]));
  const selectedOrder = selected && orderMap.get(selected.orderId);
  return (
    <>
      <SectionHead title="События системы" meta={`${rows.length} из ${store.events.length}`}>
        <button
          className="button secondary compact"
          onClick={() =>
            exportCsv('Журнал событий.csv', [
              ['Дата и время', 'Уровень', 'Раздел', 'Объект', 'Событие', 'Исполнитель'],
              ...rows.map((event) => [
                dateTime(event.time),
                levels[event.kind],
                categories[categoryOf(event)],
                event.objectCode,
                event.message,
                event.actor,
              ]),
            ])
          }
        >
          Выгрузить
        </button>
      </SectionHead>
      <RegistryFilters
        {...{ query, from, to }}
        onQuery={setQuery}
        onFrom={setFrom}
        onTo={setTo}
        placeholder="Событие, заказ, MTU или исполнитель"
      >
        <select aria-label="Уровень события" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Все уровни</option>
          {Object.entries(levels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Раздел события"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Все разделы</option>
          {Object.entries(categories).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </RegistryFilters>
      <div className="table-scroll">
        <table className="data-table history-table events-table">
          <thead>
            <tr>
              <th>Дата и время</th>
              <th>Уровень</th>
              <th>Раздел</th>
              <th>Объект</th>
              <th>Событие</th>
              <th>Исполнитель</th>
            </tr>
          </thead>
          <tbody>
            {pagination.rows.map((event) => {
              const order = orderMap.get(event.orderId);
              return (
                <tr key={event.id}>
                  <td>{dateTime(event.time)}</td>
                  <td>
                    <Badge
                      status={
                        event.kind === 'warning' || event.kind === 'error'
                          ? 'hold'
                          : event.kind === 'success'
                            ? 'completed'
                            : 'planned'
                      }
                    >
                      {levels[event.kind] || event.kind}
                    </Badge>
                  </td>
                  <td>{categories[categoryOf(event)]}</td>
                  <td>
                    {order ? (
                      <button className="order-link" onClick={() => onDetail(order.id)}>
                        {event.objectCode || order.code}
                      </button>
                    ) : (
                      event.objectCode || '—'
                    )}
                  </td>
                  <td>
                    <button className="registry-text-link" onClick={() => setSelected(event)}>
                      {event.message}
                    </button>
                  </td>
                  <td>{event.actor || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <Empty title="События не найдены" text="" />}
      </div>
      <Pagination state={pagination} />
      {selected && (
        <Modal title="Событие" onClose={() => setSelected(null)}>
          <div className="modal-content">
            <dl className="details-list">
              <div>
                <dt>Дата и время</dt>
                <dd>{dateTime(selected.time)}</dd>
              </div>
              <div>
                <dt>Раздел</dt>
                <dd>{categories[categoryOf(selected)]}</dd>
              </div>
              <div>
                <dt>Объект</dt>
                <dd>{selected.objectCode || selectedOrder?.code || '—'}</dd>
              </div>
              <div>
                <dt>Операция</dt>
                <dd>{selected.operation || '—'}</dd>
              </div>
              <div>
                <dt>Исполнитель</dt>
                <dd>{selected.actor || '—'}</dd>
              </div>
            </dl>
            <p className="registry-detail-text">{selected.message}</p>
            {selected.releasedReservations?.length > 0 && (
              <p className="plain-note">
                Снят резерв:{' '}
                {selected.releasedReservations
                  .map((row) => `${row.code} · ${fmt(row.qty, 3)} ${row.unit || ''}`)
                  .join(', ')}
              </p>
            )}
            {selected.mtus?.length > 0 && (
              <dl className="details-list">
                {selected.mtus.map((mtu, index) => (
                  <div key={`${mtu.code}-${index}`}>
                    <dt>
                      MTU {mtu.code}
                      {mtu.status ? ` · ${mtu.status === 'consumed' ? 'Списано' : 'Резерв'}` : ''}
                    </dt>
                    <dd>
                      {fmt(mtu.qty, 3)} {mtu.unit}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div className="modal-actions">
            {selectedOrder && (
              <button
                className="button secondary"
                onClick={() => {
                  setSelected(null);
                  trace(selectedOrder.id);
                }}
              >
                Генеалогия
              </button>
            )}
            <button className="button primary" onClick={() => setSelected(null)}>
              Закрыть
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function ShipmentsView({ store, trace }) {
  const [query, setQuery] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [selected, setSelected] = useState(null);
  const lotMap = new Map(store.finished.map((lot) => [lot.id, lot]));
  const orderMap = new Map(store.orders.map((order) => [order.id, order]));
  const rows = store.shipments
    .map((shipment) => {
      const lot = lotMap.get(shipment.lotId);
      const order = orderMap.get(shipment.orderId || lot?.orderId);
      return {
        ...shipment,
        lotCode: shipment.lotCode || lot?.code,
        materialName: shipment.materialName || lot?.name,
        unit: shipment.unit || lot?.unit,
        orderId: shipment.orderId || order?.id,
        orderCode: shipment.orderCode || order?.code,
      };
    })
    .filter(
      (row) =>
        inPeriod(row.time, from, to) &&
        containsText(query, row.lotCode, row.materialName, row.customer, row.orderCode),
    )
    .sort((a, b) => b.time.localeCompare(a.time));
  const pagination = usePagination(rows, JSON.stringify([query, from, to]));
  return (
    <>
      <SectionHead title="Реестр отгрузок" meta={`${rows.length} из ${store.shipments.length}`}>
        <button
          className="button secondary compact"
          onClick={() =>
            exportCsv('Отгрузки.csv', [
              ['Дата и время', 'Партия', 'Продукция', 'Заказ', 'Получатель', 'Количество', 'Ед.'],
              ...rows.map((row) => [
                dateTime(row.time),
                row.lotCode,
                row.materialName,
                row.orderCode,
                row.customer,
                row.qty,
                row.unit,
              ]),
            ])
          }
        >
          Выгрузить
        </button>
      </SectionHead>
      <RegistryFilters
        {...{ query, from, to }}
        onQuery={setQuery}
        onFrom={setFrom}
        onTo={setTo}
        placeholder="Получатель, партия, продукция или заказ"
      />
      <div className="table-scroll">
        <table className="data-table history-table">
          <thead>
            <tr>
              <th>Дата и время</th>
              <th>Партия / заказ</th>
              <th>Продукция</th>
              <th>Получатель</th>
              <th className="numeric">Количество</th>
            </tr>
          </thead>
          <tbody>
            {pagination.rows.map((row) => (
              <tr key={row.id}>
                <td>{dateTime(row.time)}</td>
                <td>
                  <button className="order-link" onClick={() => setSelected(row)}>
                    {row.lotCode || row.lotId}
                  </button>
                  <small>{row.orderCode}</small>
                </td>
                <td>{row.materialName}</td>
                <td>{row.customer}</td>
                <td className="numeric">
                  {fmt(row.qty, 3)} {row.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty title="Отгрузки не найдены" text="" />}
      </div>
      <Pagination state={pagination} />
      {selected && (
        <Modal title={`Отгрузка ${selected.lotCode}`} onClose={() => setSelected(null)}>
          <div className="modal-content">
            <dl className="details-list">
              <div>
                <dt>Дата и время</dt>
                <dd>{dateTime(selected.time)}</dd>
              </div>
              <div>
                <dt>Продукция</dt>
                <dd>{selected.materialName}</dd>
              </div>
              <div>
                <dt>Количество</dt>
                <dd>
                  {fmt(selected.qty, 3)} {selected.unit}
                </dd>
              </div>
              <div>
                <dt>Получатель</dt>
                <dd>{selected.customer}</dd>
              </div>
              <div>
                <dt>Заказ</dt>
                <dd>{selected.orderCode}</dd>
              </div>
            </dl>
          </div>
          <div className="modal-actions">
            {selected.orderId && (
              <button
                className="button secondary"
                onClick={() => {
                  setSelected(null);
                  trace({ type: 'lot', id: selected.lotId });
                }}
              >
                Генеалогия партии
              </button>
            )}
            <button className="button primary" onClick={() => setSelected(null)}>
              Закрыть
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function ReportsView({ store, onDetail }) {
  const [query, setQuery] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const rows = store.orders
    .filter(
      (order) =>
        inPeriod(order.date, from, to) &&
        containsText(query, order.code, recipeOf(order).name, recipeOf(order).outputName),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
  const pagination = usePagination(rows, JSON.stringify([query, from, to]));
  return (
    <>
      <SectionHead title="План и фактический выпуск по заказам" meta={`${rows.length}`}>
        <button
          className="button secondary compact"
          onClick={() =>
            exportCsv('Выполнение заказов.csv', [
              ['Плановая дата', 'Заказ', 'Процесс', 'Продукция', 'План', 'Факт', 'Ед.', 'Статус'],
              ...rows.map((order) => [
                order.date,
                order.code,
                recipeOf(order).name,
                recipeOf(order).outputName,
                order.qty,
                order.status === 'completed' ? order.actual : 0,
                recipeOf(order).outputUnit,
                statusLabels[order.status],
              ]),
            ])
          }
        >
          Выгрузить
        </button>
      </SectionHead>
      <RegistryFilters
        {...{ query, from, to }}
        onQuery={setQuery}
        onFrom={setFrom}
        onTo={setTo}
        placeholder="Заказ, процесс или продукция"
      />
      <div className="table-scroll">
        <table className="data-table history-table">
          <thead>
            <tr>
              <th>Плановая дата</th>
              <th>Заказ</th>
              <th>Процесс / продукция</th>
              <th>План</th>
              <th>Выпущено</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {pagination.rows.map((order) => (
              <tr key={order.id}>
                <td>{order.date.split('-').reverse().join('.')}</td>
                <td>
                  <button className="order-link" onClick={() => onDetail(order.id)}>
                    {order.code}
                  </button>
                </td>
                <td>
                  {recipeOf(order).name}
                  <small>{recipeOf(order).outputName}</small>
                </td>
                <td>
                  {fmt(order.qty, 3)} {recipeOf(order).outputUnit}
                </td>
                <td>
                  {fmt(order.status === 'completed' ? order.actual : 0, 3)}{' '}
                  {recipeOf(order).outputUnit}
                </td>
                <td>
                  <Badge status={order.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty title="Заказы не найдены" text="" />}
      </div>
      <Pagination state={pagination} />
    </>
  );
}
