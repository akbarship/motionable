// The Studio's Montaj screen: files, preview, the inspector (transcript, cuts, captions, notes) and the timeline over
// one project. The daemon's live events keep it in step with Claude: a plan change reloads the view, a rebuilt page
// reloads the player; the Claude pill says whether Claude in chat is waiting for the Studio.
import {useCallback, useEffect, useRef, useState} from 'react';
import {api, type ComponentInfo, type FileEntry, type Lesson, type Op, type View} from './api';
import {LangContext, useT, type Lang} from './i18n';
import {ClaudePill, PresenceContext, usePresence} from './Requests';
import {Player, type PlayerHandle} from './Player';
import type {Sel} from './Transcript';
import {Inspector, type Tab} from './Inspector';
import type {Item} from './Elements';
import {Files} from './Files';
import {Videos} from './Videos';
import {NewVideo} from './NewVideo';
import {Setup} from './Setup';
import {Proposal, useProposals} from './Proposal';
import {Settings} from './Settings';
import {Styles} from './Styles';

const stored = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const store = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export const App = () => {
  const [lang, setLang] = useState<Lang>(stored('mc.lang') === 'en' ? 'en' : 'uz');
  return (
    <LangContext.Provider value={lang}>
      <Studio lang={lang} setLang={(l) => { setLang(l); store('mc.lang', l); document.documentElement.lang = l; }} />
    </LangContext.Provider>
  );
};

type Status = {kind: 'idle' | 'building' | 'rendering' | 'rendered' | 'exporting' | 'exported' | 'error'; text?: string};

