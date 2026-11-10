import React, { useState, useEffect } from 'react';
import { uid, materialKinds, validateProcess } from './domain.js';
import { Modal, Field, SectionHead } from './ui.jsx';
import { HierarchyView } from './Hierarchy.jsx';
import { ProcessEditor } from './ProcessEditor.jsx';
import { CounterpartiesView } from './Counterparties.jsx';

const blankProcess = (store) => ({
  id: uid(),
  code: `ПР-${String(store.processes.length + 1).padStart(3, '0')}`,
  name: '',
  description: '',
  revision: 1,
  lifecycle: 'draft',
  outputMaterial: '',
  baseQty: 1000,
  shelf: 21,
  operations: [],
});
const lifecycleLabels = { published: 'Опубликован', draft: 'Черновик', archived: 'Архив' };

export function MasterView({ store, act, busy, onDirty }) {
  const [tab, setTab] = useState('processes'),
    [query, setQuery] = useState(''),
    [showArchive, setShowArchive] = useState(false);
  const [editor, setEditor] = useState(null),
    [dialog, setDialog] = useState(null),
    [dirty, setDirty] = useState(false),
    [operationDirty, setOperationDirty] = useState(false),
    [leave, setLeave] = useState(null);
  const hasUnsaved = Boolean(editor && (dirty || operationDirty));
  useEffect(() => {
    onDirty?.(hasUnsaved);
    return () => onDirty?.(false);
  }, [hasUnsaved, onDirty]);
  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);
  const open = (process, copy = false) => {
    const value = structuredClone(process.draft || process);
    delete value.draft;
    if (copy) {
      value.id = uid();
      value.code = `ПР-${String(store.processes.length + 1).padStart(3, '0')}`;
      value.name += ' (копия)';
      value.revision = 1;
      value.lifecycle = 'draft';
    }
    setEditor(value);
    setDirty(copy);
  };
  const changeTab = (next) => {
    if (editor && dirty) {
      setLeave(next);
      return;
    }
    setEditor(null);
    setTab(next);
    setQuery('');
  };
  const closeEditor = () => {
    if (dirty) setLeave('processes');
    else setEditor(null);
  };
  const save = async (process, publish) => {
    if (publish) validateProcess(process, store);
    if (
      await act(
        { type: 'saveProcess', process, publish },
        publish ? 'Версия процесса опубликована' : 'Черновик сохранён',
      )
    ) {
      setDirty(false);
      if (publish) setEditor(null);
      else setEditor({ ...process, lifecycle: 'draft' });
      return true;
    }
    return false;
  };
  const matches = (value) => value.toLowerCase().includes(query.toLowerCase());
  return (
    <>
      <div className="view-tabs tabs">
        {[
          [
            'processes',
            'Процессы',
            store.processes.filter((p) => p.lifecycle !== 'archived').length,
          ],
          ['materials', 'Материалы', store.materials.length],
          ['equipment', 'Структура производства', store.equipment.length],
          ['counterparties', 'Поставщики и потребители', store.counterparties.length],
        ].map(([id, name, count]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => changeTab(id)}>
            {name}
            <span>{count}</span>
          </button>
        ))}
      </div>
      {tab === 'equipment' ? (
        <HierarchyView store={store} act={act} busy={busy} />
      ) : tab === 'counterparties' ? (
        <CounterpartiesView store={store} act={act} busy={busy} />
      ) : (
        <>
          <SectionHead
            title={
              tab === 'processes'
                ? 'Процессы'
                : tab === 'materials'
                  ? 'Справочник материалов'
                  : 'Справочник оборудования'
            }
          >
            <input
              className="registry-search"
              aria-label="Поиск в НСИ"
              placeholder="Код или наименование"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {tab === 'processes' && (
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={showArchive}
                  onChange={(e) => setShowArchive(e.target.checked)}
                />
                Архив
              </label>
            )}
            <button
              className="button primary"
              onClick={() => {
                if (tab === 'processes') {
                  setEditor(blankProcess(store));
                  setDirty(true);
                } else setDialog({ type: tab, value: null });
              }}
            >
              {tab === 'processes'
                ? 'Создать процесс'
                : tab === 'materials'
                  ? 'Создать материал'
                  : 'Добавить оборудование'}
            </button>
          </SectionHead>
          <div className="table-scroll">
            <table className="data-table master-registry">
              <thead>
                {tab === 'processes' ? (
                  <tr>
                    <th>Код</th>
                    <th>Наименование процесса</th>
                    <th>Выпускаемый материал</th>
                    <th>Версия</th>
                    <th>Операций</th>
                    <th>Состояние</th>
                    <th />
                  </tr>
                ) : tab === 'materials' ? (
                  <tr>
                    <th>Код</th>
                    <th>Наименование</th>
                    <th>Тип</th>
                    <th>Ед. изм.</th>
                    <th>Аллергены</th>
                    <th>Состояние</th>
                    <th />
                  </tr>
                ) : (
                  <tr>
                    <th>Код</th>
                    <th>Оборудование</th>
                    <th>Участок</th>
                    <th>Состояние</th>
                    <th />
                  </tr>
                )}
              </thead>
              <tbody>
                {tab === 'processes'
                  ? store.processes
                      .filter(
                        (p) =>
                          (showArchive || p.lifecycle !== 'archived') &&
                          matches(`${p.code} ${p.name}`),
                      )
                      .map((p) => (
                        <tr key={p.id}>
                          <td className="mono">{p.code}</td>
                          <td>
                            <button
                              className="order-link"
                              disabled={p.lifecycle === 'archived'}
                              onClick={() => open(p)}
                            >
                              {p.name}
                            </button>
                            {p.draft && <small>Есть неопубликованные изменения</small>}
                          </td>
                          <td>
                            {store.materials.find((m) => m.id === p.outputMaterial)?.name ||
                              'Не выбран'}
                          </td>
                          <td>{p.revision}</td>
                          <td>{p.operations.length}</td>
                          <td>
                            <span className={`lifecycle ${p.lifecycle}`}>
                              {lifecycleLabels[p.lifecycle]}
                            </span>
                          </td>
                          <td>
                            <div className="table-commands">
                              {p.lifecycle !== 'archived' && (
                                <button className="text-button" onClick={() => open(p)}>
                                  Редактировать
                                </button>
                              )}
                              <button className="text-button" onClick={() => open(p, true)}>
                                Копировать
                              </button>
                              {p.lifecycle !== 'archived' && (
                                <button
                                  className="text-button muted-command"
                                  onClick={() => setDialog({ type: 'archive', value: p })}
                                >
                                  В архив
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                  : tab === 'materials'
                    ? store.materials
                        .filter((m) => matches(`${m.code} ${m.name}`))
                        .map((m) => (
                          <tr key={m.id}>
                            <td className="mono">{m.code}</td>
                            <td className="strong">{m.name}</td>
                            <td>{materialKinds[m.kind]}</td>
                            <td>{m.unit}</td>
                            <td>{m.allergen || 'Не указаны'}</td>
                            <td>{m.active === false ? 'Не используется' : 'Действует'}</td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => setDialog({ type: 'materials', value: m })}
                              >
                                Изменить
                              </button>
                            </td>
                          </tr>
                        ))
                    : store.equipment
                        .filter((e) => matches(`${e.code} ${e.name}`))
                        .map((e) => (
                          <tr key={e.id}>
                            <td className="mono">{e.code}</td>
                            <td className="strong">{e.name}</td>
                            <td>{e.area || '—'}</td>
                            <td>{e.active ? 'Доступно' : 'Недоступно'}</td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => setDialog({ type: 'equipment', value: e })}
                              >
                                Изменить
                              </button>
                            </td>
                          </tr>
                        ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editor && (
        <ProcessEditor
          onPendingChange={setOperationDirty}
          key={editor.id}
          value={editor}
          store={store}
          busy={busy}
          onChange={(value) => {
            setEditor(value);
            setDirty(true);
          }}
          onSave={save}
          onBack={closeEditor}
          dirty={dirty}
        />
      )}
      {dialog?.type === 'materials' && (
        <MaterialEditor
          value={dialog.value}
          store={store}
          act={act}
          busy={busy}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'equipment' && (
        <EquipmentEditor
          value={dialog.value}
          store={store}
          act={act}
          busy={busy}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'archive' && (
        <Modal title="Переместить процесс в архив" onClose={() => setDialog(null)}>
          <div className="modal-content">
            <p>
              {dialog.value.code} · {dialog.value.name}
            </p>
            <p className="plain-note">
              Процесс станет недоступен для новых заказов. Созданные заказы продолжат исполняться по
              своим версиям.
            </p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDialog(null)}>
              Отмена
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                if (
                  await act(
                    { type: 'archiveProcess', processId: dialog.value.id },
                    'Процесс перенесён в архив',
                  )
                )
                  setDialog(null);
              }}
            >
              В архив
            </button>
          </div>
        </Modal>
      )}
      {leave && (
        <Modal title="Несохранённые изменения" onClose={() => setLeave(null)}>
          <div className="modal-content">
            <p>В процессе есть изменения. Сохранить их в черновик перед выходом?</p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setLeave(null)}>
              Продолжить редактирование
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setEditor(null);
                setDirty(false);
                setTab(leave);
                setLeave(null);
              }}
            >
              Не сохранять
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                if (await save(editor, false)) {
                  setEditor(null);
                  setTab(leave);
                  setLeave(null);
                }
              }}
            >
              Сохранить
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function MaterialEditor({ value, store, act, busy, onClose }) {
  const [material, setMaterial] = useState(
    value
      ? { ...value }
      : {
          id: uid(),
          code: `МТ-${String(store.materials.length + 1).padStart(3, '0')}`,
          name: '',
          kind: 'raw',
          unit: 'кг',
          allergen: '',
          active: true,
        },
  );
  const field = (key, value) => setMaterial({ ...material, [key]: value });
  return (
    <Modal title={value ? 'Изменить материал' : 'Новый материал'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act({ type: 'saveMaterial', material }, 'Материал сохранён')) onClose();
        }}
      >
        <div className="modal-content">
          <div className="form-grid">
            <Field label="Код">
              <input
                required
                value={material.code}
                onChange={(e) => field('code', e.target.value)}
              />
            </Field>
            <Field label="Тип материала">
              <select value={material.kind} onChange={(e) => field('kind', e.target.value)}>
                {Object.entries(materialKinds).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Наименование">
            <input required value={material.name} onChange={(e) => field('name', e.target.value)} />
          </Field>
          <div className="form-grid">
            <Field label="Единица измерения">
              <select value={material.unit} onChange={(e) => field('unit', e.target.value)}>
                {['кг', 'л', 'шт', 'г'].map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            </Field>
            <Field label="Аллергены">
              <input
                value={material.allergen}
                onChange={(e) => field('allergen', e.target.value)}
              />
            </Field>
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={material.active !== false}
              onChange={(e) => field('active', e.target.checked)}
            />
            Материал используется
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EquipmentEditor({ value, store, act, busy, onClose }) {
  const [equipment, setEquipment] = useState(
    value
      ? { ...value }
      : {
          id: uid(),
          code: `ОБ-${String(store.equipment.length + 1).padStart(3, '0')}`,
          name: '',
          area: '',
          active: true,
        },
  );
  const field = (key, value) => setEquipment({ ...equipment, [key]: value });
  return (
    <Modal title={value ? 'Изменить оборудование' : 'Новое оборудование'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act({ type: 'saveEquipment', equipment }, 'Оборудование сохранено')) onClose();
        }}
      >
        <div className="modal-content">
          <Field label="Код оборудования">
            <input
              required
              value={equipment.code}
              onChange={(e) => field('code', e.target.value)}
            />
          </Field>
          <Field label="Наименование">
            <input
              required
              value={equipment.name}
              onChange={(e) => field('name', e.target.value)}
            />
          </Field>
          <Field label="Участок">
            <input value={equipment.area} onChange={(e) => field('area', e.target.value)} />
          </Field>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={equipment.active}
              onChange={(e) => field('active', e.target.checked)}
            />
            Доступно для производства
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}
