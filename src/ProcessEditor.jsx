import React, { useState, useEffect } from 'react';
import { uid } from './domain.js';
import { Modal, Field, Empty, fmt } from './ui.jsx';
import { ProcessWorkspace } from './ProcessWorkspace.jsx';
import { OperationEditor } from './OperationEditor.jsx';
import { moveOperation } from './processEditing.js';

const blankOperation = () => ({
  id: uid(),
  name: '',
  kind: 'production',
  equipmentId: '',
  equipmentClass: '',
  inputs: [],
  outputs: [],
  parameters: [],
});
export function ProcessEditor({
  value: process,
  store,
  busy,
  onChange,
  onSave,
  onBack,
  dirty,
  onPendingChange,
}) {
  const [panel, setPanel] = useState(process.name ? 'route' : 'properties');
  const [selected, setSelected] = useState(null),
    [editing, setEditing] = useState(null),
    [operationDirty, setOperationDirty] = useState(false);
  const [orderDraft, setOrderDraft] = useState(null),
    [remove, setRemove] = useState(null),
    [pendingNext, setPendingNext] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const orderChanged =
    orderDraft && orderDraft.some((op, i) => process.operations[i]?.id !== op.id);
  const pending = operationDirty || Boolean(orderChanged);
  useEffect(() => {
    onPendingChange?.(pending);
    return () => onPendingChange?.(false);
  }, [pending, onPendingChange]);
  const selectedOperation = process.operations.find((op) => op.id === selected);
  const mainUnit = store.materials.find((m) => m.id === process.outputMaterial)?.unit || 'ед.';
  const setProcess = (key, value) => onChange({ ...process, [key]: value });
  const finishNavigation = (next) => {
    setEditing(null);
    setOperationDirty(false);
    setOrderDraft(null);
    setError('');
    setNotice('');
    if (next === 'close') onBack();
    else setPanel(next);
  };
  const requestNavigation = (next) => {
    if (busy) return;
    if (pending) setPendingNext(next);
    else finishNavigation(next);
  };
  const openOperation = (op, isNew = false) => {
    setError('');
    setNotice('');
    setEditing({
      operation: structuredClone(op),
      isNew,
      position: isNew
        ? process.operations.length
        : process.operations.findIndex((o) => o.id === op.id),
    });
  };
  const applyOperation = (operation, position) => {
    const operations = process.operations.filter((op) => op.id !== operation.id);
    operations.splice(position, 0, structuredClone(operation));
    onChange({ ...process, operations });
    setSelected(operation.id);
    setNotice(
      editing.isNew ? 'Операция добавлена в маршрут' : 'Изменения операции сохранены в маршруте',
    );
    setEditing(null);
    setOperationDirty(false);
  };
  const save = async (publish) => {
    setError('');
    try {
      await onSave(process, publish);
    } catch (e) {
      setError(e.message);
    }
  };
  const published = store.processes.find((p) => p.id === process.id)?.lifecycle === 'published';
  return (
    <ProcessWorkspace
      title={`Редактор процесса ${process.code}`}
      onClose={() => requestNavigation('close')}
    >
      <header className="workspace-heading">
        <div>
          <div className="workspace-breadcrumb">
            НСИ <span>/</span> Процессы <span>/</span> {process.code}
          </div>
          <h2>{process.name || 'Новый технологический процесс'}</h2>
          <p>
            {published
              ? `Опубликованная версия ${store.processes.find((p) => p.id === process.id).revision} · Изменения сохраняются в черновик`
              : store.processes.some((p) => p.id === process.id)
                ? `Черновик версии ${process.revision}`
                : 'Новый процесс · Черновик'}
          </p>
        </div>
        <button
          className="workspace-close"
          disabled={busy}
          onClick={() => requestNavigation('close')}
          aria-label="Закрыть редактор процесса"
        >
          Закрыть <span aria-hidden="true">×</span>
        </button>
      </header>
      {!editing && !orderDraft && (
        <nav className="workspace-navigation" aria-label="Разделы редактора процесса">
          <button
            className={panel === 'route' ? 'active' : ''}
            onClick={() => requestNavigation('route')}
          >
            Операции <span>{process.operations.length}</span>
          </button>
          <button
            className={panel === 'properties' ? 'active' : ''}
            onClick={() => requestNavigation('properties')}
          >
            Свойства процесса
          </button>
          <div className="workspace-basis">
            Нормы на {fmt(Number(process.baseQty) || 0, 3)} {mainUnit}
          </div>
        </nav>
      )}
      {error && (
        <div className="editor-error workspace-error" role="alert">
          {error}
        </div>
      )}
      {editing ? (
        <OperationEditor
          key={editing.operation.id}
          initial={editing.operation}
          position={editing.position}
          isNew={editing.isNew}
          process={process}
          store={store}
          onDirty={setOperationDirty}
          onApply={applyOperation}
          onBack={() => requestNavigation('route')}
          onCancel={() => {
            setEditing(null);
            setOperationDirty(false);
          }}
        />
      ) : orderDraft ? (
        <>
          <RouteOrder operations={orderDraft} onChange={setOrderDraft} />
          <footer className="workspace-footer">
            <span>Порядок определяет последовательность исполнения заказа</span>
            <div className="row-actions">
              <button className="button secondary" onClick={() => setOrderDraft(null)}>
                Отмена
              </button>
              <button
                className="button primary"
                onClick={() => {
                  if (orderChanged) onChange({ ...process, operations: orderDraft });
                  setOrderDraft(null);
                  setNotice('Порядок операций применён');
                }}
              >
                Применить порядок
              </button>
            </div>
          </footer>
        </>
      ) : (
        <>
          {panel === 'properties' ? (
            <section className="workspace-properties-panel">
              <div className="workspace-section-caption">
                <h3>Свойства процесса</h3>
                <p>Продукт, базовый объём для расчёта норм и срок годности выпуска.</p>
              </div>
              <div className="process-properties">
                <Field label="Код процесса">
                  <input
                    aria-label="Код процесса"
                    required
                    value={process.code}
                    onChange={(e) => setProcess('code', e.target.value)}
                  />
                </Field>
                <Field label="Наименование процесса">
                  <input
                    aria-label="Наименование процесса"
                    required
                    value={process.name}
                    placeholder="Например, производство творога"
                    onChange={(e) => setProcess('name', e.target.value)}
                  />
                </Field>
                <Field label="Основной выпускаемый материал">
                  <select
                    aria-label="Основной выпускаемый материал"
                    value={process.outputMaterial}
                    onChange={(e) => setProcess('outputMaterial', e.target.value)}
                  >
                    <option value="">Выберите материал</option>
                    {store.materials
                      .filter((m) => m.active !== false)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.code} · {m.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label={`Базовый объём, ${mainUnit}`}>
                  <input
                    aria-label="Базовый объём"
                    type="number"
                    min="0.001"
                    step="any"
                    value={process.baseQty}
                    onChange={(e) => setProcess('baseQty', e.target.value)}
                  />
                </Field>
                <Field label="Срок годности, суток">
                  <input
                    aria-label="Срок годности"
                    type="number"
                    min="1"
                    step="1"
                    value={process.shelf}
                    onChange={(e) => setProcess('shelf', e.target.value)}
                  />
                </Field>
                <Field
                  label={`Шаг объёма выпуска, ${mainUnit}`}
                  hint="Например, масса одной потребительской упаковки."
                >
                  <input
                    aria-label="Шаг объёма выпуска"
                    type="number"
                    min="0.001"
                    step="any"
                    value={process.quantityStep ?? ''}
                    onChange={(e) =>
                      setProcess(
                        'quantityStep',
                        e.target.value === '' ? undefined : Number(e.target.value),
                      )
                    }
                  />
                </Field>
                <label className="check-control full-width">
                  <input
                    type="checkbox"
                    checked={!!process.preserveExpiry}
                    onChange={(e) => setProcess('preserveExpiry', e.target.checked)}
                  />
                  <span>Ограничивать срок выпуска сроком годности исходного сырья</span>
                </label>
              </div>
              {process.carcassGradeRules?.length > 0 && (
                <details className="classification-mode">
                  <summary>Правила итоговой классификации туш</summary>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Код / название</th>
                          <th>Масса от / до, кг</th>
                          <th>Постность от / до, %</th>
                          <th>Есть примечания</th>
                        </tr>
                      </thead>
                      <tbody>
                        {process.carcassGradeRules.map((rule, index) => {
                          const change = (key, value) =>
                            setProcess(
                              'carcassGradeRules',
                              process.carcassGradeRules.map((row, i) =>
                                i === index ? { ...row, [key]: value } : row,
                              ),
                            );
                          return (
                            <tr key={rule.id}>
                              <td>
                                <input
                                  aria-label={`Код грейда ${index + 1}`}
                                  value={rule.code}
                                  onChange={(event) => change('code', event.target.value)}
                                />
                                <input
                                  aria-label={`Название грейда ${index + 1}`}
                                  value={rule.name}
                                  onChange={(event) => change('name', event.target.value)}
                                />
                              </td>
                              <td>
                                {['minWeight', 'maxWeight'].map((key) => (
                                  <input
                                    key={key}
                                    aria-label={`${key === 'minWeight' ? 'Минимальная' : 'Максимальная'} масса грейда ${index + 1}`}
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    value={rule[key]}
                                    onChange={(event) =>
                                      change(
                                        key,
                                        event.target.value === '' ? '' : Number(event.target.value),
                                      )
                                    }
                                  />
                                ))}
                              </td>
                              <td>
                                {['minLean', 'maxLean'].map((key) => (
                                  <input
                                    key={key}
                                    aria-label={`${key === 'minLean' ? 'Минимальная' : 'Максимальная'} постность грейда ${index + 1}`}
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.001"
                                    value={rule[key]}
                                    onChange={(event) =>
                                      change(
                                        key,
                                        event.target.value === '' ? '' : Number(event.target.value),
                                      )
                                    }
                                  />
                                ))}
                              </td>
                              <td>
                                <label className="check-control">
                                  <input
                                    type="checkbox"
                                    checked={rule.allowFindings}
                                    onChange={(event) =>
                                      change('allowFindings', event.target.checked)
                                    }
                                  />
                                  <span>Допускаются</span>
                                </label>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </section>
          ) : (
            <section className="route-manager">
              <header className="route-manager-heading">
                <div>
                  <h3>Операции процесса</h3>
                  <p>Выберите строку для редактирования или удаления операции.</p>
                </div>
                <span>{process.operations.length} операций · Последовательный маршрут</span>
              </header>
              <div className="route-toolbar" role="toolbar" aria-label="Действия с операциями">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => openOperation(blankOperation(), true)}
                >
                  Добавить
                </button>
                <button
                  className="button secondary"
                  disabled={busy || !selectedOperation}
                  onClick={() => openOperation(selectedOperation)}
                >
                  Редактировать
                </button>
                <button
                  className="button secondary danger-command"
                  disabled={busy || !selectedOperation}
                  onClick={() => setRemove(selectedOperation)}
                >
                  Удалить
                </button>
                <span className="toolbar-divider" />
                <button
                  className="button secondary"
                  disabled={busy || process.operations.length < 2}
                  onClick={() => {
                    setOrderDraft([...process.operations]);
                    setNotice('');
                  }}
                >
                  Порядок операций
                </button>
              </div>
              <div className="table-scroll route-table-scroll">
                <table className="data-table route-table" aria-label="Операции процесса">
                  <thead>
                    <tr>
                      <th>
                        <span className="visually-hidden">Выбор</span>
                      </th>
                      <th>№</th>
                      <th>Наименование операции</th>
                      <th>Тип</th>
                      <th>Оборудование</th>
                      <th>
                        Материалы
                        <br />
                        Вход / выход
                      </th>
                      <th>Параметры</th>
                    </tr>
                  </thead>
                  <tbody>
                    {process.operations.map((op, i) => (
                      <tr
                        key={op.id}
                        aria-selected={op.id === selected}
                        className={op.id === selected ? 'selected' : ''}
                        onClick={() => {
                          setSelected(op.id);
                          setNotice('');
                        }}
                        onDoubleClick={() => openOperation(op)}
                      >
                        <td>
                          <input
                            type="radio"
                            name="selected-operation"
                            aria-label={`Выбрать операцию ${op.name || i + 1}`}
                            checked={op.id === selected}
                            onChange={() => setSelected(op.id)}
                          />
                        </td>
                        <td className="mono">{String(i + 1).padStart(2, '0')}</td>
                        <td className="route-operation-name">{op.name || 'Без наименования'}</td>
                        <td>{op.kind === 'quality' ? 'Контроль качества' : 'Производственная'}</td>
                        <td>
                          {op.equipmentClass ||
                            store.equipment.find((e) => e.id === op.equipmentId)?.name ||
                            'Без оборудования'}
                        </td>
                        <td>
                          {op.inputs.length} / {op.outputs.length}
                        </td>
                        <td>{op.parameters.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!process.operations.length && (
                <Empty
                  title="В процессе пока нет операций"
                  text="Добавьте первую операцию с помощью кнопки над списком."
                />
              )}
              <div className="route-selection-status" role="status">
                {notice ||
                  (selectedOperation
                    ? `Выбрана операция: ${selectedOperation.name}`
                    : 'Операция не выбрана')}
              </div>
            </section>
          )}
          <footer className="workspace-footer">
            <span className={dirty ? 'workspace-dirty' : ''}>
              {busy
                ? 'Сохранение…'
                : dirty
                  ? 'Есть несохранённые изменения процесса'
                  : 'Изменений нет'}
            </span>
            <div className="row-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => requestNavigation('close')}
              >
                Закрыть
              </button>
              <button className="button secondary" disabled={busy} onClick={() => save(false)}>
                Сохранить черновик
              </button>
              <button className="button primary" disabled={busy} onClick={() => save(true)}>
                Опубликовать
              </button>
            </div>
          </footer>
        </>
      )}
      {remove && (
        <Modal title="Удалить операцию?" onClose={() => setRemove(null)}>
          <div className="modal-content">
            <p>
              Операция «{remove.name}» будет удалена из маршрута черновика. Результаты действующих
              заказов сохранятся.
            </p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setRemove(null)}>
              Отмена
            </button>
            <button
              className="button danger"
              onClick={() => {
                onChange({
                  ...process,
                  operations: process.operations.filter((op) => op.id !== remove.id),
                });
                setSelected(null);
                setRemove(null);
                setNotice('Операция удалена из маршрута');
              }}
            >
              Удалить операцию
            </button>
          </div>
        </Modal>
      )}
      {pendingNext && (
        <Modal
          title={editing ? 'Несохранённые изменения операции' : 'Изменение порядка операций'}
          onClose={() => setPendingNext(null)}
        >
          <div className="modal-content">
            <p>Изменения ещё не применены к процессу. Отменить их и выйти из этого режима?</p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setPendingNext(null)}>
              Продолжить редактирование
            </button>
            <button
              className="button primary"
              onClick={() => {
                const next = pendingNext;
                setPendingNext(null);
                finishNavigation(next);
              }}
            >
              Отменить изменения
            </button>
          </div>
        </Modal>
      )}
    </ProcessWorkspace>
  );
}

function RouteOrder({ operations, onChange }) {
  const [dragged, setDragged] = useState(null),
    [target, setTarget] = useState(null),
    [announcement, setAnnouncement] = useState('');
  const move = (id, to) => {
    const op = operations.find((op) => op.id === id);
    onChange(moveOperation(operations, id, to));
    setAnnouncement(`«${op.name}»: позиция ${to + 1}`);
  };
  return (
    <section className="route-order-page">
      <header className="route-manager-heading">
        <div>
          <h3>Порядок операций</h3>
          <p>Перетащите строку за маркер слева или выберите новую позицию в поле справа.</p>
        </div>
      </header>
      <div className="route-order-list">
        {operations.map((op, i) => (
          <div
            key={op.id}
            className={`route-order-row ${dragged === op.id ? 'dragged' : ''} ${target === op.id ? 'drop-target' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragged) setTarget(op.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragged && dragged !== op.id) move(dragged, i);
              setDragged(null);
              setTarget(null);
            }}
          >
            <button
              className="drag-handle"
              draggable
              aria-label={`Перетащить операцию ${op.name}`}
              title="Перетащить строку"
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', op.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragged(op.id);
              }}
              onDragEnd={() => {
                setDragged(null);
                setTarget(null);
              }}
            >
              <span aria-hidden="true">⠿</span>
            </button>
            <span className="route-order-number">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <strong>{op.name}</strong>
              <small>{op.kind === 'quality' ? 'Контроль качества' : 'Производственная'}</small>
            </div>
            <label className="route-order-position">
              <span>Позиция</span>
              <select
                aria-label={`Позиция операции ${op.name}`}
                value={i}
                onChange={(e) => move(op.id, Number(e.target.value))}
              >
                {operations.map((_, n) => (
                  <option key={n} value={n}>
                    {n + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
      </div>
      <p className="route-order-announcement" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
