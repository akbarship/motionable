// A project with no plan yet: the analysis as it runs, the paid transcript (unless the wizard already agreed to it),
// and the plan request to Claude in chat. Claude's proposal opens on its own page (Proposal.tsx) when it's written.
import {useEffect, useState} from 'react';
import {api, type ProjectState} from './api';
import {useT, type Key} from './i18n';
import {RequestCard, useRequests} from './Requests';
import {PaidDialog} from './Dialogs';
import {Check} from './Icons';

const STEPS = ['source', 'voice', 'loudness', 'sheet', 'track', 'transcribe'];

export const Setup = ({project, title, tick, onSettings, onError}: {
  project: string; title: string; tick: number; onSettings(): void; onError(m: string): void;
}) => {
  const t = useT();
  const [state, setState] = useState<ProjectState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const {last, ask, cancel} = useRequests({project}, onError);

  useEffect(() => { api.state(project).then(setState, (e) => onError(e.message)); }, [project, tick, onError]);

  const steps = state?.analysis?.steps ?? {};
  const voiceover = state?.brief?.mode === 'voiceover';
  const analysed = steps.loudness === 'done';
  const transcribed = steps.transcribe === 'done' || !!state?.next && !/transcribe|analysis/.test(state.next);
  const running = Object.values(steps).some((v) => v === 'running') || state?.next?.startsWith('analysis is running');

  const transcribe = async () => {
    setConfirm(false);
    setBusy(true);
    try {
      await api.transcribe(project);
    } catch (e) {
      const m = (e as Error).message;
      onError(m); // a missing key comes back as a notice with its "Open Settings" button
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup">
      <div className="sheet">
        <h2>{title}</h2>
        {state?.brief && <p className="muted">{state.brief.about}</p>}
        <ol className="steps">
          {STEPS.filter((k) => !(voiceover && (k === 'sheet' || k === 'track'))).map((k) => {
            const v = steps[k] ?? (k === 'transcribe' && transcribed ? 'done' : 'waiting');
            const st = v.startsWith('failed') ? 'failed' : v;
            return (
              <li key={k} className={st}>
                <span className="dot" />
                <b>{t(`step_${k}` as Key)}</b>
                <small>{st === 'done' ? <Check size={14} /> : st === 'running' ? t('running') : ''}</small>
                {st === 'failed' && <span className="fail"><small>{v.slice(8)}</small>
                  <button className="btn slim" onClick={() => api.analyze(project).catch((e) => onError(e.message))}>{t('retry')}</button></span>}
              </li>
            );
          })}
        </ol>
        {state?.analysis?.warnings?.map((w) => <p key={w} className="hint">{w}</p>)}
        {analysed && !transcribed && !running && (
          <div className="sec">
            <h3>{t('step_transcribe')}</h3>
            <p className="hint">{t('transcribeHint')}</p>
            <div className="btnrow"><button className="btn primary" onClick={() => setConfirm(true)} disabled={busy}>{busy ? t('running') : t('transcribeGo')}</button></div>
          </div>
        )}
        <div className="sec">
          <h3>{t('proposal')}</h3>
          {last ? <RequestCard r={last} onCancel={cancel} /> : <p className="hint">{t('planHint')}</p>}
          {(!last || last.status === 'done' || last.status === 'cancelled') && (
            <div className="btnrow"><button className="btn primary" onClick={() => ask('plan')}>{t('askPlan')}</button></div>
          )}
        </div>
      </div>
      <PaidDialog open={confirm} minutes={state?.durationS ? state.durationS / 60 : null} onYes={transcribe} onNo={() => setConfirm(false)} />
    </main>
  );
};
