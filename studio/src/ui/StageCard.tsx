import { STATE_LABEL, type StageState } from '../pipeline';

const CLS: Record<StageState, string> = {
  idle: 'chip',
  queued: 'chip',
  running: 'chip chip--run',
  done: 'chip chip--done',
  failed: 'chip chip--fail',
};

/** One pipeline stage: title, status chip and the last few progress lines. */
export function StageCard({ index, title, state, lines }: { index: number; title: string; state: StageState; lines: string[] }) {
  return (
    <li className={`stagecard is-${state}`}>
      <div className="stagecard-head">
        <span className="stagecard-n" aria-hidden="true">{index}</span>
        <h2 className="stagecard-title">{title}</h2>
        <span className={CLS[state]}>
          <span className="dot" aria-hidden="true" />
          {STATE_LABEL[state]}
        </span>
      </div>
      {lines.length > 0 && (
        <ul className="stagecard-log" aria-label={`${title}: so'nggi qadamlar`} aria-live="polite">
          {lines.map((l, i) => (
            <li key={`${i}-${l}`}>{l}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
