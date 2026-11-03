// Claude's proposal, before any edit: how long the reel will be, how much is cut, and every scene with what happens
// and why. "Approve" asks Claude to edit it; a few words + "Change" ask for a new version. Older versions stay
// readable, each with the user's answer.
import {useEffect, useRef, useState} from 'react';
import {api, clock, type Proposal as P} from './api';
import {useT} from './i18n';
import {RequestCard, useRequests} from './Requests';
import {Plus} from './Icons';

export const Proposal = ({project, list, onError}: {project: string; list: P[]; onError(m: string): void}) => {
  const t = useT();
  const [v, setV] = useState(list.at(-1)?.v ?? 0);
  const [text, setText] = useState('');
  const {last, ask, cancel} = useRequests({project}, onError);
  useEffect(() => setV(list.at(-1)?.v ?? 0), [list]);
  const p = list.find((x) => x.v === v) ?? list.at(-1);
  if (!p) return null;
  const current = p.v === list.at(-1)?.v;
  const waiting = last && (last.status === 'queued' || last.status === 'taken');

  // clips Claude asked for: uploaded straight into the project's files, where it picks them up
  const pickClips = useRef<HTMLInputElement>(null);
  const [sent, setSent] = useState(0);
  const upload = async (files: File[]) => {
    for (const f of files) {
      try {
        await api.upload(project, f, () => {});
        setSent((n) => n + 1);
      } catch (e) {
        onError(`${f.name}: ${(e as Error).message}`);
      }
    }
  };

  const revise = async () => {
    if (await ask('revise', text)) setText('');
  };

  return (
    <main className="setup">
      <div className="sheet wide proposal">
        <h2>{t('proposal')}
          {list.length > 1 && (
            <select className="inp slim" value={p.v} onChange={(e) => setV(Number(e.target.value))} aria-label={t('version')}>
              {list.map((x) => <option key={x.v} value={x.v}>v{x.v}</option>)}
            </select>
          )}
          {p.status !== 'proposed' && <span className={`tag ${p.status === 'approved' ? 'done' : 'open'}`}>{p.status === 'approved' ? t('approved') : t('changesAsked')}</span>}
        </h2>
        <div className="stats">
          <div><b>{clock(p.durationS)}</b><span>{t('length')}</span></div>
          <div><b>{p.cutS ? `−${p.cutS.toFixed(1)} s` : '0 s'}</b><span>{t('cutTime')}</span></div>
          <div><b>{p.scenes.length}</b><span>{t('scenesN')}</span></div>
        </div>
        <p>{p.summary}</p>
        {p.style && <p className="muted">{t('style')}: {p.style}</p>}

        <div className="sec">
          <h3>{t('scenes')}</h3>
          <ol className="scenes">
            {p.scenes.map((s, i) => (
              <li key={i}>
                <span className="tc">{clock(s.from)}–{clock(s.to)}</span>
                <div><b>{s.title}</b><p>{s.what}</p><p className="why">{t('why')}: {s.why}</p></div>
              </li>
            ))}
          </ol>
        </div>
        {!!p.cuts?.length && (
          <div className="sec">
            <h3>{t('removed')} <span>{p.cuts.length}</span></h3>
            <ul className="scenes cuts">
              {p.cuts.map((c, i) => <li key={i}><span className="tc">{clock(c.from)}–{clock(c.to)}</span><div><p>{c.why}</p></div></li>)}
            </ul>
          </div>
        )}
        {!!p.needs?.length && (
          <div className="sec needs">
            <h3>{t('needsTitle')} <span>{p.needs.length}</span></h3>
            <p className="hint">{t('needsHint')}</p>
            <ul className="scenes">
              {p.needs.map((n, i) => <li key={i}><span className="tc">{n.when ?? ''}</span><div><p>{n.what}</p></div></li>)}
            </ul>
            <div className="btnrow">
              <button className="btn" onClick={() => pickClips.current?.click()}><Plus size={14} /> {t('uploadClips')}</button>
              {sent > 0 && <span className="tag done" role="status">{sent} {t('uploaded')}</span>}
              <input ref={pickClips} type="file" accept="video/*,image/*" multiple hidden onChange={(e) => { upload(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            </div>
          </div>
        )}
        {(p.audio || p.delivery || p.pauses === 'keep') && (
          <div className="sec">
            {p.audio && <p><b>{t('sound')}:</b> {p.audio}</p>}
            {p.delivery && <p><b>{t('export')}:</b> {p.delivery}</p>}
            {p.pauses === 'keep' && <p className="muted">{t('pausesKept')}</p>}
          </div>
        )}
        {p.feedback && <p className="reply">{t('yourWords')}: {p.feedback}</p>}

        {current && (
          <div className="sec">
            {last && <RequestCard r={last} onCancel={cancel} />}
            {p.status === 'proposed' && !waiting && (
              <>
                <textarea className="inp" rows={2} placeholder={t('changePlaceholder')} value={text} onChange={(e) => setText(e.target.value)} />
                <div className="btnrow">
                  <button className="btn" disabled={!text.trim()} onClick={revise}>{t('change')}</button>
                  <span className="spacer" />
                  <button className="btn primary" onClick={() => ask('approve')}>{t('approveGo')}</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
};

/** The proposals of a project, kept fresh by the live events. */
export const useProposals = (project: string | null, tick: number) => {
  const [list, setList] = useState<P[]>([]);
  useEffect(() => {
    if (!project) return setList([]);
    api.proposals(project).then(setList, () => setList([]));
  }, [project, tick]);
  return list;
};
