import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, upload, type RefFile, type StyleAnswers, type StyleSummary, type Task } from '../api';
import { canContinue, canStudy, parsePalette, pickAccent, rememberStyles, studiedStyleId } from '../pipeline';
import { go } from '../router';
import { Dropzone, FileList, formatSize, toRows, type FileRow } from '../ui/Dropzone';
import { Icon, ICON } from '../ui/TopBar';

const ACCEPT = 'video/*,.mp4,.mov,.m4v,.webm';

const CHIP: Record<RefFile['status'], { text: string; cls: string }> = {
  added: { text: "qo'shildi", cls: 'chip' },
  queued: { text: 'navbatda', cls: 'chip' },
  awaiting_approval: { text: 'navbatda', cls: 'chip' },
  running: { text: "o'rganilmoqda", cls: 'chip chip--run' },
  done: { text: "o'rganildi", cls: 'chip chip--done' },
  failed: { text: 'xato', cls: 'chip chip--fail' },
};

/** Second screen: add every reference (link or file), study them together, answer the style questions, then plan. */
export function References({ id, tick }: { id: string; tick: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [refs, setRefs] = useState<RefFile[]>([]);
  const [styles, setStyles] = useState<StyleSummary[] | null>(null);
  const [saved, setSaved] = useState<StyleAnswers | undefined>(undefined);
  const [picked, setPicked] = useState<string[]>([]);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [studyBusy, setStudyBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [answers, setAnswers] = useState<StyleAnswers | null>(null);

  // Only the newest request may write state; older replies that land late are dropped.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const [v, r] = await Promise.all([api.getProject(id), api.refs(id)]);
      if (seq !== loadSeq.current) return;
      setTasks(v.tasks);
      setRefs(r);
      setSaved(v.project.styleAnswers);
      setError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const studied = studiedStyleId(tasks);
  useEffect(() => {
    api.styles().then(setStyles, () => setStyles([]));
  }, [studied]);

  // The style the questions are about: the one just studied, else the first picked saved style.
  const subjectId = studied ?? picked[0] ?? null;
  const subject = styles?.find((s) => s.id === subjectId) ?? null;
  useEffect(() => {
    if (!subject) return setAnswers(null);
    setAnswers(
      saved ?? {
        palette: 'reference',
        font: subject.fontFamily,
        background: 'exact',
        accent: pickAccent(subject.palette),
      },
    );
  }, [subject?.id, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const studyRunning = tasks.some((t) => t.type === 'study_ref' && (t.status === 'queued' || t.status === 'running'));
  const ready = canContinue(tasks, picked.length);
  const canGo = ready && !starting;

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

  const patch = (key: string, p: Partial<FileRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)));

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

  async function remove(name: string) {
    setError(null);
    try {
      await api.deleteRef(id, name);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function study() {
    setStudyBusy(true);
    setError(null);
    try {
      await api.startStudy(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStudyBusy(false);
    }
  }

  async function start() {
    if (!canGo) return;
    setStarting(true);
    setError(null);
    const styleIds = [...new Set([...picked, ...(studied ? [studied] : [])])];
    try {
      if (answers) await api.putStyleAnswers(id, answers);
      // Footage or voiceovers to clean first: the rough cut comes before the plan.
      const [footage, cut] = await Promise.all([api.footage(id), api.cut(id)]);
      if (footage.length > 0 && !cut?.approved) {
        rememberStyles(id, styleIds);
        go(`#/p/${id}/footage`);
        return;
      }
      await api.addTask(id, 'direct', { styleIds });
      go(`#/p/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setStarting(false);
    }
  }

  const toggle = (sid: string) => setPicked((cur) => (cur.includes(sid) ? cur.filter((x) => x !== sid) : [...cur, sid]));
  const failed = [...tasks].reverse().find((t) => t.type === 'study_ref' && t.status === 'failed');

  return (
    <div className="stage stage--refs">
      <h1 className="h-screen">Namuna videolar</h1>
      <p className="muted lead">Hamma namunalarni qo'shing, keyin bir marta o'rganishni boshlang. Uslub hammasidan bitta bo'lib yoziladi.</p>

      <div className="ref-options">
        <form className="ref-option" onSubmit={addLink} noValidate>
          <h2 className="h-sub">
            <Icon d={ICON.link} size={15} /> Instagram havolasi
          </h2>
          <input
            id="ref-link"
            type="url"
            inputMode="url"
            aria-label="Instagram havolasi"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://www.instagram.com/reel/…"
            aria-invalid={!!linkError || undefined}
            aria-describedby={linkError ? 'ref-link-error' : undefined}
          />
          <button type="submit" className="btn btn--dark" disabled={linkBusy || !link.trim()}>
            {linkBusy ? 'Yuklanmoqda…' : "Qo'shish"}
          </button>
          {linkError && (
            <p id="ref-link-error" className="form-error" role="alert">
              {linkError}
            </p>
          )}
        </form>

        <div className="ref-option">
          <h2 className="h-sub">Videoni yuklang</h2>
          <Dropzone className="ref-drop" label="Videoni tashlang yoki tanlang" hint="MP4, MOV, WEBM" accept={ACCEPT} onFiles={(f) => void addFiles(f)} />
          <FileList
            rows={rows.filter((r) => r.state !== 'done')}
            onRetry={(key) => {
              const row = rows.find((r) => r.key === key);
              if (row) void sendFile(row);
            }}
          />
        </div>
      </div>

      {refs.length > 0 && (
        <section className="block" aria-labelledby="refs-h">
          <h2 id="refs-h" className="block-h">
            Qo'shilgan namunalar ({refs.length})
          </h2>
          <ul className="refs">
            {refs.map((r) => {
              const c = CHIP[r.status];
              const locked = r.status === 'queued' || r.status === 'running';
              return (
                <li key={r.name} className="ref">
                  <span className="ref-name" title={r.name}>
                    {r.name}
                  </span>
                  <span className="muted small">{formatSize(r.size)}</span>
                  <span className={c.cls}>
                    <span className="dot" aria-hidden="true" />
                    {c.text}
                  </span>
                  <button type="button" className="btn btn--ghost btn--sm" disabled={locked} onClick={() => void remove(r.name)} aria-label={`${r.name} ni olib tashlash`}>
                    Olib tashlash
                  </button>
                </li>
              );
            })}
          </ul>
          {failed?.error && <p className="form-error">{failed.error}</p>}
          <div className="actions">
            <button type="button" className="btn btn--dark" disabled={!canStudy(refs, tasks) || studyBusy} onClick={() => void study()}>
              {studyRunning ? "O'rganilmoqda…" : "O'rganishni boshlash"}
            </button>
          </div>
        </section>
      )}

      {subject && answers && <StyleQuestions style={subject} value={answers} onChange={setAnswers} />}

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

      <div className="actions">
        <button type="button" className="btn btn--dark btn--lg" disabled={!canGo} onClick={() => void start()}>
          {starting ? 'Boshlanmoqda…' : 'Davom etish'}
        </button>
        <p className="muted small" aria-live="polite">
          {studyRunning
            ? "Namunalar o'rganib bo'linguncha kuting."
            : refs.length > 0 && !studied && picked.length === 0
              ? "Avval «O'rganishni boshlash»ni bosing."
              : refs.length === 0 && picked.length === 0
                ? 'Kamida bitta namuna yoki uslub kerak.'
                : ''}
        </p>
      </div>
    </div>
  );
}

/** Follow-up questions after a study; each answer defaults to the reference value. */
function StyleQuestions({ style, value, onChange }: { style: StyleSummary; value: StyleAnswers; onChange: (a: StyleAnswers) => void }) {
  const own = value.palette !== 'reference';
  const [ownText, setOwnText] = useState(own ? (value.palette as string[]).join(', ') : '');
  const set = (p: Partial<StyleAnswers>) => onChange({ ...value, ...p });
  const colours = own ? (value.palette as string[]) : style.palette;

  return (
    <section className="block questions" aria-labelledby="q-h">
      <h2 id="q-h" className="block-h">
        Uslub savollari
      </h2>
      <p className="muted small">
        Namunadan olingan qiymatlar tanlangan. Kerak bo'lsa o'zgartiring; rejissyor va ijrochi bularni qat'iy qoida deb oladi.
      </p>

      <fieldset className="q">
        <legend>1. Asosiy ranglar qaysi?</legend>
        <label className="radio">
          <input type="radio" name="q-pal" checked={!own} onChange={() => set({ palette: 'reference' })} />
          <span>Namunadagi ranglar</span>
          <span className="swatches" aria-hidden="true">
            {style.palette.slice(0, 6).map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="q-pal"
            checked={own}
            onChange={() => {
              const p = parsePalette(ownText);
              set({ palette: p.length ? p : style.palette.slice(0, 3) });
            }}
          />
          <span>O'z ranglarim</span>
        </label>
        {own && (
          <input
            type="text"
            aria-label="O'z ranglaringiz, vergul bilan"
            placeholder="#f4f1ea, #c9643f, #1d1d1b"
            value={ownText}
            onChange={(e) => {
              setOwnText(e.target.value);
              const p = parsePalette(e.target.value);
              if (p.length) set({ palette: p });
            }}
          />
        )}
      </fieldset>

      <fieldset className="q">
        <legend>2. Shrift</legend>
        <input type="text" aria-label="Shrift nomi" value={value.font} onChange={(e) => set({ font: e.target.value || style.fontFamily })} />
      </fieldset>

      <fieldset className="q">
        <legend>3. Fon namunadagidek aynan bo'lsinmi?</legend>
        {style.background && <p className="muted small">Namunada: {style.background}</p>}
        <label className="radio">
          <input type="radio" name="q-bg" checked={value.background === 'exact'} onChange={() => set({ background: 'exact' })} />
          <span>Ha, aynan o'zi</span>
        </label>
        <label className="radio">
          <input type="radio" name="q-bg" checked={value.background === 'simple'} onChange={() => set({ background: 'simple' })} />
          <span>Shu ranglarda, sokinroq</span>
        </label>
      </fieldset>

      <fieldset className="q">
        <legend>4. Urg'u rangi</legend>
        <div className="swatch-pick">
          {colours.map((c) => (
            <button
              key={c}
              type="button"
              className={value.accent.toLowerCase() === c.toLowerCase() ? 'swatch is-on' : 'swatch'}
              style={{ background: c }}
              aria-pressed={value.accent.toLowerCase() === c.toLowerCase()}
              aria-label={c}
              onClick={() => set({ accent: c.toLowerCase() })}
            />
          ))}
          <input type="color" aria-label="Boshqa rang" value={value.accent} onChange={(e) => set({ accent: e.target.value.toLowerCase() })} />
        </div>
      </fieldset>
    </section>
  );
}
