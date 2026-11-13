// Studio API client. The session token comes from ?t= once and is kept in sessionStorage.

const KEY = 'motionable.token';
let token: string | null = null;
const SESSION_KEY = 'motionable.session';
let session: string | null = null;

export type TaskStatus = 'queued' | 'awaiting_approval' | 'running' | 'done' | 'failed';
export type TaskType = 'study_ref' | 'roughcut' | 'direct' | 'storyboard' | 'storyboard_edit' | 'execute' | 'edit' | 'render' | 'generate';
export type Kind = 'image' | 'video' | 'tts' | 'stt';
export type ProviderUse = 'off' | 'kie' | 'elevenlabs' | 'bot';

export interface StyleAnswers {
  palette: 'reference' | string[];
  font: string;
  background: 'exact' | 'simple';
  accent: string;
}

export interface Project {
  id: string;
  name: string;
  brief: string;
  status: string;
  styleIds: string[];
  createdAt: string;
  styleAnswers?: StyleAnswers;
}

export interface RefFile {
  name: string;
  size: number;
  taskId: string | null;
  status: 'added' | TaskStatus;
}

export interface Storyboard {
  scenes: { sceneId: string; file: string; script: string; at: number; deleted?: boolean }[];
  updatedAt: string;
}

export interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  input: Record<string, unknown>;
  progress: string[];
  output: unknown;
  error: string | null;
  createdAt: string;
  startedAt?: string;
  updatedAt?: string;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  files?: string[];
  at: string;
}

export interface RenderFile {
  name: string;
  size: number;
  mtime: string;
}

export interface ProjectView {
  project: Project;
  tasks: Task[];
  plan: unknown;
  planError?: 'invalid';
  chat: ChatMsg[];
  /** Last CLI calls agents made for this project: live proof of work. */
  activity?: { t: string; cmd: string }[];
}

export interface StyleSummary {
  id: string;
  framing: string;
  pace: { avgShotSeconds: number; cutsPerMin: number };
  palette: string[];
  fontFamily: string;
  transitions: string[];
  background?: string;
}

export interface Config {
  providers: Record<Kind, { use: ProviderUse; key?: string }>;
  botKey?: string;
  botUrl?: string;
  port: number;
}

/** Rules learnt from the user's feedback: `global` or one style id. */
export interface LessonGroup {
  scope: string;
  lines: string[];
}

export type ConfigPatch = Partial<Omit<Config, 'providers'>> & {
  providers?: Partial<Record<Kind, { use: ProviderUse; key?: string }>>;
};

/** Read `name` from the page URL once (then drop it from the address bar) or from sessionStorage. */
function urlOnce(name: string, storageKey: string): string {
  let v = '';
  try {
    const params = new URLSearchParams(location.search);
    v = params.get(name) ?? '';
    if (v) {
      // Keep it out of the address bar, history and screenshots.
      params.delete(name);
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    }
  } catch {
    // no location/history (non-browser) or replaceState refused
  }
  try {
    if (v) sessionStorage.setItem(storageKey, v);
    else v = sessionStorage.getItem(storageKey) ?? '';
  } catch {
    // storage blocked: keep the in-memory value only
  }
  return v;
}

/** Token from the page URL (first call) or sessionStorage; empty string if neither has one. */
export function getToken(): string {
  if (token === null) token = urlOnce('t', KEY);
  return token;
}

/** Chat id from studio_open (?s=): projects opened in this tab are worked by that chat's /motionable loop. */
export function getSession(): string {
  if (session === null) session = urlOnce('s', SESSION_KEY);
  return session;
}

/** Test hook: forget the cached token. */
export function resetTokenForTests(): void {
  token = null;
  session = null;
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-motionable-token': getToken() };
  if (getSession()) headers['x-motionable-session'] = getSession();
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(path, { method: init.method ?? 'GET', headers, body });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty or non-JSON body
  }
  if (!res.ok) {
    const msg = (data as { error?: unknown } | null)?.error;
    throw new Error(typeof msg === 'string' ? msg : `HTTP ${res.status}`);
  }
  return data as T;
}

