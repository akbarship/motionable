// A project with no plan yet: the analysis as it runs, then the paid transcript (asked first), then a style and a
// camera to start the plan from. The daemon's live events move it along.
import {useEffect, useState} from 'react';
import {api, type ProjectState, type StyleListItem} from './api';
import {useT, type Key} from './i18n';

const STEPS = ['source', 'voice', 'loudness', 'sheet', 'track', 'transcribe'];

export const Setup = ({project, tick, onReady, onSettings, onError}: {
  project: string; tick: number; onReady(): void; onSettings(): void; onError(m: string): void;
}) => {
  const t = useT();
  const [state, setState] = useState<ProjectState | null>(null);
  const [styles, setStyles] = useState<StyleListItem[]>([]);
  const [style, setStyle] = useState('');
  const [camera, setCamera] = useState<'track' | 'fixed' | 'off'>('track');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { api.state(project).then(setState, (e) => onError(e.message)); }, [project, tick, onError]);
  useEffect(() => {
    api.styles().then((s) => {
      setStyles(s);
      const last = s.find((x) => x.versions.length);
      if (last && !style) setStyle(`${last.name}@${last.versions.at(-1)}`);
    }, () => setStyles([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = state?.analysis?.steps ?? {};
  const analysed = steps.sheet === 'done';
  const transcribed = steps.transcribe === 'done' || state?.next?.startsWith('choose a style');
  const running = Object.values(steps).some((v) => v === 'running') || state?.next?.startsWith('analysis is running');

  const transcribe = async () => {
    if (!window.confirm(t('transcribeConfirm'))) return;
    setBusy('transcribe');
    try {
      await api.transcribe(project);
    } catch (e) {
      const m = (e as Error).message;
      if (/no ElevenLabs key/i.test(m)) onSettings();
      onError(m);
    } finally {
      setBusy(null);
    }
  };
  const start = async () => {
    setBusy('scaffold');
    try {
      const {version} = await api.scaffold(project, style);
      // the scaffold picks track when there's a face; the user's pick goes in as the first edit
      await api.ops(project, version, 'camera chosen at setup', [{op: 'camera.set', mode: camera}]);
      onReady();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="setup">
      <div className="sheet">
        <h2>{project}</h2>
        <ol className="steps">
          {STEPS.map((k) => {
            const v = steps[k] ?? (k === 'transcribe' && transcribed ? 'done' : 'waiting');
            const st = v.startsWith('failed') ? 'failed' : v;
            return (
              <li key={k} className={st}>
                <span className="dot" />
                <b>{t(`step_${k}` as Key)}</b>
                <small>{st === 'done' ? '✓' : st === 'running' ? t('running') : st === 'failed' ? v.slice(8) : ''}</small>
              </li>
            );
          })}
        </ol>
        {state?.analysis?.warnings?.map((w) => <p key={w} className="hint">⚠ {w}</p>)}
        {analysed && !transcribed && (
          <div className="sec">
            <h3>{t('step_transcribe')}</h3>
            <p className="hint">{t('transcribeHint')}</p>
            <div className="btnrow"><button className="btn primary" onClick={transcribe} disabled={!!busy || running}>{busy === 'transcribe' ? t('running') : t('transcribeGo')}</button></div>
          </div>
        )}
        {transcribed && (
          <div className="sec">
            <h3>{t('startPlan')}</h3>
            {!styles.length && <p className="hint">{t('noStyles')}</p>}
            <div className="field"><label htmlFor="st-style">{t('style')}</label>
              <select id="st-style" className="inp" value={style} onChange={(e) => setStyle(e.target.value)}>
                {styles.flatMap((s) => s.versions.map((v) => <option key={`${s.name}@${v}`} value={`${s.name}@${v}`}>{s.name}@{v}</option>))}
              </select></div>
            <div className="field"><label htmlFor="st-cam">{t('camera')}</label>
              <select id="st-cam" className="inp" value={camera} onChange={(e) => setCamera(e.target.value as typeof camera)}>
                <option value="track">{t('cam_track')}</option><option value="fixed">{t('cam_fixed')}</option><option value="off">{t('cam_off')}</option>
              </select></div>
            <div className="btnrow"><button className="btn primary" onClick={start} disabled={!style || !!busy}>{t('startPlanGo')}</button></div>
          </div>
        )}
      </div>
    </main>
  );
};
