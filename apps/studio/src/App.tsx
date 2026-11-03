// The Studio. It opens on Home (the first steps and the user's videos); a video opens in the editor: the preview and
// notes for Claude, with the transcript, cuts, captions and scenes behind "Advanced". The daemon's live events keep it
// in step with Claude: a plan change reloads the view, a rebuilt page reloads the player, a finished export opens its
// file. While no Claude is connected a banner says how to connect it, on every screen.
import {useCallback, useEffect, useRef, useState} from 'react';
import {api, type ComponentInfo, type FileEntry, type Lesson, type Op, type ProjectItem, type View} from './api';
import {LangContext, useT, type Lang} from './i18n';
import {ClaudeBanner, ClaudePill, PresenceContext, usePresence} from './Requests';
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
import {Home} from './Home';
import {ExportDialog, NoticeBar, friendly, type Notice} from './Dialogs';
import {More, Plus, Sliders, Undo} from './Icons';

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
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return (
    <LangContext.Provider value={lang}>
      <Studio lang={lang} setLang={(l) => { setLang(l); store('mc.lang', l); }} />
    </LangContext.Provider>
  );
};

type Status = {kind: 'idle' | 'building' | 'rendering' | 'rendered' | 'exporting' | 'exported' | 'error'; text?: string};
type Screen = 'home' | 'edit' | 'new' | 'styles' | 'videos' | 'settings';

