// Edit by text: the words in timestamped rows (a row ends at a sentence, a pause over 0.6 s, or 12 words). Cut words
// are struck through, suggested ones marked. Click seeks; shift-click selects a range to cut or restore. The keyboard
// gets one tab stop for the whole transcript (roving focus): arrows move word by word, Shift+arrows select.
import type {View, ViewWord} from './api';
import {clock} from './api';
import {useT} from './i18n';

export type Sel = {a: number; b: number} | null;

type Props = {
  view: View;
  sel: Sel;
  now: number; // output seconds
  onPick(i: number, extend: boolean): void;
  onCut(): void;
  onRestore(k: number): void;
};

const rowsOf = (words: ViewWord[]) => {
  const rows: ViewWord[][] = [];
  let cur: ViewWord[] = [];
  words.forEach((w, k) => {
    cur.push(w);
    const next = words[k + 1];
    if (!next || /[.?!…]$/.test(w.text) || next.start - w.end > 0.6 || cur.length >= 12) {
      rows.push(cur);
      cur = [];
    }
  });
  return rows;
};

export const Transcript = ({view, sel, now, onPick, onCut, onRestore}: Props) => {
  const t = useT();
  const removedOf = new Map<number, number>();
  for (const r of view.removed) if (r.from !== undefined && r.to !== undefined) for (let i = r.from; i <= r.to; i++) removedOf.set(i, r.k);
  const suggested = new Set<number>();
  for (const r of view.suggested) if (r.from !== undefined && r.to !== undefined) for (let i = r.from; i <= r.to; i++) suggested.add(i);
  const lo = sel ? Math.min(sel.a, sel.b) : -1;
  const hi = sel ? Math.max(sel.a, sel.b) : -1;
  // the word being spoken: the last kept word that started before the playhead
  const current = view.words.filter((w) => w.out !== null && w.out <= now + 0.01).at(-1)?.i ?? -1;
  const selRemoved = sel ? removedOf.get(lo) : undefined;
  const focusable = lo >= 0 ? lo : Math.max(0, current);
  const onKey = (e: React.KeyboardEvent<HTMLOListElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const at = Number((e.target as HTMLElement).dataset.i);
    if (!d || Number.isNaN(at)) return;
    e.preventDefault();
    const i = Math.min(view.words.length - 1, Math.max(0, at + d));
    onPick(i, e.shiftKey);
    (e.currentTarget.querySelector(`[data-i="${i}"]`) as HTMLElement | null)?.focus();
  };

  return (
    <div className="transcript">
      <p className="hint pad">{t('selectHint')}</p>
      <ol className="rows" onKeyDown={onKey}>
        {rowsOf(view.words).map((row) => {
          const first = row.find((w) => w.out !== null);
          const live = row.some((w) => w.i === current);
          return (
            <li key={row[0].i} className={live ? 'row now' : 'row'}>
              <button className="tc" tabIndex={-1} disabled={!first} onClick={() => first && onPick(first.i, false)}>
                {first ? clock(first.out!) : t('cutWord')}
              </button>
              <p>
                {row.map((w) => {
                  const cls = ['wd'];
                  if (!w.kept) cls.push('gone');
                  if (removedOf.has(w.i)) cls.push('cut');
                  if (suggested.has(w.i)) cls.push('sug');
                  if (w.i >= lo && w.i <= hi) cls.push('sel');
                  if (w.i === current) cls.push('cur');
                  if (w.conf !== null && w.conf < 0.6) cls.push('low');
                  return <button key={w.i} data-i={w.i} tabIndex={w.i === focusable ? 0 : -1} className={cls.join(' ')} aria-pressed={w.i >= lo && w.i <= hi}
                    onClick={(e) => onPick(w.i, e.shiftKey)}>{w.text}</button>;
                })}
              </p>
            </li>
          );
        })}
      </ol>
      {sel && (
        <div className="selbar">
          <span>{hi - lo + 1} {t('selected')}</span>
          {selRemoved !== undefined
            ? <button className="btn" onClick={() => onRestore(selRemoved)}>{t('restore')}</button>
            : <button className="btn danger" onClick={onCut}>{t('cut')}</button>}
        </div>
      )}
    </div>
  );
};
