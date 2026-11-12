import { useCallback, useEffect, useRef, useState } from 'react';
import { api, renderUrl, type ChatMsg, type RenderFile, type Task } from '../api';
import { formatSize } from '../ui/Dropzone';
import { Chat } from '../ui/Chat';

const active = (t: Task) => t.status === 'queued' || t.status === 'running';
const doneCount = (tasks: Task[], type: Task['type']) => tasks.filter((t) => t.type === type && t.status === 'done').length;

/** Editor: the latest rendered video (re-rendered after every change), chat with Claude, finished renders. */
export function Editor({ id, tick }: { id: string; tick: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [renders, setRenders] = useState<RenderFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const v = await api.getProject(id);
      if (seq !== loadSeq.current) return;
      setTasks(v.tasks);
      setChat(v.chat);
      setError(null);
    } catch (e) {
      if (seq === loadSeq.current) setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const rendersDone = doneCount(tasks, 'render');
  const hasExecute = tasks.some((t) => t.type === 'execute' && t.status === 'done');

  useEffect(() => {
    let live = true;
    api
      .renders(id)
      .then((r) => live && setRenders(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, rendersDone]);

  const working = [...tasks].reverse().find((t) => t.type === 'edit' && active(t)) ?? null;
  const renderBusy = rendering || tasks.some((t) => t.type === 'render' && active(t));
  // The video changes while an edit, generate or render is running: keep the old one with a badge.
  const updating = tasks.some((t) => (t.type === 'render' || t.type === 'edit' || t.type === 'generate') && active(t));
  const latest = renders[0] ?? null;

  const render = async () => {
    setRendering(true);
    setError(null);
    try {
      await api.addTask(id, 'render', { quality: 'delivery' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="editor">
      <section className="editor-main">
        <div className="editor-bar">
          <h1 className="h-screen">Tahrirlash</h1>
          <button type="button" className="btn btn--dark" disabled={renderBusy || !hasExecute} onClick={() => void render()}>
            {renderBusy ? 'Render qilinmoqda…' : 'Yakuniy render (yuqori sifat)'}
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="player">
          {latest ? (
            <>
              <video key={latest.name} controls playsInline preload="metadata" src={renderUrl(id, latest.name)} />
              {updating && <span className="player-badge">yangilanmoqda…</span>}
            </>
          ) : updating ? (
            <div className="player-note" aria-busy="true">
              <p className="muted">Video render qilinmoqda…</p>
            </div>
          ) : (
            <div className="player-note">
              <p>{hasExecute ? "Hali render yo'q. «Yakuniy render»ni bosing." : "Video hali tayyor emas — Jarayon'da storyboardni tasdiqlang"}</p>
              {!hasExecute && (
                <a className="btn btn--ghost" href={`#/p/${id}`}>
                  Jarayon'ga qaytish
                </a>
              )}
            </div>
          )}
        </div>

        <div className="renders">
          <h2 className="h-sub">Tayyor videolar</h2>
          {renders.length === 0 && <p className="muted small">Hali render qilingan video yo'q.</p>}
          <ul>
            {renders.map((r) => (
              <li key={r.name} className="render-item">
                <video controls preload="metadata" src={renderUrl(id, r.name)} />
                <div className="render-meta">
                  <span className="file-name" title={r.name}>{r.name}</span>
                  <span className="muted small">{formatSize(r.size)}</span>
                  <a className="btn btn--ghost btn--sm" href={renderUrl(id, r.name)} download={r.name}>
                    Yuklab olish
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <Chat projectId={id} chat={chat} tasks={tasks} working={working} onSent={() => void load()} />
    </div>
  );
}
