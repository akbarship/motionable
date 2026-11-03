// "Yangi video": a three-step wizard. 1) what the video is about and its script; 2) the format (an edit of
// talking-head footage, or a voiceover made all of motion) and a style (one of the user's, or a new one from
// references, built by Claude while the wizard goes on); 3) the materials. "Send to Claude" creates the project;
// the daemon then runs the analysis, the paid transcript (agreed here) and queues the plan request for Claude.
import {useEffect, useRef, useState, type DragEvent} from 'react';
import {api, type StyleListItem} from './api';
import {useT} from './i18n';
import {Check, Close, Down, Up} from './Icons';
import {slug} from './slug';

type Mode = 'edit' | 'voiceover';
type StyleCard = {name: string; ref: string | null; colors: string[]; components: number};

const VIDEO = 'video/*,.mp4,.mov,.m4v,.mkv,.webm';
const AUDIO = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac';

/** The user's styles with a few colours each; a style still being built has no version yet. */
const loadCards = async (list: StyleListItem[]): Promise<StyleCard[]> => Promise.all(list.map(async (s) => {
  const v = s.versions.at(-1);
  if (v === undefined) return {name: s.name, ref: null, colors: [], components: 0};
  const ref = `${s.name}@${v}`;
  const d = await api.style(ref).catch(() => null);
  return {name: s.name, ref, colors: Object.values(d?.style.tokens?.color ?? {}).slice(0, 5), components: s.components.length};
}));

// what the user typed survives leaving the wizard (Settings for a key, another tab) until the video is sent
type Language = 'uz' | 'ru' | 'en' | 'auto';
type Draft = {title: string; about: string; script: string; mode: Mode; language: Language};
const DRAFT = 'mc.draft';
const readDraft = (): Partial<Draft> => {
  try {
    return JSON.parse(localStorage.getItem(DRAFT) ?? '{}');
  } catch {
    return {};
  }
};

/** A drop zone: files dragged onto it arrive like picked ones. */
const useDrop = (onFiles: (f: File[]) => void) => {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => { e.preventDefault(); setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); },
    },
  };
};

