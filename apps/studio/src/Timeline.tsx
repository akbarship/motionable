// Lanes over output time: words, shots, caption lines, overlays, transitions, notes, with the playhead. Click to
// seek. Overlays drag (move, or stretch an edge) and shot boundaries drag; the drop is one op on word anchors, so the
// timing follows the words through later cuts. Esc cancels a drag; ←/→ nudge a picked overlay a frame (Shift: 10).
import {useEffect, useRef, useState} from 'react';
import type {Op, Span, View} from './api';
import {useT, type Key} from './i18n';
import {snap, timeToAnchor} from './timeAnchor';

type Drag = {kind: 'overlay' | 'shot'; id: string; mode: 'move' | 'start' | 'end'; x0: number; start: number; end: number; min: number; max: number; dx: number};
const EDGE = 7; // px: grabbing this close to a chip's edge stretches it

const PX = 48; // pixels per second

type Props = {view: View; now: number; line: string | null; item: {kind: string; id: string} | null; onSeek(t: number): void; onLine(id: string): void;
  onItem(kind: 'overlay' | 'transition', id: string): void; onNote(): void; apply(why: string, ops: Op[]): void; onDragging?(on: boolean): void};

export const Timeline = ({view, now, line, item, onSeek, onLine, onItem, onNote, apply, onDragging}: Props) => {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const moved = useRef(false);
  const dragNow = useRef<Drag | null>(null); // the drag as the pointer left it (state updaters must stay pure)
  dragNow.current = drag;
  useEffect(() => onDragging?.(drag !== null), [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const fps = view.fps;
  const anchor = (s: number) => timeToAnchor(view.words, s, fps);
  // the span a drag is showing: moved, or one edge stretched, kept inside its limits and at least 2 frames long
  const span = (d: Drag) => {
    const dt = d.dx / PX;
    const len = d.end - d.start;
    let a = d.start, b = d.end;
    if (d.mode === 'move') { a = Math.min(Math.max(d.start + dt, d.min), d.max - len); b = a + len; }
    if (d.mode === 'start') a = Math.min(Math.max(d.start + dt, d.min), d.end - 2 / fps);
    if (d.mode === 'end') b = Math.max(Math.min(d.end + dt, d.max), d.start + 2 / fps);
    return {start: snap(a, fps, view.durationS), end: snap(b, fps, view.durationS)};
  };
  const commit = (d: Drag) => {
    const s = span(d);
    if (Math.abs(s.start - d.start) < 0.5 / fps && Math.abs(s.end - d.end) < 0.5 / fps) return; // held at a limit: nothing moved
    if (d.kind === 'overlay') apply('studio: overlay moved on the timeline', [{op: 'overlay.retime', id: d.id, from: anchor(s.start), to: anchor(s.end)}]);
    else apply('studio: shot boundary moved on the timeline', [{op: 'shot.update', id: d.id, set: {from: anchor(s.start)}}]);
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - drag.x0) > 2) moved.current = true;
      const d = {...dragNow.current!, dx: e.clientX - drag.x0};
      dragNow.current = d;
      setDrag(d);
    };
    const up = () => {
      const d = dragNow.current;
      dragNow.current = null;
      setDrag(null);
      if (d && moved.current) commit(d); // once, outside any updater
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (moved.current = false, setDrag(null));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [drag?.id, drag?.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // ←/→ nudge the picked overlay by a frame, Shift by ten
  useEffect(() => {
    if (item?.kind !== 'overlay') return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const o = view.lanes.overlays.find((x) => x.id === item.id);
      if (!o) return;
      e.preventDefault();
      const d = ((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1)) / fps;
      const a = snap(o.start + d, fps, view.durationS), b = snap(o.end + d, fps, view.durationS);
      if (b - a < (o.end - o.start) - 0.5 / fps) return; // at an edge of the video
      apply('studio: overlay nudged', [{op: 'overlay.retime', id: o.id, from: anchor(a), to: anchor(b)}]);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const grab = (e: React.PointerEvent<HTMLElement>, kind: Drag['kind'], s: Span, min: number, max: number, edgesOnly = false) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mode: Drag['mode'] = e.clientX - r.left < EDGE ? 'start' : r.right - e.clientX < EDGE ? 'end' : 'move';
    if (edgesOnly && mode !== 'start') return;
    e.preventDefault();
    moved.current = false;
    setDrag({kind, id: s.id, mode, x0: e.clientX, start: s.start, end: s.end, min, max, dx: 0});
  };
  const shown = (kind: Drag['kind'], s: Span) => (drag && drag.kind === kind && drag.id === s.id ? {...s, ...span(drag)} : s);
  const width = Math.ceil(view.durationS * PX) + 40;

  // caption lines in output time: from their first kept word to the next line (or their last word's end)
  const kept = view.lines.filter((l) => !l.hidden).map((l) => {
    const ws = l.words.map((i) => view.words[i]).filter((w) => w?.out !== null);
    return ws.length ? {l, start: ws[0].out!, end: ws[ws.length - 1].out! + (ws[ws.length - 1].end - ws[ws.length - 1].start)} : null;
  }).filter((x) => x !== null);
  const captions: (Span & {role: string})[] = kept.map((x, k) => ({id: x.l.id, role: x.l.role, start: x.start,
    end: Math.max(x.end, Math.min(kept[k + 1]?.start ?? x.end, x.end + 0.6))}));
  const words: Span[] = view.words.filter((w) => w.out !== null).map((w) => ({id: w.text, start: w.out!, end: w.out! + (w.end - w.start)}));

  // keep the playhead in view while playing
  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const x = now * PX;
    if (x < s.scrollLeft || x > s.scrollLeft + s.clientWidth - 40) s.scrollLeft = Math.max(0, x - 80);
  }, [now]);

  const seekAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (moved.current) return void (moved.current = false); // the click that ends a drag isn't a seek
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(view.durationS, (e.clientX - r.left) / PX)));
  };

  const lanes: [Key, string, React.ReactNode][] = [
    ['words', 'var(--c-word)', words.map((w, k) => <i key={k} className="chip word" style={pos(w)}>{w.id}</i>)],
    ['shots', 'var(--c-cam)', view.lanes.shots.map((s0, k, all) => {
      const s = shown('shot', s0);
      // a shot's start moves between the previous shot's start and its own end (the first shot starts the video)
      const min = k > 0 ? all[k - 1].start + 2 / fps : 0, max = s0.end;
      return (
        <i key={s.id} className={`chip shot${k > 0 ? ' grab-start' : ''}${drag?.id === s.id ? ' dragging' : ''}`} style={{...pos(s), background: 'var(--c-cam)'}}
          onPointerDown={k > 0 ? (e) => grab(e, 'shot', s0, min, max, true) : undefined}
          title={k > 0 ? t('dragShot') : undefined}>{s.id} · {s.level}{drag?.id === s.id && <b className="dragtime">{s.start.toFixed(2)}s</b>}</i>
      );
    })],
    ['captions', 'var(--c-capt)', captions.map((c) => (
      <i key={c.id} className={`chip cap${c.role === 'key' ? ' key' : ''}${c.id === line ? ' sel' : ''}`} style={pos(c)}
        onClick={(e) => { e.stopPropagation(); onLine(c.id); onSeek(c.start); }}>{view.lines.find((l) => l.id === c.id)!.words.map((i) => view.words[i].text).join(' ')}</i>
    ))],
    ['overlays', 'var(--c-over)', view.lanes.overlays.map((s0) => {
      const s = shown('overlay', s0);
      return (
        <i key={s.id} className={`chip grab${item?.kind === 'overlay' && item.id === s.id ? ' sel' : ''}${drag?.id === s.id ? ' dragging' : ''}`}
          style={{...pos(s), background: 'var(--c-over)'}} title={t('dragOverlay')}
          onPointerDown={(e) => grab(e, 'overlay', s0, 0, view.durationS)}
          onClick={(e) => { e.stopPropagation(); if (!moved.current) { onItem('overlay', s.id); onSeek(s.start); } }}>
          {s.id} · {s.component}{drag?.id === s.id && <b className="dragtime">{s.start.toFixed(2)}–{s.end.toFixed(2)}s</b>}
        </i>
      );
    })],
    ['transitions', 'var(--c-tr)', view.lanes.transitions.map((s) => (
      <i key={s.id} className={`chip${item?.kind === 'transition' && item.id === s.id ? ' sel' : ''}`} style={{...pos(s), background: 'var(--c-tr)'}}
        onClick={(e) => { e.stopPropagation(); onItem('transition', s.id); onSeek(s.start); }}>{s.component}</i>
    ))],
    ['notes', 'var(--blue)', view.notes.filter((n) => n.t !== undefined).map((n) => (
      <i key={n.id} className={`pin ${n.status}`} style={n.tEnd !== undefined ? pos({start: n.t!, end: n.tEnd}) : {left: n.t! * PX - 6}} title={n.text}
        onClick={(e) => { e.stopPropagation(); onSeek(n.t!); onNote(); }} />
    ))],
  ];

  return (
    <section className="tl" aria-label="timeline">
      <div className="labels">
        <div className="ruler" />
        {lanes.map(([k, c]) => <div key={k}><i style={{background: c}} />{t(k)}</div>)}
      </div>
      <div className="scroller" ref={scroller}>
        <div className="lanes" style={{width}} onClick={seekAt}>
          <div className="lane ruler">
            {Array.from({length: Math.ceil(view.durationS) + 1}, (_, s) => (
              <span key={s} className={`tick${s % 5 ? ' minor' : ''}`} style={{left: s * PX}}>{s % 5 ? '' : `${s}s`}</span>
            ))}
          </div>
          {lanes.map(([k, , items]) => <div key={k} className="lane">{items}</div>)}
          <div className="playhead" style={{left: now * PX}} />
        </div>
      </div>
    </section>
  );
};

const pos = (s: {start: number; end: number}) => ({left: s.start * PX, width: Math.max(4, (s.end - s.start) * PX - 2)});
