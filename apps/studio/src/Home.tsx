// Home: where a first-time user lands. Three steps in order (connect Claude, make a style, start a video), each with
// its one action, then the user's videos with where each one is and what it needs next.
import {useEffect, useState} from 'react';
import {api, type Presence, type ProjectItem, type StyleListItem} from './api';
import {useT} from './i18n';
import {CopyCommand} from './Requests';
import {Check, Plus} from './Icons';

type Props = {projects: ProjectItem[]; presence: Presence; refresh: number; onOpen(id: string): void; onNew(): void; onStyles(): void};

export const Home = ({projects, presence, refresh, onOpen, onNew, onStyles}: Props) => {
  const t = useT();
  const [styles, setStyles] = useState<StyleListItem[] | null>(null);
  useEffect(() => { api.styles().then(setStyles, () => setStyles([])); }, [refresh]);

  const claude = presence.status !== 'offline';
  const style = !!styles?.some((s) => s.versions.length > 0);
  const video = projects.length > 0;
  const steps = [
    {key: 'claude', done: claude, title: t('stepClaude'), hint: t('stepClaudeHint'), action: <CopyCommand />},
    {key: 'style', done: style, title: t('stepStyle'), hint: t('stepStyleHint'),
      action: <button className="btn" onClick={onStyles}>{t('stepStyle')}</button>},
    {key: 'video', done: video, title: t('stepVideo'), hint: t('stepVideoHint'),
      action: <button className="btn primary" onClick={onNew}><Plus size={14} /> {t('newVideo')}</button>},
  ];
  const next = steps.find((s) => !s.done)?.key;
  const fmt = (at: string | null) => (at ? new Date(at).toLocaleDateString(undefined, {day: 'numeric', month: 'short'}) : '');

  return (
    <main className="home">
      <div className="homecol">
        {next && (
          <section className="start" aria-labelledby="start-h">
            <h1 id="start-h">{t('getStarted')}</h1>
            <ol className="startlist">
              {steps.map((s, i) => (
                <li key={s.key} className={s.done ? 'done' : s.key === next ? 'now' : ''} aria-current={s.key === next ? 'step' : undefined}>
                  <span className="num" aria-hidden="true">{s.done ? <Check size={14} /> : i + 1}</span>
                  <div>
                    <h2>{s.title}{s.done && <span className="sr"> · {t('doneStep')}</span>}</h2>
                    {!s.done && <p>{s.hint}</p>}
                    {!s.done && s.key === next && <div className="act">{s.action}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section aria-labelledby="videos-h">
          <div className="homehead">
            <h1 id="videos-h">{t('yourVideos')}</h1>
            {!next && <button className="btn primary" onClick={onNew}><Plus size={14} /> {t('newVideo')}</button>}
          </div>
          {projects.length ? (
            <ul className="projects">
              {projects.map((p) => (
                <li key={p.id}>
                  <button onClick={() => onOpen(p.id)}>
                    <b>{p.title}</b>
                    <span className={`vstage ${p.stage}`}>{t(`stage_${p.stage}`)}</span>
                    <small>{fmt(p.at)}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted">{t('noProjects')}</p>}
        </section>
      </div>
    </main>
  );
};
