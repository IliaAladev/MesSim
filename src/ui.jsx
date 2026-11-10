import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { recipeOf, statusLabels, operationsOf } from './domain.js';
import { dateTime } from './registries.jsx';

export const fmt = (n, digits = 0) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n);
export const dateFmt = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU');
export const timeFmt = (date) =>
  new Date(date).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Samara',
  });
export function IconButton({ icon: Icon, label, className = '', ...props }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      <Icon size={17} strokeWidth={1.6} />
    </button>
  );
}
export function Badge({ status, children }) {
  return <span className={`badge ${status}`}>{children || statusLabels[status] || status}</span>;
}
export function Product({ order, compact = false }) {
  const r = recipeOf(order);
  return (
    <span className={`product ${compact ? 'compact' : ''}`}>
      <span>
        <strong>{r.name}</strong>
      </span>
    </span>
  );
}
export function StageProgress({ order }) {
  const complete = order.status === 'completed';
  const operations = operationsOf(order);
  const percent = Math.round((order.samples.length / operations.length) * 100);
  return (
    <div className="stage-progress">
      <div className="stage-bars">
        {operations.map((s, i) => (
          <span
            key={s.id}
            title={s.name}
            className={
              complete || i < order.stage
                ? 'done'
                : i === order.stage && ['running', 'hold', 'quality'].includes(order.status)
                  ? 'current'
                  : ''
            }
          />
        ))}
      </div>
      <span>{percent}%</span>
    </div>
  );
}
export function Empty({ title = 'Ничего не найдено', text = 'Измените условия поиска', children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const els = ref.current.querySelectorAll(
          'button:not(:disabled), input, select, textarea, [tabindex="0"]',
        );
        if (!els.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''}`}
      >
        <header>
          <h2>{title}</h2>
          <IconButton icon={X} label="Закрыть окно" onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}
export function Field({ label, children, hint, className = '' }) {
  const Tag =
    React.isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type)
      ? 'label'
      : 'div';
  return (
    <Tag className={`field ${className}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </Tag>
  );
}
export function SectionHead({ title, meta, children }) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {meta && <span className="meta">{meta}</span>}
      </div>
      <div className="row-actions">{children}</div>
    </div>
  );
}
export function EventList({ events, onOrder, limit = 5 }) {
  return (
    <div className="event-list">
      {events.slice(0, limit).map((event) => (
        <div className="event" key={event.id}>
          <time>{dateTime(event.time)}</time>
          {event.orderId ? (
            <button className="registry-text-link" onClick={() => onOrder(event.orderId)}>
              {event.message}
            </button>
          ) : (
            <span>{event.message}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function exportCsv(filename, rows) {
  const csv =
    '\uFEFF' +
    rows
      .map((row) => row.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(';'))
      .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
