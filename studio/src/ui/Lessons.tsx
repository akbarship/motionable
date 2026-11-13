import { useEffect, useState } from 'react';
import { api, type LessonGroup } from '../api';
import { errorText } from '../errors';

/** Rules the agents learnt from the user's feedback. The user can add one by hand or delete a wrong one. */
export function Lessons() {
  const [groups, setGroups] = useState<LessonGroup[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.lessons().then(setGroups, (e) => setError(errorText((e as Error).message)));
  }, []);

  async function run(call: () => Promise<LessonGroup[]>) {
    setBusy(true);
    setError(null);
    try {
      setGroups(await call());
    } catch (e) {
      setError(errorText((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const t = text.trim();
    if (!t || busy) return;
    void run(() => api.addLesson('global', t)).then(() => setText(''));
  }

  const total = groups?.reduce((n, g) => n + g.lines.length, 0) ?? 0;

  return (
    <section className="group" aria-labelledby="lessons-h">
      <h2 id="lessons-h" className="h-group">Saboqlar</h2>
      <p className="muted small">
        Izohlaringizdan chiqarilgan qoidalar. Har bir yangi video shu qoidalar bilan rejalashtiriladi. Noto'g'risini o'chiring.
      </p>
      <div className="field">
        <label htmlFor="lesson-new">Yangi qoida</label>
        <div className="inline">
          <input
            id="lesson-new"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault(); // the settings form must not submit
              add();
            }}
            placeholder="Masalan: fon butun videoda bitta bo'lsin"
            maxLength={240}
          />
          <button type="button" className="btn btn--ghost" onClick={add} disabled={busy || !text.trim()}>
            Qo'shish
          </button>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {groups && total === 0 && <p className="muted small">Hali saboq yo'q.</p>}
      {groups?.filter((g) => g.lines.length > 0).map((g) => (
        <div className="lessons" key={g.scope}>
          <h3 className="lessons-scope">{g.scope === 'global' ? 'Barcha videolar' : `Uslub: ${g.scope}`}</h3>
          <ul className="lessons-list">
            {g.lines.map((line) => (
              <li key={line}>
                <span>{line}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy}
                  onClick={() => void run(() => api.deleteLesson(g.scope, line))}
                  aria-label={`Saboqni o'chirish: ${line}`}
                >
                  O'chirish
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
