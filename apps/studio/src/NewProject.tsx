// "+ Yangi loyiha": choose the videos (joined in this order), upload them, and the daemon creates the project and
// starts the free analysis. The project then opens on its setup card (Setup.tsx).
import {useRef, useState} from 'react';
import {api} from './api';
import {useT} from './i18n';

export const NewProject = ({onClose, onCreated}: {onClose(): void; onCreated(id: string): void}) => {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const move = (i: number, d: -1 | 1) => setFiles((f) => {
    const j = i + d;
    if (j < 0 || j >= f.length) return f;
    const next = [...f];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const create = async () => {
    setError(null);
    const total = files.reduce((a, f) => a + f.size, 0) || 1;
    let done = 0;
    try {
      const paths: string[] = [];
      for (const f of files) {
        paths.push(await api.inbox(f, (p) => setProgress((done + p * f.size) / total)));
        done += f.size;
      }
      setProgress(1);
      const {id} = await api.createProject(paths, title.trim() || undefined);
      onCreated(id);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="np-title" onKeyDown={(e) => e.key === 'Escape' && progress === null && onClose()}>
      <div className="sheet">
        <h2 id="np-title">{t('newProject')}</h2>
        <p className="hint">{t('newProjectHint')}</p>
        <button className="drop" onClick={() => input.current?.click()} disabled={progress !== null}>
          <b>{t('chooseVideos')}</b>
          <span>{t('chooseVideosHint')}</span>
        </button>
        <input ref={input} type="file" accept="video/*" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
        {files.length > 0 && (
          <ol className="picklist">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className="fname">{i + 1}. {f.name}</span>
                <small>{(f.size / 1e6).toFixed(1)} MB</small>
                <span className="acts">
                  <button className="iconbtn" aria-label="up" onClick={() => move(i, -1)} disabled={i === 0 || progress !== null}>↑</button>
                  <button className="iconbtn" aria-label="down" onClick={() => move(i, 1)} disabled={i === files.length - 1 || progress !== null}>↓</button>
                  <button className="iconbtn" aria-label={t('remove')} onClick={() => setFiles(files.filter((_, j) => j !== i))} disabled={progress !== null}>✕</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="field"><label htmlFor="np-name">{t('projectTitle')}</label>
          <input id="np-name" className="inp" value={title} placeholder={files[0]?.name ?? ''} onChange={(e) => setTitle(e.target.value)} /></div>
        {progress !== null && <div className="bar"><i style={{width: `${Math.round(progress * 100)}%`}} /></div>}
        {error && <p className="error">{error}</p>}
        <div className="btnrow">
          <button className="btn primary" disabled={!files.length || progress !== null} onClick={create}>
            {progress === null ? t('create') : `${t('uploading')} ${Math.round(progress * 100)}%`}
          </button>
          <button className="btn" onClick={onClose} disabled={progress !== null}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  );
};
