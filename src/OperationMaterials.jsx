import { resolveCarcassLot } from './carcassTracking.js';
import { agroMaterialCaption } from './agroCatalog.js';
import React, { useEffect, useState } from 'react';
import {
  materialAssignments,
  materialOf,
  scaledQty,
  sourceLot,
  stockLots,
  stockBalance,
  round,
  uid,
} from './domain.js';
import { Field, SectionHead, fmt } from './ui.jsx';

export function OperationMaterials({ store, order, operation, act, busy }) {
  const inputs = operation.inputs.filter((item) => item.source === 'stock');
  const [inputId, setInputId] = useState(inputs[0]?.id || '');
  const [code, setCode] = useState(''),
    [qty, setQty] = useState('');
  const [replace, setReplace] = useState(false),
    [movementId, setMovementId] = useState(uid);
  useEffect(() => {
    setInputId(inputs[0]?.id || '');
    setCode('');
    setQty('');
    setReplace(false);
    setMovementId(uid());
  }, [order.id, operation.id]);
  if (!inputs.length) return null;
  const assignments = materialAssignments(order, operation);
  const rowsFor = (id) => assignments.filter((item) => item.inputId === id);
  const consumed = (id) =>
    round(
      rowsFor(id)
        .filter((item) => item.consumed)
        .reduce((sum, item) => sum + item.qty, 0),
    );
  const remaining = (input) =>
    materialOf(store, input.material)?.lotMode === 'livestock'
      ? consumed(input.id) > 0
        ? 0
        : scaledQty(input, order)
      : round(Math.max(0, scaledQty(input, order) - consumed(input.id)));
  const pending = inputs.filter((input) => remaining(input) > 0.0005);
  const active = ['running', 'quality'].includes(order.status);
  const selectedInput = inputs.find((item) => item.id === inputId);
  const selectedLot = stockLots(store).find((lot) =>
    [lot.id, lot.code, lot.mtuCode].some(
      (value) => value?.toLocaleLowerCase() === code.trim().toLocaleLowerCase(),
    ),
  );
  const scannedCarcassLot = selectedLot || resolveCarcassLot(store, code, selectedInput?.material);
  const reserves = rowsFor(inputId).filter((item) => !item.consumed);
  const totalReserve = reserves.reduce((sum, item) => sum + item.qty, 0);
  const ownReserve = reserves
    .filter((item) => item.lotId === scannedCarcassLot?.id)
    .reduce((sum, item) => sum + item.qty, 0);
  const replacement =
    scannedCarcassLot &&
    selectedInput &&
    scannedCarcassLot.material === selectedInput.material &&
    totalReserve > ownReserve + 0.0005 &&
    (materialOf(store, selectedInput.material)?.lotMode === 'livestock'
      ? totalReserve > ownReserve
      : totalReserve + Number(qty) - Math.min(Number(qty), ownReserve) >
        remaining(selectedInput) + 0.0005);
  return (
    <section className="operation-mtu">
      <SectionHead
        title={
          active || ['hold', 'reinspection'].includes(order.status)
            ? 'Списание сырья'
            : 'Резерв сырья'
        }
      />
      <div className="table-scroll">
        <table className="data-table operation-materials">
          <thead>
            <tr>
              <th>Материал</th>
              <th>По плану</th>
              <th>В резерве</th>
              <th>Списано</th>
              <th>MTU / партия</th>
            </tr>
          </thead>
          <tbody>
            {inputs.map((input) => (
              <tr key={input.id}>
                <td>{agroMaterialCaption(input)}</td>
                <td>
                  {fmt(scaledQty(input, order), 3)} {input.unit}
                </td>
                <td>
                  {fmt(
                    rowsFor(input.id)
                      .filter((row) => !row.consumed)
                      .reduce((sum, row) => sum + row.qty, 0),
                    3,
                  )}{' '}
                  {input.unit}
                </td>
                <td>
                  {fmt(consumed(input.id), 3)} {input.unit}
                </td>
                <td>
                  {rowsFor(input.id).map((row, index) => (
                    <div key={row.movementId || index}>
                      {row.mtuCode ||
                        sourceLot(store, row.lotId)?.mtuCode ||
                        sourceLot(store, row.lotId)?.code}{' '}
                      · {fmt(row.qty, 3)} {input.unit} · {row.consumed ? 'списано' : 'резерв'}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!active && pending.length > 0 && (
        <p className="plain-note">
          MTU и фактическое количество подтверждаются оператором после запуска операции.
        </p>
      )}
      {active && pending.length > 0 && (
        <form
          className="mtu-entry"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await act(
                {
                  type: 'consumeMaterial',
                  orderId: order.id,
                  operationId: operation.id,
                  inputId,
                  code,
                  qty,
                  movementId,
                  replaceReservation: replace,
                },
                'Списание сырья сохранено',
              )
            ) {
              setCode('');
              setQty('');
              setReplace(false);
              setMovementId(uid());
              if (
                selectedInput &&
                (materialOf(store, selectedInput.material)?.lotMode === 'livestock' ||
                  Number(qty) >= remaining(selectedInput) - 0.0005)
              )
                setInputId(pending.find((input) => input.id !== inputId)?.id || inputId);
            }
          }}
        >
          <Field label="Материал операции">
            <select
              value={inputId}
              onChange={(event) => {
                setInputId(event.target.value);
                setCode('');
                setQty('');
                setReplace(false);
                setMovementId(uid());
              }}
            >
              {inputs.map((input) => (
                <option key={input.id} value={input.id}>
                  {agroMaterialCaption(input)}
                  {remaining(input) <= 0.0005 ? ' · списано' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={
              materialOf(store, selectedInput?.material)?.lotMode === 'individual'
                ? 'MTU / QR / номер убоя'
                : 'MTU / код партии'
            }
          >
            <input
              required
              aria-label="MTU / код партии"
              autoComplete="off"
              list={`mtus-${order.id}-${operation.id}`}
              value={code}
              disabled={busy}
              onChange={(event) => {
                setCode(event.target.value);
                setReplace(false);
              }}
            />
            <datalist id={`mtus-${order.id}-${operation.id}`}>
              {stockLots(store)
                .filter(
                  (lot) =>
                    lot.material === selectedInput?.material &&
                    lot.status === 'released' &&
                    lot.expires >= order.date &&
                    stockBalance(lot) > 0,
                )
                .map((lot) => (
                  <option key={lot.id} value={lot.mtuCode || lot.code}>
                    {lot.code} · остаток {fmt(stockBalance(lot), 3)} {selectedInput?.unit}
                  </option>
                ))}
            </datalist>
          </Field>
          <Field label={`Количество, ${selectedInput?.unit || ''}`}>
            <input
              required
              aria-label="Количество списания"
              type="number"
              min={selectedInput?.unit === 'шт' ? 1 : 0.001}
              step={selectedInput?.unit === 'шт' ? 1 : 0.001}
              value={qty}
              disabled={busy}
              onChange={(event) => {
                setQty(event.target.value);
                setReplace(false);
              }}
            />
          </Field>
          <button
            className="button secondary"
            disabled={
              busy ||
              !selectedInput ||
              remaining(selectedInput) <= 0.0005 ||
              (replacement && !replace)
            }
          >
            Списать сырьё
          </button>
          {replacement && (
            <label className="check-control mtu-replacement">
              <input
                type="checkbox"
                checked={replace}
                disabled={busy}
                onChange={(event) => setReplace(event.target.checked)}
              />
              <span>Заменить резерв другой MTU на указанное количество и списать</span>
            </label>
          )}
        </form>
      )}
    </section>
  );
}
