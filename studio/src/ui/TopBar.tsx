import type { Project } from '../api';
import { go, type Route } from '../router';
import { ClaudePill } from './ClaudePill';

const STATUS: Record<string, string> = {
  new: 'Yangi',
  refs: "Namunalar o'rganilmoqda",
  directing: 'Reja tuzilmoqda',
  executing: "Yig'ilmoqda",
  ready: 'Tayyor',
  rendering: 'Render qilinmoqda',
  done: 'Tayyor',
  failed: 'Xato',
};

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const ICON = {
  plus: 'M12 5v14M5 12h14',
  settings:
    'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  chat: 'M5 5h14v10H9l-4 4V5z',
  upload: 'M12 16V5M7 10l5-5 5 5M5 19h14',
  check: 'M5 12.5l4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6L6 18',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
};

export { Icon };

export function TopBar({ route }: { route: Route }) {
  const onSettings = route.name === 'settings';
  return (
    <header className="topbar">
      <a className="skip" href="#main">Asosiy qismga o'tish</a>
      <div className="topbar-left">
        <a className="brand" href="#/" aria-label="Motionable, bosh sahifa">
          <span className="brand-mark" aria-hidden="true" />
          Motionable
        </a>
        <nav className="seg" aria-label="Bo'limlar">
          <a href="#/" aria-current={!onSettings && route.name !== 'new' ? 'page' : undefined}>
            Bosh sahifa
          </a>
          <a href="#/settings" aria-current={onSettings ? 'page' : undefined}>
            Sozlamalar
          </a>
        </nav>
      </div>
      <div className="topbar-right">
        <ClaudePill />
        <button type="button" className="btn btn--dark" onClick={() => go('#/new')}>
          <Icon d={ICON.plus} size={14} />
          Yangi video
        </button>
        <a className="icon-btn" href="#/settings" aria-label="Sozlamalar" title="Sozlamalar">
          <Icon d={ICON.settings} size={18} />
        </a>
      </div>
    </header>
  );
}

export function ProjectBar({ project, projects, route }: { project: Project | null; projects: Project[]; route: Route }) {
  const id = 'id' in route ? route.id : '';
  const status = project ? (STATUS[project.status] ?? project.status) : '';
  return (
    <div className="projectbar">
      <label className="sr-only" htmlFor="project-switch">Loyiha</label>
      <div className="select-wrap select-wrap--bare">
        <select
          id="project-switch"
          value={id}
          onChange={(e) => go(`#/p/${e.target.value}`)}
        >
          {!project && <option value={id}>{id}</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {status && (
        <span className={project && ['ready', 'done'].includes(project.status) ? 'chip chip--done' : 'chip'}>
          <span className="dot" aria-hidden="true" />
          {status}
        </span>
      )}
    </div>
  );
}

/** Reserved right column; the chat itself arrives with the editor. */
export function ChatPanel() {
  return (
    <aside className="chat" aria-label="Claude bilan suhbat">
      <div className="chat-head">
        <Icon d={ICON.chat} size={15} />
        <h2>Claude bilan suhbat</h2>
      </div>
      <div className="chat-empty">
        <p>Video yig'ilgach, shu yerda Claude'ga o'zgarishlarni yozasiz: kadrni almashtirish, matnni tuzatish, tempni o'zgartirish.</p>
      </div>
      <div className="chat-compose" aria-hidden="true">
        <span>Claude'ga yozing…</span>
      </div>
    </aside>
  );
}
