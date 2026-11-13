import { useEffect, useState } from 'react';
import type { Task } from '../api';
import { clock, STATE_LABEL, type StageState } from '../pipeline';

const CLS: Record<StageState, string> = {
  idle: 'chip',
  queued: 'chip',
  running: 'chip chip--run',
  done: 'chip chip--done',
  failed: 'chip chip--fail',
  stopped: 'chip',
};

/** No sign of work for this long while running: the chat may be stuck (sign-in, permission prompt). */
const QUIET_S = 300;

/**
 * One pipeline stage: title, status, the last progress lines and live proof of work
 * (timer, last agent command and how long ago), with Stop / Continue.
 */
export function StageCard({
  index,
  title,
  state,
  lines,
  task,
  activity = [],
  onStop,
  onRetry,
}: {
  index: number;
  title: string;
  state: StageState;
  lines: string[];
  task?: Task | null;
  activity?: { t: string; cmd: string }[];
  onStop?: (t: Task) => void;
  onRetry?: (t: Task) => void;
}) {
  const live = state === 'running';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  const started = task?.startedAt ? Date.parse(task.startedAt) : null;
  // Last sign of life: a progress line (task updatedAt) or an agent command after the start.
  const lastCmd = [...activity].reverse().find((a) => !started || Date.parse(a.t) >= started) ?? null;
  const stamps = [task?.updatedAt, lastCmd?.t].filter(Boolean).map((x) => Date.parse(x!));
  const lastSeen = stamps.length > 0 ? Math.max(...stamps) : started;
  const quietS = lastSeen ? (now - lastSeen) / 1000 : 0;

  return (
    <li className={`stagecard is-${state}`}>
      <div className="stagecard-head">
        <span className="stagecard-n" aria-hidden="true">{index}</span>
        <h2 className="stagecard-title">{title}</h2>
        {live && started && <span className="stagecard-timer" aria-label="o'tgan vaqt">{clock((now - started) / 1000)}</span>}
        <span className={CLS[state]}>
          <span className="dot" aria-hidden="true" />
          {STATE_LABEL[state]}
        </span>
        {task && (state === 'running' || state === 'queued') && onStop && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onStop(task)}>
            To'xtatish
          </button>
        )}
        {task && (state === 'stopped' || state === 'failed') && onRetry && (
          <button type="button" className="btn btn--dark btn--sm" onClick={() => onRetry(task)}>
            Davom ettirish
          </button>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="stagecard-log" aria-label={`${title}: so'nggi qadamlar`} aria-live="polite">
          {lines.map((l, i) => (
            <li key={`${i}-${l}`}>{l}</li>
          ))}
        </ul>
      )}
      {live && (
        <p className={quietS > QUIET_S ? 'stagecard-live is-quiet' : 'stagecard-live'}>
          {quietS > QUIET_S
            ? `Claude ${clock(quietS)} dan beri jim: chatni tekshiring (ruxsat so'rovi yoki qayta kirish kerak bo'lishi mumkin).`
            : `Oxirgi faollik ${Math.round(quietS)} s oldin${lastCmd ? ` · ${lastCmd.cmd}` : ''}`}
        </p>
      )}
      {state === 'failed' && task?.error && <p className="form-error small">{task.error}</p>}
    </li>
  );
}