const Studio = ({lang, setLang}: {lang: Lang; setLang(l: Lang): void}) => {
  const t = useT();
  const [projects, setProjects] = useState<ProjectItem[] | null>(null);
  const [id, setId] = useState<string | null>(stored('mc.project'));
  const [view, setView] = useState<View | null>(null);
  const [components, setComponents] = useState<Record<string, ComponentInfo>>({});
  const [page, setPage] = useState(Date.now());
  const [now, setNow] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [line, setLine] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({kind: 'idle'});
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [advanced, setAdvanced] = useState(stored('mc.advanced') === '1');
  const [tab, setTab] = useState<Tab>(advanced ? 'transcript' : 'notes');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const presence = usePresence();
  const [item, setItem] = useState<Item | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [screen, setScreen] = useState<Screen>('home');
  const [setup, setSetup] = useState(false); // the project has no plan yet
  const [tick, setTick] = useState(0);
  const [proposalAt, setProposalAt] = useState(0);
  const [stylesAt, setStylesAt] = useState(0);
  const [videosAt, setVideosAt] = useState(0);
  const [exported, setExported] = useState<{project: string; file: string} | null>(null);
  const proposals = useProposals(id, proposalAt);
  const player = useRef<PlayerHandle>(null);
  const idRef = useRef(id);
  idRef.current = id;

  /** Errors stay until dismissed, in words the user can act on; `info` goes by itself. */
  const say = useCallback((m: string, kind: 'error' | 'info' = 'error') => setNotice(kind === 'info' ? {kind, text: m} : friendly(m)), []);

  const refreshProjects = useCallback(() => api.projects().then((list) => { setProjects(list); setOnline(true); return list; }, () => {
    setOnline(false);
    setProjects((p) => p ?? []);
    return [] as ProjectItem[];
  }), []);
  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  const reload = useCallback((pid: string) => api.view(pid).then(setView, (e) => say(String(e.message))), [say]);

  const open = useCallback((pid: string) => { setId(pid); setScreen('edit'); }, []);
  useEffect(() => {
    if (!id || screen !== 'edit') return;
    store('mc.project', id);
    setSel(null);
    setLine(null);
    setView(null);
    // a project without a plan opens on its setup card (or its plan, once Claude wrote one); one with a plan in the editor
    api.state(id).then((s) => {
      setSetup(s.version === 0);
      if (s.version > 0) reload(id);
    }, (e) => say(e.message));
    api.files(id).then(setFiles, () => setFiles([]));
  }, [id, screen === 'edit', reload, say]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (['plan', 'proposal', 'analysis', 'render'].includes(ev.type)) refreshProjects(); // Home shows each video's stage
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
        if (ev.status === 'done' && ev.file) setExported({project: ev.project, file: ev.file});
        if (ev.status === 'failed') say(ev.error ?? 'render');
      }
      if (ev.type === 'error') { setStatus({kind: 'error', text: ev.message}); say(ev.message); }
      if (ev.type === 'files') api.files(ev.project).then(setFiles, () => {});
    };
    return () => es.close();
  }, [reload, say, loadLessons, refreshProjects]);

  const apply = useCallback(async (why: string, ops: Op[]) => {
    if (!view) return;
    try {
      const r = await api.ops(view.id, view.version, why, ops);
      if (r.warnings.length) say(r.warnings.join(' · '), 'info');
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
      await api.undo(view.id);
      say(t('undo'), 'info');
    } catch (e) {
      say((e as Error).message);
    }
  };
  const toggleAdvanced = () => {
    const a = !advanced;
    setAdvanced(a);
    store('mc.advanced', a ? '1' : '0');
    setTab(a ? 'transcript' : 'notes');
  };

  // ctrl/cmd+Z undoes, unless the user is typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select');
      if (!typing && screen === 'edit' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const statusText = status.kind === 'exporting' ? `${t('exporting')}${status.text === 'loudness' ? ` ${t('loudnessStep')}` : ''}`
    : status.kind === 'exported' ? `${t('exported')} · ${status.text}` : status.kind === 'building' ? t('building') : status.kind === 'rendering' ? t('rendering')
    : status.kind === 'rendered' ? `${t('rendered')} · ${status.text}` : status.kind === 'error' ? t('errTitle') : online ? t('live') : t('offline');
  const title = projects?.find((p) => p.id === id)?.title ?? id ?? '';
  const nav = (s: Screen, label: string) => (
    <button aria-current={screen === s ? 'page' : undefined} className={screen === s ? 'on' : ''} onClick={() => setScreen(s)}>{label}</button>
  );

  return (
    <PresenceContext.Provider value={presence}>
    <div className="app">
      <div className="chrome">
        <header className="top">
          <div className="brand"><i />Motionable</div>
          <nav className="seg" aria-label={t('home')}>
            {nav('home', t('home'))}
            {nav('styles', t('styles'))}
            {nav('videos', t('myVideos'))}
          </nav>
          <div className="spacer" />
          <ClaudePill p={presence} />
          <button className="btn primary" onClick={() => setScreen('new')}><Plus size={14} /> {t('newVideo')}</button>
          <button className={`iconbtn${screen === 'settings' ? ' strong' : ''}`} onClick={() => setScreen('settings')}
            aria-label={t('settings')} aria-current={screen === 'settings' ? 'page' : undefined} title={t('settings')}><Sliders size={18} /></button>
        </header>
        <ClaudeBanner p={presence} />
        {!online && <div className="banner bad" role="alert"><span className="dot" /><p>{t('errServer')}</p></div>}
      </div>

      {screen === 'home' && projects && (
        <Home projects={projects} presence={presence} refresh={stylesAt} onOpen={open} onNew={() => setScreen('new')} onStyles={() => setScreen('styles')} />
      )}
      {screen === 'styles' && <Styles lang={lang} projects={(projects ?? []).filter((p) => p.version > 0).map((p) => p.id)} refresh={stylesAt} onError={say} />}
      {screen === 'settings' && <Settings lang={lang} setLang={setLang} onError={say} />}
      {screen === 'videos' && <Videos refresh={videosAt} onOpen={open} />}
      {screen === 'new' && <NewVideo onError={say} onSettings={() => setScreen('settings')}
        onCreated={(nid) => { refreshProjects().then(() => open(nid)); }} />}

      {screen === 'edit' && id && (
        <section className="editor" aria-label={title}>
          <div className="edbar">
            <label className="job">
              <span className="sr">{t('project')}</span>
              <select className="inp slim" value={id} onChange={(e) => open(e.target.value)}>
                {projects?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </label>
            <span className={`pill status ${status.kind}${online ? '' : ' off'}`} aria-live="polite"><span className="dot" />{statusText}</span>
            <div className="spacer" />
            {!setup && view && (
              <>
                <button className={`toggle-adv${advanced ? ' on' : ''}`} aria-pressed={advanced} onClick={toggleAdvanced} title={t('advancedHint')}>{t('advanced')}</button>
                <button className="iconbtn" onClick={undo} title={`${t('undo')} (Ctrl+Z)`} aria-label={t('undo')}><Undo size={18} /></button>
                <details className="menu">
                  <summary className="iconbtn" aria-label={t('more')} title={t('more')}><More size={18} /></summary>
                  <div className="menulist">
                    <button onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false;
                      api.render(id).then(() => setStatus({kind: 'rendering'}), (er) => say(er.message)); }}>{t('render')}</button>
                    <button onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; api.build(id); }}>{t('rebuild')}</button>
                  </div>
                </details>
                <button className="render" onClick={() => api.render(id, 'export').then(() => setStatus({kind: 'exporting'}), (e) => say(e.message))}>
                  {t('export')}
                </button>
              </>
            )}
          </div>
          {setup && proposals.length > 0 && <Proposal project={id} list={proposals} onError={say} />}
          {setup && !proposals.length && <Setup project={id} title={title} tick={tick} onSettings={() => setScreen('settings')} onError={say} />}
          {!setup && view && (
            <main className={`main${advanced ? '' : ' simple'}`}>
              {advanced && <Files project={id} files={files} onError={say} />}
              <div className="stage">
                <Player ref={player} project={id} page={page} onTime={setNow} />
              </div>
              <Inspector view={view} lang={lang} components={components} line={line} item={item} lessons={lessons} onError={say} sel={sel} now={now}
                tab={tab} setTab={setTab} simple={!advanced}
                onPick={pickWord} onCut={cut} onRestore={restore} seek={seek} apply={apply} onItem={setItem} />
            </main>
          )}
        </section>
      )}
      <p className="mobilenote">{t('desktopBest')}</p>
      {notice && <NoticeBar n={notice} onClose={() => setNotice(null)} onSettings={() => setScreen('settings')} />}
      <ExportDialog file={exported?.file ?? null} project={exported?.project ?? null} onClose={() => setExported(null)} onVideos={() => setScreen('videos')} />
    </div>
    </PresenceContext.Provider>
  );
};
