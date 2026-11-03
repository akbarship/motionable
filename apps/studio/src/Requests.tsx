// The Studio's side of the bridge to Claude in chat: whether a Claude is here (the pill), and what the Studio asked of
// it on a project or a style (the request card: waiting, working, or its one-line reply). Live events keep both fresh.
import {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {api, type Presence, type RequestKind, type StudioRequest} from './api';
import {useT} from './i18n';

type Scope = {project?: string; style?: string};

/** Is a Claude waiting for the Studio, working on a request, or not connected. */
export const usePresence = () => {
  const [p, setP] = useState<Presence>({status: 'offline'});
  useEffect(() => {
    api.presence().then(setP, () => {});
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'claude') setP({status: ev.status, request: ev.request, lastSeen: ev.lastSeen});
    };
    return () => es.close();
  }, []);
  return p;
};

export const PresenceContext = createContext<Presence>({status: 'offline'});

/** The requests on one project or style, newest last, and a way to ask a new one. */
export const useRequests = ({project, style}: Scope, onError: (m: string) => void) => {
  const [list, setList] = useState<StudioRequest[]>([]);
  useEffect(() => {
    if (!project && !style) return setList([]);
    const q = project ? {project} : {style};
    api.requests(q).then(setList, () => setList([]));
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type !== 'request') return;
      const r = ev.request as StudioRequest;
      if ((project && r.project === project) || (style && r.style === style)) {
        setList((l) => (l.some((x) => x.id === r.id) ? l.map((x) => (x.id === r.id ? r : x)) : [...l, r]));
      }
    };
    return () => es.close();
  }, [project, style]);
  const ask = useCallback(async (kind: RequestKind, text?: string) => {
    try {
      const r = await api.ask({kind, ...(project ? {project} : {style}), text});
      setList((l) => (l.some((x) => x.id === r.id) ? l.map((x) => (x.id === r.id ? r : x)) : [...l, r]));
      return r;
    } catch (e) {
      onError((e as Error).message);
      return null;
    }
  }, [project, style, onError]);
  const cancel = useCallback((id: string) => api.cancelRequest(id).catch((e) => onError(e.message)), [onError]);
  return {list, last: list.filter((r) => r.status !== 'cancelled').at(-1) ?? null, ask, cancel};
};

export const ClaudePill = ({p}: {p: Presence}) => {
  const t = useT();
  return (
    <span className={`pill claude ${p.status}`} aria-live="polite" title={p.status === 'offline' ? t('claudeOfflineHint') : undefined}>
      <span className="dot" />{p.status === 'ready' ? t('claudeReady') : p.status === 'working' ? t('claudeWorking') : t('claudeOffline')}
    </span>
  );
};

/** One request as the Studio shows it: waiting (can be withdrawn), being done, or done with Claude's reply. */
export const RequestCard = ({r, onCancel}: {r: StudioRequest; onCancel(id: string): void}) => {
  const t = useT();
  const presence = useContext(PresenceContext);
  return (
    <div className={`run ${r.status}`} aria-live="polite">
      <b>{r.status === 'queued' ? t('reqQueued') : r.status === 'taken' ? t('claudeWorking') : t('claudeDone')}</b>
      {r.text && <p className="muted">{r.text}</p>}
      {r.reply && <p>Claude: {r.reply}</p>}
      {r.status === 'queued' && presence.status === 'offline' && <p className="hint">{t('claudeOfflineHint')}</p>}
      {r.status === 'queued' && <button className="link" onClick={() => onCancel(r.id)}>{t('cancel')}</button>}
    </div>
  );
};
