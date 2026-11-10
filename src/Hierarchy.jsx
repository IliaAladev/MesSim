import React, { useState } from 'react';
import { uid, occupancy, operationOf } from './domain.js';
import { resourceNodes, resourcePath, resourceActive, levelLabels } from './resources.js';
import { Field, Modal, SectionHead } from './ui.jsx';

const childTypes = {
  enterprise: ['site'],
  site: ['area'],
  area: ['line', 'equipment'],
  line: ['equipment'],
  equipment: [],
};
export function HierarchyView({ store, act, busy }) {
  const [selected, setSelected] = useState('area'),
    [editor, setEditor] = useState(null),
    [remove, setRemove] = useState(false),
    [collapsed, setCollapsed] = useState(() => new Set(store.lines.map((l) => l.id)));
  const nodes = resourceNodes(store),
    current = nodes.find((n) => n.id === selected);
  const assignments = current
    ? store.orders.filter((o) =>
        current.type === 'equipment'
          ? ['running', 'quality', 'hold'].includes(o.status) &&
            operationOf(o).equipmentId === current.id
          : occupancy(o) && resourcePath(store, o.line).some((n) => n.id === current.id),
      )
    : [];
  const add = (type, parentId = '') =>
    setEditor({
      id: uid(),
      type,
      parentId,
      code: '',
      name: '',
      active: true,
      capacity: 600,
      status: 'ready',
      classCode: '',
    });
  const branch = (parentId = '', depth = 0) =>
    nodes
      .filter((n) => (n.parentId || '') === parentId)
      .map((n) => (
        <React.Fragment key={n.id}>
          <div className="hierarchy-tree-row">
            <button
              className={`hierarchy-node ${n.id === selected ? 'selected' : ''}`}
              style={{ paddingLeft: 16 + depth * 20 }}
              onClick={() => setSelected(n.id)}
            >
              <span className="hierarchy-code">{n.code}</span>
              <strong>{n.name}</strong>
              <small>
                {levelLabels[n.type]}
                {!resourceActive(store, n.id) ? ' · Отключён' : ''}
              </small>
            </button>
            {nodes.some((child) => child.parentId === n.id) && (
              <button
                className="hierarchy-toggle"
                aria-label={`${collapsed.has(n.id) ? 'Развернуть' : 'Свернуть'} ${n.name}`}
                aria-expanded={!collapsed.has(n.id)}
                onClick={() => {
                  const next = new Set(collapsed);
                  if (next.has(n.id)) next.delete(n.id);
                  else next.add(n.id);
                  setCollapsed(next);
                }}
              >
                {collapsed.has(n.id) ? '+' : '−'}
              </button>
            )}
          </div>
          {!collapsed.has(n.id) && branch(n.id, depth + 1)}
        </React.Fragment>
      ));
  return (
    <>
      <SectionHead title="Структура производства">
        <button className="button secondary" onClick={() => add('enterprise')}>
          Добавить предприятие
        </button>
      </SectionHead>
      <p className="hierarchy-intro">
        Предприятие → площадка → участок → рабочий центр (линия) → рабочая единица (оборудование).
        Оборудование участка является общим ресурсом его линий.
      </p>
      <div className="hierarchy-layout">
        <nav className="hierarchy-tree" aria-label="Дерево производства">
          {branch()}
        </nav>
        <section className="hierarchy-detail">
          {current ? (
            <>
              <span className="plain-note">{levelLabels[current.type]}</span>
              <h2>{current.name}</h2>
              <p className="hierarchy-path">
                {resourcePath(store, current.id)
                  .map((n) => n.name)
                  .join(' / ')}
              </p>
              <dl className="details-list">
                <div>
                  <dt>Код</dt>
                  <dd>{current.code}</dd>
                </div>
                <div>
                  <dt>Доступность</dt>
                  <dd>{resourceActive(store, current.id) ? 'Доступен' : 'Отключён'}</dd>
                </div>
                {current.type === 'equipment' && (
                  <>
                    <div>
                      <dt>Класс оборудования</dt>
                      <dd>{current.classCode}</dd>
                    </div>
                    <div>
                      <dt>Использование</dt>
                      <dd>
                        {nodes.find((n) => n.id === current.parentId)?.type === 'area'
                          ? 'Общий ресурс линий участка'
                          : 'Ресурс своей линии'}
                      </dd>
                    </div>
                  </>
                )}
                {current.type === 'line' && (
                  <>
                    <div>
                      <dt>Режим</dt>
                      <dd>{current.status === 'cip' ? 'Санобработка' : 'Производство'}</dd>
                    </div>
                    <div>
                      <dt>Производительность</dt>
                      <dd>{current.capacity} кг/ч</dd>
                    </div>
                  </>
                )}
              </dl>
              <div className="row-actions">
                <button className="button secondary" onClick={() => setEditor({ ...current })}>
                  Редактировать узел
                </button>
                {childTypes[current.type].map((type) => (
                  <button
                    key={type}
                    className="button secondary"
                    onClick={() => add(type, current.id)}
                  >
                    Добавить:{' '}
                    {type === 'equipment' ? 'оборудование' : levelLabels[type].toLowerCase()}
                  </button>
                ))}
                <button className="text-button" onClick={() => setRemove(true)}>
                  Удалить узел
                </button>
              </div>
              <section className="resource-usage">
                <h3>Занятость</h3>
                {assignments.length ? (
                  assignments.map((o) => (
                    <p key={o.id}>
                      <strong>{o.code}</strong> · {store.lines.find((l) => l.id === o.line)?.name} ·{' '}
                      {operationOf(o).name}
                      {o.status === 'waiting' ? ' · Ожидание' : ''}
                    </p>
                  ))
                ) : (
                  <p className="plain-note">Активных назначений нет</p>
                )}
                <p className="plain-note">
                  Линия закреплена за заказом до завершения производственного маршрута. Оборудование
                  занято только текущей выполняемой или приостановленной операцией. Финальный
                  контроль без оборудования освобождает линию.
                </p>
              </section>
            </>
          ) : (
            <p>Выберите узел структуры.</p>
          )}
        </section>
      </div>
      {editor && (
        <NodeEditor
          key={editor.id}
          value={editor}
          store={store}
          busy={busy}
          act={act}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            setSelected(id);
            setCollapsed(
              new Set(
                [...collapsed].filter(
                  (parent) => !resourcePath(store, editor.parentId).some((n) => n.id === parent),
                ),
              ),
            );
            setEditor(null);
          }}
        />
      )}
      {remove && current && (
        <Modal title="Удалить узел структуры?" onClose={() => setRemove(false)}>
          <div className="modal-content">
            <p>
              {current.name}. Удаление доступно для узлов без дочерних элементов и ссылок из
              процессов и заказов.
            </p>
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setRemove(false)}>
              Отмена
            </button>
            <button
              disabled={busy}
              className="button primary"
              onClick={async () => {
                if (await act({ type: 'deleteResource', id: current.id }, 'Узел удалён')) {
                  setSelected(current.parentId);
                  setRemove(false);
                }
              }}
            >
              Удалить
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function NodeEditor({ value, store, busy, act, onClose, onSaved }) {
  const [node, setNode] = useState(value),
    set = (key, val) => setNode({ ...node, [key]: val });
  const allowed = {
    enterprise: [],
    site: ['enterprise'],
    area: ['site'],
    line: ['area'],
    equipment: ['line', 'area'],
  }[node.type];
  const nodes = resourceNodes(store);
  return (
    <Modal
      title={`${nodes.some((n) => n.id === node.id) ? 'Редактировать' : 'Создать'}: ${levelLabels[node.type].toLowerCase()}`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act(
              node.type === 'equipment'
                ? { type: 'saveEquipment', equipment: node }
                : { type: 'saveNode', node },
              'Структура сохранена',
            )
          )
            onSaved(node.id);
        }}
      >
        <div className="modal-content">
          <Field label="Код узла">
            <input required value={node.code} onChange={(e) => set('code', e.target.value)} />
          </Field>
          <Field label="Наименование узла">
            <input required value={node.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          {node.type !== 'enterprise' && (
            <Field label="Родительский узел">
              <select
                required
                value={node.parentId}
                onChange={(e) => set('parentId', e.target.value)}
              >
                <option value="">Выберите узел</option>
                {nodes
                  .filter((n) => allowed.includes(n.type))
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {resourcePath(store, n.id)
                        .map((n) => n.name)
                        .join(' / ')}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {node.type === 'equipment' && (
            <Field label="Класс оборудования">
              <input
                aria-label="Класс оборудования"
                required
                list="equipment-classes"
                value={node.classCode || ''}
                onChange={(e) => set('classCode', e.target.value)}
              />
              <datalist id="equipment-classes">
                {[...new Set(store.equipment.map((e) => e.classCode))].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          )}
          {node.type === 'line' && (
            <Field label="Производительность, кг/ч">
              <input
                required
                type="number"
                min="0.001"
                step="any"
                value={node.capacity}
                onChange={(e) => set('capacity', e.target.value)}
              />
            </Field>
          )}
          <label className="inline-check">
            <input
              type="checkbox"
              checked={node.active !== false}
              onChange={(e) => set('active', e.target.checked)}
            />
            Доступен для производства
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