export const NewVideo = ({onCreated, onError, onSettings}: {onCreated(id: string): void; onError(m: string): void; onSettings(): void}) => {
  const t = useT();
  const d0 = useRef(readDraft()).current;
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(d0.title ?? '');
  const [about, setAbout] = useState(d0.about ?? '');
  const [script, setScript] = useState(d0.script ?? '');
  const [mode, setMode] = useState<Mode>(d0.mode ?? 'edit');
  const [language, setLanguage] = useState<Language>(d0.language ?? 'uz');
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT, JSON.stringify({title, about, script, mode, language}));
    } catch {}
  }, [title, about, script, mode, language]);
  const [cards, setCards] = useState<StyleCard[] | null>(null);
  const [style, setStyle] = useState<string>(''); // name@version, or the name of a style still being built
  const [pickNew, setPickNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [refs, setRefs] = useState<string[]>([]);
  const [main, setMain] = useState<File[]>([]);
  const [extras, setExtras] = useState<File[]>([]);
  const [paid, setPaid] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const scriptFile = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const mainInput = useRef<HTMLInputElement>(null);
  const extraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.styles().then(loadCards).then((c) => {
      setCards(c);
      const first = c.find((x) => x.ref);
      if (first && !style) setStyle(first.ref!);
      if (!c.length) setPickNew(true);
    }, () => setCards([]));
    api.settings().then((s) => setHasKey(!!s.keys.elevenlabs), () => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const readScript = async (f: File | undefined) => f && setScript(await f.text());
  const move = (i: number, d: -1 | 1) => setMain((f) => {
    const j = i + d;
    if (j < 0 || j >= f.length) return f;
    const next = [...f];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  // a new style: references go up now, and Claude is asked to build it while the user carries on
  const name = slug(newName);
  const uploadRefs = async (files: FileList | File[] | null) => {
    if (!name) return onError(t('newStyleName'));
    for (const f of Array.from(files ?? [])) {
      setBusy(f.name);
      try {
        await api.addReference(name, f);
        setRefs((r) => [...r, f.name]);
      } catch (e) {
        onError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setBusy(null);
  };
  const buildStyle = async () => {
    try {
      await api.ask({kind: 'style', style: name});
      setStyle(name);
      setPickNew(false);
      setStep(3);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const send = async () => {
    const total = main.reduce((a, f) => a + f.size, 0) + extras.reduce((a, f) => a + f.size, 0) || 1;
    let done = 0;
    const track = (f: File) => (p: number) => setProgress((done + p * f.size) / total);
    try {
      setProgress(0);
      const paths: string[] = [];
      for (const f of main) {
        paths.push(await api.inbox(f, track(f)));
        done += f.size;
      }
      const {id} = await api.createProject(paths, {title: title.trim() || undefined,
        brief: {about: about.trim(), script: script.trim() || undefined, mode, style: style || undefined, language},
        then: {transcribe: paid, plan: true}});
      for (const f of extras) {
        await api.upload(id, f, track(f)).catch((e) => onError(`${f.name}: ${e.message}`));
        done += f.size;
      }
      try {
        localStorage.removeItem(DRAFT);
      } catch {}
      onCreated(id);
    } catch (e) {
      onError((e as Error).message);
      setProgress(null);
    }
  };

  const steps = [t('wzAbout'), t('wzFormat'), t('wzFiles')];
  const addMain = (f: File[]) => setMain(mode === 'edit' ? [...main, ...f] : f.slice(0, 1));
  const dropRefs = useDrop((f) => newName.trim() && !busy && uploadRefs(f));
  const dropMain = useDrop((f) => progress === null && addMain(f));
  const dropExtras = useDrop((f) => progress === null && setExtras([...extras, ...f]));
  return (
    <main className="setup">
      <div className="sheet wide wizard">
        <h2>{t('newVideo')}</h2>
        <ol className="wzsteps">
          {steps.map((s, i) => (
            <li key={s} className={i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''} aria-current={i + 1 === step ? 'step' : undefined}>
              <button className="link" disabled={i + 1 > step || progress !== null} onClick={() => setStep(i + 1)}>{i + 1}. {s}</button>
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div className="sec">
            <div className="field"><label htmlFor="wz-title">{t('projectTitle')}</label>
              <input id="wz-title" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <label className="stack" htmlFor="wz-about"><span>{t('wzAboutLabel')}</span>
              <textarea id="wz-about" className="inp" rows={3} placeholder={t('wzAboutHint')} value={about} onChange={(e) => setAbout(e.target.value)} /></label>
            <label className="stack" htmlFor="wz-script"><span>{t('wzScript')} <small className="muted">{t('optional')}</small></span>
              <textarea id="wz-script" className="inp" rows={6} placeholder={t('wzScriptHint')} value={script} onChange={(e) => setScript(e.target.value)} /></label>
            <div className="btnrow">
              <button className="btn" onClick={() => scriptFile.current?.click()}>{t('wzScriptFile')}</button>
              <input ref={scriptFile} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={(e) => { readScript(e.target.files?.[0]); e.target.value = ''; }} />
              <span className="spacer" />
              <button className="btn primary" disabled={!about.trim()} onClick={() => setStep(2)}>{t('next')}</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="sec">
            <h3>{t('wzFormat')}</h3>
            <div className="cards two">
              {(['edit', 'voiceover'] as Mode[]).map((m) => (
                <button key={m} className={`pick${mode === m ? ' on' : ''}`} aria-pressed={mode === m} onClick={() => { setMode(m); setMain([]); }}>
                  <b>{m === 'edit' ? t('modeEdit') : t('modeVoiceover')}</b>
                  <span>{m === 'edit' ? t('modeEditHint') : t('modeVoiceoverHint')}</span>
                </button>
              ))}
            </div>
            <h3>{t('style')}</h3>
            {!cards && <p className="hint">{t('running')}</p>}
            <div className="cards">
              {cards?.map((c) => (
                <button key={c.name} className={`pick${!pickNew && style === (c.ref ?? c.name) ? ' on' : ''}`} aria-pressed={!pickNew && style === (c.ref ?? c.name)}
                  onClick={() => { setStyle(c.ref ?? c.name); setPickNew(false); }}>
                  <span className="chips">{c.colors.map((col) => <i key={col} style={{background: col}} />)}</span>
                  <b>{c.name}</b>
                  <span>{c.ref ? `v${c.ref.split('@')[1]} · ${c.components} ${t('componentsN')}` : t('noVersion')}</span>
                </button>
              ))}
              <button className={`pick new${pickNew ? ' on' : ''}`} aria-pressed={pickNew} onClick={() => setPickNew(true)}>
                <b>+ {t('wzNewStyle')}</b><span>{t('wzNewStyleHint')}</span>
              </button>
            </div>
            {pickNew && (
              <div className="newstyle">
                <div className="field"><label htmlFor="wz-sname">{t('newStyleName')}</label>
                  <input id="wz-sname" className="inp" value={newName} placeholder={t('styleNameHint')} onChange={(e) => setNewName(e.target.value)} /></div>
                <button className={`drop${dropRefs.over ? ' over' : ''}`} {...dropRefs.props} onClick={() => refInput.current?.click()} disabled={!newName.trim() || !!busy}>
                  <b>{busy ? `${t('studying')} ${busy}…` : t('addReferences')}</b><span>{t('addReferencesHint')} · {t('dropHere')}</span>
                </button>
                <input ref={refInput} type="file" accept={VIDEO} multiple hidden onChange={(e) => { uploadRefs(e.target.files); e.target.value = ''; }} />
                <ul className="never">{refs.map((r) => <li key={r}><Check size={14} /> {r}</li>)}</ul>
              </div>
            )}
            <div className="btnrow">
              <button className="btn" onClick={() => setStep(1)}>{t('back')}</button>
              <span className="spacer" />
              {pickNew
                ? <button className="btn primary" disabled={!!busy || !refs.length} onClick={buildStyle}>{t('wzBuildAndNext')}</button>
                : <button className="btn primary" disabled={!style} onClick={() => setStep(3)}>{t('next')}</button>}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="sec">
            <h3>{mode === 'edit' ? t('wzMainVideo') : t('wzMainAudio')}</h3>
            <button className={`drop${dropMain.over ? ' over' : ''}`} {...dropMain.props} onClick={() => mainInput.current?.click()} disabled={progress !== null}>
              <b>{mode === 'edit' ? t('chooseVideos') : t('wzChooseAudio')}</b>
              <span>{mode === 'edit' ? t('newProjectHint') : t('wzAudioHint')} · {t('dropHere')}</span>
            </button>
            <input ref={mainInput} type="file" accept={mode === 'edit' ? VIDEO : AUDIO} multiple={mode === 'edit'} hidden
              onChange={(e) => { addMain(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            {main.length > 0 && (
              <ol className="picklist">
                {main.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <span className="fname">{i + 1}. {f.name}</span>
                    <small>{(f.size / 1e6).toFixed(1)} MB</small>
                    <span className="acts">
                      {mode === 'edit' && <button className="iconbtn" aria-label={`${t('moveUp')}: ${f.name}`} onClick={() => move(i, -1)} disabled={i === 0 || progress !== null}><Up /></button>}
                      {mode === 'edit' && <button className="iconbtn" aria-label={`${t('moveDown')}: ${f.name}`} onClick={() => move(i, 1)} disabled={i === main.length - 1 || progress !== null}><Down /></button>}
                      <button className="iconbtn" aria-label={`${t('remove')}: ${f.name}`} onClick={() => setMain(main.filter((_, j) => j !== i))} disabled={progress !== null}><Close /></button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <h3>{t('wzExtras')} <span>{t('optional')}</span></h3>
            <button className={`drop${dropExtras.over ? ' over' : ''}`} {...dropExtras.props} onClick={() => extraInput.current?.click()} disabled={progress !== null}>
              <b>{t('choose')}</b><span>{t('dropHint')}</span>
            </button>
            <input ref={extraInput} type="file" multiple hidden onChange={(e) => { setExtras([...extras, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
            {extras.length > 0 && (
              <ul className="picklist">
                {extras.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <span className="fname">{f.name}</span><small>{(f.size / 1e6).toFixed(1)} MB</small>
                    <span className="acts"><button className="iconbtn" aria-label={`${t('remove')}: ${f.name}`} onClick={() => setExtras(extras.filter((_, j) => j !== i))} disabled={progress !== null}><Close /></button></span>
                  </li>
                ))}
              </ul>
            )}
            <h3>{t('step_transcribe')}</h3>
            <div className="field"><label htmlFor="wz-lang">{t('videoLang')}</label>
              <select id="wz-lang" className="inp" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
                <option value="uz">Oʻzbekcha</option><option value="ru">Русский</option><option value="en">English</option>
                <option value="auto">{t('langAuto')}</option>
              </select></div>
            <label className="check">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} disabled={!hasKey} />
              <span>{t('wzPaidOk')}</span>
            </label>
            <p className="hint">{hasKey ? t('transcribeHint') : t('wzNoKey')}</p>
            {!hasKey && <div className="btnrow"><button className="btn slim" onClick={onSettings}>{t('openSettings')}</button></div>}
            {progress !== null && <div className="bar"><i style={{width: `${Math.round(progress * 100)}%`}} /></div>}
            <div className="btnrow">
              <button className="btn" onClick={() => setStep(2)} disabled={progress !== null}>{t('back')}</button>
              <span className="spacer" />
              <button className="btn primary" disabled={!main.length || progress !== null} onClick={send}>
                {progress === null ? t('sendClaude') : `${t('uploading')} ${Math.round(progress * 100)}%`}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};
