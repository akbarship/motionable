// "Videolarim": every export and render, newest first. Exports are the finished files (−14 LUFS, SRT beside them).
import {useEffect, useState} from 'react';
import {api, type Video} from './api';
import {useT, type Key} from './i18n';

export const Videos = ({refresh, onOpen}: {refresh: number; onOpen(project: string): void}) => {
  const t = useT();
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [only, setOnly] = useState<'export' | 'all'>('export');
  useEffect(() => {
    api.videos().then(setVideos, () => setVideos([]));
  }, [refresh]);
  const shown = (videos ?? []).filter((v) => only === 'all' || v.kind === 'export');
  return (
    <main className="videos">
      <div className="vhead">
        <h2>{t('myVideos')}</h2>
        <div className="seg" role="group" aria-label={t('myVideos')}>
          <button className={only === 'export' ? 'on' : ''} onClick={() => setOnly('export')}>{t('exports')}</button>
          <button className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>{t('allRenders')}</button>
        </div>
      </div>
      {videos && !shown.length && <p className="hint">{t('noVideos')}</p>}
      <ul className="vgrid">
        {shown.map((v) => {
          const src = `/api/projects/${v.project}/out/${v.file}`;
          return (
            <li key={`${v.project}/${v.file}`} className="vcard">
              <video src={src} controls preload="metadata" playsInline />
              <div className="vmeta">
                <div className="vtitle">
                  <button className="link strong" onClick={() => onOpen(v.project)}>{v.project}</button>
                  <span className={`tag ${v.kind === 'export' ? 'done' : ''}`}>{t(`kind_${v.kind}` as Key)} · v{v.version}</span>
                </div>
                <small>{new Date(v.at).toLocaleString()} · {(v.bytes / 1e6).toFixed(1)} MB</small>
                <div className="btnrow wrap">
                  <a className="btn primary" href={src} download={v.file}>MP4</a>
                  {v.srt && <a className="btn" href={`/api/projects/${v.project}/out/${v.srt}`} download={v.srt}>SRT</a>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
};

