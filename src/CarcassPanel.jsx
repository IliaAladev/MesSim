import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { materialAssignments, operationOf, sourceLot, stockLots } from './domain.js';
import { carcassForOrder, freeCarriers, markingFor } from './carcassTracking.js';
import { carcassLabelSvg, downloadCarcassLabel } from './carcassLabel.js';
import { Field, SectionHead, fmt } from './ui.jsx';
import './carcass.css';

function CarcassDetails({ expanded, children }) {
  return expanded ? (
    <>{children}</>
  ) : (
    <details className="carcass-details">
      <summary>Сведения о туше</summary>
      {children}
    </details>
  );
}

export function CarcassQrButton({ store, carcassId, act, busy }) {
  const [error, setError] = useState(''),
    [preparing, setPreparing] = useState(false);
  const record = store.carcasses?.find((row) => row.id === carcassId);
  const job = markingFor(store, record);
  if (!job || !act) return null;
  return (
    <div className="carcass-download">
      <button
        className="button secondary compact"
        disabled={busy || preparing}
        onClick={async () => {
          setPreparing(true);
          setError('');
          try {
            const svg = carcassLabelSvg(job);
            if (await act({ type: 'exportCarcassMark', carcassId, jobId: job.id }))
              downloadCarcassLabel(job, svg);
          } catch {
            setError('Не удалось сформировать QR. Повторите скачивание.');
          } finally {
            setPreparing(false);
          }
        }}
      >
        <Download size={15} />
        Скачать QR
      </button>
      {error && (
        <p className="editor-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function CarcassPanel({ store, order, act, busy, readOnly = false }) {
  const operation = operationOf(order),
    record = carcassForOrder(store, order);
  const assignments = materialAssignments(order, operation);
  const assignedSource =
    assignments.find((row) => row.consumed) || assignments.find((row) => !row.consumed);
  const identifiedMaterial = operation.inputs.find((row) => row.source === 'stock')?.material;
  const [sourceId, setSourceId] = useState(assignedSource?.lotId || '');
  const [rfid, setRfid] = useState(''),
    [replace, setReplace] = useState(false);
  const [newRfid, setNewRfid] = useState(''),
    [reason, setReason] = useState('');
  const [error, setError] = useState(''),
    [preparing, setPreparing] = useState(false);
  useEffect(() => {
    setSourceId(assignedSource?.lotId || '');
    setRfid('');
    setError('');
    setReplace(false);
  }, [order.id, operation.id]);
  const job = markingFor(store, record);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!job) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(new Blob([carcassLabelSvg(job)], { type: 'image/svg+xml' }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [job?.id]);
  const identification = operation.carcassIdentification;
  if (!identification && !record) return null;
  const active = !readOnly && ['running', 'quality'].includes(order.status);
  const batch = store.slaughterBatches?.find((batch) => batch.id === record?.slaughterBatchId);
  const source = sourceLot(store, sourceId);
  const replacement = assignments.some((row) => !row.consumed && row.lotId !== sourceId);
  const markRequired =
    active && (identification || record?.origin === 'legacy') && job?.status !== 'applied';
  const full = identification || markRequired;
  return (
    <section className="carcass-panel">
      <SectionHead
        title={record?.slaughterNumber ? `Туша № ${record.slaughterNumber}` : 'Идентификация туши'}
        meta={!full && record?.currentRfid ? `RFID разноги · ${record.currentRfid}` : undefined}
      />
      {!record && active && identification && (
        <form
          className="carcass-identify"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            await act(
              {
                type: 'identifyCarcass',
                orderId: order.id,
                operationId: operation.id,
                sourceCode: sourceId,
                rfid,
                confirmConsumption: true,
                replaceReservation: replace,
              },
              'Туша идентифицирована, подача подтверждена',
            );
          }}
        >
          <Field label="Туша / MTU">
            <select
              aria-label="Туша / MTU"
              required
              value={sourceId}
              disabled={busy}
              onChange={(event) => {
                setSourceId(event.target.value);
                setReplace(false);
              }}
            >
              <option value="">Выберите учётную единицу</option>
              {stockLots(store)
                .filter(
                  (lot) =>
                    lot.material === identifiedMaterial &&
                    (lot.remaining > 0 || assignments.some((row) => row.lotId === lot.id)),
                )
                .map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.code} · {fmt(lot.qty, 3)} кг
                    {assignments.some((row) => row.lotId === lot.id && !row.consumed)
                      ? ' · резерв'
                      : ''}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="RFID разноги">
            <input
              aria-label="RFID разноги"
              required
              value={rfid}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => setRfid(event.target.value)}
            />
          </Field>
          <div className="carcass-scan">
            <button
              type="button"
              className="button secondary compact"
              disabled={busy || !freeCarriers(store).length}
              onClick={() => setRfid(freeCarriers(store)[0]?.code || '')}
            >
              Считать разногу
            </button>
          </div>
          {source && <p className="plain-note">Масса туши: {fmt(source.qty, 3)} кг</p>}
          {replacement && (
            <label className="check-control">
              <input
                type="checkbox"
                checked={replace}
                disabled={busy}
                onChange={(event) => setReplace(event.target.checked)}
              />
              <span>Заменить резерв выбранной тушей</span>
            </label>
          )}
          <button
            className="button primary"
            disabled={busy || !sourceId || !rfid.trim() || (replacement && !replace)}
          >
            Подтвердить подачу и идентифицировать
          </button>
        </form>
      )}
      {!record && !active && (
        <p className="plain-note">Запустите операцию для идентификации туши.</p>
      )}
      {record && (
        <CarcassDetails expanded={full}>
          <dl className="carcass-facts">
            <div>
              <dt>RFID разноги</dt>
              <dd>{record.currentRfid || 'Разнога освобождена'}</dd>
            </div>
            <div>
              <dt>Партия убоя</dt>
              <dd>{batch?.number || 'Ранее не зарегистрирована'}</dd>
            </div>
            <div>
              <dt>Постность · AutoFom III</dt>
              <dd>
                {record.primaryClassification
                  ? `${fmt(record.primaryClassification.lean, 3)} %`
                  : 'Не зарегистрирована'}
              </dd>
            </div>
          </dl>
          {active &&
            !record.primaryClassification &&
            (identification || record.origin === 'legacy') && (
              <div className="carcass-equipment">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      {
                        type: 'simulatePrimaryClassification',
                        orderId: order.id,
                        operationId: operation.id,
                      },
                      'Данные AutoFom получены, номер убоя присвоен',
                    )
                  }
                >
                  Получить данные AutoFom
                </button>
              </div>
            )}
          {job && (
            <div className={`carcass-marking ${full ? '' : 'compact'}`}>
              {full && preview && (
                <img
                  className="carcass-label-preview"
                  src={preview}
                  alt={`QR маркировки туши ${record.slaughterNumber}`}
                />
              )}
              <div>
                <h3>Маркировка туши</h3>
                <p>
                  {job.status === 'applied'
                    ? 'Нанесение подтверждено'
                    : job.exports.length
                      ? 'Файл QR подготовлен. Нанесение не подтверждено.'
                      : 'QR готов к скачиванию'}
                </p>
                <div className="carcass-marking-actions">
                  <button
                    className="button secondary"
                    disabled={busy || preparing}
                    onClick={async () => {
                      setPreparing(true);
                      setError('');
                      try {
                        const svg = carcassLabelSvg(job);
                        if (
                          await act({
                            type: 'exportCarcassMark',
                            carcassId: record.id,
                            jobId: job.id,
                          })
                        )
                          downloadCarcassLabel(job, svg);
                      } catch {
                        setError('Не удалось сформировать файл QR. Повторите скачивание.');
                      } finally {
                        setPreparing(false);
                      }
                    }}
                  >
                    <Download size={15} />
                    Скачать QR
                  </button>
                  {markRequired && (
                    <button
                      className="button primary"
                      disabled={busy || !job.exports.length}
                      onClick={() =>
                        act(
                          { type: 'confirmCarcassMark', carcassId: record.id, jobId: job.id },
                          'Нанесение маркировки подтверждено',
                        )
                      }
                    >
                      Подтвердить нанесение
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          <details className="carcass-carriers">
            <summary>История разног · {record.carrierHistory.length}</summary>
            {record.carrierHistory.map((row, i) => (
              <div key={i}>
                <strong>{row.code}</strong>
                <span>
                  {row.releasedAt ? 'Освобождена' : 'Текущая'}
                  {row.reason ? ` · ${row.reason}` : ''}
                </span>
              </div>
            ))}
            {active && record.currentRfid && (
              <form
                className="carcass-rebind"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (
                    await act(
                      { type: 'rebindCarcassCarrier', orderId: order.id, rfid: newRfid, reason },
                      'Разнога изменена, идентификатор туши сохранён',
                    )
                  ) {
                    setNewRfid('');
                    setReason('');
                  }
                }}
              >
                <Field label="Новая RFID-разнога">
                  <input
                    required
                    value={newRfid}
                    disabled={busy}
                    onChange={(event) => setNewRfid(event.target.value)}
                  />
                </Field>
                <Field label="Причина смены разноги">
                  <input
                    required
                    value={reason}
                    disabled={busy}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
                <button className="button secondary compact" disabled={busy}>
                  Сменить разногу
                </button>
              </form>
            )}
          </details>
        </CarcassDetails>
      )}
      {error && (
        <p className="editor-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
