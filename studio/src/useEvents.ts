import { useEffect, useRef } from 'react';
import { getToken } from './api';

/**
 * One EventSource per page; calls onProject(id) for each project change. EventSource reconnects by itself;
 * onOpen fires on every (re)connect so the caller can refetch what it missed while disconnected.
 */
export function useEvents(onProject: (id: string) => void, onOpen?: () => void): void {
  const cb = useRef(onProject);
  cb.current = onProject;
  const openCb = useRef(onOpen);
  openCb.current = onOpen;
  useEffect(() => {
    const es = new EventSource(`/api/events?t=${encodeURIComponent(getToken())}`);
    let first = true;
    es.onopen = () => {
      // The first open needs no refetch: screens load on mount.
      if (first) first = false;
      else openCb.current?.();
    };
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type?: string; id?: string };
        if (msg.type === 'project' && typeof msg.id === 'string') cb.current(msg.id);
      } catch {
        // ignore malformed events
      }
    };
    return () => es.close();
  }, []);
}
