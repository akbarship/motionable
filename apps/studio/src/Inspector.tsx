// Right panel: the transcript, cut suggestions (accept or dismiss), the picked caption line (role, hidden, component
// and its props), and timed notes for Claude. Every change goes out as one ops batch.
import {useEffect, useState} from 'react';
import {clock, type ClaudeRun, type ComponentInfo, type Lesson, type Op, type PropSpec, type View} from './api';
import {Dislike} from './Dislike';
import {Lessons} from './Lessons';
import {pick, useT, type Lang} from './i18n';
import {Transcript, type Sel} from './Transcript';

export type Tab = 'transcript' | 'cuts' | 'captions' | 'notes';
export type Item = {kind: 'overlay' | 'transition'; id: string};
type Props = {
  view: View;
  lang: Lang;
  components: Record<string, ComponentInfo>;
  line: string | null;
  item: Item | null;
  lessons: Lesson[];
  onError(m: string): void;
  sel: Sel;
  now: number;
  tab: Tab;
  setTab(t: Tab): void;
  onPick(i: number, extend: boolean): void;
  onCut(): void;
  onRestore(k: number): void;
  seek(s: number): void;
  claude: ClaudeRun | null;
  sendClaude(): void;
  stopClaude(): void;
  copyPrompt(): void;
  apply(why: string, ops: Op[]): void;
};

