// The preview: the project's built HyperFrames page in <hyperframes-player>. A rebuilt page reloads it at the same
// moment, still playing if it was; page events close together make one reload, and none happens mid-drag.
import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import '@hyperframes/player';

type HfPlayer = HTMLElement & {currentTime: number; duration: number; paused: boolean; seek(t: number): void; play(): void; pause(): void};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hyperframes-player': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {src?: string; controls?: boolean};
    }
  }
}

export type PlayerHandle = {seek(t: number): void};

const SETTLE_MS = 300; // page events closer than this make one reload

type Props = {project: string; page: number; onTime(t: number): void};

export const Player = forwardRef<PlayerHandle, Props>(({project, page, onTime}, ref) => {
  const el = useRef<HfPlayer>(null);
  const loaded = useRef<string | null>(null); // the src the player has, so the same one is never set twice

  useImperativeHandle(ref, () => ({seek: (t) => el.current?.seek(t)}), []);

  useEffect(() => {
    const p = el.current;
    if (!p) return;
    const tick = () => onTime(p.currentTime || 0);
    p.addEventListener('timeupdate', tick);
    return () => p.removeEventListener('timeupdate', tick);
  }, [onTime]);

  useEffect(() => {
    const p = el.current;
    if (!p) return;
    const src = `/p/${project}/index.html?v=${page}`;
    if (loaded.current === src) return;
    const first = loaded.current === null || !loaded.current.startsWith(`/p/${project}/`);
    const timer = window.setTimeout(() => {
      // come back to the same moment, and keep playing if it was (a new project starts at 0, paused)
      const t = first ? 0 : p.currentTime || 0;
      const playing = !first && !p.paused;
      const back = () => {
        if (t) p.seek(t);
        if (playing) p.play();
      };
      p.addEventListener('ready', back, {once: true});
      loaded.current = src;
      p.setAttribute('src', src);
    }, first ? 0 : SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [project, page]);

  return <hyperframes-player ref={el} controls className="player" />;
});
