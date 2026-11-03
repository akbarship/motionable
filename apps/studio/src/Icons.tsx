// The Studio's icons: one set, drawn on a 24 grid with a 1.75 stroke, so every control speaks the same visual language
// (no emoji or text glyphs standing in for icons). Decorative by default: the button around them carries the label.
import type {ReactNode} from 'react';

type P = {size?: number};
const svg = (d: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {d}
  </svg>
);

export const Sliders = ({size}: P) => svg(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>, size);
export const Undo = ({size}: P) => svg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>, size);
export const More = ({size}: P) => svg(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>, size);
export const ThumbDown = ({size}: P) => svg(<><path d="M17 14V3" /><path d="M9 18.5 10 14H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 3H17v11l-4 7a2.2 2.2 0 0 1-4-1.5Z" /></>, size);
export const Close = ({size}: P) => svg(<><path d="M18 6 6 18M6 6l12 12" /></>, size);
export const Copy = ({size}: P) => svg(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>, size);
export const Check = ({size}: P) => svg(<path d="M20 6 9 17l-5-5" />, size);
export const Plus = ({size}: P) => svg(<path d="M12 5v14M5 12h14" />, size);
export const Download = ({size}: P) => svg(<><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>, size);
export const Alert = ({size}: P) => svg(<><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>, size);
export const Terminal = ({size}: P) => svg(<><path d="m5 8 4 4-4 4M12 16h7" /><rect x="2" y="3" width="20" height="18" rx="3" /></>, size);
export const Up = ({size}: P) => svg(<path d="m6 15 6-6 6 6" />, size);
export const Down = ({size}: P) => svg(<path d="m6 9 6 6 6-6" />, size);