export const Inspector = (props: Props) => {
  const {view, lang, components, line, sel, now, tab, setTab, apply} = props;
  const t = useT();
  const open = view.notes.filter((n) => n.status === 'open').length;
  return (
    <aside className="insp">
      <div className="tabs" role="tablist">
        {(['transcript', 'cuts', 'captions', 'notes'] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t(k)}
            {k === 'cuts' && view.suggested.length ? <span className="badge">{view.suggested.length}</span> : null}
            {k === 'notes' && open ? <span className="badge blue">{open}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'transcript' && <Transcript view={view} sel={sel} now={now} onPick={props.onPick} onCut={props.onCut} onRestore={props.onRestore} />}
      {tab === 'cuts' && <Cuts view={view} apply={apply} />}
      {tab === 'captions' && (props.item
        ? <Picked view={view} item={props.item} apply={apply} onError={props.onError} />
        : <Captions view={view} lang={lang} components={components} line={line} apply={apply} onError={props.onError} />)}
      {tab === 'notes' && <Notes {...props} />}
    </aside>
  );
};

const text = (view: View, from?: number, to?: number) =>
  from === undefined || to === undefined ? '' : view.words.slice(from, to + 1).map((w) => w.text).join(' ');

const Cuts = ({view, apply}: {view: View; apply: Props['apply']}) => {
  const t = useT();
  return (
    <>
      <div className="sec">
        <h3>{t('suggested')} <span>{view.suggested.length}</span></h3>
        {!view.suggested.length && <p className="hint">{t('noSuggestions')}</p>}
        {view.suggested.map((r) => (
          <div className="card" key={`s${r.k}`}>
            <div className="t"><b>«{text(view, r.from, r.to)}»</b><span className="tag">{r.kind}</span></div>
            {(r.why || r.evidence?.length) && <p className="muted">{r.why ?? r.evidence?.join('; ')}</p>}
            <div className="btnrow">
              <button className="btn danger" onClick={() => apply('studio: accept suggested cut', [{op: 'range.cut', from: r.anchors[0], to: r.anchors[1], kind: r.kind,
                ...(r.evidence ? {evidence: r.evidence} : {}), why: r.why ?? 'accepted in the Studio'}])}>{t('accept')}</button>
              <button className="btn" onClick={() => apply('studio: dismiss suggestion', [{op: 'range.dismiss', from: r.anchors[0], to: r.anchors[1]}])}>{t('dismiss')}</button>
            </div>
          </div>
        ))}
      </div>
      <div className="sec">
        <h3>{t('removed')} <span>{view.removed.length}</span></h3>
        {!view.removed.length && <p className="hint">{t('none')}</p>}
        {view.removed.map((r) => (
          <div className="card" key={`r${r.k}`}>
            <div className="t"><s>«{text(view, r.from, r.to)}»</s><span className="tag">{r.kind}</span></div>
            {r.why && <p className="muted">{r.why}</p>}
            <div className="btnrow">
              <button className="btn" onClick={() => apply('studio: restore', [{op: 'range.restore', from: r.anchors[0], to: r.anchors[1]}])}>{t('restore')}</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

/** An overlay or a transition picked on the timeline: what it is, take it out, or say it's wrong. */
const Picked = ({view, item, apply, onError}: Pick<Props, 'view' | 'apply' | 'onError'> & {item: Item}) => {
  const t = useT();
  const span = (item.kind === 'overlay' ? view.lanes.overlays : view.lanes.transitions).find((x) => x.id === item.id);
  if (!span) return <div className="sec"><p className="hint">{t('pickLine')}</p></div>;
  const w = view.words.filter((x) => x.out !== null && x.out <= span.start + 0.01).at(-1);
  return (
    <div className="sec">
      <h3>{t(item.kind)} <span>{item.id}</span></h3>
      <p className="linetext">{span.component}</p>
      <div className="field"><label>{t('span')}</label><span>{clock(span.start)}–{clock(span.end)}</span></div>
      <div className="btnrow wrap">
        <button className="btn danger" onClick={() => apply(`studio: remove ${item.kind}`, [{op: `${item.kind}.remove`, id: item.id}])}>{t('removeItem')}</button>
        <Dislike style={view.style} what={`${item.kind} ${item.id}`} component={span.component ?? null} at={w ? `word:${w.i}` : undefined} apply={apply} onError={onError} />
      </div>
    </div>
  );
};

const Captions = ({view, lang, components, line, apply, onError}: Pick<Props, 'view' | 'lang' | 'components' | 'line' | 'apply' | 'onError'>) => {
  const t = useT();
  const idx = view.lines.findIndex((l) => l.id === line);
  const l = idx >= 0 ? view.lines[idx] : null;
  const captionRefs = Object.entries(components).filter(([, c]) => c.kind === 'caption').map(([ref]) => ref);
  const ref = l?.component ?? view.captions.component;
  const spec = components[ref]?.props ?? {};
  const current = {...defaults(spec), ...(l?.component ? l.props ?? {} : view.captions.props)};
  const [draft, setDraft] = useState<Record<string, unknown>>(current);
  useEffect(() => setDraft(current), [line, view.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!l) return <div className="sec"><p className="hint">{t('pickLine')}</p></div>;
  const words = l.words.map((i) => view.words[i]?.text).join(' ');
  const next = view.lines[idx + 1];
  const setProps = () => apply('studio: caption props', [l.component
    ? {op: 'caption.setProps', scope: 'line', target: l.id, props: draft}
    : {op: 'caption.setComponent', scope: 'line', target: l.id, component: ref, props: draft}]);

  return (
    <>
      <div className="sec">
        <h3>{t('line')} <span>{l.id}</span></h3>
        <p className="linetext">{words}</p>
        <div className="field">
          <label htmlFor="role">{t('role')}</label>
          <select id="role" className="inp" value={l.role}
            onChange={(e) => apply('studio: caption role', [{op: 'caption.setRole', line: l.id, role: e.target.value}])}>
            {view.roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={l.hidden} onChange={(e) => apply('studio: caption hide', [{op: 'caption.hide', line: l.id, hidden: e.target.checked}])} />
          {t('hidden')}
        </label>
        <div className="btnrow wrap">
          {next && <button className="btn" onClick={() => apply('studio: merge caption lines', [{op: 'caption.merge', lines: [l.id, next.id]}])}>{t('merge')}</button>}
          <Dislike style={view.style} what={`caption line ${l.id} «${words}»`} component={l.component ?? view.captions.component}
            at={`word:${l.words[0]}`} apply={apply} onError={onError} />
        </div>
      </div>
      <div className="sec">
        <h3>{t('component')}</h3>
        <select className="inp" aria-label={t('component')} value={l.component ?? ''}
          onChange={(e) => apply('studio: caption component', [{op: 'caption.setComponent', scope: 'line', target: l.id,
            component: e.target.value || view.captions.component, props: {}}])}>
          <option value="">{t('videoDefault')} · {view.captions.component}</option>
          {captionRefs.map((r) => <option key={r} value={r}>{pick(components[r].title, lang, r)} · {r}</option>)}
        </select>
      </div>
      {Object.keys(spec).length > 0 && (
        <div className="sec">
          <h3>{t('props')} <span>{ref}</span></h3>
          {Object.entries(spec).map(([k, s]) => (
            <PropField key={k} name={k} spec={s} lang={lang} value={draft[k]} onChange={(v) => setDraft({...draft, [k]: v})} />
          ))}
          <div className="btnrow"><button className="btn primary" onClick={setProps}>{t('apply')}</button></div>
        </div>
      )}
    </>
  );
};

const defaults = (spec: Record<string, PropSpec>) =>
  Object.fromEntries(Object.entries(spec).filter(([, s]) => s.default !== undefined).map(([k, s]) => [k, s.default]));

const PropField = ({name, spec, lang, value, onChange}: {name: string; spec: PropSpec; lang: Lang; value: unknown; onChange(v: unknown): void}) => {
  const id = `prop-${name}`;
  const label = pick(spec.label, lang, name);
  let input: React.ReactNode;
  if (spec.type === 'number' || spec.type === 'integer') {
    const n = Number(value ?? spec.default ?? 0);
    input = spec.min !== undefined && spec.max !== undefined
      ? <span className="range"><input id={id} type="range" min={spec.min} max={spec.max} step={spec.step ?? (spec.type === 'integer' ? 1 : 0.01)} value={n}
          onChange={(e) => onChange(Number(e.target.value))} /><output>{n}{spec.unit ?? ''}</output></span>
      : <input id={id} className="inp" type="number" value={n} onChange={(e) => onChange(Number(e.target.value))} />;
  } else if (spec.type === 'boolean') {
    input = <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  } else if (spec.type === 'enum') {
    input = <select id={id} className="inp" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
      {spec.options?.map((o) => <option key={o.value} value={o.value}>{pick(o.label, lang, o.value)}</option>)}
    </select>;
  } else if (spec.type === 'color') {
    input = <input id={id} type="color" value={String(value ?? '#ffffff')} onChange={(e) => onChange(e.target.value)} />;
  } else if (spec.type === 'text') {
    input = <input id={id} className="inp" maxLength={spec.maxLength} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  } else {
    input = <code className="muted">{JSON.stringify(value)}</code>;
  }
  return <div className="field"><label htmlFor={id}>{label}</label>{input}</div>;
};

/** The nearest kept word at or before a moment: notes hang on words, so they follow them through cuts. */
const wordAt = (view: View, s: number) => view.words.filter((w) => w.out !== null && w.out <= s + 0.01).at(-1) ?? view.words.find((w) => w.out !== null);

const Notes = (props: Props) => {
  const {view, sel, now, seek, claude, sendClaude, stopClaude, copyPrompt, apply} = props;
  const t = useT();
  const [note, setNote] = useState('');
  const lo = sel ? Math.min(sel.a, sel.b) : null;
  const hi = sel ? Math.max(sel.a, sel.b) : null;
  const ranged = lo !== null && hi !== null && hi > lo;
  const add = () => {
    const w = wordAt(view, now);
    const where = ranged ? {at: `word:${lo}`, to: `word:${hi}.end`} : w ? {at: `word:${w.i}`} : {};
    apply('studio: note for Claude', [{op: 'note.add', text: note.trim(), ...where}]);
    setNote('');
  };
  const open = view.notes.filter((n) => n.status === 'open');
  const running = claude?.status === 'running';
  const notes = [...view.notes].reverse();
  return (
    <div className="notespane">
      <div className="sec">
        <h3>{t('noteAt')} <span>{ranged ? t('noteRange') : clock(now)}</span></h3>
        <textarea className="inp" rows={3} placeholder={t('notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && note.trim()) add(); }} />
        <div className="btnrow"><button className="btn primary" disabled={!note.trim()} onClick={add}>{t('addNote')}</button></div>
      </div>
      <div className="sec claude">
        <div className="btnrow wrap">
          {running
            ? <button className="btn" onClick={stopClaude}>{t('stop')}</button>
            : <button className="btn primary" disabled={!open.length} onClick={sendClaude}>{t('sendClaude')}{open.length ? ` · ${open.length}` : ''}</button>}
          <button className="btn" onClick={copyPrompt}>{t('copyPrompt')}</button>
        </div>
        {!open.length && !claude && <p className="hint">{t('noOpen')}</p>}
        {claude && (
          <div className={`run ${claude.status}`} aria-live="polite">
            <b>{claude.status === 'running' ? t('claudeWorking') : claude.status === 'done' ? t('claudeDone') : claude.status === 'failed' ? t('claudeFailed') : t('stop')}</b>
            <ul>{claude.steps.slice(-6).map((s, i) => <li key={i}>{s}</li>)}</ul>
            {claude.result && claude.status !== 'running' && <p className="muted">{claude.result}</p>}
          </div>
        )}
      </div>
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id} className={n.status}>
            <div className="nhead">
              {n.t !== undefined ? <button className="tc" onClick={() => seek(n.t!)}>{clock(n.t)}{n.tEnd !== undefined ? `–${clock(n.tEnd)}` : ''}</button> : <span className="tc">—</span>}
              <span className={`tag ${n.status}`}>{n.status === 'open' ? t('open') : t('done')}</span>
            </div>
            <p>{n.text}</p>
            {n.reply && <p className="reply">Claude: {n.reply}</p>}
            {n.status === 'done' && (
              <button className="link" onClick={() => apply('studio: reopen note', [{op: 'note.reopen', id: n.id}])}>{t('reopen')}</button>
            )}
          </li>
        ))}
      </ul>
      <Lessons lessons={props.lessons} onError={props.onError} />
    </div>
  );
};
