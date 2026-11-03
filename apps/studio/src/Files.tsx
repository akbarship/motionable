// Left panel: the project's own files. Drop or choose them; each uploads with progress, videos are conformed for the
// page on arrival, and Claude sees them in get_project_state as asset ids.
import {useRef, useState} from 'react';
import {api, clock, type FileEntry} from './api';
import {Close} from './Icons';
import {useT, type Key} from './i18n';

type Upload = {name: string; p: number};

export const Files = ({project, files, onError}: {project: string; files: FileEntry[]; onError(m: string): void}) => {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);

  const send = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) {
      setUploads((u) => [...u, {name: f.name, p: 0}]);
      try {
        await api.upload(project, f, (p) => setUploads((u) => u.map((x) => (x.name === f.name ? {...x, p} : x))));
      } catch (e) {
        onError(`${f.name}: ${(e as Error).message}`);
      } finally {
        setUploads((u) => u.filter((x) => x.name !== f.name));
      }
    }
  };

  return (
    <section className="side files" aria-label={t('files')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}>
      <div className="sec">
        <h3>{t('files')} <span>{files.length}</span></h3>
        <button className={`drop${over ? ' over' : ''}`} onClick={() => input.current?.click()}>
          <b>{t('choose')}</b>
          <span>{t('dropHint')}</span>
        </button>
        <input ref={input} type="file" multiple hidden onChange={(e) => { send(e.target.files); e.target.value = ''; }} />
      </div>
      {uploads.map((u) => (
        <div className="file up" key={u.name}>
          <div className="fname">{u.name}</div>
          <div className="bar"><i style={{width: `${Math.round(u.p * 100)}%`}} /></div>
          <small>{u.p < 1 ? `${t('uploading')} ${Math.round(u.p * 100)}%` : t('processing')}</small>
        </div>
      ))}
      {!files.length && !uploads.length && <p className="hint pad">{t('noFiles')}</p>}
      <ul className="filelist">
        {files.map((f) => (
          <li className="file" key={f.id}>
            <div className="thumb">
              {f.thumb ? <img src={`/api/projects/${project}/media/${f.thumb.replace(/^media\//, '')}`} alt="" loading="lazy" /> : <span>{f.kind}</span>}
            </div>
            <div className="meta">
              <div className="fname" title={f.name}>{f.name}</div>
              <small>
                <span className="tag">{t(`kind_${f.kind}` as Key)}</span>
                {f.durationS !== undefined && <> {clock(f.durationS)}</>} · {mb(f.bytes)}
              </small>
            </div>
            <button className="iconbtn" aria-label={`${t('remove')} ${f.name}`}
              onClick={() => api.removeFile(project, f.id).catch((e) => onError(e.message))}><Close size={16} /></button>
          </li>
        ))}
      </ul>
    </section>
  );
};

const mb = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
