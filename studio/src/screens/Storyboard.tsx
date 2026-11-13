import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../errors';
import { api, stillUrl, type Storyboard as Board, type Task } from '../api';
import { awaitingGenerate, hasUnknownState, newestTask, storyboardUseGen } from '../pipeline';
import { go } from '../router';
import { ApproveCost } from '../ui/ApproveCost';

const active = (t: Task) => t.status === 'queued' || t.status === 'running';

/** Storyboard: one still per scene with its VO line; comment a frame to change it, approve to animate. */
export function Storyboard({ id, tick }: { id: string; tick: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const [v, b] = await Promise.all([api.getProject(id), api.storyboard(id)]);
      if (seq !== loadSeq.current) return;
      setTasks(v.tasks);
      setBoard(b);
      setError(null);
    } catch (e) {
      if (seq === loadSeq.current) setError(errorText((e as Error).message));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const sb = newestTask(tasks.filter((t) => t.type === 'storyboard'));
  const building = tasks.some((t) => (t.type === 'storyboard' || t.type === 'storyboard_edit' || t.type === 'generate') && active(t));
  const editing = new Set(tasks.filter((t) => t.type === 'storyboard_edit' && active(t)).map((t) => String(t.input.sceneId)));
  // Only an execute started after this storyboard closes it (a re-planned project gets a fresh board).
  const executed = !!sb && tasks.some((t) => t.type === 'execute' && t.status !== 'failed' && t.createdAt > sb.createdAt);
  const pending = awaitingGenerate(tasks);
  const unknown = tasks.filter(hasUnknownState);

  async function comment(sceneId: string) {
    const text = notes[sceneId]?.trim();
    if (!text) return;
    setBusy(sceneId);
    setError(null);
    try {
      await api.addTask(id, 'storyboard_edit', { sceneId, text });
      setNotes((n) => ({ ...n, [sceneId]: '' }));
      await load();
    } catch (e) {
      setError(errorText((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  async function removeStill(sceneId: string, file: string) {
    if (!confirm("Bu kadr o'chirilsinmi? Keyin uni qayta yaratish mumkin.")) return;
    setBusy(sceneId);
    setError(null);
    try {
      await api.deleteStill(id, file);
      await load();
    } catch (e) {
      setError(errorText((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  async function regenerate(sceneId: string) {
    const note = notes[sceneId]?.trim();
    setBusy(sceneId);
    setError(null);
    try {
      await api.addTask(id, 'storyboard_edit', {
        sceneId,
        text: `Foydalanuvchi bu kadrni o'chirdi: boshqacha qilib qayta yarating.${note ? ` Izoh: ${note}` : ''}`,
      });
      setNotes((n) => ({ ...n, [sceneId]: '' }));
      await load();
    } catch (e) {
      setError(errorText((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  const deletedCount = board?.scenes.filter((x) => x.deleted).length ?? 0;

  async function approve() {
    setBusy('approve');
    setError(null);
    try {
      await api.addTask(id, 'execute', { useGen: storyboardUseGen(tasks), fromStoryboard: true });
      go(`#/p/${id}/edit`);
    } catch (e) {
      setError(errorText((e as Error).message));
      setBusy(null);
    }
  }

  return (
    <div className="board">
      <div className="board-bar">
        <h1 className="h-screen">Storyboard</h1>
        {board && !executed && (
          <button type="button" className="btn btn--dark btn--lg" disabled={building || pending.length > 0 || busy !== null || deletedCount > 0} onClick={() => void approve()}>
            {busy === 'approve' ? 'Yuborilmoqda…' : 'Tasdiqlash va animatsiya qilish'}
          </button>
        )}
        {executed && (
          <a className="btn btn--dark" href={`#/p/${id}/edit`}>
            Muharrirga o'tish
          </a>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!sb && (
        <p className="muted">
          Storyboard hali yo'q. <a href={`#/p/${id}`}>Jarayon</a>da rejani tasdiqlang.
        </p>
      )}
      {sb?.status === 'failed' && <p className="form-error">Storyboard xatosi: {sb.error}</p>}
      {sb && !board && active(sb) && (
        <p className="muted" aria-busy="true">
          Har sahna uchun kadr tayyorlanmoqda…
        </p>
      )}
      {building && board && <p className="muted small">Yangilanmoqda…</p>}
      {deletedCount > 0 && !executed && <p className="muted small">{deletedCount} ta kadr o'chirilgan: tasdiqlashdan oldin ularni qayta yarating.</p>}
      {pending.length > 0 && <p className="muted small">AI rasmlarni tasdiqlang yoki rad eting: ular storyboardga qo'yiladi.</p>}
      <ApproveCost projectId={id} pending={pending} unknown={unknown} onChanged={() => void load()} />

      {board && (
        <ol className="board-grid">
          {board.scenes.map((s, i) => (
            <li key={s.sceneId} className={s.deleted ? 'board-cell is-deleted' : 'board-cell'}>
              {s.deleted ? (
                <div className="board-gone">{editing.has(s.sceneId) ? 'Qayta yaratilmoqda…' : "O'chirildi"}</div>
              ) : (
                <img src={stillUrl(id, s.file, board.updatedAt)} alt={`${i + 1}-sahna: ${s.script}`} loading="lazy" />
              )}
              <p className="scene-script">
                <b>{i + 1}.</b> {s.script}
              </p>
              {!executed && (
                <>
                  <textarea
                    aria-label={`${i + 1}-sahnaga izoh`}
                    placeholder="Nimani o'zgartiramiz?"
                    value={notes[s.sceneId] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [s.sceneId]: e.target.value }))}
                  />
                  <div className="board-cell-actions">
                    {s.deleted ? (
                      <button
                        type="button"
                        className="btn btn--dark btn--sm"
                        disabled={busy !== null || editing.has(s.sceneId)}
                        onClick={() => void regenerate(s.sceneId)}
                      >
                        {editing.has(s.sceneId) ? 'Yaratilmoqda…' : 'Qayta yaratish'}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={!notes[s.sceneId]?.trim() || busy !== null || editing.has(s.sceneId)}
                          onClick={() => void comment(s.sceneId)}
                        >
                          {editing.has(s.sceneId) ? "O'zgartirilmoqda…" : 'Yuborish'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy !== null || editing.has(s.sceneId)}
                          onClick={() => void removeStill(s.sceneId, s.file)}
                        >
                          O'chirish
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
