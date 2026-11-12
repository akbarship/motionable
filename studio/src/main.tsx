import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, getToken, type Project } from './api';
import { Onboarding } from './screens/Onboarding';
import { Pipeline } from './screens/Pipeline';
import { References } from './screens/References';
import { Settings } from './screens/Settings';
import { ChatPanel, ProjectBar, TopBar } from './ui/TopBar';
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

/** Placeholder for screens built in later tasks (pipeline, editor). */
function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="stage">
      <div className="canvas canvas--empty" aria-label="Video maydoni">
        <div className="canvas-note">
          <h1 className="h-screen">{title}</h1>
          <p className="muted">{text}</p>
        </div>
      </div>
    </section>
  );
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

  // No hash: open the newest project, or onboarding when there is none.
  useEffect(() => {
    if (route.name !== 'home' || projects === null) return;
    if (projects.length > 0) location.replace(`#/p/${projects[0].id}`);
    else location.replace('#/new');
  }, [route.name, projects]);

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
    case 'pipeline':
      body = <Pipeline key={route.id} id={route.id} tick={tick} />;
      break;
    case 'edit':
      body = <Placeholder title="Tahrirlash" text="Tahrir ekrani keyingi versiyada qo'shiladi." />;
      break;
    case 'settings':
      body = <Settings />;
      withChat = false;
      break;
  }

  return (
    <div className="app">
      <TopBar route={route} />
      {projectId && <ProjectBar project={project} projects={projects ?? []} route={route} />}
      <div className={withChat ? 'workspace' : 'workspace workspace--solo'}>
        <main id="main" className="main">
          {body}
        </main>
        {withChat && <ChatPanel />}
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
