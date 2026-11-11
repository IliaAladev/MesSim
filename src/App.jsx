import React, { useState, useRef, useEffect } from 'react';
import './demo.css';
import { DispatchView } from './DispatchView.jsx';
import { EventsView, ShipmentsView, ReportsView } from './HistoryViews.jsx';
import { Pagination, usePagination, inPeriod } from './registries.jsx';
import { readDemo, writeDemo } from './demoPersistence.js';
import { operationTaskId, qualityPending } from './operatorTasks.js';
import { CURRENT_USER } from './identity.js';
import { Folder, House, ChevronRight, PanelLeftClose, Menu, Settings, X } from 'lucide-react';
import {
  seedState,
  transition,
  recipeOf,
  operationOf,
  operationsOf,
  orderUnit,
  statusLabels,
} from './domain.js';
import { DEMO_SELECTION_KEY, demos, demoOf } from './demoStorage.js';
import {
  Badge,
  Product,
  StageProgress,
  Modal,
  Field,
  IconButton,
  SectionHead,
  Empty,
  fmt,
  dateFmt,
  exportCsv,
} from './ui.jsx';
import {
  CreateOrder,
  OrderDrawer,
  OperatorView,
  QualityView,
  LotsView,
  ReceiveLot,
  FinishedView,
  GenealogyView,
  MasterView,
} from './views.jsx';

const pages = {
  dispatch: { name: 'Диспетчерская', group: 'Производство' },
  orders: { name: 'Производственные заказы', group: 'Производство' },
  operator: { name: 'Рабочее место оператора', group: 'Производство' },
  lots: { name: 'Сырьё и материалы', group: 'Склады и отгрузки' },
  productionLots: { name: 'Межцеховые партии', group: 'Склады и отгрузки' },
  finished: { name: 'Готовая продукция', group: 'Склады и отгрузки' },
  shipments: { name: 'Отгрузки', group: 'Склады и отгрузки' },
  quality: { name: 'Контроль качества', group: 'Качество' },
  genealogy: { name: 'Генеалогия партий', group: 'Учёт и отчёты' },
  events: { name: 'Журнал событий', group: 'Учёт и отчёты' },
  reports: { name: 'Производственные отчёты', group: 'Учёт и отчёты' },
  master: { name: 'Справочники', group: 'НСИ' },
};
const groups = [
  { name: 'Производство', items: ['dispatch', 'orders', 'operator'] },
  { name: 'Склады и отгрузки', items: ['lots', 'productionLots', 'finished', 'shipments'] },
  { name: 'Качество', items: ['quality'] },
  { name: 'Учёт и отчёты', items: ['genealogy', 'events', 'reports'] },
  { name: 'НСИ', items: ['master'] },
];
const freshFilters = () => ({ line: '', status: '', recipe: '', from: '', to: '' });
const statusRank = {
  running: 0,
  hold: 1,
  reinspection: 1,
  waiting: 2,
  queued: 3,
  quality: 3,
  ready: 4,
  planned: 5,
  completed: 6,
};
async function loadData() {
  let scenarioId = 'agro';
  try {
    scenarioId = demoOf(localStorage.getItem(DEMO_SELECTION_KEY)).id;
    return { state: await readDemo(scenarioId), error: '' };
  } catch (e) {
    return {
      state: seedState(scenarioId),
      error: `Сохранённые данные не загружены: ${e.message}. Исходное сохранение не изменено.`,
    };
  }
}

export default function App() {
  const [initial, setInitial] = useState(null);
  useEffect(() => {
    let active = true;
    loadData().then((value) => {
      if (active) setInitial(value);
    });
    return () => {
      active = false;
    };
  }, []);
  if (!initial)
    return (
      <div className="app-loading" role="status">
        Загрузка данных MES…
      </div>
    );
  return <MESApp initial={initial} />;
}

