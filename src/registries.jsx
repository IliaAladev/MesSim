import React, { useEffect, useState } from 'react';

export const containsText = (query, ...values) =>
  values.join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'));

export function localDay(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Samara' }).format(date);
}

export const inPeriod = (value, from, to) => {
  const day = localDay(value);
  return (!from || day >= from) && (!to || day <= to);
};

export const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Europe/Samara',
      })
    : '—';

export function usePagination(rows, filterKey) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  useEffect(() => setPage(1), [filterKey, size]);
  useEffect(() => setPage((value) => Math.min(value, pages)), [pages]);
  return {
    rows: rows.slice((current - 1) * size, current * size),
    page: current,
    pages,
    size,
    setPage,
    setSize,
    total: rows.length,
  };
}

export function Pagination({ state }) {
  const { page, pages, size, total, setPage, setSize } = state;
  return (
    <div className="registry-pagination">
      <span>
        {total
          ? `${(page - 1) * size + 1}–${Math.min(page * size, total)} из ${total}`
          : '0 записей'}
      </span>
      <label>
        На странице
        <select
          aria-label="Записей на странице"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        >
          {[25, 50, 100].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <button
        className="button secondary compact"
        disabled={page === 1}
        onClick={() => setPage(page - 1)}
      >
        Назад
      </button>
      <span>
        {page} / {pages}
      </span>
      <button
        className="button secondary compact"
        disabled={page === pages}
        onClick={() => setPage(page + 1)}
      >
        Далее
      </button>
    </div>
  );
}

export function RegistryFilters({
  query,
  onQuery,
  from,
  onFrom,
  to,
  onTo,
  placeholder = 'Поиск',
  children,
}) {
  return (
    <div className="registry-filters">
      <input
        className="registry-search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {onFrom && (
        <label>
          С{' '}
          <input
            aria-label="Дата с"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onFrom(e.target.value)}
          />
        </label>
      )}
      {onTo && (
        <label>
          По{' '}
          <input
            aria-label="Дата по"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onTo(e.target.value)}
          />
        </label>
      )}
      {children}
    </div>
  );
}
