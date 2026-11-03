// "Elementlar": every shot, overlay and transition of the edit as a list, in place of a timeline. A row seeks there
// and opens it; an overlay or a shot boundary nudges by a frame or half a second; anything can go, or be marked
// "not this" (a lesson). Every change is one ops batch, anchored on words so it follows later cuts.
import {clock, type Op, type Span, type View} from './api';
import {Dislike} from './Dislike';
import {useT, type Key} from './i18n';
import {snap, timeToAnchor} from './timeAnchor';

export type Item = {kind: 'overlay' | 'transition' | 'shot'; id: string};
type Props = {view: View; item: Item | null; now: number; onItem(i: Item): void; seek(s: number): void; apply(why: string, ops: Op[]): void; onError(m: string): void};

export const Elements = ({view, item, now, onItem, seek, apply, onError}: Props) => {
  const t = useT();
  const fps = view.fps;
  const anchor = (s: number) => timeToAnchor(view.words, s, fps);
  const at = (s: number) => {
    const w = view.words.filter((x) => x.out !== null && x.out <= s + 0.01).at(-1);
    return w ? `word:${w.i}` : undefined;
  };

  // an overlay moves whole; a shot moves its start (the one before it ends there), never past its neighbours
  const nudge = (kind: Item['kind'], s: Span, d: number) => {
    if (kind === 'overlay') {
      const a = snap(s.start + d, fps, view.durationS), b = snap(s.end + d, fps, view.durationS);
      if (b - a < s.end - s.start - 0.5 / fps) return; // at an edge of the video
      apply('studio: overlay nudged', [{op: 'overlay.retime', id: s.id, from: anchor(a), to: anchor(b)}]);
    } else {
      const i = view.lanes.shots.findIndex((x) => x.id === s.id);
      const prev = view.lanes.shots[i - 1];
      const a = snap(s.start + d, fps, view.durationS);
      if (!prev || a <= prev.start + 2 / fps || a >= s.end - 2 / fps) return;
      apply('studio: shot start nudged', [{op: 'shot.update', id: s.id, set: {from: anchor(a)}}]);
    }
  };

  const steps: [string, number][] = [['−0.5s', -0.5], ['−1f', -1 / fps], ['+1f', 1 / fps], ['+0.5s', 0.5]];
  const group = (kind: Item['kind'], title: Key, spans: Span[]) => (
    <div className="sec">
      <h3>{t(title)} <span>{spans.length}</span></h3>
      {!spans.length && <p className="hint">{t('none')}</p>}
      <ul className="elements">
        {spans.map((s, i) => {
          const on = item?.kind === kind && item.id === s.id;
          const here = now >= s.start && now < s.end;
          const movable = kind === 'overlay' || (kind === 'shot' && i > 0);
          return (
            <li key={s.id} className={`${on ? 'on' : ''}${here ? ' here' : ''}`}>
              <button className="row" onClick={() => { seek(s.start); onItem({kind, id: s.id}); }} aria-pressed={on}>
                <span className="tc">{clock(s.start)}–{clock(s.end)}</span>
                <b>{s.component ?? [s.kind, s.level].filter(Boolean).join(' · ')}</b>
                <small>{s.id}</small>
              </button>
              {on && (
                <div className="acts">
                  {movable && steps.map(([label, d]) => (
                    <button key={label} className="btn slim" onClick={() => nudge(kind, s, d)}>{label}</button>
                  ))}
                  <span className="spacer" />
                  {!(kind === 'shot' && i === 0) && (
                    <button className="btn danger slim" onClick={() => apply(`studio: remove ${kind}`, [{op: `${kind}.remove`, id: s.id}])}>{t('remove')}</button>
                  )}
                  <Dislike style={view.style} what={`${kind} ${s.id}`} component={s.component ?? null} at={at(s.start)} apply={apply} onError={onError} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <>
      {group('overlay', 'overlays', view.lanes.overlays)}
      {group('transition', 'transitions', view.lanes.transitions)}
      {group('shot', 'shots', view.lanes.shots)}
    </>
  );
};
