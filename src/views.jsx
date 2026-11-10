import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import {
  RegistryFilters,
  Pagination,
  usePagination,
  inPeriod,
  containsText,
  dateTime,
} from './registries.jsx';
import {
  DAY,
  availableProcesses,
  recipeOf,
  operationsOf,
  operationOf,
  orderUnit,
  requirements,
  materialOf,
  sourceLot,
  isOrderBlocked,
  reservationLots,
  trackedInputKey,
  orderSupply,
  scaledQty,
  stockBalance,
  round,
} from './domain.js';
import {
  Badge,
  Product,
  Modal,
  Field,
  IconButton,
  SectionHead,
  Empty,
  fmt,
  dateFmt,
  timeFmt,
} from './ui.jsx';
import { QualityForm, OperationRecord } from './Execution.jsx';
import { CounterpartyPicker } from './Counterparties.jsx';
import { agroMaterialCaption } from './agroCatalog.js';
export { OperatorView } from './OperatorWorkspace.jsx';
import { qualityPending } from './operatorTasks.js';
export { MasterView } from './MasterData.jsx';
import { processLineError, resolveEquipment, resourcePath } from './resources.js';

export function CreateOrder({ store, act, busy, onClose }) {
  const processes = availableProcesses(store);
  const [processId, setProcessId] = useState(processes[0]?.id || ''),
    [qty, setQty] = useState(processes[0]?.baseQty ?? 1000),
    [line, setLine] = useState(
      store.lines.find((l) => processes[0] && !processLineError(store, processes[0], l.id))?.id ||
        '',
    ),
    [date, setDate] = useState(DAY),
    [start, setStart] = useState('14:00'),
    [due, setDue] = useState('18:00'),
    [priority, setPriority] = useState('normal');
  const process = processes.find((p) => p.id === processId),
    unit = process ? materialOf(store, process.outputMaterial).unit : 'ед.';
  const lineError = process ? processLineError(store, process, line) : '';
  return (
    <Modal title="Новый производственный заказ" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act(
              { type: 'createOrder', processId, qty, line, date, start, due, priority },
              'Заказ создан',
            )
          )
            onClose();
        }}
      >
        <div className="modal-content">
          <Field label="Процесс">
            <select
              required
              aria-label="Процесс заказа"
              value={processId}
              onChange={(e) => {
                setProcessId(e.target.value);
                const p = processes.find((p) => p.id === e.target.value);
                if (p) {
                  setQty(p.baseQty);
                  setLine(store.lines.find((l) => !processLineError(store, p, l.id))?.id || '');
                }
              }}
            >
              <option value="">Выберите процесс</option>
              {processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name} · версия {p.revision}
                </option>
              ))}
            </select>
          </Field>
          {process && (
            <p className="plain-note">
              Объём заказа — выпуск материала «{materialOf(store, process.outputMaterial).name}».{' '}
              {process.description}
            </p>
          )}
          <div className="form-grid">
            <Field label={`Объём, ${unit}`}>
              <input
                aria-label="Объём заказа"
                type="number"
                min={unit === 'шт' ? '1' : '0.001'}
                step={unit === 'шт' ? '1' : 'any'}
                max="1000000"
                required
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </Field>
            <Field label="Линия">
              <select value={line} onChange={(e) => setLine(e.target.value)}>
                <option value="">Выберите совместимую линию</option>
                {store.lines.map((l) => (
                  <option
                    key={l.id}
                    value={l.id}
                    disabled={Boolean(process && processLineError(store, process, l.id))}
                  >
                    {l.name}
                    {process && processLineError(store, process, l.id)
                      ? ' · нет ресурсов процесса'
                      : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Плановая дата">
              <input
                type="date"
                min={DAY}
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Приоритет">
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="normal">Обычный</option>
                <option value="high">Высокий</option>
              </select>
            </Field>
            <Field label="Начало">
              <input
                type="time"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="Окончание">
              <input type="time" required value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </div>
          {process && (
            <div className="form-summary">
              <div>
                {materialOf(store, process.outputMaterial)?.name}
                <small>
                  {process.operations.length} операций · версия {process.revision}
                </small>
              </div>
            </div>
          )}
          {!processes.length && (
            <p className="plain-note">Нет опубликованных процессов. Опубликуйте процесс в НСИ.</p>
          )}
          {process && (
            <section className="order-resources">
              <h3>Назначение оборудования</h3>
              {lineError ? (
                <p className="warning-banner">{lineError}</p>
              ) : (
                <>
                  <p className="hierarchy-path">
                    {resourcePath(store, line)
                      .map((n) => n.name)
                      .join(' / ')}
                  </p>
                  {process.operations.map((op) => {
                    const eq = resolveEquipment(store, op, line);
                    return (
                      <p key={op.id}>
                        <strong>{op.name}</strong>
                        <span>{eq ? `${eq.code} · ${eq.name}` : 'Без оборудования'}</span>
                      </p>
                    );
                  })}
                </>
              )}
            </section>
          )}
        </div>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary" disabled={busy || !process || Boolean(lineError)}>
            Создать заказ
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function OrderDrawer({ order, store, act, busy, onClose, openOperator, trace }) {
  const [quality, setQuality] = useState(false),
    [record, setRecord] = useState(null),
    [lotChoices, setLotChoices] = useState({}),
    [reserveQuantities, setReserveQuantities] = useState({}),
    [plannedQty, setPlannedQty] = useState(order.qty);
  const supply = orderSupply(store, order);
  const shortage = supply.rows.some((row) => row.shortage > 0.001);
  useEffect(() => {
    setPlannedQty(order.qty);
    setReserveQuantities({});
  }, [order.id, order.qty]);
  useEffect(() => {
    setLotChoices({});
    setReserveQuantities({});
  }, [order.id]);
  const stockInputs = operationsOf(order).flatMap((op) =>
    op.inputs
      .filter((input) => input.source === 'stock')
      .map((input) => ({ key: trackedInputKey(op, input), op, input })),
  );
  const trackedLots = [
    ...new Map(
      order.allocations
        .map((a) => sourceLot(store, a.lotId))
        .filter(Boolean)
        .map((lot) => [lot.id, lot]),
    ).values(),
  ].filter(
    (lot) => lot && ['livestock', 'individual'].includes(materialOf(store, lot.material)?.lotMode),
  );
  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside
        className="order-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Заказ ${order.code}`}
      >
        <header>
          <h2>{order.code}</h2>
          <IconButton icon={X} label="Закрыть заказ" onClick={onClose} />
        </header>
        <div className="drawer-content">
          <div className="drawer-product">
            <Product order={order} />
            <Badge status={order.status} />
          </div>
          <dl className="details-list">
            <div>
              <dt>План / факт</dt>
              <dd>
                {fmt(order.qty, 3)} / {fmt(order.actual, 3)} {orderUnit(order)}
              </dd>
            </div>
            <div>
              <dt>Линия</dt>
              <dd>{store.lines.find((l) => l.id === order.line)?.name}</dd>
            </div>
            <div>
              <dt>Дата и время</dt>
              <dd>
                {dateFmt(order.date)} · {order.start}–{order.due}
              </dd>
            </div>
            <div>
              <dt>Процесс</dt>
              <dd>
                {recipeOf(order).code} · версия {recipeOf(order).revision}
              </dd>
            </div>
            {trackedLots.map((lot) => (
              <div key={lot.id}>
                <dt>Исходная партия</dt>
                <dd>
                  {lot.code}
                  {lot.mark ? ` · № убоя ${lot.mark}` : ''}
                </dd>
              </div>
            ))}
          </dl>
          {order.status === 'reinspection' && <p className="warning-banner">{order.holdReason}</p>}
          {order.status === 'planned' && (
            <div className="order-plan-editor">
              <Field label={`План выпуска, ${orderUnit(order)}`}>
                <input
                  type="number"
                  min="0.001"
                  step={recipeOf(order).quantityStep || 'any'}
                  value={plannedQty}
                  onChange={(event) => setPlannedQty(event.target.value)}
                />
              </Field>
              <button
                className="button secondary compact"
                disabled={busy || Number(plannedQty) === order.qty}
                onClick={() =>
                  act(
                    { type: 'resizeOrder', orderId: order.id, qty: plannedQty },
                    'План пересчитан',
                  )
                }
              >
                Применить объём
              </button>
            </div>
          )}
          {order.status === 'planned' && shortage && (
            <div className="order-supply-note">
              <p>Для текущего плана недостаточно свободного сырья.</p>
              {supply.maxQty > 0 && supply.maxQty < order.qty && (
                <button
                  className="button secondary compact"
                  disabled={busy}
                  onClick={() =>
                    act(
                      { type: 'resizeOrder', orderId: order.id, qty: supply.maxQty },
                      'План пересчитан по свободным остаткам',
                    )
                  }
                >
                  По остаткам · {fmt(supply.maxQty, 3)} {orderUnit(order)}
                </button>
              )}
            </div>
          )}
          <h3 className="subheading">Операции</h3>
          <div className="order-route-list">
            {operationsOf(order).map((op, index) => {
              const completed = order.samples.some((s) => s.operationId === op.id);
              return (
                <button
                  key={op.id}
                  disabled={!completed}
                  className={completed ? 'complete' : index === order.stage ? 'current' : ''}
                  onClick={() => setRecord(index)}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <span>
                    <strong>{op.name}</strong>
                    <small>
                      {op.kind === 'quality' ? 'Контроль качества' : 'Производство'}
                      {op.equipment ? ` · ${op.equipment}` : ''}
                    </small>
                  </span>
                  <small>
                    {completed
                      ? 'Выполнено'
                      : index === order.stage && !['planned', 'ready'].includes(order.status)
                        ? 'Текущая'
                        : ''}
                  </small>
                </button>
              );
            })}
          </div>
          <h3 className="subheading">Потребность со склада</h3>
          {order.status === 'planned' ? (
            <div className="table-scroll">
              <table className="data-table order-supply-table">
                <thead>
                  <tr>
                    <th>Материал</th>
                    <th>Нужно</th>
                    <th>Свободно</th>
                    <th>Не хватает</th>
                  </tr>
                </thead>
                <tbody>
                  {supply.rows.map((need) => (
                    <tr key={need.material}>
                      <td>{agroMaterialCaption(need)}</td>
                      <td>
                        {fmt(need.qty, 3)} {need.unit}
                      </td>
                      <td>
                        {fmt(need.available, 3)} {need.unit}
                      </td>
                      <td>{need.shortage > 0 ? `${fmt(need.shortage, 3)} ${need.unit}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bom-list">
              {requirements(order).map((need) => (
                <div key={need.material}>
                  <span>{agroMaterialCaption(need)}</span>
                  <strong>
                    {fmt(need.qty, 3)} {need.unit}
                  </strong>
                </div>
              ))}
            </div>
          )}
          {order.status === 'planned' && stockInputs.length > 0 && (
            <>
              <h3 className="subheading">Резервирование сырья</h3>
              <p className="plain-note">
                MTU можно оставить пустой. Оператор подтверждает фактическую MTU и количество при
                списании на операции.
              </p>
              {stockInputs.map(({ key, op, input }) => {
                const lots = reservationLots(store, order, input, false);
                const selected = lots.find((lot) => lot.id === lotChoices[key]);
                const mode = materialOf(store, input.material)?.lotMode;
                const whole = ['livestock', 'individual'].includes(mode);
                const reserveQty =
                  reserveQuantities[key] ??
                  (selected
                    ? whole
                      ? stockBalance(selected)
                      : Math.min(
                          scaledQty(input, order),
                          stockBalance(selected) - (selected.reserved || 0),
                        )
                    : '');
                return (
                  <div key={key} className="order-reservation-row">
                    <Field label={`Резерв MTU · ${agroMaterialCaption(input)}`} hint={op.name}>
                      <select
                        aria-label={`Резерв MTU · ${agroMaterialCaption(input)}`}
                        value={lotChoices[key] || ''}
                        onChange={(event) => {
                          setLotChoices({ ...lotChoices, [key]: event.target.value });
                          setReserveQuantities({ ...reserveQuantities, [key]: undefined });
                        }}
                      >
                        <option value="">Без предварительного резерва</option>
                        {lots.map((lot) => (
                          <option key={lot.id} value={lot.id}>
                            {lot.mtuCode || lot.code}
                            {lot.mark ? ` · № убоя ${lot.mark}` : ''} ·{' '}
                            {fmt(stockBalance(lot) - (lot.reserved || 0), 3)} {input.unit}
                            {lot.livestock ? ` · ${lot.livestock.heads} гол.` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {selected && (
                      <Field label={`В резерв, ${input.unit}`}>
                        <input
                          aria-label={`Резерв количества · ${agroMaterialCaption(input)}`}
                          type="number"
                          min={input.unit === 'шт' ? 1 : 0.001}
                          step={input.unit === 'шт' ? 1 : 0.001}
                          readOnly={whole}
                          value={reserveQty}
                          onChange={(event) =>
                            setReserveQuantities({
                              ...reserveQuantities,
                              [key]: event.target.value,
                            })
                          }
                        />
                      </Field>
                    )}
                    {mode === 'individual' &&
                      selected &&
                      stockBalance(selected) !== scaledQty(input, order) && (
                        <button
                          className="button secondary compact"
                          disabled={busy}
                          onClick={() =>
                            act(
                              {
                                type: 'resizeOrder',
                                orderId: order.id,
                                qty: round(
                                  (stockBalance(selected) / Number(input.qty)) *
                                    Number(recipeOf(order).baseQty),
                                ),
                              },
                              'План пересчитан по массе партии',
                            )
                          }
                        >
                          Пересчитать по массе партии
                        </button>
                      )}
                  </div>
                );
              })}
            </>
          )}
          {order.status !== 'planned' && order.allocations.length > 0 && (
            <>
              <h3 className="subheading">Резерв и списание</h3>
              <div className="bom-list">
                {order.allocations.map((row, index) => (
                  <div key={row.movementId || index}>
                    <span>
                      {row.mtuCode ||
                        sourceLot(store, row.lotId)?.mtuCode ||
                        sourceLot(store, row.lotId)?.code}
                      <small>
                        {operationsOf(order).find((op) => op.id === row.operationId)?.name} ·{' '}
                        {row.consumed ? 'Списано' : 'Резерв'}
                      </small>
                    </span>
                    <strong>
                      {fmt(row.qty, 3)} {materialOf(store, row.material)?.unit}
                    </strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <footer className="drawer-actions">
          {order.status === 'planned' && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                act(
                  {
                    type: 'prepareOrder',
                    orderId: order.id,
                    reservations: stockInputs
                      .filter(({ key }) => lotChoices[key])
                      .map(({ key, op, input }) => {
                        const lot = sourceLot(store, lotChoices[key]);
                        const whole = ['livestock', 'individual'].includes(
                          materialOf(store, input.material)?.lotMode,
                        );
                        return {
                          operationId: op.id,
                          inputId: input.id,
                          lotId: lot.id,
                          qty:
                            reserveQuantities[key] ??
                            (whole
                              ? stockBalance(lot)
                              : Math.min(
                                  scaledQty(input, order),
                                  stockBalance(lot) - (lot.reserved || 0),
                                )),
                        };
                      }),
                  },
                  'Заказ подготовлен к исполнению',
                )
              }
            >
              Подготовить заказ
            </button>
          )}
          {['ready', 'queued', 'waiting'].includes(order.status) && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => (qualityPending(order) ? setQuality(true) : openOperator(order.id))}
            >
              {qualityPending(order) ? 'Открыть контроль' : 'Открыть операцию'}
            </button>
          )}
          {['running', 'hold'].includes(order.status) && (
            <button className="button primary" onClick={() => openOperator(order.id)}>
              Открыть рабочее место
            </button>
          )}
          {['quality', 'reinspection'].includes(order.status) && (
            <button className="button primary" onClick={() => setQuality(true)}>
              {order.status === 'reinspection' ? 'Открыть реинспекцию' : 'Провести контроль'}
            </button>
          )}
          <button className="button secondary" onClick={() => trace(order.id)}>
            Генеалогия партии
          </button>
        </footer>
      </aside>
      {quality && (
        <QualityForm
          order={order}
          store={store}
          act={act}
          busy={busy}
          onClose={() => setQuality(false)}
        />
      )}
      {record !== null && (
        <Modal title="Результаты операции" wide onClose={() => setRecord(null)}>
          <div className="modal-content">
            <OperationRecord order={order} index={record} />
          </div>
        </Modal>
      )}
    </>
  );
}

export function QualityView({ store, act, busy, onDetail }) {
  const [tab, setTab] = useState('pending'),
    [selected, setSelected] = useState(null),
    [query, setQuery] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const pending = store.orders.filter(qualityPending),
    incoming = store.lots.filter((l) => l.status === 'quarantine');
  const records = store.orders.flatMap((order) =>
    order.samples.filter((s) => s.kind === 'quality').map((sample) => ({ order, sample })),
  );
  const filteredRecords = records
    .filter(
      ({ order, sample }) =>
        inPeriod(sample.time, from, to) &&
        containsText(
          query,
          order.code,
          recipeOf(order).name,
          sample.name,
          sample.operator,
          sample.equipment,
          ...Object.values(sample.values),
        ),
    )
    .sort((a, b) => b.sample.time.localeCompare(a.sample.time));
  const pagination = usePagination(filteredRecords, JSON.stringify([query, from, to]));
  return (
    <>
      <div className="view-tabs tabs">
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
          Ожидают контроля<span>{pending.length + incoming.length}</span>
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          Журнал качества<span>{records.length}</span>
        </button>
      </div>
      {tab === 'history' && (
        <RegistryFilters
          {...{ query, from, to }}
          onQuery={setQuery}
          onFrom={setFrom}
          onTo={setTo}
          placeholder="Заказ, проверка, результат или исполнитель"
        />
      )}
      {tab === 'pending' ? (
        <>
          <SectionHead title="Контроль по производственным заказам" meta={`${pending.length}`} />
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Процесс</th>
                  <th>Операция</th>
                  <th>Статус</th>
                  <th>Линия</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <button className="order-link" onClick={() => onDetail(o.id)}>
                        {o.code}
                      </button>
                    </td>
                    <td>
                      {recipeOf(o).name}
                      <small>Версия {recipeOf(o).revision}</small>
                    </td>
                    <td>
                      {operationOf(o).name}
                      {o.status === 'reinspection' && <small>{o.holdReason}</small>}
                    </td>
                    <td>
                      <Badge status={o.status} />
                    </td>
                    <td>{store.lines.find((l) => l.id === o.line)?.name}</td>
                    <td>
                      <button
                        className="button secondary compact"
                        onClick={() => setSelected(o.id)}
                      >
                        {o.status === 'reinspection' ? 'Открыть реинспекцию' : 'Провести контроль'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!pending.length && <Empty title="Нет операций на контроле" text="" />}
          </div>
          <SectionHead title="Входной контроль" meta={`${incoming.length} партий`} />
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Партия</th>
                  <th>Материал</th>
                  <th>Поставщик</th>
                  <th>Количество</th>
                  <th>Годен до</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {incoming.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.code}</td>
                    <td>{materialOf(store, l.material).name}</td>
                    <td>{l.supplier}</td>
                    <td>
                      {fmt(l.qty, 3)} {materialOf(store, l.material).unit}
                    </td>
                    <td>{l.livestock ? 'Текущая смена' : dateFmt(l.expires)}</td>
                    <td>
                      <button
                        className="button secondary compact"
                        disabled={busy}
                        onClick={() =>
                          act({ type: 'releaseLot', lotId: l.id }, 'Входной контроль пройден')
                        }
                      >
                        Допустить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!incoming.length && <Empty title="Все поступления проверены" text="" />}
          </div>
        </>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Заказ</th>
                <th>Операция</th>
                <th>Результаты</th>
                <th>Исполнитель</th>
                <th>Время</th>
              </tr>
            </thead>
            <tbody>
              {pagination.rows.map(({ order, sample }) => {
                const op = operationsOf(order).find((op) => op.id === sample.operationId);
                return (
                  <tr key={`${order.id}-${sample.operationId}`}>
                    <td>
                      <button className="order-link" onClick={() => onDetail(order.id)}>
                        {order.code}
                      </button>
                      <small>{recipeOf(order).name}</small>
                    </td>
                    <td>{sample.name}</td>
                    <td className="quality-results">
                      {op.parameters.map((p) => (
                        <span key={p.id}>
                          {p.name}:{' '}
                          {p.type === 'boolean'
                            ? sample.values[p.id]
                              ? 'Соответствует'
                              : 'Нет'
                            : (sample.values[p.id] ?? '—')}{' '}
                          {p.unit || ''}
                        </span>
                      ))}
                    </td>
                    <td>{sample.operator}</td>
                    <td>{dateTime(sample.time)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filteredRecords.length && <Empty title="Проверки не найдены" text="" />}
        </div>
      )}
      {tab === 'history' && <Pagination state={pagination} />}
      {selected && (
        <QualityForm
          order={store.orders.find((o) => o.id === selected)}
          store={store}
          act={act}
          busy={busy}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

export const lotLabels = {
  released: 'Допущена',
  quarantine: 'Входной контроль',
  blocked: 'Заблокирована',
};
export function LotsView({ store, act, busy, trace }) {
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [selected, setSelected] = useState(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const lots = store.lots.filter(
    (l) =>
      (!status || l.status === status) &&
      inPeriod(l.receivedAt || l.received, from, to) &&
      `${l.code} ${materialOf(store, l.material).name} ${l.supplier}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pagination = usePagination(lots, JSON.stringify([query, status, from, to]));
  const lot = store.lots.find((l) => l.id === selected);
  return (
    <>
      <SectionHead
        title="Остатки сырья и материалов"
        meta={`${lots.length} из ${store.lots.length} партий`}
      />
      <RegistryFilters
        {...{ query, from, to }}
        onQuery={setQuery}
        onFrom={setFrom}
        onTo={setTo}
        placeholder="Партия, материал или поставщик"
      >
        <select
          aria-label="Статус партии"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Все статусы</option>
          {Object.entries(lotLabels).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </RegistryFilters>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Партия</th>
              <th>Материал / поставщик</th>
              <th className="numeric">Остаток</th>
              <th className="numeric">Резерв</th>
              <th className="numeric">Доступно</th>
              <th>{store.scenarioId === 'agro' ? 'Срок / смена' : 'Годен до'}</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {pagination.rows.map((l) => {
              const m = materialOf(store, l.material);
              return (
                <tr key={l.id}>
                  <td>
                    <button className="order-link" onClick={() => setSelected(l.id)}>
                      {l.code}
                    </button>
                    <small>{l.location}</small>
                    {l.mtuCode && <small>MTU {l.mtuCode}</small>}
                    <small>{l.receivedAt ? dateTime(l.receivedAt) : dateFmt(l.received)}</small>
                  </td>
                  <td>
                    {m.name}
                    <small>{l.supplier}</small>
                  </td>
                  <td className="numeric">
                    {fmt(l.qty, 3)} {m.unit}
                    {l.livestock && <small>{l.qty > 0 ? l.livestock.heads : 0} гол.</small>}
                  </td>
                  <td className="numeric">{fmt(l.reserved, 3)}</td>
                  <td className="numeric strong">
                    {fmt(l.status === 'released' ? l.qty - l.reserved : 0, 3)}
                  </td>
                  <td>{l.livestock ? 'Текущая смена' : dateFmt(l.expires)}</td>
                  <td>
                    <Badge status={l.status}>{lotLabels[l.status]}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!lots.length && <Empty />}
      </div>
      <Pagination state={pagination} />
      {lot && (
        <Modal title={`Партия ${lot.code}`} wide onClose={() => setSelected(null)}>
          <div className="modal-content">
            <h3>{materialOf(store, lot.material).name}</h3>
            <dl className="details-list">
              <div>
                <dt>Поставщик</dt>
                <dd>{lot.supplier}</dd>
              </div>
              <div>
                <dt>Остаток / резерв</dt>
                <dd>
                  {fmt(lot.qty, 3)} / {fmt(lot.reserved, 3)} {materialOf(store, lot.material).unit}
                </dd>
              </div>
              {lot.livestock ? (
                <>
                  <div>
                    <dt>ТСДок</dt>
                    <dd>{lot.livestock.document}</dd>
                  </div>
                  <div>
                    <dt>Фактически принято</dt>
                    <dd>
                      {lot.livestock.heads} гол. · {fmt(lot.livestock.weight, 3)} кг
                    </dd>
                  </div>
                  <div>
                    <dt>Масса по документам</dt>
                    <dd>{fmt(lot.livestock.declaredWeight, 3)} кг</dd>
                  </div>
                  <div>
                    <dt>Расхождение по массе</dt>
                    <dd>{fmt(lot.livestock.weight - lot.livestock.declaredWeight, 3)} кг</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>Годен до</dt>
                  <dd>{dateFmt(lot.expires)}</dd>
                </div>
              )}
              <div>
                <dt>Статус</dt>
                <dd>
                  <Badge status={lot.status}>{lotLabels[lot.status]}</Badge>
                </dd>
              </div>
            </dl>
            <h3 className="subheading">Связанные заказы</h3>
            <div className="linked-orders">
              {store.orders
                .filter((o) => o.allocations.some((a) => a.lotId === lot.id))
                .map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setSelected(null);
                      trace(o.id);
                    }}
                  >
                    <span>
                      <strong>{o.code}</strong>
                      <small>{recipeOf(o).name}</small>
                    </span>
                    <Badge status={o.status} />
                  </button>
                ))}
            </div>
            {lot.status === 'blocked' && (
              <p className="warning-banner">Отгрузка связанной продукции запрещена.</p>
            )}
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setSelected(null)}>
              Закрыть
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setSelected(null);
                trace({ type: 'lot', id: lot.id, direction: 'forward' });
              }}
            >
              Генеалогия партии
            </button>
            {lot.status === 'quarantine' ? (
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  act(
                    { type: 'releaseLot', lotId: lot.id },
                    lot.livestock ? 'Партия передана в ЗПС' : 'Сырьё допущено',
                  )
                }
              >
                {lot.livestock ? 'Допустить в ЗПС' : 'Допустить'}
              </button>
            ) : (
              <button
                className={`button ${lot.status === 'blocked' ? 'primary' : 'danger'}`}
                disabled={busy}
                onClick={() =>
                  act(
                    { type: 'blockLot', lotId: lot.id },
                    lot.status === 'blocked' ? 'Блокировка снята' : 'Партия заблокирована',
                  )
                }
              >
                {lot.status === 'blocked' ? 'Снять блокировку' : 'Заблокировать'}
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

export function ReceiveLot({ store, act, busy, onClose }) {
  const materials = store.materials.filter((m) => m.active !== false && !m.internal);
  const [material, setMaterial] = useState(materials[0]?.id || ''),
    [qty, setQty] = useState(materials[0]?.lotMode === 'livestock' ? '' : 1000),
    [supplierId, setSupplierId] = useState(''),
    [heads, setHeads] = useState(''),
    [declaredWeight, setDeclaredWeight] = useState(''),
    [document, setDocument] = useState(''),
    [mtuCode, setMtuCode] = useState(''),
    [expires, setExpires] = useState('2026-11-22');
  const selected = materials.find((m) => m.id === material);
  const unit = selected?.unit;
  const live = selected?.lotMode === 'livestock';
  return (
    <Modal title={live ? 'Приёмка живка · КТ1/КТ2' : 'Приёмка материала'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act(
              {
                type: 'receiveLot',
                material,
                qty,
                supplierId,
                expires,
                heads,
                declaredWeight,
                document,
                mtuCode,
              },
              'Партия принята на входной контроль',
            )
          )
            onClose();
        }}
      >
        <div className="modal-content">
          <Field label="Материал">
            <select required value={material} onChange={(e) => setMaterial(e.target.value)}>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} · {m.name}
                </option>
              ))}
            </select>
          </Field>
          <CounterpartyPicker
            {...{ store, act, busy }}
            role="isSupplier"
            value={supplierId}
            onChange={setSupplierId}
            label={live ? 'Свиноводческое хозяйство / поставщик' : 'Поставщик'}
          />
          <Field label="Код MTU" hint="При пустом поле используется код принятой партии.">
            <input value={mtuCode} onChange={(event) => setMtuCode(event.target.value)} />
          </Field>
          <div className="form-grid">
            <Field label={live ? 'Фактическая живая масса, кг' : `Количество, ${unit || 'ед.'}`}>
              <input
                required
                type="number"
                min={unit === 'шт' ? 1 : 0.001}
                step={unit === 'шт' ? 1 : 'any'}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </Field>
            {live ? (
              <>
                <Field label="Фактически, голов">
                  <input
                    required
                    type="number"
                    min="1"
                    step="1"
                    value={heads}
                    onChange={(e) => setHeads(e.target.value)}
                  />
                </Field>
                <Field label="Живая масса по документам, кг">
                  <input
                    required
                    type="number"
                    min="0.001"
                    step="any"
                    value={declaredWeight}
                    onChange={(e) => setDeclaredWeight(e.target.value)}
                  />
                </Field>
                <Field label="Номер ТСДок">
                  <input required value={document} onChange={(e) => setDocument(e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label="Годен до">
                <input
                  type="date"
                  required
                  min="2026-10-23"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </Field>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary" disabled={busy || !material}>
            Принять
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function FinishedView({ store, act, busy, trace, production = false }) {
  const [selected, setSelected] = useState(null),
    [qty, setQty] = useState(''),
    [query, setQuery] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [status, setStatus] = useState(''),
    [customerId, setCustomerId] = useState('');
  const lot = store.finished.find((l) => l.id === selected);
  const agro = store.scenarioId === 'agro';
  const batches = store.finished.filter((batch) => {
    const material = materialOf(store, batch.material);
    const order = store.orders.find((item) => item.id === batch.orderId);
    const blocked = isOrderBlocked(store, order);
    return (
      (production ? material?.kind !== 'finished' : material?.kind === 'finished') &&
      (production || stockBalance(batch) > 0) &&
      (!status || (blocked ? 'blocked' : batch.status) === status) &&
      inPeriod(batch.producedAt || order?.date, from, to) &&
      containsText(query, batch.code, batch.mtuCode, batch.name, batch.mark, order?.code)
    );
  });
  const pagination = usePagination(batches, JSON.stringify([query, from, to, status, production]));
  return (
    <>
      <SectionHead
        title={production ? 'Межцеховые партии' : 'Остатки готовой продукции'}
        meta={`${batches.length} партий`}
      />
      <RegistryFilters
        {...{ query, from, to }}
        onQuery={setQuery}
        onFrom={setFrom}
        onTo={setTo}
        placeholder="Партия, MTU, продукция или заказ"
      >
        <select
          aria-label="Статус выпуска"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Все статусы</option>
          <option value="released">Учтена / принята</option>
          <option value="inTransit">Ожидает приёмки</option>
          <option value="blocked">Блокировка сырья</option>
        </select>
      </RegistryFilters>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Партия / заказ</th>
              <th>Материал</th>
              <th className="numeric">Выпуск</th>
              <th className="numeric">Остаток</th>
              <th>Годен до</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pagination.rows.map((l) => {
              const order = store.orders.find((o) => o.id === l.orderId),
                blocked = isOrderBlocked(store, order),
                pending = l.status === 'inTransit';
              return (
                <tr key={l.id}>
                  <td>
                    <button className="order-link" onClick={() => trace({ type: 'lot', id: l.id })}>
                      {l.code}
                    </button>
                    <small>{order.code}</small>
                    {l.producedAt && <small>{dateTime(l.producedAt)}</small>}
                  </td>
                  <td>
                    {l.name || materialOf(store, l.material)?.name}
                    {l.mark && <small>Номер убоя {l.mark}</small>}
                  </td>
                  <td className="numeric">
                    {fmt(l.qty, 3)} {l.unit}
                  </td>
                  <td className="numeric">
                    {fmt(l.remaining, 3)} {l.unit}
                    {l.reserved > 0 && (
                      <small>
                        Резерв {fmt(l.reserved, 3)} {l.unit}
                      </small>
                    )}
                  </td>
                  <td>{dateFmt(l.expires)}</td>
                  <td>
                    <Badge status={blocked ? 'blocked' : pending ? 'queued' : 'completed'}>
                      {blocked
                        ? 'Блокировка сырья'
                        : pending
                          ? 'Ожидает приёмки'
                          : l.acceptedAt
                            ? 'Принята на СГП'
                            : agro
                              ? 'Учтена'
                              : 'Разрешена'}
                    </Badge>
                  </td>
                  <td>
                    {pending ? (
                      <button
                        className="button primary compact"
                        disabled={blocked || busy}
                        onClick={() =>
                          act({ type: 'acceptWarehouse', lotId: l.id }, 'Палета принята на СГП')
                        }
                      >
                        Принять на СГП
                      </button>
                    ) : (
                      !production && (
                        <button
                          className="button secondary compact"
                          disabled={blocked || l.remaining - (l.reserved || 0) <= 0}
                          onClick={() => {
                            setSelected(l.id);
                            setQty(l.remaining - (l.reserved || 0));
                          }}
                        >
                          Отгрузить
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!batches.length && <Empty title="Партии не найдены" text="" />}
      </div>
      <Pagination state={pagination} />
      {lot && (
        <Modal title={`Отгрузка ${lot.code}`} onClose={() => setSelected(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ type: 'ship', lotId: lot.id, qty, customerId }, 'Отгрузка проведена'))
                setSelected(null);
            }}
          >
            <div className="modal-content">
              <CounterpartyPicker
                {...{ store, act, busy }}
                role="isCustomer"
                value={customerId}
                onChange={setCustomerId}
              />
              <Field
                label={`Количество, ${lot.unit}`}
                hint={`Доступно ${fmt(lot.remaining - (lot.reserved || 0), 3)} ${lot.unit}`}
              >
                <input
                  aria-label="Количество отгрузки"
                  type="number"
                  required
                  min={lot.unit === 'шт' ? 1 : 0.001}
                  step={lot.unit === 'шт' ? 1 : 'any'}
                  max={lot.remaining - (lot.reserved || 0)}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </Field>
            </div>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setSelected(null)}>
                Отмена
              </button>
              <button className="button primary" disabled={busy}>
                Провести отгрузку
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export { GenealogyView } from './GenealogyView.jsx';
