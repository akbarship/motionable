// Hash router: #/new, #/p/:id/refs, #/p/:id, #/p/:id/board, #/p/:id/edit, #/settings.

export type Route =
  | { name: 'new' }
  | { name: 'refs'; id: string }
  | { name: 'pipeline'; id: string }
  | { name: 'board'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'settings' }
  | { name: 'home' };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h === '' || h === '/') return { name: 'home' };
  if (h === '/new') return { name: 'new' };
  if (h === '/settings') return { name: 'settings' };
  const m = /^\/p\/([a-z0-9-]+)(?:\/(refs|board|edit))?$/.exec(h);
  if (m) {
    if (m[2] === 'refs') return { name: 'refs', id: m[1] };
    if (m[2] === 'board') return { name: 'board', id: m[1] };
    if (m[2] === 'edit') return { name: 'edit', id: m[1] };
    return { name: 'pipeline', id: m[1] };
  }
  return { name: 'new' };
}

export function go(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
}
