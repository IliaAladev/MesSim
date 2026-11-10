import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { uid } from './domain.js';
import { Field, IconButton, SectionHead, Empty, fmt } from './ui.jsx';
import { resourcePath } from './resources.js';
import { validateOperationDraft } from './processEditing.js';

export function OperationEditor({
  initial,
  position: initialPosition,
  isNew,
  process,
  store,
  onApply,
  onCancel,
  onBack,
  onDirty,
}) {
  const [operation, setOperation] = useState(() => structuredClone(initial));
  const initialMode = initial.equipmentClass ? 'class' : initial.equipmentId ? 'fixed' : 'none';
  const [resourceMode, setResourceMode] = useState(initialMode),
    [position, setPosition] = useState(initialPosition);
  const [section, setSection] = useState('general'),
    [error, setError] = useState('');
  const changed =
    JSON.stringify(operation) !== JSON.stringify(initial) ||
    position !== initialPosition ||
    resourceMode !== initialMode;
  useEffect(() => {
    onDirty(changed);
    return () => onDirty(false);
  }, [changed, onDirty]);
  const updateOperation = (patch) => setOperation((op) => ({ ...op, ...patch }));
  const modifyRow = (group, id, patch) =>
    updateOperation({
      [group]: operation[group].map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  const removeRow = (group, id) =>
    updateOperation({ [group]: operation[group].filter((row) => row.id !== id) });
  const mainUnit = store.materials.find((m) => m.id === process.outputMaterial)?.unit || 'ед.';
  const positions = process.operations.filter((op) => op.id !== operation.id).length + 1;
  const save = () => {
    setError('');
    try {
      validateOperationDraft(operation, store, resourceMode);
      onApply({ ...operation, name: operation.name.trim() }, Number(position));
    } catch (e) {
      setError(e.message);
      setSection(e.section || 'general');
    }
  };
  return (
    <>
      <section className="operation-edit-page">
        <button className="text-button operation-back" onClick={onBack}>
          ← К списку операций
        </button>
        <header className="operation-edit-heading">
          <div>
            <h3>{isNew ? 'Добавление операции' : 'Редактирование операции'}</h3>
            <p>
              {isNew ? 'Новая операция маршрута' : initial.name} · Нормы на{' '}
              {fmt(Number(process.baseQty) || 0, 3)} {mainUnit}
            </p>
          </div>
        </header>
        <div className="tabs builder-tabs">
          {[
            ['general', 'Основное'],
            ['materials', 'Материалы'],
            ['parameters', 'Параметры'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={section === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              {label}
              {id !== 'general' && (
                <span>
                  {id === 'materials'
                    ? operation.inputs.length + operation.outputs.length
                    : operation.parameters.length}
                </span>
              )}
            </button>
          ))}
        </div>
        {error && (
          <div className="editor-error" role="alert">
            {error}
          </div>
        )}
        <div className="operation-edit-content">
          {section === 'general' ? (
            <div className="operation-edit-fields">
              <label className="check-control full-width">
                <input
                  type="checkbox"
                  checked={!!operation.massBalance}
                  onChange={(e) => updateOperation({ massBalance: e.target.checked })}
                />
                <span>Проверять материальный баланс: вход = выходы + потери (кг)</span>
              </label>
              {operation.carcassIdentification && (
                <Field
                  label="Имитация AutoFom: постность, %"
                  hint="Значение только для демонстрационного источника данных."
                >
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.001"
                    value={operation.primaryLeanTarget ?? 57}
                    onChange={(event) =>
                      updateOperation({
                        primaryLeanTarget:
                          event.target.value === '' ? '' : Number(event.target.value),
                      })
                    }
                  />
                </Field>
              )}
              {operation.massBalance && (
                <Field
                  label="Параметр технологических потерь"
                  hint="Обязательное число в кг, пересчёт на объём, нижний допуск от нуля. Создайте его на вкладке «Параметры»."
                >
                  <select
                    aria-label="Параметр технологических потерь"
                    value={operation.lossParameter || ''}
                    onChange={(e) => updateOperation({ lossParameter: e.target.value })}
                  >
                    <option value="">Выберите параметр</option>
                    {operation.parameters
                      .filter((p) => p.type === 'number' && p.unit === 'кг')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Field label="Наименование операции *" className="full-width">
                <input
                  autoFocus
                  aria-label="Наименование операции"
                  value={operation.name}
                  placeholder="Например, пастеризация смеси"
                  onChange={(e) => updateOperation({ name: e.target.value })}
                />
              </Field>
              <Field label="Тип операции">
                <select
                  aria-label="Тип операции"
                  value={operation.kind}
                  onChange={(e) => updateOperation({ kind: e.target.value })}
                >
                  <option value="production">Производственная</option>
                  <option value="quality">Контроль качества</option>
                </select>
              </Field>
              <Field label="Позиция в маршруте">
                <select
                  aria-label="Позиция в маршруте"
                  value={position}
                  onChange={(e) => setPosition(Number(e.target.value))}
                >
                  {Array.from({ length: positions }, (_, i) => (
                    <option key={i} value={i}>
                      {i + 1}
                      {i === positions - 1 ? ' · В конце маршрута' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Назначение оборудования">
                <select
                  aria-label="Назначение оборудования"
                  value={resourceMode}
                  onChange={(e) => {
                    setResourceMode(e.target.value);
                    updateOperation({ equipmentClass: '', equipmentId: '' });
                  }}
                >
                  <option value="none">Без оборудования</option>
                  <option value="class">По классу оборудования</option>
                  <option value="fixed">Конкретное оборудование</option>
                </select>
              </Field>
              {resourceMode === 'class' && (
                <Field
                  label="Класс оборудования *"
                  hint="Оборудование назначается из ресурсов линии при создании заказа."
                >
                  <select
                    aria-label="Класс оборудования операции"
                    value={operation.equipmentClass || ''}
                    onChange={(e) => updateOperation({ equipmentClass: e.target.value })}
                  >
                    <option value="">Выберите класс</option>
                    {[...new Set(store.equipment.filter((e) => e.active).map((e) => e.classCode))]
                      .filter(Boolean)
                      .map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                  </select>
                </Field>
              )}
              {resourceMode === 'fixed' && (
                <Field label="Оборудование *">
                  <select
                    aria-label="Оборудование операции"
                    value={operation.equipmentId || ''}
                    onChange={(e) => updateOperation({ equipmentId: e.target.value })}
                  >
                    <option value="">Выберите оборудование</option>
                    {store.equipment
                      .filter((e) => e.active || e.id === operation.equipmentId)
                      .map((eq) => (
                        <option key={eq.id} value={eq.id}>
                          {eq.code} · {eq.name} · {resourcePath(store, eq.parentId).at(-1)?.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
            </div>
          ) : section === 'materials' ? (
            <>
              <MaterialRows
                title="Потребляемые материалы"
                group="inputs"
                rows={operation.inputs}
                store={store}
                baseQty={process.baseQty}
                mainUnit={mainUnit}
                onChange={(id, patch) => modifyRow('inputs', id, patch)}
                onRemove={(id) => removeRow('inputs', id)}
                onAdd={() =>
                  updateOperation({
                    inputs: [
                      ...operation.inputs,
                      { id: uid(), material: '', qty: '', source: 'stock' },
                    ],
                  })
                }
              />
              <MaterialRows
                title="Выпускаемые материалы"
                group="outputs"
                rows={operation.outputs}
                store={store}
                baseQty={process.baseQty}
                mainUnit={mainUnit}
                onChange={(id, patch) => modifyRow('outputs', id, patch)}
                onRemove={(id) => removeRow('outputs', id)}
                onAdd={() =>
                  updateOperation({
                    outputs: [
                      ...operation.outputs,
                      { id: uid(), material: '', qty: '', destination: 'process' },
                    ],
                  })
                }
              />
            </>
          ) : (
            <section className="parameter-editor">
              <SectionHead title="Параметры операции">
                <button
                  className="button secondary compact"
                  onClick={() =>
                    updateOperation({
                      parameters: [
                        ...operation.parameters,
                        {
                          id: uid(),
                          name: '',
                          type: 'number',
                          unit: '',
                          min: '',
                          target: '',
                          max: '',
                          required: true,
                          scaled: false,
                        },
                      ],
                    })
                  }
                >
                  Добавить параметр
                </button>
              </SectionHead>
              {operation.parameters.map((p, i) => (
                <div className="parameter-definition" key={p.id}>
                  <div className="parameter-definition-main">
                    <Field label={`Параметр ${i + 1}`}>
                      <input
                        aria-label={`Наименование параметра ${i + 1}`}
                        value={p.name}
                        placeholder="Наименование"
                        onChange={(e) => modifyRow('parameters', p.id, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Тип значения">
                      <select
                        aria-label={`Тип параметра ${i + 1}`}
                        value={p.type}
                        onChange={(e) => modifyRow('parameters', p.id, { type: e.target.value })}
                      >
                        <option value="number">Число</option>
                        <option value="text">Текст</option>
                        <option value="boolean">Подтверждение</option>
                      </select>
                    </Field>
                    {p.type === 'number' && (
                      <Field label="Ед. изм.">
                        <input
                          aria-label={`Единица параметра ${i + 1}`}
                          value={p.unit || ''}
                          placeholder="°C, pH…"
                          onChange={(e) => modifyRow('parameters', p.id, { unit: e.target.value })}
                        />
                      </Field>
                    )}
                    <IconButton
                      icon={X}
                      label={`Удалить параметр ${i + 1}`}
                      onClick={() => removeRow('parameters', p.id)}
                    />
                  </div>
                  {p.type === 'number' && (
                    <div className="parameter-limits">
                      {[
                        ['min', 'Нижний допуск'],
                        ['target', 'Номинал'],
                        ['max', 'Верхний допуск'],
                      ].map(([key, label]) => (
                        <Field key={key} label={label}>
                          <input
                            aria-label={`${label} параметра ${i + 1}`}
                            type="number"
                            step="any"
                            value={p[key] ?? ''}
                            onChange={(e) =>
                              modifyRow('parameters', p.id, {
                                [key]: e.target.value === '' ? '' : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  )}
                  <div className="parameter-options">
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={p.required}
                        onChange={(e) =>
                          modifyRow('parameters', p.id, { required: e.target.checked })
                        }
                      />
                      Обязательный
                    </label>
                    {p.type === 'number' && (
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={Boolean(p.scaled)}
                          onChange={(e) =>
                            modifyRow('parameters', p.id, { scaled: e.target.checked })
                          }
                        />
                        Пересчитывать на объём заказа
                      </label>
                    )}
                  </div>
                </div>
              ))}
              {!operation.parameters.length && <Empty title="Параметров нет" text="" />}
            </section>
          )}
        </div>
      </section>
      <footer className="workspace-footer">
        <span>
          {changed
            ? 'Изменения операции не сохранены'
            : isNew
              ? 'Заполните данные новой операции'
              : 'Редактирование выбранной операции'}
        </span>
        <div className="row-actions">
          <button className="button secondary" onClick={onCancel}>
            Отмена
          </button>
          <button className="button primary" onClick={save}>
            Сохранить операцию
          </button>
        </div>
      </footer>
    </>
  );
}

function MaterialRows({ title, group, rows, store, baseQty, mainUnit, onChange, onAdd, onRemove }) {
  const consuming = group === 'inputs';
  return (
    <section className="material-definitions">
      <SectionHead title={title} meta={`на ${fmt(Number(baseQty) || 0, 3)} ${mainUnit}`}>
        <button className="button secondary compact" onClick={onAdd}>
          Добавить материал
        </button>
      </SectionHead>
      <div className="table-scroll">
        <table className="data-table config-materials">
          <thead>
            <tr>
              <th>Материал</th>
              <th>{consuming ? 'Источник' : 'Назначение'}</th>
              <th>Количество</th>
              <th>Ед.</th>
              {!consuming && <th>Срок, сут.</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>
                  <select
                    aria-label={`${consuming ? 'Потребляемый' : 'Выпускаемый'} материал ${index + 1}`}
                    value={row.material}
                    onChange={(e) => onChange(row.id, { material: e.target.value })}
                  >
                    <option value="">Выберите материал</option>
                    {store.materials
                      .filter((m) => m.active !== false || m.id === row.material)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.code} · {m.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={`${consuming ? 'Источник' : 'Назначение'} материала ${index + 1}`}
                    value={consuming ? row.source : row.destination}
                    onChange={(e) =>
                      onChange(row.id, { [consuming ? 'source' : 'destination']: e.target.value })
                    }
                  >
                    {consuming ? (
                      <>
                        <option value="stock">Склад</option>
                        <option value="process">Предыдущие операции</option>
                      </>
                    ) : (
                      <>
                        <option value="process">В следующие операции</option>
                        <option value="stock">На склад</option>
                      </>
                    )}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`${consuming ? 'Потребление' : 'Выпуск'} материала ${index + 1}`}
                    type="number"
                    min="0.001"
                    step="any"
                    value={row.qty}
                    onChange={(e) =>
                      onChange(row.id, { qty: e.target.value === '' ? '' : Number(e.target.value) })
                    }
                  />
                </td>
                <td>{store.materials.find((m) => m.id === row.material)?.unit || '—'}</td>
                {!consuming && (
                  <td>
                    <input
                      aria-label={`Срок годности выхода ${index + 1}`}
                      type="number"
                      min="1"
                      step="1"
                      placeholder="По процессу"
                      value={row.shelf ?? ''}
                      onChange={(e) =>
                        onChange(row.id, {
                          shelf: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </td>
                )}
                <td>
                  <IconButton
                    icon={X}
                    label={`Удалить строку ${index + 1} ${consuming ? 'потребления' : 'выпуска'}`}
                    onClick={() => onRemove(row.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="plain-note">Не заданы</p>}
    </section>
  );
}