const p = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const api = {
  listProjects: () => request<Project[]>('/api/projects'),
  createProject: (b: { name: string; brief: string }) => request<Project>('/api/projects', { method: 'POST', body: b }),
  getProject: (id: string) => request<ProjectView>(p(id)),
  addRef: (id: string, url: string) => request<{ ref: { name: string } }>(`${p(id)}/refs`, { method: 'POST', body: { url } }),
  addRefFile: (id: string, name: string) =>
    request<{ ref: { name: string } }>(`${p(id)}/refs/file`, { method: 'POST', body: { name } }),
  refs: (id: string) => request<RefFile[]>(`${p(id)}/refs`),
  deleteRef: (id: string, name: string) => request<{ ok: true }>(`${p(id)}/refs/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  startStudy: (id: string) => request<{ task: Task }>(`${p(id)}/refs/study`, { method: 'POST', body: {} }),
  putStyleAnswers: (id: string, a: StyleAnswers) => request<Project>(`${p(id)}/style-answers`, { method: 'PUT', body: a }),
  stopTask: (id: string, tid: string) => request<Task>(`${p(id)}/tasks/${tid}/stop`, { method: 'POST' }),
  retryTask: (id: string, tid: string) => request<Task>(`${p(id)}/tasks/${tid}/retry`, { method: 'POST' }),
  deleteStill: (id: string, file: string) => request<Storyboard>(`${p(id)}/storyboard/${encodeURIComponent(file)}`, { method: 'DELETE' }),
  deleteRender: (id: string, name: string) => request<{ deleted: string }>(`${p(id)}/renders/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  footage: (id: string) => request<FootageFile[]>(`${p(id)}/footage`),
  cut: (id: string) => request<Cut | null>(`${p(id)}/cut`),
  approveCut: (id: string) => request<Cut>(`${p(id)}/cut/approve`, { method: 'POST' }),
  player: (id: string) => request<{ url: string }>(`${p(id)}/player`),
  storyboard: (id: string) => request<Storyboard | null>(`${p(id)}/storyboard`),
  addTask: (id: string, type: TaskType, input: Record<string, unknown> = {}) =>
    request<Task>(`${p(id)}/tasks`, { method: 'POST', body: { type, input } }),
  quote: (id: string, items: { kind: Kind; params: Record<string, unknown> }[]) =>
    request<{ usd: number; missing: Kind[] }>(`${p(id)}/quote`, { method: 'POST', body: { items } }),
  approveTask: (id: string, tid: string) =>
    request<Task>(`${p(id)}/tasks/${encodeURIComponent(tid)}/approve`, { method: 'POST' }),
  declineTask: (id: string, tid: string) =>
    request<Task>(`${p(id)}/tasks/${encodeURIComponent(tid)}/decline`, { method: 'POST' }),
  renders: (id: string) => request<RenderFile[]>(`${p(id)}/renders`),
  sendChat: (id: string, text: string, files?: string[]) =>
    request<{ msg: ChatMsg; task: Task }>(`${p(id)}/chat`, { method: 'POST', body: { text, ...(files?.length ? { files } : {}) } }),
  styles: () => request<StyleSummary[]>('/api/styles'),
  prices: () => request<{ stt: { perMinute: number } }>('/api/prices'),
  getConfig: () => request<Config>('/api/config'),
  putConfig: (patch: ConfigPatch) => request<Config>('/api/config', { method: 'PUT', body: patch }),
  lessons: () => request<LessonGroup[]>('/api/lessons'),
  addLesson: (scope: string, text: string) => request<LessonGroup[]>('/api/lessons', { method: 'POST', body: { scope, text } }),
  deleteLesson: (scope: string, line: string) => request<LessonGroup[]>('/api/lessons', { method: 'DELETE', body: { scope, line } }),
  balance: () => request<Record<string, unknown>>('/api/bot/balance'),
  claude: () => request<{ connected: boolean }>('/api/claude'),
};

/** URL for a finished render usable in <video src> / <a href> (token in the query, since those cannot send headers). */
export interface FootageFile {
  name: string;
  size: number;
  kind: 'video' | 'audio';
}
export interface Cut {
  segments: { src: string; in: number; out: number; line?: string }[];
  dropped: { src: string; why: string }[];
  body?: string;
  duration?: number;
  approved: boolean;
}

/** The assembled rough-cut body (video or audio), cache-busted by `v`. */
export function bodyUrl(projectId: string, v: string | number): string {
  return `${p(projectId)}/body?t=${encodeURIComponent(getToken())}&v=${encodeURIComponent(String(v))}`;
}

export function renderUrl(projectId: string, name: string): string {
  return `${p(projectId)}/renders/${encodeURIComponent(name)}?t=${encodeURIComponent(getToken())}`;
}

/** URL for a storyboard still usable in <img src>. `v` busts the cache after a rebuild. */
export function stillUrl(projectId: string, file: string, v: string): string {
  return `${p(projectId)}/storyboard/${encodeURIComponent(file)}?t=${encodeURIComponent(getToken())}&v=${encodeURIComponent(v)}`;
}

/** Uploads one file with progress (0..1). Resolves with the stored name (the server may suffix it). */
export function upload(
  projectId: string,
  kind: 'broll' | 'refs',
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ name: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${p(projectId)}/upload?kind=${kind}`);
    xhr.setRequestHeader('x-motionable-token', getToken());
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: { name?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON reply
      }
      if (xhr.status >= 200 && xhr.status < 300 && typeof data.name === 'string') {
        onProgress?.(1);
        resolve({ name: data.name });
      } else reject(new Error(data.error ?? `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Tarmoq xatosi'));
    xhr.send(file);
  });
}
