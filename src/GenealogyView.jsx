import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { operationsOf, orderUnit } from './domain.js';
import { createTraceIndex, traceSearch, traceSelection, traceQuantity } from './genealogy.js';
import { RegistryFilters, Pagination } from './registries.jsx';
import { Badge, Empty, SectionHead, fmt, dateFmt } from './ui.jsx';
import { GenealogyWorkspace } from './GenealogyWorkspace.jsx';
import './genealogy.css';
const lotLabels = {
  released: 'Допущена',
  quarantine: 'Карантин',
  blocked: 'Заблокирована',
  inTransit: 'Ожидает приёмки',
};
const lotUnit = (index, lot) => lot?.unit || index.materials.get(lot?.material)?.unit || '';

function LotStatus({ lot }) {
  return <Badge status={lot.status}>{lotLabels[lot.status] || lot.status}</Badge>;
}

function TraceRegistry({ index, filters, setFilters, paging, setPaging, onSelect }) {
  const { type, query, from, to } = filters;
  const rows = useMemo(
    () => traceSearch(index, type, query, from, to),
    [index, type, query, from, to],
  );
  const pages = Math.max(1, Math.ceil(rows.length / paging.size));
  const current = Math.min(paging.page, pages);
  const page = {
    rows: rows.slice((current - 1) * paging.size, current * paging.size),
    page: current,
    pages,
    size: paging.size,
    total: rows.length,
    setPage: (page) => setPaging((previous) => ({ ...previous, page })),
    setSize: (size) => setPaging({ page: 1, size }),
  };
  const change = (values) => {
    setFilters((previous) => ({ ...previous, ...values }));
    setPaging((previous) => ({ ...previous, page: 1 }));
  };
  return (
    <section className="genealogy-registry">
      <div className="genealogy-registry-heading">
        <Search size={18} />
        <p>Найдите партию или заказ, чтобы открыть происхождение и дальнейшее использование.</p>
      </div>
      <div className="segmented genealogy-object-tabs" aria-label="Объекты прослеживаемости">
        <button
          aria-pressed={type === 'lot'}
          className={type === 'lot' ? 'active' : ''}
          onClick={() => change({ type: 'lot' })}
        >
          Партии и продукция
        </button>
        <button
          aria-pressed={type === 'order'}
          className={type === 'order' ? 'active' : ''}
          onClick={() => change({ type: 'order' })}
        >
          Производственные заказы
        </button>
      </div>
      <RegistryFilters
        {...{ query, from, to }}
        onQuery={(query) => change({ query })}
        onFrom={(from) => change({ from })}
        onTo={(to) => change({ to })}
        placeholder="Партия, MTU, ПЗ, продукция, номер убоя или хозяйство"
      />
      <SectionHead
        title={type === 'lot' ? 'Партии и продукция' : 'Производственные заказы'}
        meta={`${rows.length} из ${index.rows[type].length}`}
      />
      <div className="table-scroll">
        <table className="data-table history-table genealogy-search-table">
          <thead>
            <tr>
              <th>{type === 'lot' ? 'Партия / MTU' : 'Заказ'}</th>
              <th>{type === 'lot' ? 'Материал / продукция' : 'Процесс'}</th>
              <th>Дата</th>
              <th>{type === 'lot' ? 'Происхождение' : 'Выполнено операций'}</th>
              <th className="numeric">{type === 'lot' ? 'Принято / выпущено' : 'План / факт'}</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <button className="order-link" onClick={() => onSelect({ type, id: row.id })}>
                    {row.code}
                  </button>
                  {row.lot?.mtuCode && <small>MTU {row.lot.mtuCode}</small>}
                </td>
                <td>{row.name}</td>
                <td>{dateFmt(row.date)}</td>
                <td>
                  {type === 'lot' ? (
                    <>
                      {row.lot.supplier || row.order?.code || 'Источник не найден'}
                      {row.lot.mark && <small>№ убоя {row.lot.mark}</small>}
                    </>
                  ) : (
                    `${row.order.samples.length} из ${operationsOf(row.order).length}`
                  )}
                </td>
                <td className="numeric">
                  {type === 'lot' ? (
                    <>
                      {fmt(traceQuantity(index, row.lot), 3)} {lotUnit(index, row.lot)}
                    </>
                  ) : (
                    <>
                      {fmt(row.order.qty, 3)} / {fmt(row.order.actual, 3)} {orderUnit(row.order)}
                    </>
                  )}
                </td>
                <td>
                  {type === 'lot' ? (
                    <LotStatus lot={row.lot} />
                  ) : (
                    <Badge status={row.order.status} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <Empty title="Ничего не найдено" text="Измените поиск, период или тип объекта." />
        )}
      </div>
      <Pagination state={page} />
    </section>
  );
}

export function GenealogyView({ store, selectedId, setSelectedId, onDetail, act, busy }) {
  const index = useMemo(() => createTraceIndex(store), [store]);
  const selection = traceSelection(index, selectedId);
  const [filters, setFilters] = useState({ type: 'lot', query: '', from: '', to: '' });
  const [paging, setPaging] = useState({ page: 1, size: 25 });
  const select = (value, direction = 'backward') => {
    setSelectedId({ ...value, direction });
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  if (!selection)
    return (
      <TraceRegistry {...{ index, filters, setFilters, paging, setPaging }} onSelect={select} />
    );
  return (
    <GenealogyWorkspace
      key={`${selection.type}/${selection.id}/${selection.direction || 'backward'}`}
      store={store}
      act={act}
      busy={busy}
      index={index}
      selection={selection}
      onBack={() => setSelectedId(null)}
      onSelect={select}
      onDetail={onDetail}
    />
  );
}
