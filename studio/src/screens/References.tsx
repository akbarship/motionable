import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, upload, type StyleSummary, type Task } from '../api';
import { go } from '../router';
import { Dropzone, FileList, toRows, type FileRow } from '../ui/Dropzone';
import { Icon, ICON } from '../ui/TopBar';

const ACCEPT = 'video/*,.mp4,.mov,.m4v,.webm';

const CHIP: Record<Task['status'], { text: string; cls: string }> = {
  queued: { text: 'navbatda', cls: 'chip' },
  awaiting_approval: { text: 'navbatda', cls: 'chip' },
  running: { text: "o'rganilmoqda", cls: 'chip chip--run' },
  done: { text: 'tayyor', cls: 'chip chip--done' },
  failed: { text: 'xato', cls: 'chip chip--fail' },
};

function refName(t: Task): string {
  const v = t.input.video;
  return typeof v === 'string' ? v.split('/').pop() || v : t.id;
}

/** A study_ref task may report the style it saved; pick it up if so. */
function outputStyleId(t: Task): string | null {
  const o = t.output as { styleId?: unknown } | null;
  return o && typeof o.styleId === 'string' ? o.styleId : null;
}

/** Second screen: add reference reels (link or file) or pick saved styles, then hand off to the director. */
export function References({ id, tick }: { id: string; tick: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [styles, setStyles] = useState<StyleSummary[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Only the newest request may write state; older replies that land late are dropped.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const v = await api.getProject(id);
      if (seq !== loadSeq.current) return;
      setTasks(v.tasks);
      setError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  useEffect(() => {
    api.styles().then(setStyles, () => setStyles([]));
  }, []);

  const refs = tasks.filter((t) => t.type === 'study_ref');
  const allDone = refs.length > 0 && refs.every((t) => t.status === 'done');
  const canGo = (allDone || picked.length > 0) && !starting;
  const waiting = refs.length > 0 && !allDone && picked.length === 0;

  async function addLink(e: FormEvent) {
    e.preventDefault();
    if (!link.trim() || linkBusy) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      await api.addRef(id, link.trim());
      setLink('');
      await load();
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setLinkBusy(false);
    }
  }

  const patch = (key: string, p: Partial<FileRow>) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function sendFile(row: FileRow) {
    patch(row.key, { state: 'uploading', progress: 0, error: undefined });
    try {
      const { name } = await upload(id, 'refs', row.file, (f) => patch(row.key, { progress: f }));
      await api.addRefFile(id, name);
      patch(row.key, { state: 'done', progress: 1 });
      await load();
    } catch (err) {
      patch(row.key, { state: 'error', error: (err as Error).message });
    }
  }

  async function addFiles(files: File[]) {
    const fresh = toRows(files);
    setRows((cur) => [...cur, ...fresh]);
    for (const r of fresh) await sendFile(r);
  }

  async function start() {
    if (!canGo) return;
    setStarting(true);
    setError(null);
    const fromRefs = refs.filter((t) => t.status === 'done').map(outputStyleId).filter((s): s is string => !!s);
    const styleIds = [...new Set([...picked, ...fromRefs])];
    try {
      await api.addTask(id, 'direct', { styleIds });
      go(`#/p/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setStarting(false);
    }
  }

  const toggle = (sid: string) =>
    setPicked((cur) => (cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid]));

  return (
    <div className="stage stage--split">
      <div className="panel">
        <h1 className="h-screen">Namuna videolar</h1>
        <p className="muted lead">
          Qaysi uslubda bo'lsin? Instagram havolasini qo'ying, videoni tashlang yoki saqlangan uslubni tanlang.
        </p>

        <form className="field" onSubmit={addLink} noValidate>
          <label htmlFor="ref-link">Instagram havolasi</label>
          <div className="inline">
            <div className="input-icon">
              <Icon d={ICON.link} size={15} />
              <input
                id="ref-link"
                type="url"
                inputMode="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://www.instagram.com/reel/…"
                aria-invalid={!!linkError || undefined}
                aria-describedby={linkError ? 'ref-link-error' : undefined}
              />
            </div>
            <button type="submit" className="btn btn--dark" disabled={linkBusy || !link.trim()}>
              {linkBusy ? 'Yuklanmoqda…' : "Qo'shish"}
            </button>
          </div>
          {linkError && (
            <p id="ref-link-error" className="form-error" role="alert">
              {linkError}
            </p>
          )}
        </form>

        <fieldset className="field styles">
          <legend>Saqlangan uslublar</legend>
          {styles === null ? (
            <p className="muted small">Yuklanmoqda…</p>
          ) : styles.length === 0 ? (
            <p className="muted small">Hali saqlangan uslub yo'q. Birinchi namunani o'rgangach, shu yerda paydo bo'ladi.</p>
          ) : (
            <ul className="style-list">
              {styles.map((s) => {
                const on = picked.includes(s.id);
                return (
                  <li key={s.id}>
                    <button type="button" className={on ? 'style is-on' : 'style'} aria-pressed={on} onClick={() => toggle(s.id)}>
                      <span className="swatches" aria-hidden="true">
                        {s.palette.slice(0, 4).map((c, i) => (
                          <span key={i} style={{ background: c }} />
                        ))}
                      </span>
                      <span className="style-body">
                        <span className="style-name">{s.id}</span>
                        <span className="style-meta">
                          {s.framing} · {s.pace.cutsPerMin} kesim/daq
                        </span>
                      </span>
                      <span className="style-check" aria-hidden="true">
                        {on && <Icon d={ICON.check} size={14} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

      </div>

      <div className="actions actions--stage">
        <button type="button" className="btn btn--dark btn--lg" disabled={!canGo} onClick={start}>
          {starting ? 'Boshlanmoqda…' : 'Davom etish'}
        </button>
        <p className="muted small" aria-live="polite">
          {waiting
            ? "Namunalar o'rganib bo'linguncha kuting."
            : refs.length === 0 && picked.length === 0
              ? 'Kamida bitta namuna yoki uslub kerak.'
              : ''}
        </p>
      </div>

      <div className="canvas-col">
        <Dropzone
          className="canvas"
          label="Namuna videoni shu yerga tashlang"
          hint="Havola ishlamasa, videoni o'zingiz yuklang."
          accept={ACCEPT}
          onFiles={(f) => void addFiles(f)}
        />
        <FileList rows={rows.filter((r) => r.state !== 'done')} onRetry={(key) => {
          const row = rows.find((r) => r.key === key);
          if (row) void sendFile(row);
        }} />
        {refs.length > 0 && (
          <ul className="refs" aria-label="Namunalar">
            {refs.map((t) => {
              const c = CHIP[t.status];
              return (
                <li key={t.id} className="ref">
                  <span className="ref-name" title={refName(t)}>{refName(t)}</span>
                  <span className={c.cls}>
                    <span className="dot" aria-hidden="true" />
                    {c.text}
                  </span>
                  {t.status === 'failed' && t.error && <p className="file-error">{t.error}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
