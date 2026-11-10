import { CarcassQrButton } from './CarcassPanel.jsx';
import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Link2,
  Package,
  Printer,
  Search,
  Truck,
  Workflow,
  X,
} from 'lucide-react';
import { recipeOf, operationsOf, stockBalance, isOrderBlocked } from './domain.js';
import { buildTrace, buildTraceTree, visibleTraceNodes, traceQuantity } from './genealogy.js';
import { Badge, Empty, Modal, fmt, dateFmt, exportCsv } from './ui.jsx';
import { dateTime, Pagination, usePagination } from './registries.jsx';
import { OperationRecord } from './Execution.jsx';

const labels = {
  released: 'Допущена',
  quarantine: 'Карантин',
  blocked: 'Заблокирована',
  inTransit: 'Ожидает приёмки',
};
const nameOf = (index, lot) =>
  lot?.name || index.materials.get(lot?.material)?.name || 'Партия не найдена';
const unitOf = (index, lot) => lot?.unit || index.materials.get(lot?.material)?.unit || '';
const quantity = (value, unit) => `${fmt(value, 3)} ${unit || ''}`.trim();
const safeDate = (value) => (value ? dateFmt(value.slice(0, 10)) : '—');
const count = (n, forms) =>
  `${n} ${forms[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2]}`;

function NodeIcon({ type, ...props }) {
  const Icon = type === 'order' ? Workflow : type === 'shipment' ? Truck : Package;
  return <Icon size={16} strokeWidth={1.5} aria-hidden="true" {...props} />;
}

function nodeTitle(index, node) {
  if (!node.record) return node.code || node.id;
  return node.type === 'order'
    ? recipeOf(node.record).name
    : node.type === 'shipment'
      ? node.record.customer
      : nameOf(index, node.record);
}

