import { useEffect, useState } from 'react';
import { api } from '../api';

const POLL_MS = 10_000;

/** Polls GET /api/claude every 10 s and shows whether a Claude Code session is pulling tasks. */
export function ClaudePill() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await api.claude();
        if (alive) setConnected(r.connected);
      } catch {
        if (alive) setConnected(false);
      }
    };
    void check();
    const t = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const on = connected === true;
  const text =
    connected === null
      ? 'Claude tekshirilmoqda…'
      : on
        ? 'Claude ulangan'
        : "Claude ulanmagan — Claude Code'da /motionable ni ishga tushiring";
  return (
    <span className={on ? 'pill pill--status is-on' : 'pill pill--status'} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <span className="pill-text" title={text}>{text}</span>
    </span>
  );
}
