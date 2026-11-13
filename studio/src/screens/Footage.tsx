import { useCallback, useEffect, useRef, useState } from 'react';
import { api, bodyUrl, upload, type Cut, type FootageFile, type Task } from '../api';
import { errorText } from '../errors';
import { newestTask, recalledStyles } from '../pipeline';
import { go } from '../router';
import { Dropzone, FileList, formatSize, toRows, type FileRow } from '../ui/Dropzone';

const ACCEPT = 'video/*,audio/*,.mp4,.mov,.m4v,.webm,.mp3,.wav,.m4a';
const active = (t: Task) => t.status === 'queued' || t.status === 'running';
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/**
 * Footage: the user's clips and voiceovers. Claude drops the bad ones, picks the best take of every
 * script line, cuts the pauses and joins one body; the person checks it here before the plan.
 */
export function Footage({ id, tick }: { id: string; tick: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<FootageFile[]>([]);
  const [cut, setCut] = useState<Cut | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const [v, f, c] = await Promise.all([api.getProject(id), api.footage(id), api.cut(id)]);
      if (seq !== loadSeq.current) return;
      setTasks(v.tasks);
      setFiles(f);
      setCut(c);
      setError(null);
    } catch (e) {
      if (seq === loadSeq.current) setError(errorText((e as Error).message));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const rc = newestTask(tasks.filter((t) => t.type === 'roughcut'));
  const cutting = !!rc && active(rc);
  const planned = tasks.some((t) => t.type === 'direct');

  const patch = (key: string, p: Partial<FileRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)));
  async function send(row: FileRow) {
    patch(row.key, { state: 'uploading', progress: 0, error: undefined });
    try {
      await upload(id, 'broll', row.file, (f) => patch(row.key, { progress: f }));
      patch(row.key, { state: 'done', progress: 1 });
    } catch (e) {
      patch(row.key, { state: 'error', error: (e as Error).message });
    }
  }
  async function addFiles(list: File[]) {
    const fresh = toRows(list);
    setRows((cur) => [...cur, ...fresh]);
    for (const r of fresh) await send(r);
    setRows((cur) => cur.filter((r) => r.state !== 'done'));
    await load();
  }

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText((e as Error).message));
    } finally {
      setBusy(null);
    }
  }
  const startCut = () =>
    act('cut', async () => {
      await api.addTask(id, 'roughcut', note.trim() ? { note: note.trim() } : {});
      setNote('');
    });
  const toPlan = (approveFirst: boolean) =>
    act('plan', async () => {
      if (approveFirst) await api.approveCut(id);
      await api.addTask(id, 'direct', { styleIds: recalledStyles(id, tasks) });
      go(`#/p/${id}`);
    });

  return (
    <div className="stage stage--footage">
      <h1 className="h-screen">Footaj va ovoz</h1>
      <p className="muted lead">
        Videolar yoki voiceoverlarni yuklang. Claude yaroqsizlarini chiqaradi, har gapning eng yaxshi dublini skript bo'yicha tanlaydi,
        pauzalarni kesadi va bitta body yig'adi.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="footage-grid">
        <section className="panel">
          <Dropzone label="Video yoki ovozni tashlang" hint="MP4, MOV, MP3, WAV, M4A. Bir nechta fayl bo'lishi mumkin." accept={ACCEPT} disabled={cutting} onFiles={(f) => void addFiles(f)} />
          <FileList rows={rows} onRemove={(key) => setRows((cur) => cur.filter((r) => r.key !== key))} />
          <h2 className="h-sub">Yuklangan fayllar ({files.length})</h2>
          {files.length === 0 && <p className="muted small">Hali fayl yo'q. Footaj kerak bo'lmasa, to'g'ridan-to'g'ri rejaga o'ting.</p>}
          <ul className="footage-list">
            {files.map((f) => {
              const why = cut?.dropped.find((d) => d.src.endsWith(`/${f.name}`))?.why;
              const used = cut?.segments.some((s) => s.src.endsWith(`/${f.name}`));
              return (
                <li key={f.name} className="footage-item">
                  <span className="file-name" title={f.name}>{f.name}</span>
                  <span className="muted small">{f.kind === 'audio' ? 'ovoz' : 'video'} · {formatSize(f.size)}</span>
                  {used && <span className="chip chip--done">ishlatildi</span>}
                  {why && <span className="chip chip--fail" title={why}>tashlandi: {why}</span>}
                </li>
              );
            })}
          </ul>
          <label className="field">
            <span className="field-label">Claude'ga izoh (ixtiyoriy)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: 3-gapni ikkinchi dubldan oling" />
          </label>
          <div className="actions">
            <button type="button" className="btn btn--dark btn--lg" disabled={files.length === 0 || cutting || busy !== null} onClick={() => void startCut()}>
              {cutting ? 'Kesilmoqda…' : cut ? 'Qayta kesish' : 'Kesishni boshlash'}
            </button>
            {files.length === 0 && !planned && (
              <button type="button" className="btn btn--ghost btn--lg" disabled={busy !== null} onClick={() => void toPlan(false)}>
                Footajsiz davom etish
              </button>
            )}
          </div>
          {cutting && rc && <p className="muted small" aria-busy="true">{rc.progress[rc.progress.length - 1] ?? 'Navbatda…'}</p>}
          {rc?.status === 'failed' && <p className="form-error">Kesish xatosi: {rc.error}</p>}
        </section>

        <section className="panel footage-body">
          <h2 className="h-sub">Body {cut?.duration ? `· ${fmt(cut.duration)}` : ''}</h2>
          {cut?.body ? (
            <>
              {cut.body.endsWith('.wav') ? (
                <audio controls src={bodyUrl(id, cut.duration ?? 0)} />
              ) : (
                <div className="player">
                  <video controls playsInline preload="metadata" src={bodyUrl(id, cut.duration ?? 0)} />
                </div>
              )}
              <ol className="cut-list">
                {cut.segments.map((s, i) => (
                  <li key={i}>
                    <span className="muted small">{s.src.split('/').pop()} {fmt(s.in)}–{fmt(s.out)}</span>
                    {s.line && <span> {s.line}</span>}
                  </li>
                ))}
              </ol>
              {!planned && (
                <button type="button" className="btn btn--dark btn--lg" disabled={cutting || busy !== null} onClick={() => void toPlan(!cut.approved)}>
                  {busy === 'plan' ? 'Yuborilmoqda…' : 'Tasdiqlash va rejaga o’tish'}
                </button>
              )}
            </>
          ) : (
            <p className="muted">{cutting ? 'Body yig’ilmoqda…' : 'Kesishdan keyin bu yerda tayyor body chiqadi.'}</p>
          )}
        </section>
      </div>
    </div>
  );
}
