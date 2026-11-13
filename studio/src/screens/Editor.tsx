import { useCallback, useEffect, useRef, useState } from 'react';
import { api, renderUrl, type ChatMsg, type RenderFile, type Task } from '../api';
import { formatSize } from '../ui/Dropzone';
import { Chat } from '../ui/Chat';

const active = (t: Task) => t.status === 'queued' || t.status === 'running';
const doneCount = (tasks: Task[], type: Task['type']) => tasks.filter((t) => t.type === type && t.status === 'done').length;

/** Editor: the live HyperFrames player of the composition (reloaded after every change), chat with Claude, renders. */
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
  // Every finished build, edit or asset swap changes comp/: reload the player then.
  const compVersion = doneCount(tasks, 'execute') + doneCount(tasks, 'edit') + doneCount(tasks, 'generate');
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState(false);
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

  useEffect(() => {
    if (!hasExecute) return;
    let live = true;
    setPlayerError(false);
    api
      .player(id)
      .then((r) => live && setPlayerUrl(r.url))
      .catch(() => live && setPlayerError(true));
    return () => {
      live = false;
    };
  }, [id, hasExecute]);

  const working = [...tasks].reverse().find((t) => t.type === 'edit' && active(t)) ?? null;
  const renderBusy = rendering || tasks.some((t) => t.type === 'render' && active(t));
  // The composition changes while an edit or generate runs: keep showing it with a badge.
  const updating = tasks.some((t) => (t.type === 'edit' || t.type === 'generate' || t.type === 'execute') && active(t));
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
          {playerUrl && !playerError ? (
            <>
              <iframe key={compVersion} title="Video player" src={playerUrl} allow="autoplay; fullscreen" />
              {updating && <span className="player-badge">yangilanmoqda…</span>}
            </>
          ) : latest ? (
            <video key={latest.name} controls playsInline preload="metadata" src={renderUrl(id, latest.name)} />
          ) : (
            <div className="player-note" aria-busy={hasExecute && !playerError ? 'true' : undefined}>
              <p>
                {!hasExecute
                  ? "Video hali tayyor emas — Storyboard'ni tasdiqlang"
                  : playerError
                    ? "Player ochilmadi. «Yakuniy render»ni bosing."
                    : 'Player ochilmoqda…'}
              </p>
              {!hasExecute && (
                <a className="btn btn--ghost" href={`#/p/${id}/board`}>
                  Storyboard'ga o'tish
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
