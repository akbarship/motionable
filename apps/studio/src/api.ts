// The daemon's HTTP API as the Studio uses it. Every edit is an ops batch, the same path Claude takes over MCP.
export type ViewWord = {i: number; text: string; start: number; end: number; conf: number | null; kept: boolean; out: number | null; at: number | null; line: string | null};
export type ViewRange = {k: number; from?: number; to?: number; kind: string; why?: string; evidence?: string[]; anchors: [string, string]};
export type ViewLine = {id: string; words: number[]; role: string; hidden: boolean; component: string | null; props: Record<string, unknown> | null};
export type Note = {id: string; text: string; status: 'open' | 'done'; at?: string; to?: string; by?: string; reply?: string; t?: number; tEnd?: number};
export type FileEntry = {id: string; kind: string; name: string; bytes: number; durationS?: number; w?: number; h?: number; thumb?: string};
export type Brief = {about: string; script?: string; mode: 'edit' | 'voiceover'; style?: string; language?: 'uz' | 'ru' | 'en' | 'auto'};
export type Proposal = {v: number; at: string; status: 'proposed' | 'approved' | 'revise'; feedback?: string; summary: string; style?: string;
  durationS: number; cutS: number; scenes: {from: number; to: number; title: string; what: string; why: string}[];
  cuts?: {from: number; to: number; why: string}[]; audio?: string; delivery?: string; pauses?: 'trim' | 'keep'; needs?: {what: string; when?: string}[]};
export type RequestKind = 'plan' | 'revise' | 'approve' | 'notes' | 'style';
export type StudioRequest = {id: string; kind: RequestKind; project?: string; style?: string; text?: string; at: string;
  status: 'queued' | 'taken' | 'done' | 'cancelled'; takenAt?: string; doneAt?: string; reply?: string};
export type Presence = {status: 'ready' | 'working' | 'offline'; request?: string; lastSeen?: string};
export type Lesson = {id: string; scope: string; text: string; rule?: {kind: string; [k: string]: unknown}; source?: string; seen?: number; last?: string; at: string};
export type Video = {project: string; file: string; kind: 'export' | 'draft' | 'looks' | 'delivery'; version: number; bytes: number; at: string; srt?: string};
export type ProjectState = {id: string; version: number; style: string | null; next?: string; durationS?: number; brief?: Brief;
  analysis?: {steps?: Record<string, string>; warnings?: string[]}};
export type StyleListItem = {name: string; versions: number[]; refs: number; components: string[]};
export type SettingsInfo = {keys: Record<string, string | null>; lang: 'uz' | 'en'; home: string; restart: boolean; version?: string};
export type Stage = 'setup' | 'proposal' | 'editing' | 'exported';
export type ProjectItem = {id: string; title: string; at: string | null; style: string | null; version: number; stage: Stage};
type TypeTok = {font: string; weight: number; size: number; caps?: boolean; fill?: string};
export type StyleDetail = {
  ref: string; brief: string;
  style: {title: Record<string, string>; description: string; sources?: Record<string, string>; never: {id: string; text: string}[];
    tokens?: {color?: Record<string, string>; type?: Record<string, TypeTok>; safe?: {face?: number}};
    rules?: {shots?: {targetS?: number[]}; captions?: {wordsPerLine?: number[]}; timeline?: {trimPausesOver?: number; trimTo?: number}; framing?: {levels?: string[]}}};
  refs: {id: string; source?: string; durationS: number; cuts: number; cutsPerMin: number; avgShotS: number; pacing: string; sheet: string | null}[];
  components: {ref: string; kind: string; title: Record<string, string>; description: string; status: string;
    gate: null | {pass: boolean; at: string; cases: number; errors: string[]}; sheet: string | null}[];
};
export type Span = {id: string; start: number; end: number; component?: string; kind?: string; level?: string | null};
export type View = {
  id: string; version: number; style: string; fps: number; durationS: number;
  words: ViewWord[]; removed: ViewRange[]; suggested: ViewRange[];
  captions: {component: string; props: Record<string, unknown>};
  lines: ViewLine[]; lanes: {shots: Span[]; overlays: Span[]; transitions: Span[]};
  roles: string[]; notes: Note[];
};
export type PropSpec = {type: string; default?: unknown; label?: Record<string, string>; min?: number; max?: number; step?: number;
  unit?: string; options?: {value: string; label?: Record<string, string>}[]; maxLength?: number};
export type ComponentInfo = {kind: string; title: Record<string, string>; props: Record<string, PropSpec>};
export type Op = {op: string; [k: string]: unknown};

