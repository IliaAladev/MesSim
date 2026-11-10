import React, { useState } from 'react';
import { uid } from './domain.js';
import { nextCounterpartyCode } from './counterparties.js';
import { Badge, Empty, Field, Modal, SectionHead } from './ui.jsx';
import { containsText, Pagination, usePagination } from './registries.jsx';

const blank = (store, role) => ({
  id: uid(),
  code: nextCounterpartyCode(store),
  name: '',
  isSupplier: role === 'isSupplier',
  isCustomer: role === 'isCustomer',
  active: true,
});
const rolesOf = (party) =>
  [party.isSupplier && 'Поставщик', party.isCustomer && 'Потребитель'].filter(Boolean).join(' · ');

export function CounterpartyPicker({ store, act, busy, role, value, onChange, label }) {
  const [draft, setDraft] = useState(null);
  const isSupplier = role === 'isSupplier';
  const parties = store.counterparties
    .filter((party) => party.active && party[role])
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const save = async () => {
    if (
      await act(
        { type: 'saveCounterparty', counterparty: draft },
        'Контрагент добавлен в справочник',
      )
    ) {
      onChange(draft.id);
      setDraft(null);
    }
  };
  return (
    <div className="counterparty-picker">
      <Field label={label || (isSupplier ? 'Поставщик' : 'Потребитель / получатель')}>
        <select
          required
          aria-label={isSupplier ? 'Поставщик из справочника' : 'Потребитель из справочника'}
          value={value}
          disabled={busy || Boolean(draft)}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{isSupplier ? 'Выберите поставщика' : 'Выберите потребителя'}</option>
          {parties.map((party) => (
            <option key={party.id} value={party.id}>
              {party.name} · {party.code}
            </option>
          ))}
        </select>
      </Field>
      {!draft ? (
        <>
          {!parties.length && (
            <p className="plain-note">
              {isSupplier ? 'Нет действующих поставщиков.' : 'Нет действующих потребителей.'}
            </p>
          )}
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => setDraft(blank(store, role))}
          >
            {isSupplier ? 'Добавить поставщика' : 'Добавить потребителя'}
          </button>
        </>
      ) : (
        <div className="counterparty-inline-editor">
          <Field label={isSupplier ? 'Новый поставщик' : 'Новый потребитель'}>
            <input
              autoFocus
              aria-label="Наименование нового контрагента"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (draft.name.trim() && !busy) save();
                }
              }}
            />
          </Field>
          <div className="row-actions">
            <button
              className="button secondary compact"
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Отмена
            </button>
            <button
              className="button primary compact"
              type="button"
              disabled={busy || !draft.name.trim()}
              onClick={save}
            >
              Сохранить и выбрать
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CounterpartyEditor({ value, store, act, busy, onClose }) {
  const [party, setParty] = useState(() => (value ? { ...value } : blank(store)));
  const change = (field, value) => setParty((previous) => ({ ...previous, [field]: value }));
  return (
    <Modal title={value ? 'Контрагент' : 'Новый контрагент'} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (await act({ type: 'saveCounterparty', counterparty: party }, 'Контрагент сохранён'))
            onClose();
        }}
      >
        <div className="modal-content">
          <Field label="Код">
            <input
              required
              value={party.code}
              onChange={(event) => change('code', event.target.value)}
            />
          </Field>
          <Field label="Наименование">
            <input
              required
              value={party.name}
              onChange={(event) => change('name', event.target.value)}
            />
          </Field>
          <Field label="Роли" hint="Одна организация может быть и поставщиком, и потребителем.">
            <div className="counterparty-roles">
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={party.isSupplier}
                  onChange={(event) => change('isSupplier', event.target.checked)}
                />
                Поставщик
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={party.isCustomer}
                  onChange={(event) => change('isCustomer', event.target.checked)}
                />
                Потребитель
              </label>
            </div>
          </Field>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={party.active}
              onChange={(event) => change('active', event.target.checked)}
            />
            Доступен для новых документов
          </label>
          {value && (
            <p className="plain-note counterparty-history-note">
              Изменения справочника не меняют наименования в ранее оформленных приёмках и отгрузках.
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
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

export function CounterpartiesView({ store, act, busy }) {
  const [query, setQuery] = useState(''),
    [role, setRole] = useState(''),
    [archive, setArchive] = useState(false);
  const [editor, setEditor] = useState(null);
  const rows = store.counterparties
    .filter(
      (party) =>
        (archive || party.active) &&
        (!role || party[role]) &&
        containsText(query, party.code, party.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const page = usePagination(rows, JSON.stringify([query, role, archive]));
  return (
    <section>
      <SectionHead title="Поставщики и потребители" meta={String(rows.length)}>
        <button className="button primary" onClick={() => setEditor({ value: null })}>
          Добавить контрагента
        </button>
      </SectionHead>
      <div className="counterparty-filters">
        <input
          aria-label="Поиск контрагента"
          placeholder="Код или наименование"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Роль контрагента"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="">Все роли</option>
          <option value="isSupplier">Поставщики</option>
          <option value="isCustomer">Потребители</option>
        </select>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={archive}
            onChange={(event) => setArchive(event.target.checked)}
          />
          Показать недействующих
        </label>
      </div>
      <div className="table-scroll">
        <table className="data-table master-registry">
          <thead>
            <tr>
              <th>Код</th>
              <th>Наименование</th>
              <th>Роли</th>
              <th>Состояние</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {page.rows.map((party) => (
              <tr key={party.id}>
                <td className="mono">{party.code}</td>
                <td>
                  <button className="order-link" onClick={() => setEditor({ value: party })}>
                    {party.name}
                  </button>
                </td>
                <td>{rolesOf(party)}</td>
                <td>
                  <Badge status={party.active ? 'released' : 'planned'}>
                    {party.active ? 'Действует' : 'Не используется'}
                  </Badge>
                </td>
                <td>
                  <button className="text-button" onClick={() => setEditor({ value: party })}>
                    Изменить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <Empty
            title="Контрагенты не найдены"
            text="Измените условия поиска или добавьте контрагента."
          />
        )}
      </div>
      <Pagination state={page} />
      {editor && (
        <CounterpartyEditor
          {...{ store, act, busy }}
          value={editor.value}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}
