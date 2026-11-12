import { useEffect, useRef, useState } from 'react';
import { api, upload, type ChatMsg, type Task } from '../api';
import { Icon, ICON } from './TopBar';

const ACCEPT = 'video/*,audio/*,image/*,.mp4,.mov,.m4v,.webm,.mp3,.wav,.m4a,.png,.jpg,.jpeg,.webp';

/** Chat panel: each message becomes an edit task for Claude. */
export function Chat({
  projectId,
  chat,
  working,
  onSent,
}: {
  projectId: string;
  chat: ChatMsg[];
  working: Task | null;
  onSent: () => void;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.length, working?.progress.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.sendChat(projectId, t, files);
      setText('');
      setFiles([]);
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      const names: string[] = [];
      for (const f of Array.from(list)) names.push((await upload(projectId, 'broll', f)).name);
      setFiles((cur) => [...cur, ...names]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const last = working?.progress[working.progress.length - 1];

  return (
    <aside className="chat chat--live" aria-label="Claude bilan suhbat">
      <div className="chat-head">
        <Icon d={ICON.chat} size={15} />
        <h2>Claude bilan suhbat</h2>
      </div>
      <div className="chat-log" role="log" aria-live="polite">
        {chat.length === 0 && <p className="muted small">Hozircha xabar yo'q. Kadrni almashtirish, matnni tuzatish yoki tempni o'zgartirishni yozing.</p>}
        {chat.map((m) => (
          <div key={m.id} className={`msg msg--${m.role}`}>
            <p>{m.text}</p>
            {m.files && m.files.length > 0 && <p className="msg-files">{m.files.join(', ')}</p>}
          </div>
        ))}
        {working && (
          <div className="msg msg--assistant msg--working" role="status">
            <p>Claude ishlayapti…</p>
            {last && <p className="msg-files">{last}</p>}
          </div>
        )}
        <div ref={end} />
      </div>
      {error && (
        <p className="form-error chat-error" role="alert">
          {error}
        </p>
      )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {files.length > 0 && (
          <ul className="chat-attached" aria-label="Biriktirilgan fayllar">
            {files.map((f) => (
              <li key={f}>
                {f}
                <button type="button" className="icon-btn icon-btn--sm" aria-label={`${f} ni olib tashlash`} onClick={() => setFiles((c) => c.filter((x) => x !== f))}>
                  <Icon d={ICON.close} size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={text}
          rows={3}
          aria-label="Xabar"
          placeholder="Claude'ga yozing… (Enter: yuborish, Shift+Enter: yangi qator)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="chat-actions">
          <label className="icon-btn" title="Fayl biriktirish" aria-label="Fayl biriktirish">
            <input
              className="sr-only"
              type="file"
              multiple
              accept={ACCEPT}
              disabled={busy}
              onChange={(e) => {
                void attach(e.target.files);
                e.target.value = '';
              }}
            />
            <Icon d={ICON.upload} size={18} />
          </label>
          <button type="submit" className="btn btn--dark" disabled={busy || !text.trim()}>
            Yuborish
          </button>
        </div>
      </form>
    </aside>
  );
}