const json = async <T>(r: Response): Promise<T> => {
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
};
const post = <T>(url: string, body?: unknown) =>
  fetch(url, {method: 'POST', headers: body ? {'content-type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined}).then((r) => json<T>(r));

export const api = {
  projects: () => fetch('/api/projects').then((r) => json<ProjectItem[]>(r)),
  view: (id: string) => fetch(`/api/projects/${id}/view`).then((r) => json<View>(r)),
  components: (style: string) => fetch(`/api/styles/${style}/components`).then((r) => json<Record<string, ComponentInfo>>(r)),
  ops: (id: string, base: number, why: string, ops: Op[]) =>
    post<{version: number; warnings: string[]}>(`/api/projects/${id}/ops`, {base, by: {kind: 'editor', tool: 'studio'}, why, ops}),
  undo: (id: string) => post<{version: number; restored: number}>(`/api/projects/${id}/undo`),
  build: (id: string) => post<{ok: boolean}>(`/api/projects/${id}/build`),
  render: (id: string, quality: 'draft' | 'export' = 'draft') => post<{status: string; out: string}>(`/api/projects/${id}/render`, {quality}),
  videos: () => fetch('/api/videos').then((r) => json<Video[]>(r)),
  style: (ref: string) => fetch(`/api/styles/${encodeURIComponent(ref)}`).then((r) => json<StyleDetail & {lessons: Lesson[]}>(r)),
  styleRefs: (name: string) => fetch(`/api/styles/${encodeURIComponent(name)}`).then((r) => json<{pending: string[]}>(r)).then((j) => j.pending ?? []),
  addReference: (name: string, file: File) => fetch(`/api/styles/${encodeURIComponent(name)}/refs/${encodeURIComponent(file.name)}`,
    {method: 'PUT', headers: {'content-type': 'application/octet-stream'}, body: file}).then((r) => json<{refs: unknown[]}>(r)),
  specimen: (project: string, style: string) => post<{image: string; mime: string}>('/api/look', {project, style, from: 0, to: 8}),
  settings: () => fetch('/api/settings').then((r) => json<SettingsInfo>(r)),
  saveSettings: (change: {keys?: Record<string, string | null>; lang?: string; home?: string}) => post<SettingsInfo>('/api/settings', change),
  state: (id: string) => fetch(`/api/projects/${id}/state`).then((r) => json<ProjectState>(r)),
  styles: () => fetch('/api/styles').then((r) => json<StyleListItem[]>(r)),
  /** One video into the inbox, with upload progress; the project is created from inbox paths afterwards. */
  inbox: (file: File, onProgress: (p: number) => void) => new Promise<string>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', `/api/inbox/${encodeURIComponent(file.name)}`);
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      const j = (() => { try { return JSON.parse(x.responseText); } catch { return {}; } })();
      if (x.status >= 200 && x.status < 300) resolve(j.path); else reject(new Error(j.error ?? `HTTP ${x.status}`));
    };
    x.onerror = () => reject(new Error('upload failed'));
    x.send(file);
  }),
  createProject: (files: string[], o: {title?: string; brief?: Brief; then?: {transcribe?: boolean; plan?: boolean}} = {}) =>
    post<{id: string}>('/api/projects', {files, ...o}),
  analyze: (id: string) => post<{ok: boolean}>(`/api/projects/${id}/analyze`),
  transcribe: (id: string) => post<{words: number; lowConfidence: number; warnings: string[]}>(`/api/projects/${id}/transcribe`, {}),
  scaffold: (id: string, style: string) => post<{version: number}>(`/api/projects/${id}/scaffold`, {style}),
  files: (id: string) => fetch(`/api/projects/${id}/files`).then((r) => json<FileEntry[]>(r)),
  removeFile: (id: string, key: string) => fetch(`/api/projects/${id}/files/${key}`, {method: 'DELETE'}).then((r) => json<{removed: string}>(r)),
  /** One file as a raw body, with upload progress (0–1); the daemon conforms videos after it arrives. */
  upload: (id: string, file: File, onProgress: (p: number) => void) => new Promise<FileEntry>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', `/api/projects/${id}/files/${encodeURIComponent(file.name)}`);
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      const j = (() => { try { return JSON.parse(x.responseText); } catch { return {}; } })();
      if (x.status >= 200 && x.status < 300) resolve(j); else reject(new Error(j.error ?? `HTTP ${x.status}`));
    };
    x.onerror = () => reject(new Error('upload failed'));
    x.send(file);
  }),
  lessons: (style: string) => fetch(`/api/lessons?style=${encodeURIComponent(style)}`).then((r) => json<Lesson[]>(r)),
  addLesson: (l: Omit<Lesson, 'id' | 'at'>) => post<Lesson>('/api/lessons', l),
  removeLesson: (id: string) => fetch(`/api/lessons/${id}`, {method: 'DELETE'}).then((r) => json<{removed: string}>(r)),
  proposals: (id: string) => fetch(`/api/projects/${id}/proposal`).then((r) => json<Proposal[]>(r)),
  // the bridge to Claude in chat: is it here, what was asked, ask it something
  presence: () => fetch('/api/claude').then((r) => json<Presence>(r)),
  requests: (q: {project?: string; style?: string}) =>
    fetch(`/api/requests?${new URLSearchParams(q as Record<string, string>)}`).then((r) => json<StudioRequest[]>(r)),
  ask: (req: {kind: RequestKind; project?: string; style?: string; text?: string}) => post<StudioRequest>('/api/requests', req),
  cancelRequest: (id: string) => fetch(`/api/requests/${id}`, {method: 'DELETE'}).then((r) => json<StudioRequest>(r)),
  restart: () => post<{ok: boolean}>('/api/restart'),
};

export const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
