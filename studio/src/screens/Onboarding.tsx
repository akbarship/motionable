import { useState, type FormEvent } from 'react';
import { api, upload, type Project } from '../api';
import { go } from '../router';
import { Dropzone, FileList, toRows, type FileRow } from '../ui/Dropzone';

const ACCEPT = 'video/*,audio/*,image/*,.mp4,.mov,.m4v,.webm,.mp3,.wav,.m4a,.png,.jpg,.jpeg,.webp';

/** First screen: what the video is about, its name, and the footage. */
export function Onboarding({ onCreated }: { onCreated: (p: Project) => void }) {
  const [brief, setBrief] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<FileRow[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (key: string, p: Partial<FileRow>) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function send(pid: string, row: FileRow): Promise<boolean> {
    patch(row.key, { state: 'uploading', progress: 0, error: undefined });
    try {
      await upload(pid, 'broll', row.file, (f) => patch(row.key, { progress: f }));
      patch(row.key, { state: 'done', progress: 1 });
      return true;
    } catch (e) {
      patch(row.key, { state: 'error', error: (e as Error).message });
      return false;
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError('Loyiha nomini yozing.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let p = project;
      if (!p) {
        p = await api.createProject({ name: name.trim(), brief: brief.trim() });
        setProject(p);
        onCreated(p);
      }
      let ok = true;
      for (const row of rows) {
        if (row.state === 'done') continue;
        if (!(await send(p.id, row))) ok = false;
      }
      if (ok) go(`#/p/${p.id}/refs`);
      else setError("Ba'zi fayllar yuklanmadi. Qayta urinib ko'ring yoki ularsiz davom eting.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const failed = rows.some((r) => r.state === 'error');

  return (
    <form className="stage stage--split" onSubmit={submit} noValidate>
      <div className="panel">
        <h1 className="h-screen">Yangi video</h1>
        <p className="muted lead">Nima haqida ekanini yozing va videolarni tashlang. Qolganini Claude yig'adi.</p>

        <div className="field">
          <label htmlFor="brief">Video nima haqida?</label>
          <textarea
            id="brief"
            rows={5}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Masalan: uy qurishga ruxsat qanday olinadi, 5 qadamda. Oxirida Telegram kanalga chaqiring."
            disabled={!!project}
          />
        </div>

        <div className="field">
          <label htmlFor="name">Loyiha nomi</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Uy qurishga ruxsat"
            autoComplete="off"
            required
            aria-invalid={error === 'Loyiha nomini yozing.' || undefined}
            disabled={!!project}
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

      </div>

      <div className="actions actions--stage">
        <button type="submit" className="btn btn--dark btn--lg" disabled={busy}>
          {busy ? 'Yuklanmoqda…' : project ? 'Qayta yuklash' : 'Davom etish'}
        </button>
        {project && failed && !busy && (
          <button type="button" className="btn btn--ghost btn--lg" onClick={() => go(`#/p/${project.id}/refs`)}>
            Ularsiz davom etish
          </button>
        )}
      </div>

      <div className="canvas-col">
        <Dropzone
          className="canvas"
          label="Videolarni shu yerga tashlang"
          hint="Asosiy video va b-roll. Bir nechta fayl bo'lishi mumkin."
          accept={ACCEPT}
          disabled={busy}
          onFiles={(files) => setRows((cur) => [...cur, ...toRows(files)])}
        />
        <FileList
          rows={rows}
          onRemove={(key) => setRows((cur) => cur.filter((r) => r.key !== key))}
          onRetry={project ? (key) => {
            const row = rows.find((r) => r.key === key);
            if (row) void send(project.id, row);
          } : undefined}
        />
      </div>
    </form>
  );
}
