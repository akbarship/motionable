import { useEffect, useRef } from 'react';
import { getToken } from './api';

/** One EventSource per page; calls onProject(id) for each project change. EventSource reconnects by itself. */
export function useEvents(onProject: (id: string) => void): void {
  const cb = useRef(onProject);
  cb.current = onProject;
  useEffect(() => {
    const es = new EventSource(`/api/events?t=${encodeURIComponent(getToken())}`);
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