function TraceTree({ index, tree, active, onSelect, expanded, setExpanded, query, setQuery }) {
  const container = useRef(null);
  const [focused, setFocused] = useState(tree.nodes[0].key);
  const [limit, setLimit] = useState(150);
  const typeAhead = useRef({ text: '', time: 0 });
  const visible = useMemo(() => visibleTraceNodes(tree, expanded, query), [tree, expanded, query]);
  const activePosition = visible.findIndex((node) => node.key === active.key);
  const rows = visible.slice(0, Math.max(limit, activePosition + 1));
  const tabKey = rows.some((node) => node.key === focused) ? focused : rows[0]?.key;
  const focusNode = (key) => {
    setFocused(key);
    const position = visible.findIndex((node) => node.key === key);
    if (position >= limit) setLimit(position + 1);
    requestAnimationFrame(() => {
      const element = container.current?.querySelector(`[data-node="${key}"]`);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };
  const toggle = (node) => {
    if (query) return;
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(node.key)) next.delete(node.key);
      else next.add(node.key);
      return next;
    });
    setFocused(node.key);
  };
  const keyboard = (event, node) => {
    const position = visible.findIndex((row) => row.key === node.key);
    let target;
    if (event.key === 'ArrowDown')
      target = visible[Math.min(position + 1, visible.length - 1)]?.key;
    else if (event.key === 'ArrowUp') target = visible[Math.max(0, position - 1)]?.key;
    else if (event.key === 'Home') target = visible[0]?.key;
    else if (event.key === 'End') target = visible.at(-1)?.key;
    else if (event.key === 'ArrowRight') {
      if (node.children.length && !expanded.has(node.key) && !query) toggle(node);
      else target = node.children.find((key) => visible.some((row) => row.key === key));
    } else if (event.key === 'ArrowLeft') {
      if (node.children.length && expanded.has(node.key) && !query) toggle(node);
      else target = node.parentKey;
    } else if (event.key === 'Enter' || event.key === ' ') onSelect(node);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typeAhead.current = {
        text:
          (now - typeAhead.current.time < 700 ? typeAhead.current.text : '') +
          event.key.toLocaleLowerCase('ru'),
        time: now,
      };
      const ordered = [...visible.slice(position + 1), ...visible.slice(0, position + 1)];
      target = ordered.find((row) =>
        nodeTitle(index, row).toLocaleLowerCase('ru').startsWith(typeAhead.current.text),
      )?.key;
    } else return;
    event.preventDefault();
    if (target) focusNode(target);
  };
  return (
    <aside className="genealogy-tree-pane" aria-label="Навигация по связям">
      <div className="genealogy-tree-toolbar">
        <h3>Дерево связей</h3>
        <div>
          <button
            className="icon-button"
            aria-label="Развернуть все связи"
            title="Развернуть все связи"
            disabled={Boolean(query)}
            onClick={() =>
              setExpanded(
                new Set(tree.nodes.filter((node) => node.children.length).map((node) => node.key)),
              )
            }
          >
            <ChevronsUpDown size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Свернуть все связи"
            title="Свернуть все связи"
            disabled={Boolean(query)}
            onClick={() => {
              setExpanded(new Set());
              setFocused(tree.nodes[0].key);
            }}
          >
            <ChevronsDownUp size={16} />
          </button>
        </div>
      </div>
      <div className="genealogy-tree-search">
        <Search size={15} aria-hidden="true" />
        <input
          aria-label="Найти в дереве связей"
          placeholder="Найти в цепочке"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(150);
          }}
        />
        {query && (
          <button aria-label="Очистить поиск в цепочке" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="genealogy-tree-scroll" ref={container}>
        <div role="tree" aria-label="Дерево генеалогии" className="genealogy-tree">
          {rows.map((node) => {
            const title = nodeTitle(index, node);
            const code =
              node.type === 'shipment'
                ? dateTime(node.record?.time)
                : node.record?.code || node.code || node.id;
            const isOpen = query
              ? node.children.some((key) => visible.some((row) => row.key === key))
              : expanded.has(node.key);
            return (
              <div
                key={node.key}
                role="treeitem"
                data-node={node.key}
                aria-level={node.depth + 1}
                aria-posinset={node.position}
                aria-setsize={node.siblings}
                aria-selected={active.key === node.key}
                aria-expanded={node.children.length ? isOpen : undefined}
                aria-label={`${node.type === 'order' ? 'Заказ' : node.type === 'shipment' ? 'Отгрузка' : 'Партия'}: ${title}, ${code}${node.reference ? ', повторная связь' : ''}${node.missing ? ', запись не найдена' : ''}`}
                tabIndex={tabKey === node.key ? 0 : -1}
                className={`genealogy-tree-node ${active.key === node.key ? 'selected' : ''} ${node.missing ? 'missing' : ''}`}
                style={{ '--tree-depth': Math.min(node.depth, 7) }}
                onFocus={() => setFocused(node.key)}
                onKeyDown={(event) => keyboard(event, node)}
                onClick={() => onSelect(node)}
              >
                {node.children.length ? (
                  <button
                    tabIndex={-1}
                    className="genealogy-tree-toggle"
                    aria-label={`${isOpen ? 'Свернуть' : 'Развернуть'} ${code}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(node);
                    }}
                    disabled={Boolean(query)}
                  >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                ) : (
                  <span className="genealogy-tree-toggle" />
                )}
                <NodeIcon type={node.type} className={`genealogy-node-icon ${node.type}`} />
                <span className="genealogy-tree-label">
                  <strong title={title}>{title}</strong>
                  <small>
                    {node.type === 'shipment' ? dateTime(node.record?.time) : code}
                    {node.reference ? ' · повторная связь' : ''}
                    {node.missing ? ' · не найдена' : ''}
                  </small>
                </span>
                {node.depth === 0 ? (
                  <span
                    className="genealogy-root-marker"
                    title="Объект, для которого открыта генеалогия"
                  >
                    {node.type === 'lot' ? 'Эта партия' : 'Этот заказ'}
                  </span>
                ) : node.reference ? (
                  <Link2 size={13} className="genealogy-reference-icon" aria-hidden="true" />
                ) : node.qty != null ? (
                  <span className="genealogy-tree-quantity">{quantity(node.qty, node.unit)}</span>
                ) : null}
              </div>
            );
          })}
        </div>
        {!rows.length && (
          <Empty title="Связи не найдены" text="Попробуйте код партии, заказ или наименование." />
        )}
        {visible.length > rows.length && (
          <button
            className="text-button genealogy-load-more"
            onClick={() => setLimit((value) => value + 150)}
          >
            Показать ещё · осталось {visible.length - rows.length}
          </button>
        )}
      </div>
      <p className="genealogy-tree-footer">Выберите узел, чтобы посмотреть подробности</p>
    </aside>
  );
}

function Fact({ label, children }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children || '—'}</dd>
    </div>
  );
}

function LotRows({ index, rows, onInspect, caption }) {
  const page = usePagination(rows, rows.map((row) => row.id || row.lot?.id || row.code).join('/'));
  return (
    <>
      <div className="genealogy-materials-table">
        {page.rows.map(({ lot, qty, code, unit, id }) => (
          <div className="genealogy-material-row" key={id || lot?.id || code}>
            <NodeIcon type="lot" />
            <div>
              {lot ? (
                <button className="order-link" onClick={() => onInspect('lot', lot.id)}>
                  {nameOf(index, lot)}
                </button>
              ) : (
                <strong>{code || 'Партия не найдена'}</strong>
              )}
              <small>
                {lot?.code || code}
                {lot?.mark ? ` · № убоя ${lot.mark}` : ''}
                {!lot ? ' · исходная запись не найдена' : ''}
              </small>
              {caption && <small>{caption}</small>}
            </div>
            <span>{quantity(qty, unit || unitOf(index, lot))}</span>
          </div>
        ))}
      </div>
      {rows.length > page.size && <Pagination state={page} />}
    </>
  );
}

function Reservations({ index, rows, onDetail }) {
  const page = usePagination(rows, rows.map((row) => `${row.orderId}/${row.lotId}`).join('/'));
  if (!rows.length) return null;
  return (
    <details className="genealogy-disclosure">
      <summary>Резервы · {rows.length}</summary>
      <p className="genealogy-note">Резерв не подтверждает списание в производство.</p>
      {page.rows.map((row, position) => (
        <div className="genealogy-reserve-row" key={`${row.orderId}/${position}`}>
          <div>
            <button className="order-link" onClick={() => onDetail(row.orderId)}>
              {index.orders.get(row.orderId)?.code || row.orderId}
            </button>
            <small>{row.lotCode || index.lots.get(row.lotId)?.code || row.lotId}</small>
          </div>
          <span>{quantity(row.qty, unitOf(index, index.lots.get(row.lotId)))}</span>
        </div>
      ))}
      {rows.length > page.size && <Pagination state={page} />}
    </details>
  );
}

function LotDetail({ index, lot, direction, onInspect, onTrace, onDetail, store, act, busy }) {
  const producer = index.orders.get(lot.orderId);
  const consumers = index.consumers.get(lot.id) || [];
  const shipments = index.shipments.get(lot.id) || [];
  const consumerPage = usePagination(consumers, lot.id);
  const shipmentPage = usePagination(shipments, lot.id);
  const total = traceQuantity(index, lot);
  return (
    <>
      <div className="genealogy-metrics">
        <div>
          <span>{lot.orderId ? 'Выпущено' : 'Принято'}</span>
          <strong>{quantity(total, unitOf(index, lot))}</strong>
        </div>
        <div>
          <span>Остаток</span>
          <strong>{quantity(stockBalance(lot), unitOf(index, lot))}</strong>
        </div>
        <div>
          <span>В резерве</span>
          <strong>{quantity(lot.reserved || 0, unitOf(index, lot))}</strong>
        </div>
      </div>
      <dl className="genealogy-properties">
        <Fact label={lot.orderId ? 'Дата выпуска' : 'Дата приёмки'}>
          {safeDate(producer?.date || lot.producedAt || lot.received)}
        </Fact>
        {lot.mtuCode && lot.mtuCode !== lot.code && <Fact label="MTU">{lot.mtuCode}</Fact>}
        {lot.supplier && <Fact label="Поставщик / хозяйство">{lot.supplier}</Fact>}
        {lot.mark && <Fact label="Номер убоя">{lot.mark}</Fact>}
        {lot.slaughterBatchId && (
          <Fact label="Партия убоя">
            {index.slaughterBatches?.get(lot.slaughterBatchId)?.number ||
              'Ранее не зарегистрирована'}
          </Fact>
        )}
        {lot.carcassId && (
          <Fact label="Текущая RFID-разнога">
            {index.carcasses?.get(lot.carcassId)?.currentRfid || 'Разнога освобождена'}
          </Fact>
        )}
        {lot.livestock && (
          <>
            <Fact label="Живок">
              {lot.livestock.heads} гол. · {quantity(lot.livestock.weight, 'кг')}
            </Fact>
            <Fact label="ТСДок">{lot.livestock.document}</Fact>
          </>
        )}
        {lot.expires && <Fact label="Годен до">{safeDate(lot.expires)}</Fact>}
        {lot.acceptedAt && <Fact label="Принято на СГП">{dateTime(lot.acceptedAt)}</Fact>}
      </dl>
      {lot.carcassId && <CarcassQrButton {...{ store, act, busy }} carcassId={lot.carcassId} />}
      {lot.livestock && (
        <p className="genealogy-note">
          Прослеживаемость ведётся по партии живка. Принятая масса относится ко всей партии, а не к
          отдельному продукту.
        </p>
      )}
      <section className="genealogy-detail-section">
        <h4>{direction === 'backward' ? 'Источник партии' : 'Дальнейшее движение'}</h4>
        {direction === 'backward' ? (
          producer ? (
            <button className="genealogy-relation" onClick={() => onInspect('order', producer.id)}>
              <NodeIcon type="order" />
              <span>
                <strong>{recipeOf(producer).name}</strong>
                <small>{producer.code}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ) : (
            <p className="genealogy-note">
              {lot.orderId
                ? 'Заказ выпуска не найден. Доступны только сведения о партии.'
                : 'Входящая партия. Происхождение зафиксировано при приёмке.'}
            </p>
          )
        ) : (
          <>
            {consumerPage.rows.map((edge) => {
              const order = index.orders.get(edge.orderId);
              return (
                <button
                  key={edge.orderId}
                  className="genealogy-relation"
                  onClick={() => onInspect('order', edge.orderId)}
                >
                  <NodeIcon type="order" />
                  <span>
                    <strong>{recipeOf(order).name}</strong>
                    <small>
                      {order.code} · списано {quantity(edge.qty, unitOf(index, lot))}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              );
            })}
            {consumers.length > consumerPage.size && <Pagination state={consumerPage} />}
            {shipmentPage.rows.map((shipment) => (
              <button
                key={shipment.id}
                className="genealogy-relation"
                onClick={() => onInspect('shipment', shipment.id)}
              >
                <NodeIcon type="shipment" />
                <span>
                  <strong>{shipment.customer}</strong>
                  <small>
                    Отгружено {quantity(shipment.qty, shipment.unit || unitOf(index, lot))} ·{' '}
                    {dateTime(shipment.time)}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {shipments.length > shipmentPage.size && <Pagination state={shipmentPage} />}
            {!consumers.length && !shipments.length && (
              <p className="genealogy-note">
                Подтверждённых списаний и отгрузок пока нет. Партия остаётся на складе.
              </p>
            )}
          </>
        )}
      </section>
      {direction === 'backward' && shipments.length > 0 && (
        <details className="genealogy-disclosure">
          <summary>Отгрузки этой партии · {shipments.length}</summary>
          {shipmentPage.rows.map((shipment) => (
            <button
              key={shipment.id}
              className="genealogy-relation"
              onClick={() => onInspect('shipment', shipment.id)}
            >
              <NodeIcon type="shipment" />
              <span>
                <strong>{shipment.customer}</strong>
                <small>
                  {quantity(shipment.qty, shipment.unit || unitOf(index, lot))} ·{' '}
                  {dateTime(shipment.time)}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
          {shipments.length > shipmentPage.size && <Pagination state={shipmentPage} />}
        </details>
      )}
      <Reservations index={index} rows={index.reservations.get(lot.id) || []} onDetail={onDetail} />
      <div className="genealogy-inspector-actions">
        <button
          className="button secondary compact"
          onClick={() =>
            onTrace({ type: 'lot', id: lot.id }, direction === 'backward' ? 'forward' : 'backward')
          }
        >
          {direction === 'backward' ? 'Показать использование' : 'Показать происхождение'}
          <ArrowRight size={14} />
        </button>
      </div>
    </>
  );
}

function OrderDetail({ index, graph, order, onInspect, onDetail, onRecord }) {
  const [tab, setTab] = useState('materials');
  const inputs = index.inputs.get(order.id) || [];
  const packaging = inputs.filter(
    (edge) => index.materials.get(edge.material)?.kind === 'packaging',
  );
  const materials = inputs.filter(
    (edge) => index.materials.get(edge.material)?.kind !== 'packaging',
  );
  const outputs = graph.outputsFor(order.id);
  const otherOutputs = (index.outputs.get(order.id) || []).filter(
    (lot) => !outputs.some((row) => row.id === lot.id),
  );
  const inputRows = (rows) =>
    rows.map((edge) => ({
      id: edge.lotId,
      lot: index.lots.get(edge.lotId),
      code: edge.code,
      qty: edge.qty,
      unit: index.materials.get(edge.material)?.unit,
    }));
  const outputRows = (rows) => rows.map((lot) => ({ lot, qty: lot.qty }));
  const operations = operationsOf(order);
  return (
    <>
      <dl className="genealogy-properties genealogy-order-facts">
        <Fact label="Дата">{safeDate(order.date)}</Fact>
        <Fact label="Выполнено операций">
          {order.samples.length} из {operations.length}
        </Fact>
      </dl>
      <div className="tabs genealogy-detail-tabs" aria-label="Сведения о заказе">
        <button
          className={tab === 'materials' ? 'active' : ''}
          aria-pressed={tab === 'materials'}
          onClick={() => setTab('materials')}
        >
          Материалы и выпуск
        </button>
        <button
          className={tab === 'operations' ? 'active' : ''}
          aria-pressed={tab === 'operations'}
          onClick={() => setTab('operations')}
        >
          Операции <span>{operations.length}</span>
        </button>
      </div>
      {tab === 'materials' ? (
        <>
          <section className="genealogy-detail-section">
            <div className="genealogy-section-label">
              <h4>Списано в заказ</h4>
              <span>Фактическое количество</span>
            </div>
            {materials.length ? (
              <LotRows index={index} rows={inputRows(materials)} onInspect={onInspect} />
            ) : (
              <p className="genealogy-note">Сырьё ещё не списано. Резервы показаны отдельно.</p>
            )}
            {packaging.length > 0 && (
              <details className="genealogy-disclosure">
                <summary>Упаковка · {packaging.length}</summary>
                <LotRows index={index} rows={inputRows(packaging)} onInspect={onInspect} />
              </details>
            )}
          </section>
          <section className="genealogy-detail-section">
            <div className="genealogy-section-label">
              <h4>Выпуск в этой цепочке</h4>
              <span>Количество выпуска</span>
            </div>
            {outputs.length ? (
              <LotRows index={index} rows={outputRows(outputs)} onInspect={onInspect} />
            ) : (
              <p className="genealogy-note">
                {order.status === 'completed'
                  ? 'Связанные партии выпуска не найдены.'
                  : order.produced.length
                    ? 'Выходы зарегистрированы. Складские партии появятся после завершения заказа.'
                    : 'Выпуск ещё не зарегистрирован.'}
              </p>
            )}
            {otherOutputs.length > 0 && (
              <details className="genealogy-disclosure">
                <summary>Другие партии этого заказа · {otherOutputs.length}</summary>
                <LotRows index={index} rows={outputRows(otherOutputs)} onInspect={onInspect} />
              </details>
            )}
          </section>
          <Reservations
            index={index}
            rows={index.orderReservations.get(order.id) || []}
            onDetail={onDetail}
          />
        </>
      ) : (
        <div className="genealogy-operations">
          {operations.map((operation, position) => {
            const sample = order.samples.find((row) => row.operationId === operation.id);
            return (
              <div className="genealogy-operation" key={operation.id}>
                <span className={`genealogy-operation-number ${sample ? 'done' : ''}`}>
                  {String(position + 1).padStart(2, '0')}
                </span>
                <div>
                  <strong>{operation.name}</strong>
                  <small>
                    {operation.equipment || 'Без оборудования'}
                    {sample?.time ? ` · ${dateTime(sample.time)}` : ''}
                  </small>
                </div>
                {sample ? (
                  <button
                    className="text-button"
                    onClick={() => onRecord({ orderId: order.id, index: position })}
                  >
                    Результаты
                    <ChevronRight size={13} />
                  </button>
                ) : (
                  <span className="genealogy-operation-state">
                    {order.status === 'reinspection' && position === order.stage
                      ? 'Реинспекция'
                      : position === order.stage
                        ? 'Не завершена'
                        : 'Ожидает'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {order.holdReason && <p className="warning-banner">{order.holdReason}</p>}
      <div className="genealogy-inspector-actions">
        <button className="button secondary compact" onClick={() => onDetail(order.id)}>
          Карточка заказа
          <ArrowRight size={14} />
        </button>
      </div>
    </>
  );
}

function ShipmentDetail({ index, shipment, onInspect }) {
  const lot = index.lots.get(shipment.lotId);
  return (
    <>
      <div className="genealogy-metrics">
        <div>
          <span>Отгружено</span>
          <strong>{quantity(shipment.qty, shipment.unit || unitOf(index, lot))}</strong>
        </div>
      </div>
      <dl className="genealogy-properties">
        <Fact label="Получатель">{shipment.customer}</Fact>
        <Fact label="Дата и время">{dateTime(shipment.time)}</Fact>
      </dl>
      <section className="genealogy-detail-section">
        <h4>Отгруженная партия</h4>
        <LotRows
          index={index}
          rows={[
            {
              lot,
              code: shipment.lotCode || shipment.lotId,
              qty: shipment.qty,
              unit: shipment.unit,
            },
          ]}
          onInspect={onInspect}
        />
      </section>
    </>
  );
}

export function GenealogyWorkspace({
  store,
  act,
  busy,
  index,
  selection,
  onBack,
  onSelect: onTrace,
  onDetail,
}) {
  const [direction, setDirection] = useState(selection.direction || 'backward');
  const graph = useMemo(
    () => buildTrace(index, selection, direction),
    [index, selection.type, selection.id, direction],
  );
  const tree = useMemo(
    () => buildTraceTree(index, selection, direction),
    [index, selection.type, selection.id, direction],
  );
  const [activeState, setActive] = useState(null);
  const [treeState, setTreeState] = useState(null);
  const [query, setQuery] = useState('');
  const [record, setRecord] = useState(null);
  const detailRef = useRef(null);
  const context = `${selection.type}/${selection.id}/${direction}`;
  const active = activeState?.context === context ? activeState.node : tree.nodes[0];
  const expanded =
    treeState?.context === context
      ? treeState.expanded
      : new Set(
          tree.nodes
            .filter((node) => node.depth < 8 && node.children.length)
            .map((node) => node.key),
        );
  const setExpanded = (update) =>
    setTreeState({ context, expanded: typeof update === 'function' ? update(expanded) : update });
  const selectNode = (node) => {
    setActive({ context, node });
    if (detailRef.current) detailRef.current.scrollTop = 0;
    if (window.matchMedia('(max-width: 760px)').matches)
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      );
  };
  const inspect = (type, id) => {
    const key = tree.first.get(`${type}/${id}`);
    const node = tree.byKey.get(key) || {
      type,
      id,
      record:
        type === 'lot'
          ? index.lots.get(id)
          : type === 'order'
            ? index.orders.get(id)
            : index.shipmentRecords.get(id),
    };
    selectNode(node);
    if (key) {
      const next = new Set(expanded);
      let parent = tree.byKey.get(node.parentKey);
      while (parent) {
        next.add(parent.key);
        parent = tree.byKey.get(parent.parentKey);
      }
      setExpanded(next);
      setQuery('');
      if (!window.matchMedia('(max-width: 760px)').matches)
        requestAnimationFrame(() =>
          document
            .querySelector(`[data-node="${key}"]`)
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
        );
    }
  };
  const root = tree.nodes[0];
  const rootRecord = root.record;
  const activeRecord =
    active.type === 'lot'
      ? index.lots.get(active.id)
      : active.type === 'order'
        ? index.orders.get(active.id)
        : active.record;
  const activeOrder =
    active.type === 'order' ? activeRecord : index.orders.get(activeRecord?.orderId);
  const blocked =
    activeRecord?.status === 'blocked' || (activeOrder && isOrderBlocked(store, activeOrder));
  const title = rootRecord.code;
  const trace = (value, mode) => {
    if (value.type === selection.type && value.id === selection.id) {
      setDirection(mode);
      setQuery('');
      setActive(null);
    } else onTrace(value, mode);
  };
  const exportLinks = () =>
    exportCsv(`Генеалогия ${title}.csv`, [
      [
        'Исследуемый объект',
        'Направление',
        'Исходная партия',
        'MTU',
        'Материал',
        'Количество списания',
        'Ед.',
        'Заказ',
        'Процесс',
        'Получатель',
        'Дата отгрузки',
        'Количество отгрузки',
      ],
      ...graph.edges.map((edge) => {
        const lot = index.lots.get(edge.lotId),
          order = index.orders.get(edge.orderId);
        return [
          title,
          direction === 'backward' ? 'Происхождение' : 'Использование',
          lot?.code || edge.code,
          lot?.mtuCode || lot?.code,
          nameOf(index, lot),
          edge.qty,
          unitOf(index, lot),
          order.code,
          recipeOf(order).name,
          '',
          '',
          '',
        ];
      }),
      ...graph.shipments.map((shipment) => {
        const lot = index.lots.get(shipment.lotId);
        return [
          title,
          direction === 'backward' ? 'Происхождение' : 'Использование',
          lot?.code || shipment.lotCode,
          lot?.mtuCode || lot?.code,
          nameOf(index, lot),
          '',
          shipment.unit || unitOf(index, lot),
          '',
          '',
          shipment.customer,
          dateTime(shipment.time),
          shipment.qty,
        ];
      }),
    ]);
  return (
    <div className="genealogy-workspace">
      <div className="genealogy-navigation">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={15} />К списку партий и заказов
        </button>
        <div>
          <button
            className="button secondary compact"
            onClick={exportLinks}
            disabled={!graph.edges.length && !graph.shipments.length}
          >
            <Download size={14} />
            Выгрузить связи
          </button>
          <button className="button secondary compact" onClick={() => window.print()}>
            <Printer size={14} />
            Печать
          </button>
        </div>
      </div>
      <header className="genealogy-heading">
        <div>
          <span>{root.type === 'lot' ? 'Генеалогия партии' : 'Генеалогия заказа'}</span>
          <h2>{title}</h2>
          <p>{nodeTitle(index, root)}</p>
        </div>
        <Badge status={rootRecord.status}>
          {root.type === 'lot' ? labels[rootRecord.status] || rootRecord.status : undefined}
        </Badge>
      </header>
      <div className="genealogy-chain-toolbar">
        <div className="segmented genealogy-direction" aria-label="Направление прослеживаемости">
          <button
            className={direction === 'backward' ? 'active' : ''}
            aria-pressed={direction === 'backward'}
            onClick={() => {
              setDirection('backward');
              setQuery('');
            }}
          >
            Происхождение
          </button>
          <button
            className={direction === 'forward' ? 'active' : ''}
            aria-pressed={direction === 'forward'}
            onClick={() => {
              setDirection('forward');
              setQuery('');
            }}
          >
            Использование
          </button>
        </div>
        <span className="genealogy-chain-count">
          {count(graph.orders.length, ['заказ', 'заказа', 'заказов'])} ·{' '}
          {count(graph.lotIds.size, ['партия', 'партии', 'партий'])}
          {graph.shipments.length
            ? ` · ${count(graph.shipments.length, ['отгрузка', 'отгрузки', 'отгрузок'])}`
            : ''}
        </span>
      </div>
      <p className="genealogy-direction-help">
        {direction === 'backward'
          ? 'От выбранного объекта к исходному сырью. Раскройте заказ, чтобы увидеть его состав.'
          : 'От выбранного объекта к выпущенным партиям и получателям. Только фактическое движение.'}
      </p>
      {(graph.cyclic || graph.missing.length > 0 || graph.brokenProducers.length > 0) && (
        <p className="warning-banner" role="status">
          {graph.cyclic ? 'Найдены циклические связи. Повторные узлы показаны ссылками. ' : ''}
          {graph.missing.length || graph.brokenProducers.length
            ? 'Часть исходных записей не найдена. Показаны доступные связи.'
            : ''}
        </p>
      )}
      <div className="genealogy-explorer">
        <TraceTree
          key={context}
          {...{ index, tree, active, expanded, setExpanded, query, setQuery }}
          onSelect={selectNode}
        />
        <section
          className="genealogy-inspector"
          ref={detailRef}
          aria-label="Подробности выбранного узла"
        >
          <button
            className="text-button genealogy-mobile-back"
            onClick={() =>
              document
                .querySelector('.genealogy-tree-pane')
                ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            }
          >
            <ArrowLeft size={13} />К дереву связей
          </button>
          <header className="genealogy-inspector-header">
            <div className="genealogy-inspector-kicker">
              <span>
                <NodeIcon type={active.type} />
                {active.type === 'lot'
                  ? 'Партия'
                  : active.type === 'order'
                    ? 'Производственный заказ'
                    : 'Отгрузка'}
                {!active.key ? ' · вне текущей цепочки' : ''}
              </span>
              {activeRecord?.status && (
                <Badge status={activeRecord.status}>
                  {active.type === 'lot'
                    ? labels[activeRecord.status] || activeRecord.status
                    : undefined}
                </Badge>
              )}
            </div>
            <h3>{nodeTitle(index, { ...active, record: activeRecord })}</h3>
            {active.type !== 'shipment' && <p>{activeRecord?.code || active.code || active.id}</p>}
          </header>
          {blocked && (
            <p className="warning-banner">
              Партия или исходное сырьё заблокированы. Отгрузка связанного выпуска запрещена.
            </p>
          )}
          {active.reference && (
            <p className="genealogy-reference-note">
              <Link2 size={14} />
              Этот узел встречается в нескольких ветвях.
              <button className="text-button" onClick={() => inspect(active.type, active.id)}>
                К первому появлению
              </button>
            </p>
          )}
          {!activeRecord ? (
            <Empty
              title="Исходная запись не найдена"
              text="Связь сохранена в учёте, но сведения об объекте недоступны."
            />
          ) : active.type === 'lot' ? (
            <LotDetail
              key={`lot/${active.id}`}
              index={index}
              lot={activeRecord}
              {...{ direction, onDetail, store, act, busy }}
              onInspect={inspect}
              onTrace={trace}
            />
          ) : active.type === 'order' ? (
            <OrderDetail
              key={`order/${active.id}`}
              index={index}
              graph={graph}
              order={activeRecord}
              onInspect={inspect}
              onDetail={onDetail}
              onRecord={setRecord}
            />
          ) : (
            <ShipmentDetail index={index} shipment={activeRecord} onInspect={inspect} />
          )}
          {activeRecord &&
            active.type !== 'shipment' &&
            (active.type !== selection.type || active.id !== selection.id) && (
              <button
                className="text-button genealogy-open-trace"
                onClick={() => onTrace({ type: active.type, id: active.id }, direction)}
              >
                Открыть отдельную цепочку
                <ArrowRight size={14} />
              </button>
            )}
        </section>
      </div>
      <div className="genealogy-print-summary">
        <h3>Все связи исследования · {graph.edges.length}</h3>
        {graph.edges.map((edge) => (
          <p key={`${edge.orderId}/${edge.lotId}`}>
            {index.lots.get(edge.lotId)?.code || edge.code} → {index.orders.get(edge.orderId)?.code}{' '}
            · {quantity(edge.qty, unitOf(index, index.lots.get(edge.lotId)))}
          </p>
        ))}
        {graph.orders.map((order) => (
          <p key={order.id}>
            {order.code} →{' '}
            {graph
              .outputsFor(order.id)
              .map((lot) => `${lot.code} (${quantity(lot.qty, unitOf(index, lot))})`)
              .join(', ') || 'Выпуск ещё не зарегистрирован'}
          </p>
        ))}
        {graph.shipments.map((shipment) => (
          <p key={shipment.id}>
            {index.lots.get(shipment.lotId)?.code || shipment.lotCode} → {shipment.customer} ·{' '}
            {quantity(shipment.qty, shipment.unit || unitOf(index, index.lots.get(shipment.lotId)))}{' '}
            · {dateTime(shipment.time)}
          </p>
        ))}
      </div>
      {record && (
        <Modal title="Результаты операции" wide onClose={() => setRecord(null)}>
          <div className="modal-content">
            <OperationRecord order={index.orders.get(record.orderId)} index={record.index} />
          </div>
        </Modal>
      )}
    </div>
  );
}
