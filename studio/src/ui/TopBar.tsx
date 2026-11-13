import type { Project } from '../api';
import { stageLinks } from '../pipeline';
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
  menu: 'M4 7h16M4 12h16M4 17h16',
  upload: 'M12 16V5M7 10l5-5 5 5M5 19h14',
  check: 'M5 12.5l4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6L6 18',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
};

export { Icon };

const TITLES: Partial<Record<Route['name'], string>> = { new: 'Yangi video', settings: 'Sozlamalar', home: 'Motionable' };

/** The one bar above the work area: menu (phone), project name, its stages and status. */
export function TopBar({ route, project, onMenu }: { route: Route; project: Project | null; onMenu: () => void }) {
  const id = 'id' in route ? route.id : '';
  const status = project ? (STATUS[project.status] ?? project.status) : '';
  return (
    <header className="topbar">
      <a className="skip" href="#main">Asosiy qismga o'tish</a>
      <div className="topbar-left">
        <button type="button" className="icon-btn menu-btn" aria-label="Loyihalar menyusi" onClick={onMenu}>
          <Icon d={ICON.menu} size={18} />
        </button>
        <h1 className="topbar-title">{id ? (project?.name ?? id) : (TITLES[route.name] ?? '')}</h1>
        {id && (
          <nav className="seg" aria-label="Bosqichlar">
            {stageLinks(id).map((l) => (
              <a key={l.key} href={l.href} aria-current={route.name === l.key ? 'page' : undefined}>
                {l.label}
              </a>
            ))}
          </nav>
        )}
      </div>
      {status && (
        <span className={project && ['ready', 'done'].includes(project.status) ? 'chip chip--done' : 'chip'}>
          <span className="dot" aria-hidden="true" />
          {status}
        </span>
      )}
    </header>
  );
}

/** Left column: brand, new video, every project (current one marked), settings and Claude status. */
export function Sidebar({ route, projects, open, onClose }: { route: Route; projects: Project[]; open: boolean; onClose: () => void }) {
  const id = 'id' in route ? route.id : '';
  return (
    <>
      <nav className={open ? 'sidebar is-open' : 'sidebar'} aria-label="Loyihalar">
        <a className="brand" href="#/new" aria-label="Motionable, yangi video" onClick={onClose}>
          <span className="brand-mark" aria-hidden="true" />
          Motionable
        </a>
        <button
          type="button"
          className="btn btn--dark sidebar-new"
          onClick={() => {
            onClose();
            go('#/new');
          }}
        >
          <Icon d={ICON.plus} size={14} />
          Yangi video
        </button>
        <p className="sidebar-label">Loyihalar</p>
        <ul className="sidebar-list">
          {projects.map((p) => (
            <li key={p.id}>
              <a href={`#/p/${p.id}`} aria-current={p.id === id ? 'page' : undefined} onClick={onClose}>
                <span className={['ready', 'done'].includes(p.status) ? 'dot dot--done' : 'dot'} aria-hidden="true" />
                <span className="sidebar-name">{p.name}</span>
              </a>
            </li>
          ))}
          {projects.length === 0 && <li className="muted small sidebar-empty">Hali loyiha yo'q</li>}
        </ul>
        <div className="sidebar-foot">
          <a href="#/settings" className="sidebar-link" aria-current={route.name === 'settings' ? 'page' : undefined} onClick={onClose}>
            <Icon d={ICON.settings} size={16} />
            Sozlamalar
          </a>
          <ClaudePill />
        </div>
      </nav>
      {open && <button type="button" className="sidebar-scrim" aria-label="Menyuni yopish" onClick={onClose} />}
    </>
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