function MESApp({ initial }) {
  const [store, setStore] = useState(initial.state),
    [loadError, setLoadError] = useState(initial.error),
    [saveError, setSaveError] = useState(false);
  const storeRef = useRef(store),
    persistedRef = useRef(initial.state),
    busyRef = useRef(false);
  const [page, setPage] = useState('dispatch'),
    [expanded, setExpanded] = useState('Производство'),
    [sidebar, setSidebar] = useState(true),
    [mobileNav, setMobileNav] = useState(false);
  const [filters, setFilters] = useState(freshFilters),
    [filterOpen, setFilterOpen] = useState(false),
    [query, setQuery] = useState(''),
    [tab, setTab] = useState('all');
  const [detail, setDetail] = useState(null),
    [operatorId, setOperatorId] = useState(null),
    [traceId, setTraceId] = useState(null),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(null);
  const [masterDirty, setMasterDirty] = useState(false),
    [pendingPage, setPendingPage] = useState(null);
  useEffect(() => {
    storeRef.current = store;
    if (loadError || persistedRef.current === store) return;
    let active = true;
    writeDemo(store)
      .then(() => {
        persistedRef.current = store;
        if (active) setSaveError(false);
      })
      .catch(() => {
        if (active) setSaveError(true);
      });
    return () => {
      active = false;
    };
  }, [store, loadError]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = (message, error = false) => setToast({ message, error });
  async function act(action, message) {
    if (busyRef.current) return false;
    if (loadError) {
      notify('Сначала восстановите сохранённые данные или сбросьте демо в настройках', true);
      return false;
    }
    busyRef.current = true;
    setBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 140));
    try {
      const next = transition(storeRef.current, action);
      await writeDemo(next);
      persistedRef.current = next;
      storeRef.current = next;
      setStore(next);
      if (message) notify(message);
      return true;
    } catch (e) {
      notify(e.message, true);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function navigate(next, force = false) {
    if (page === 'master' && masterDirty && next !== 'master' && !force) {
      setPendingPage(next);
      setModal('leave-master');
      return false;
    }
    setPage(next);
    setExpanded(pages[next].group);
    setMobileNav(false);
    setQuery('');
    setTab('all');
    setDetail(null);
    setFilterOpen(false);
    if (next === 'operator') setOperatorId(null);
    window.scrollTo({ top: 0, behavior: 'instant' });
    return true;
  }
  function openOperator(id) {
    const order = storeRef.current.orders.find((o) => o.id === id);
    if (order && qualityPending(order)) {
      navigate('quality');
      return;
    }
    navigate('operator');
    setOperatorId(order ? operationTaskId(order, operationOf(order)) : null);
  }
  function trace(id) {
    setTraceId(id);
    navigate('genealogy');
  }
  const shared = {
    store,
    act,
    busy,
    notify,
    openOperator,
    trace,
    onDetail: setDetail,
    onDirty: setMasterDirty,
  };
  const attention =
    store.orders.filter(qualityPending).length +
    store.lots.filter((l) => l.status === 'quarantine').length;
  const orders = store.orders
    .filter(
      (o) =>
        (!filters.line || o.line === filters.line) &&
        (!filters.status || o.status === filters.status) &&
        (!filters.recipe || o.recipe === filters.recipe) &&
        inPeriod(o.date, filters.from, filters.to) &&
        `${o.code} ${recipeOf(o).name}`.toLowerCase().includes(query.toLowerCase()) &&
        (tab === 'all' ||
          (tab === 'active' &&
            ['running', 'hold', 'waiting', 'queued', 'ready', 'reinspection'].includes(o.status)) ||
          (tab === 'completed' && o.status === 'completed') ||
          (tab === 'attention' && (qualityPending(o) || ['hold', 'waiting'].includes(o.status)))),
    )
    .sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        (store.scenarioId === 'agro' ? a.seq - b.seq : b.seq - a.seq),
    );
  const orderPagination = usePagination(orders, JSON.stringify([filters, query, tab]));
  const activeFilters = Object.entries(filters).filter(([, value]) => value);
  const exportOrders = () =>
    exportCsv('Производственные заказы.csv', [
      ['Заказ', 'Процесс', 'Версия', 'План', 'Факт', 'Ед.', 'Статус', 'Дата'],
      ...orders.map((o) => [
        o.code,
        recipeOf(o).name,
        recipeOf(o).revision,
        o.qty,
        o.actual,
        orderUnit(o),
        statusLabels[o.status],
        o.date,
      ]),
    ]);
  return (
    <div className={`app ${sidebar ? '' : 'nav-collapsed'}`}>
      <header className="topbar">
        <button className="brand" onClick={() => navigate('dispatch')}>
          <span className="brand-symbol">✦</span>
          <span>MES Пищевое производство</span>
        </button>
        <span className="top-context">
          {store.structure.find((n) => n.type === 'site')?.name || 'Производственная площадка'}
        </span>
        <div className="top-tools">
          <IconButton icon={Settings} label="Настройки" onClick={() => setModal('settings')} />
          <span className="user-name">{CURRENT_USER.name}</span>
        </div>
      </header>
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="sidebar-home">
          <button onClick={() => navigate('dispatch')}>
            <House size={15} />
            <span>Производство</span>
          </button>
          <IconButton
            icon={PanelLeftClose}
            label="Свернуть меню"
            onClick={() => {
              setSidebar(!sidebar);
              setMobileNav(false);
            }}
          />
        </div>
        <nav>
          {groups.map((group) => (
            <div
              className={`nav-group ${expanded === group.name ? 'expanded' : ''}`}
              key={group.name}
            >
              <button
                className={`nav-parent ${pages[page].group === group.name ? 'selected' : ''}`}
                title={group.name}
                onClick={() => {
                  if (!sidebar) setSidebar(true);
                  setExpanded(expanded === group.name ? '' : group.name);
                }}
              >
                <Folder size={16} strokeWidth={1.4} />
                <span>{group.name}</span>
                {group.name === 'Качество' && attention > 0 && (
                  <b className="nav-count">{attention}</b>
                )}
                <ChevronRight className="nav-chevron" size={13} />
              </button>
              {expanded === group.name && (
                <div className="nav-children">
                  {group.items.map((id) => (
                    <button
                      key={id}
                      className={page === id ? 'active' : ''}
                      onClick={() => navigate(id)}
                    >
                      {pages[id].name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>
      {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} />}
      <main className="main">
        <div className="breadcrumb-bar">
          <div className="breadcrumbs">
            <IconButton
              icon={Menu}
              label="Открыть меню"
              className="mobile-menu"
              onClick={() => setMobileNav(!mobileNav)}
            />
            {!sidebar && (
              <IconButton icon={Menu} label="Развернуть меню" onClick={() => setSidebar(true)} />
            )}
            <span>{pages[page].group}</span>
            <ChevronRight size={11} />
            <strong>{pages[page].name}</strong>
          </div>
          <div className="shift-indicator">
            <span>22 октября 2026</span>
            <span className="shift-pill">Смена 1 · 08:00–20:00</span>
          </div>
        </div>
        {(loadError || saveError) && (
          <div className="storage-warning">
            {loadError ||
              'Хранилище браузера недоступно. Изменения сохраняются только в текущем сеансе.'}
          </div>
        )}
        <div className="workspace">
          <div className="page-heading">
            <h1>{pages[page].name}</h1>
            <div className="heading-actions">
              {page === 'orders' && (
                <button className="button primary" onClick={() => setModal('create')}>
                  Создать заказ
                </button>
              )}
              {page === 'lots' && (
                <button className="button primary" onClick={() => setModal('receive')}>
                  Приёмка
                </button>
              )}
            </div>
          </div>
          {page === 'dispatch' && <DispatchView {...shared} navigate={navigate} />}
          {page === 'events' && <EventsView {...shared} />}
          {page === 'shipments' && <ShipmentsView {...shared} />}
          {page === 'reports' && <ReportsView {...shared} />}
          {page === 'orders' && (
            <section className="orders-section">
              <SectionHead
                title="Производственные заказы"
                meta={`${orders.length} из ${store.orders.length}`}
              >
                <button className="button secondary compact" onClick={exportOrders}>
                  Выгрузить
                </button>
                <button
                  className={`button compact ${filterOpen ? 'filter-active' : 'secondary'}`}
                  onClick={() => setFilterOpen(!filterOpen)}
                >
                  Фильтры{activeFilters.length > 0 ? ` · ${activeFilters.length}` : ''}
                </button>
              </SectionHead>
              <div className="table-toolbar">
                <div className="tabs">
                  {[
                    ['all', 'Все заказы'],
                    ['active', 'В работе'],
                    ['attention', 'Требуют внимания'],
                    ['completed', 'Завершённые'],
                  ].map(([id, name]) => (
                    <button
                      key={id}
                      className={tab === id ? 'active' : ''}
                      onClick={() => setTab(id)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <input
                  className="registry-search"
                  aria-label="Поиск заказов"
                  placeholder="Номер заказа или процесс"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {activeFilters.length > 0 && (
                <div className="filter-chips">
                  {activeFilters.map(([key, value]) => (
                    <button key={key} onClick={() => setFilters({ ...filters, [key]: '' })}>
                      {key === 'line'
                        ? store.lines.find((l) => l.id === value)?.name
                        : key === 'recipe'
                          ? store.processes.find((p) => p.id === value)?.name
                          : key === 'from' || key === 'to'
                            ? `${key === 'from' ? 'С' : 'По'} ${dateFmt(value)}`
                            : statusLabels[value]}
                      <X size={11} />
                    </button>
                  ))}
                  <button onClick={() => setFilters(freshFilters())}>Сбросить</button>
                </div>
              )}
              <div className="table-scroll">
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th>Заказ</th>
                      <th>Процесс</th>
                      <th
                        className="numeric"
                        title="План и факт по основному выпускаемому материалу"
                      >
                        План / факт
                      </th>
                      <th>Статус</th>
                      <th>Линия</th>
                      <th>Время</th>
                      <th>Исполнение</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {orderPagination.rows.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <button className="order-link" onClick={() => setDetail(o.id)}>
                            {o.code}
                          </button>
                          {o.priority === 'high' && <small>Высокий приоритет</small>}
                        </td>
                        <td>
                          <Product order={o} compact />
                          <small>
                            {recipeOf(o).code} · версия {recipeOf(o).revision}
                          </small>
                        </td>
                        <td className="numeric">
                          {fmt(o.qty, 3)} / {fmt(o.actual, 3)} {orderUnit(o)}
                        </td>
                        <td>
                          <Badge status={o.status} />
                        </td>
                        <td>{store.lines.find((l) => l.id === o.line)?.name}</td>
                        <td className="time-cell">
                          <small>{dateFmt(o.date)}</small>
                          {o.start}–{o.due}
                        </td>
                        <td>
                          <StageProgress order={o} />
                          <small>
                            {o.status === 'completed'
                              ? 'Завершено'
                              : o.status === 'planned' || o.status === 'ready'
                                ? 'Ожидает запуска'
                                : operationOf(o).name}
                          </small>
                        </td>
                        <td>
                          <button className="text-button" onClick={() => setDetail(o.id)}>
                            Открыть
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!orders.length && <Empty />}
              </div>
              <Pagination state={orderPagination} />
            </section>
          )}
          {page === 'operator' && (
            <OperatorView {...shared} selectedId={operatorId} setSelectedId={setOperatorId} />
          )}
          {page === 'quality' && <QualityView {...shared} />}
          {page === 'lots' && <LotsView {...shared} />}
          {['finished', 'productionLots'].includes(page) && (
            <FinishedView key={page} {...shared} production={page === 'productionLots'} />
          )}
          {page === 'genealogy' && (
            <GenealogyView {...shared} selectedId={traceId} setSelectedId={setTraceId} />
          )}
          {page === 'master' && <MasterView {...shared} />}
        </div>
      </main>
      {filterOpen && (
        <aside className="filter-panel">
          <header>
            <h3>Фильтр</h3>
            <IconButton icon={X} label="Закрыть фильтры" onClick={() => setFilterOpen(false)} />
          </header>
          <Field label="Плановая дата с">
            <input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </Field>
          <Field label="Плановая дата по">
            <input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </Field>
          <Field label="Производственная линия">
            <select
              value={filters.line}
              onChange={(e) => setFilters({ ...filters, line: e.target.value })}
            >
              <option value="">Все линии</option>
              {store.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Статус заказа">
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Все статусы</option>
              {Object.entries(statusLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Процесс">
            <select
              value={filters.recipe}
              onChange={(e) => setFilters({ ...filters, recipe: e.target.value })}
            >
              <option value="">Все процессы</option>
              {store.processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <button className="button secondary" onClick={() => setFilters(freshFilters())}>
            Сбросить фильтры
          </button>
        </aside>
      )}
      {detail && store.orders.some((o) => o.id === detail) && (
        <OrderDrawer
          {...shared}
          order={store.orders.find((o) => o.id === detail)}
          onClose={() => setDetail(null)}
        />
      )}
      {modal === 'create' && <CreateOrder {...shared} onClose={() => setModal(null)} />}
      {modal === 'receive' && <ReceiveLot {...shared} onClose={() => setModal(null)} />}
      {modal === 'settings' && (
        <Modal title="Настройки демо" onClose={() => setModal(null)}>
          <div className="modal-content">
            <p>Изменения НСИ и производственные данные сохраняются в этом браузере.</p>
            <div className="demo-choices" role="group" aria-label="Демонстрационный сценарий">
              {demos.map((demo) => (
                <button
                  key={demo.id}
                  className={`demo-choice ${demo.id === (store.scenarioId || 'dairy') ? 'active' : ''}`}
                  aria-pressed={demo.id === (store.scenarioId || 'dairy')}
                  disabled={busy || masterDirty}
                  onClick={async () => {
                    if (demo.id === (store.scenarioId || 'dairy') || busyRef.current) return;
                    busyRef.current = true;
                    setBusy(true);
                    try {
                      if (!loadError) await writeDemo(storeRef.current);
                      const next = await readDemo(demo.id);
                      localStorage.setItem(DEMO_SELECTION_KEY, demo.id);
                      storeRef.current = next;
                      setStore(next);
                      setLoadError('');
                      setSaveError(false);
                      setFilters(freshFilters());
                      setTraceId(null);
                      setOperatorId(null);
                      setMasterDirty(false);
                      setModal(null);
                      navigate('dispatch', true);
                      notify(`Открыто демо «${demo.name}»`);
                    } catch (e) {
                      notify(
                        `Не удалось переключить демо: ${e.message}. Сохранения не заменены.`,
                        true,
                      );
                    } finally {
                      busyRef.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  <strong>{demo.name}</strong>
                  <span>{demo.description}</span>
                  <small>
                    {demo.id === (store.scenarioId || 'dairy') ? 'Выбрано' : 'Открыть сценарий →'}
                  </small>
                </button>
              ))}
            </div>
            <p className="plain-note">
              У каждого демо своё сохранение. При переключении заказы, НСИ и результаты сохраняются.
            </p>
            {masterDirty && (
              <p className="editor-error">
                Сохраните или отмените изменения в редакторе перед сменой сценария.
              </p>
            )}
            <button className="button danger reset-button" onClick={() => setModal('reset')}>
              Сбросить текущее демо
            </button>
          </div>
        </Modal>
      )}
      {modal === 'reset' && (
        <Modal title="Сброс данных" onClose={() => setModal(null)}>
          <div className="modal-content">
            <p>
              Будут удалены созданные процессы, материалы, оборудование, заказы и результаты
              операций в демо «{demoOf(store.scenarioId).name}». Начальные данные этого сценария
              восстановятся. Второе демо сохранится.
            </p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              Отмена
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                if (busyRef.current) return;
                busyRef.current = true;
                setBusy(true);
                try {
                  const next = seedState(store.scenarioId);
                  await writeDemo(next);
                  persistedRef.current = next;
                  storeRef.current = next;
                  setStore(next);
                  setLoadError('');
                  setFilters(freshFilters());
                  setModal(null);
                  navigate('dispatch', true);
                  notify('Начальные данные восстановлены');
                } catch (error) {
                  notify(`Не удалось сбросить демо: ${error.message}`, true);
                } finally {
                  busyRef.current = false;
                  setBusy(false);
                }
              }}
            >
              Сбросить
            </button>
          </div>
        </Modal>
      )}
      {modal === 'leave-master' && (
        <Modal title="Несохранённые изменения процесса" onClose={() => setModal(null)}>
          <div className="modal-content">
            <p>
              Изменения процесса ещё не сохранены. Вернитесь к редактору, чтобы сохранить черновик
              или опубликовать версию.
            </p>
          </div>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => {
                setModal(null);
                setMasterDirty(false);
                navigate(pendingPage, true);
              }}
            >
              Выйти без сохранения
            </button>
            <button className="button primary" onClick={() => setModal(null)}>
              Продолжить редактирование
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          <span>{toast.message}</span>
          <IconButton icon={X} label="Скрыть сообщение" onClick={() => setToast(null)} />
        </div>
      )}
    </div>
  );
}
