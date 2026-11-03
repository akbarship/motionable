// "Uslublar": the user's own design systems. A card per style: the brief, colours, type in its own fonts, the rules,
// where every value came from (a reference moment, a lesson, or a guess), the studied references, the gated
// components, the lessons, and a specimen on one of the user's projects. New styles start from reference reels;
// the user's Claude in chat builds them (a request from here; see Requests.tsx).
import {useEffect, useRef, useState} from 'react';
import {api, type Lesson, type StyleDetail, type StyleListItem} from './api';
import {pick, useT, type Lang} from './i18n';
import {RequestCard, useRequests} from './Requests';
import {Lessons} from './Lessons';

const fontsLink = (families: string[]) => families.length
  ? `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f)}:wght@400;600;700;800;900`).join('&')}&display=swap` : '';

export const Styles = ({lang, projects, refresh, onError}: {lang: Lang; projects: string[]; refresh: number; onError(m: string): void}) => {
  const t = useT();
  const [list, setList] = useState<StyleListItem[]>([]);
  const [ref, setRef] = useState<string | null>(null);
  const [detail, setDetail] = useState<(StyleDetail & {lessons: Lesson[]}) | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    api.styles().then((l) => {
      setList(l);
      setRef((r) => r ?? (l.find((s) => s.versions.length) ? `${l.find((s) => s.versions.length)!.name}@${l.find((s) => s.versions.length)!.versions.at(-1)}` : l[0]?.name ?? null));
    }, (e) => onError(e.message));
  }, [refresh, onError]);
  useEffect(() => {
    if (!ref) return setDetail(null);
    if (!ref.includes('@')) return setDetail(null);
    api.style(ref).then(setDetail, (e) => onError(e.message));
  }, [ref, refresh, onError]);

  const create = () => {
    const name = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!name) return;
    setList((l) => (l.some((s) => s.name === name) ? l : [...l, {name, versions: [], refs: 0, components: []}]));
    setRef(name);
    setNewName('');
  };

  return (
    <main className="styles">
      <aside className="slist">
        <h3>{t('styles')}</h3>
        <ul>
          {list.map((s) => {
            const r = s.versions.length ? `${s.name}@${s.versions.at(-1)}` : s.name;
            return (
              <li key={s.name}>
                <button className={ref === r ? 'on' : ''} onClick={() => setRef(r)}>
                  <b>{s.name}</b>
                  <small>{s.versions.length ? `v${s.versions.at(-1)} · ${s.components.length} ${t('componentsN')}` : `${s.refs} ${t('refsN')} · ${t('noVersion')}`}</small>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="newstyle">
          <input className="inp" placeholder={t('newStyleName')} value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()} aria-label={t('newStyleName')} />
          <button className="btn" onClick={create} disabled={!newName.trim()}>+</button>
        </div>
      </aside>
      <section className="scard">
        {ref && !ref.includes('@') && <NewStyle name={ref} refresh={refresh} onError={onError} />}
        {detail && <Card d={detail} lang={lang} projects={projects} onError={onError} />}
        {!ref && <p className="hint">{t('noStyles')}</p>}
      </section>
    </main>
  );
};

const Card = ({d, lang, projects, onError}: {d: StyleDetail & {lessons: Lesson[]}; lang: Lang; projects: string[]; onError(m: string): void}) => {
  const t = useT();
  const name = d.ref.split('@')[0];
  const file = (rel: string) => `/api/styles/${name}/files/${rel}`;
  const tok = d.style.tokens ?? {};
  const src = d.style.sources ?? {};
  const types = Object.entries(tok.type ?? {});
  const families = [...new Set(types.map(([, s]) => s.font))];
  const tag = (key: string) => {
    const s = src[key] ?? Object.entries(src).find(([k]) => key.startsWith(`${k}.`) || k.startsWith(`${key}.`))?.[1];
    return s ? <span className={`tag src ${s === 'guess' ? 'guess' : ''}`} title={s}>{s.replace(/^ref:/, '')}</span> : null;
  };
  const rules = d.style.rules;
  return (
    <div className="scontent">
      {families.length > 0 && <link rel="stylesheet" href={fontsLink(families)} />}
      <header className="shead">
        <h2>{pick(d.style.title, lang, name)} <small>{d.ref}</small></h2>
        <p className="muted">{d.style.description}</p>
      </header>

      <div className="sgrid">
        <div className="sec">
          <h3>{t('brief')}</h3>
          <pre className="brief">{d.brief}</pre>
        </div>
        <div className="sec">
          <h3>{t('colours')}</h3>
          <ul className="swatches">
            {Object.entries(tok.color ?? {}).map(([k, v]) => (
              <li key={k}><i style={{background: v}} /><b>{k}</b><code>{v}</code>{tag(`tokens.color.${k}`)}</li>
            ))}
          </ul>
          <h3>{t('type')}</h3>
          <ul className="types">
            {types.map(([k, s]) => (
              <li key={k}>
                <span className="sample" style={{fontFamily: `'${s.font}'`, fontWeight: s.weight, textTransform: s.caps ? 'uppercase' : 'none',
                  color: typeof s.fill === 'string' && s.fill.startsWith('#') ? s.fill : s.fill?.startsWith('$color.') ? tok.color?.[s.fill.slice(7)] : undefined}}>
                  Oʻzbekiston
                </span>
                <small>{k} · {s.font} {s.weight} · {s.size}px</small>{tag(`tokens.type.${k}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className="sec">
          <h3>{t('rules')}</h3>
          <dl className="rules">
            <dt>{t('cutEvery')}</dt><dd>{rules?.shots?.targetS?.join('–')} s {tag('rules.shots.targetS')}</dd>
            <dt>{t('wordsPerLine')}</dt><dd>{rules?.captions?.wordsPerLine?.join('–')} {tag('rules.captions')}</dd>
            <dt>{t('trimPauses')}</dt><dd>&gt; {rules?.timeline?.trimPausesOver} s → {rules?.timeline?.trimTo} s</dd>
            <dt>{t('faceMargin')}</dt><dd>{tok.safe?.face ?? 40} px {tag('tokens.safe.face')}</dd>
            <dt>{t('framing')}</dt><dd>{rules?.framing?.levels?.join(' / ')} {tag('tokens.framing')}</dd>
          </dl>
          {d.style.never?.length > 0 && (<><h3>{t('never')}</h3><ul className="never">{d.style.never.map((n) => <li key={n.id}>✕ {n.text}</li>)}</ul></>)}
        </div>
      </div>

      <div className="sec">
        <h3>{t('references')} <span>{d.refs.length}</span></h3>
        <ul className="refs">
          {d.refs.map((r) => (
            <li key={r.id}>
              {r.sheet && <img src={file(r.sheet)} alt="" loading="lazy" />}
              <b>{r.id}</b>
              <small>{r.durationS.toFixed(1)} s · {r.cuts} {t('cutsN')} · {r.cutsPerMin}/{t('perMin')} · {r.pacing}</small>
            </li>
          ))}
        </ul>
      </div>

      <div className="sec">
        <h3>{t('componentsTitle')} <span>{d.components.length}</span></h3>
        <ul className="comps">
          {d.components.map((c) => (
            <li key={c.ref}>
              {c.sheet && <div className="cthumb"><img src={file(c.sheet)} alt="" loading="lazy" /></div>}
              <div>
                <b>{pick(c.title, lang, c.ref)}</b> <code>{c.ref}</code>
                <p className="muted">{c.description}</p>
                <span className="tag">{c.kind}</span> <span className={`tag ${c.status === 'private' || c.status === 'public' ? 'done' : ''}`}>{c.status}</span>{' '}
                {c.gate && <span className={`tag ${c.gate.pass ? 'done' : 'fail'}`}>{c.gate.pass ? `gate ✓ ${c.gate.cases}` : 'gate ✕'}</span>}
                {c.gate && !c.gate.pass && <p className="error">{c.gate.errors.join(' · ')}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Specimen styleRef={d.ref} projects={projects} onError={onError} />
      <Lessons lessons={d.lessons} onError={onError} />
    </div>
  );
};

const Specimen = ({styleRef, projects, onError}: {styleRef: string; projects: string[]; onError(m: string): void}) => {
  const t = useT();
  const [project, setProject] = useState(projects[0] ?? '');
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.specimen(project, styleRef);
      setImg(`data:${r.mime};base64,${r.image}`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sec">
      <h3>{t('specimen')}</h3>
      <p className="hint">{t('specimenHint')}</p>
      <div className="keyrow">
        <select className="inp" value={project} onChange={(e) => setProject(e.target.value)} aria-label={t('project')}>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn primary" onClick={go} disabled={!project || busy}>{busy ? t('running') : t('specimenGo')}</button>
      </div>
      {img && <img className="specimen" src={img} alt={t('specimen')} />}
    </div>
  );
};

const NewStyle = ({name, refresh, onError}: {name: string; refresh: number; onError(m: string): void}) => {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api.styleRefs(name).then(setPending, () => setPending([])); }, [name, refresh]);
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      setBusy(f.name);
      try {
        await api.addReference(name, f);
      } catch (e) {
        onError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setBusy(null);
    api.styleRefs(name).then(setPending, () => {});
  };
  // Claude in chat builds it: one request, its reply shows here
  const {last, ask, cancel} = useRequests({style: name}, onError);
  const busyReq = last?.status === 'queued' || last?.status === 'taken';
  return (
    <div className="scontent">
      <header className="shead"><h2>{name} <small>{t('noVersion')}</small></h2><p className="muted">{t('newStyleHint')}</p></header>
      <div className="sec">
        <h3>{t('references')} <span>{pending.length}</span></h3>
        <button className="drop" onClick={() => input.current?.click()} disabled={!!busy}>
          <b>{busy ? `${t('studying')} ${busy}…` : t('addReferences')}</b><span>{t('addReferencesHint')}</span>
        </button>
        <input ref={input} type="file" accept="video/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        <ul className="never">{pending.map((p) => <li key={p}>✓ {p}</li>)}</ul>
      </div>
      {pending.length > 0 && (
        <div className="sec">
          <h3>{t('buildWithClaude')}</h3>
          <p className="hint">{t('buildStyleHint')}</p>
          <div className="btnrow">
            <button className="btn primary" onClick={() => ask('style')} disabled={!!busy || busyReq}>{t('buildStyleGo')}</button>
          </div>
          {last && <RequestCard r={last} onCancel={cancel} />}
        </div>
      )}
    </div>
  );
};
