import { useCallback, useEffect, useRef, useState } from 'react';
import { api, renderUrl, type ChatMsg, type RenderFile, type Task } from '../api';
import { formatSize } from '../ui/Dropzone';
import { Chat } from '../ui/Chat';

const active = (t: Task) => t.status === 'queued' || t.status === 'running';
const doneCount = (tasks: Task[], type: Task['type']) => tasks.filter((t) => t.type === type && t.status === 'done').length;

/** Editor: live HyperFrames preview, chat with Claude, render and finished renders. */
export function Editor({ id, tick }: { id: string; tick: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [renders, setRenders] = useState<RenderFile[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<'no_comp' | string | null>(null);
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

  const editsDone = doneCount(tasks, 'edit');
  const rendersDone = doneCount(tasks, 'render');

  // (Re)start the preview server on mount, and again after Claude finishes an edit or the comp first appears.
  const hasExecute = tasks.some((t) => t.type === 'execute' && t.status === 'done');
  useEffect(() => {
    let live = true;
    api
      .preview(id)
      .then((r) => {
        if (!live) return;
        setPreviewUrl(r.url);
        setPreviewError(null);
      })
      .catch((e: Error) => {
        if (live) setPreviewError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, hasExecute]);

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

  const render = async () => {
    setRendering(true);
    setError(null);
    try {
      await api.addTask(id, 'render');
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
          <button type="button" className="btn btn--dark" disabled={renderBusy || previewError === 'no_comp'} onClick={() => void render()}>
            {renderBusy ? 'Render qilinmoqda…' : 'Render qilish'}
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="player">
          {previewError === 'no_comp' ? (
            <div className="player-note">
              <p>Video hali tayyor emas — Pipeline'da rejani tasdiqlang</p>
              <a className="btn btn--ghost" href={`#/p/${id}`}>
                Pipeline'ga qaytish
              </a>
            </div>
          ) : previewError ? (
            <div className="player-note" role="alert">
              <p>Ko'rib chiqish ochilmadi: {previewError}</p>
            </div>
          ) : previewUrl ? (
            <iframe key={`${previewUrl}#${editsDone}`} title="Video ko'rinishi" src={previewUrl} sandbox="allow-scripts allow-same-origin" />
          ) : (
            <div className="player-note" aria-busy="true">
              <p className="muted">Ko'rib chiqish ishga tushmoqda…</p>
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
