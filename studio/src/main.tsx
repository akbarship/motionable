import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, getToken, type Project } from './api';
import { Editor } from './screens/Editor';
import { Footage } from './screens/Footage';
import { Onboarding } from './screens/Onboarding';
import { Pipeline } from './screens/Pipeline';
import { References } from './screens/References';
import { Settings } from './screens/Settings';
import { Storyboard } from './screens/Storyboard';
import { ChatPanel, Sidebar, TopBar } from './ui/TopBar';
import { parseRoute, type Route } from './router';
import { useEvents } from './useEvents';
import './styles.css';

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

function App() {
  const route = useRoute();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const projectId = 'id' in route ? route.id : null;

  const loadProjects = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setLoadError(null);
      return list;
    } catch (e) {
      setLoadError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects, projectId]);

  // No hash: a fresh start is a new video; old projects are one click away in the sidebar.
  useEffect(() => {
    if (route.name === 'home') location.replace('#/new');
  }, [route.name]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEvents(
    (id) => {
      if (id === projectId) setTick((t) => t + 1);
    },
    // (Re)connected: events may have been missed while down, so refetch.
    () => {
      setTick((t) => t + 1);
      void loadProjects();
    },
  );

  const project = projects?.find((p) => p.id === projectId) ?? null;

  if (!getToken()) {
    return (
      <div className="app">
        <main className="fatal" role="alert">
          <h1 className="h-screen">Kirish kaliti topilmadi</h1>
          <p className="muted">Studio'ni Claude Code'dagi /motionable buyrug'i bergan havola orqali oching.</p>
        </main>
      </div>
    );
  }

  let body;
  let withChat = true;
  switch (route.name) {
    case 'home':
      body = loadError ? (
        <main className="fatal" role="alert">
          <p>{loadError}</p>
        </main>
      ) : (
        <div className="loading" aria-busy="true">Yuklanmoqda…</div>
      );
      withChat = false;
      break;
    case 'new':
      body = <Onboarding onCreated={(p) => setProjects((cur) => [p, ...(cur ?? [])])} />;
      break;
    case 'refs':
      body = <References key={route.id} id={route.id} tick={tick} />;
      break;
    case 'footage':
      body = <Footage key={route.id} id={route.id} tick={tick} />;
      withChat = false;
      break;
    case 'pipeline':
      body = <Pipeline key={route.id} id={route.id} tick={tick} />;
      break;
    case 'board':
      body = <Storyboard key={route.id} id={route.id} tick={tick} />;
      withChat = false;
      break;
    case 'edit':
      body = <Editor key={route.id} id={route.id} tick={tick} />;
      withChat = false;
      break;
    case 'settings':
      body = <Settings />;
      withChat = false;
      break;
  }

  return (
    <div className="app">
      <Sidebar route={route} projects={projects ?? []} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="shell">
        <TopBar route={route} project={project} onMenu={() => setMenuOpen((o) => !o)} />
        <div className={withChat ? 'workspace' : 'workspace workspace--solo'}>
          <main id="main" className="main">
            {body}
          </main>
          {withChat && <ChatPanel />}
        </div>
      </div>
    </div>
  );
}

getToken(); // read ?t= and strip it from the address bar before anything else runs

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