const Studio = ({lang, setLang}: {lang: Lang; setLang(l: Lang): void}) => {
  const t = useT();
  const [projects, setProjects] = useState<{id: string; version: number}[] | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [components, setComponents] = useState<Record<string, ComponentInfo>>({});
  const [page, setPage] = useState(Date.now());
  const [now, setNow] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [line, setLine] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({kind: 'idle'});
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('transcript');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const presence = usePresence();
  const [item, setItem] = useState<Item | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [screen, setScreen] = useState<'edit' | 'new' | 'styles' | 'videos' | 'settings'>('edit');
  const [setup, setSetup] = useState(false); // the project has no plan yet
  const [tick, setTick] = useState(0);
  const [proposalAt, setProposalAt] = useState(0);
  const [stylesAt, setStylesAt] = useState(0);
  const [videosAt, setVideosAt] = useState(0);
  const proposals = useProposals(id, proposalAt);
  const player = useRef<PlayerHandle>(null);
  const idRef = useRef(id);
  idRef.current = id;

  const say = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((x) => (x === m ? null : x)), 4000);
  }, []);

  useEffect(() => {
    api.projects().then((list) => {
      setProjects(list);
      const want = stored('mc.project');
      setId(list.find((p) => p.id === want)?.id ?? list[0]?.id ?? null);
    }, () => setOnline(false));
  }, []);
  const refreshProjects = useCallback(() => api.projects().then(setProjects, () => {}), []);

  const reload = useCallback((pid: string) => api.view(pid).then(setView, (e) => say(String(e.message))), [say]);

  useEffect(() => {
    if (!id) return;
    store('mc.project', id);
    setSel(null);
    setLine(null);
    setView(null);
    // a project without a plan opens on its setup card; one with a plan in the editor
    api.state(id).then((s) => {
      setSetup(s.version === 0);
      if (s.version > 0) reload(id);
    }, (e) => say(e.message));
    api.files(id).then(setFiles, () => setFiles([]));
  }, [id, reload, say]);

  const loadLessons = useCallback((style: string) => api.lessons(style).then(setLessons, () => setLessons([])), []);
  useEffect(() => {
    if (!view?.style) return;
    api.components(view.style).then(setComponents, () => setComponents({}));
    loadLessons(view.style);
  }, [view?.style, loadLessons]);
  const styleRef = useRef<string | null>(null);
  styleRef.current = view?.style ?? null;

  // live events from the daemon (Claude's edits, page builds, renders)
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'lessons') setStylesAt(Date.now());
      if (ev.type === 'styles' || ev.type === 'component') return void setStylesAt(Date.now());
      if (ev.type === 'lessons' && styleRef.current) return void loadLessons(styleRef.current);
      if (ev.project !== idRef.current) return;
      if (ev.type === 'analysis') setTick(Date.now());
      if (ev.type === 'proposal') setProposalAt(Date.now());
      if (ev.type === 'plan') { setSetup(false); reload(ev.project); setStatus({kind: 'building'}); }
      if (ev.type === 'page') { setPage(Date.now()); setStatus({kind: 'idle'}); }
      if (ev.type === 'page-same') setStatus({kind: 'idle'}); // nothing on screen changed: the player keeps going
      if (ev.type === 'render') {
        const exp = ev.quality === 'export';
        setStatus(ev.status === 'done' ? {kind: exp ? 'exported' : 'rendered', text: `v${ev.version}`}
          : ev.status === 'failed' ? {kind: 'error', text: ev.error ?? 'render'} : {kind: exp ? 'exporting' : 'rendering', text: ev.step});
        if (ev.status === 'done') setVideosAt(Date.now());
      }
      if (ev.type === 'error') { setStatus({kind: 'error', text: ev.message}); say(ev.message); }
      if (ev.type === 'files') api.files(ev.project).then(setFiles, () => {});
    };
    return () => es.close();
  }, [reload, say, loadLessons]);

  const apply = useCallback(async (why: string, ops: Op[]) => {
    if (!view) return;
    try {
      const r = await api.ops(view.id, view.version, why, ops);
      if (r.warnings.length) say(r.warnings.join(' · '));
    } catch (e) {
      say((e as Error).message);
    }
  }, [view, say]);

  const seek = useCallback((s: number) => { player.current?.seek(s); setNow(s); }, []);

  const pickWord = (i: number, extend: boolean) => {
    if (!view) return;
    const w = view.words[i];
    setSel((cur) => (extend && cur ? {a: cur.a, b: i} : {a: i, b: i}));
    if (w.line) { setLine(w.line); setItem(null); }
    if (w.out !== null) seek(w.out);
  };

  const cut = () => {
    if (!view || !sel) return;
    const lo = Math.min(sel.a, sel.b), hi = Math.max(sel.a, sel.b);
    apply('studio: cut', [{op: 'range.cut', from: `word:${lo}`, to: `word:${hi}.end`, kind: 'other', why: 'cut by the user in the Studio'}]);
    setSel(null);
  };
  const restore = (k: number) => {
    const r = view?.removed.find((x) => x.k === k);
    if (r) apply('studio: restore', [{op: 'range.restore', from: r.anchors[0], to: r.anchors[1]}]);
    setSel(null);
  };
  const undo = async () => {
    if (!view) return;
    try {
      const r = await api.undo(view.id);
      say(`${t('undo')}: v${r.restored}`);
    } catch (e) {
      say((e as Error).message);
    }
  };

  // ctrl/cmd+Z undoes, unless the user is typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select');
      if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const statusText = status.kind === 'exporting' ? `${t('exporting')}${status.text === 'loudness' ? ` ${t('loudnessStep')}` : ''}`
    : status.kind === 'exported' ? `${t('exported')} · ${status.text}` : status.kind === 'building' ? t('building') : status.kind === 'rendering' ? t('rendering')
    : status.kind === 'rendered' ? `${t('rendered')} · ${status.text}` : status.kind === 'error' ? status.text : online ? t('live') : t('offline');

  return (
    <PresenceContext.Provider value={presence}>
    <div className="app">
      <header className="top">
        <div className="brand"><i />Motionable</div>
        <div className="seg" role="tablist" aria-label="screens">
          <button role="tab" aria-selected={screen === 'edit'} className={screen === 'edit' ? 'on' : ''} onClick={() => setScreen('edit')}>{t('montage')}</button>
          <button role="tab" aria-selected={screen === 'styles'} className={screen === 'styles' ? 'on' : ''} onClick={() => setScreen('styles')}>{t('styles')}</button>
          <button role="tab" aria-selected={screen === 'videos'} className={screen === 'videos' ? 'on' : ''} onClick={() => setScreen('videos')}>{t('myVideos')}</button>
        </div>
        <button className={`iconbtn${screen === 'new' ? '' : ' strong'}`} onClick={() => setScreen('new')}>+ {t('newVideo')}</button>
        <button className={`iconbtn${screen === 'settings' ? ' strong' : ''}`} onClick={() => setScreen('settings')} aria-label={t('settings')} title={t('settings')}>⚙</button>
        {/* the project's own controls only where the project is open */}
        {screen === 'edit' && !!projects?.length && (
          <label className="job">
            <span className="sr">{t('project')}</span>
            <select className="inp slim" value={id ?? ''} onChange={(e) => setId(e.target.value)} disabled={!projects?.length}>
              {projects?.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
          </label>
        )}
        {screen === 'edit' && view && <span className="pill">{view.style} · {t('plan')} v{view.version}</span>}
        <span className={`pill status ${status.kind}${online ? '' : ' off'}`} aria-live="polite"><span className="dot" />{statusText}</span>
        <ClaudePill p={presence} />
        <div className="spacer" />
        {screen === 'edit' && view && (
          <>
            <button className="iconbtn" onClick={undo} title="Ctrl+Z">↶ {t('undo')}</button>
            <button className="iconbtn" onClick={() => id && api.build(id)}>{t('rebuild')}</button>
          </>
        )}
        <div className="seg" role="group" aria-label="language">
          {(['uz', 'en'] as Lang[]).map((l) => <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
        </div>
        {screen === 'edit' && view && (
          <>
            <button className="iconbtn" onClick={() => id && api.render(id).then(() => setStatus({kind: 'rendering'}), (e) => say(e.message))}>
              {t('render')}
            </button>
            <button className="render" onClick={() => id && api.render(id, 'export').then(() => setStatus({kind: 'exporting'}), (e) => say(e.message))}>
              {t('export')}
            </button>
          </>
        )}
      </header>

      {screen === 'edit' && projects && !projects.length && (
        <main className="setup"><div className="sheet hero">
          <h2>{t('newVideo')}</h2><p className="muted">{t('noProjects')}</p>
          <div className="btnrow"><button className="btn primary" onClick={() => setScreen('new')}>+ {t('newVideo')}</button></div>
        </div></main>
      )}
      {screen === 'styles' && <Styles lang={lang} projects={(projects ?? []).filter((p) => p.version > 0).map((p) => p.id)} refresh={stylesAt} onError={say} />}
      {screen === 'settings' && <Settings setLang={setLang} onError={say} />}
      {screen === 'videos' && <Videos refresh={videosAt} onOpen={(p) => { setId(p); setScreen('edit'); }} />}
      {screen === 'new' && <NewVideo onError={say} onCreated={(nid) => { setScreen('edit'); refreshProjects().then(() => setId(nid)); }} />}
      {screen === 'edit' && setup && id && proposals.length > 0 && <Proposal project={id} list={proposals} onError={say} />}
      {screen === 'edit' && setup && id && !proposals.length && <Setup project={id} tick={tick} onSettings={() => setScreen('settings')} onError={say} />}
      {screen === 'edit' && !setup && view && id && (
        <>
          <main className="main">
            <Files project={id} files={files} onError={say} />
            <div className="stage">
              <Player ref={player} project={id} page={page} onTime={setNow} />
            </div>
            <Inspector view={view} lang={lang} components={components} line={line} item={item} lessons={lessons} onError={say} sel={sel} now={now} tab={tab} setTab={setTab}
              onPick={pickWord} onCut={cut} onRestore={restore} seek={seek} apply={apply} onItem={setItem} />
          </main>
        </>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
    </PresenceContext.Provider>
  );
};
