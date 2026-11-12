import { useState } from 'react';
import { errorText } from '../errors';
import { api, type Task } from '../api';
import { fmtUsd } from '../pipeline';

const UNKNOWN = "Holat noma'lum — provayder panelini tekshiring";

function field(t: Task, key: string): string {
  const v = t.input[key];
  return typeof v === 'string' ? v : '';
}

function prompt(t: Task): string {
  const params = t.input.params as { prompt?: unknown } | null | undefined;
  return params && typeof params.prompt === 'string' ? params.prompt : '';
}

/** Paid generation tasks waiting for a click; money moves only on "Tasdiqlash". */
export function ApproveCost({
  projectId,
  pending,
  unknown,
  onChanged,
}: {
  projectId: string;
  pending: Task[];
  unknown: Task[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(t: Task, kind: 'approve' | 'decline') {
    if (busy) return;
    setBusy(t.id);
    setError(null);
    try {
      await (kind === 'approve' ? api.approveTask(projectId, t.id) : api.declineTask(projectId, t.id));
      onChanged();
    } catch (e) {
      setError(errorText((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  if (pending.length === 0 && unknown.length === 0) return null;

  return (
    <section className="block" aria-labelledby="approve-h">
      <h2 id="approve-h" className="block-h">Pullik generatsiya</h2>
      {pending.length > 0 && (
        <>
          <p className="muted small">Pul faqat Tasdiqlash bosilganda yechiladi.</p>
          <ul className="approve-list">
            {pending.map((t) => {
              const text = prompt(t);
              const usd = typeof t.input.usd === 'number' ? t.input.usd : 0;
              return (
                <li key={t.id} className="approve">
                  <div className="approve-body">
                    <span className="approve-meta">
                      {field(t, 'sceneId') || t.id} · {field(t, 'kind')}
                    </span>
                    <span className="approve-prompt" title={text}>{text.length > 90 ? `${text.slice(0, 90)}…` : text}</span>
                  </div>
                  <span className="approve-usd">{fmtUsd(usd)}</span>
                  <div className="approve-btns">
                    <button type="button" className="btn btn--dark btn--sm" disabled={busy !== null} onClick={() => void act(t, 'approve')}>
                      Tasdiqlash
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" disabled={busy !== null} onClick={() => void act(t, 'decline')}>
                      Rad etish
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {unknown.map((t) => (
        <p key={t.id} className="form-error" role="alert">
          {field(t, 'sceneId') || t.id}: {UNKNOWN}
        </p>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

