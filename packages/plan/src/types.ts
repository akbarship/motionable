// The edit plan, style and component manifest formats (docs/edit-plan.md, styles.md, components.md).

export type Anchor = string; // word:N | word:N.end | t:S | cut:N | shot:ID[.end] | out:S | end, plus an optional ±offset
export type Duration = number | string; // seconds, or "26f" for frames
export type AssetRef = string; // asset:<id>[@version]
export type ComponentRef = string; // name@version
export type Props = Record<string, unknown>;

export type Canvas = {w: number; h: number; fps: number};

// ---------- tokens ----------
export type Gradient = {angle: number; stops: [string, number][]};
export type TextStyleToken = {
  font: string;
  weight: number;
  size: number;
  tracking?: number;
  caps?: boolean;
  italic?: boolean;
  keep?: boolean;
  fill?: string; // a color, or a $color / $gradient reference
  shadow?: string; // a $shadow reference
};
export type Grade = {contrast?: number; saturation?: number; brightness?: number};
export type Shadow = {x?: number; y: number; blur: number; color: string; opacity: number};
export type Framing = {zoom: [number, number]; face: [number, number]};

export type Tokens = {
  color?: Record<string, string>;
  gradient?: Record<string, Gradient>;
  type?: Record<string, TextStyleToken>;
  framing?: Record<string, Framing>;
  captionZone?: Record<string, number>;
  safe?: {face?: number}; // the only safe area: px kept clear around the face (captions never cover it), default 40
  grade?: Record<string, Grade>;
  shadow?: Record<string, Shadow>;
  timing?: {anchorLead?: number; captionLead?: Duration; minHold?: number};
};

// ---------- the edit plan ----------
export type Segment = {id: number; in: number; out: number; join?: {crossfade?: number}};
export type Range = {
  from: Anchor;
  to: Anchor;
  kind: 'retake' | 'filler' | 'other';
  by?: string;
  evidence?: string[];
  why?: string;
  cut?: [number, number][]; // removed ranges only: the source spans actually taken out, so a restore is exact
};

export type Instance = {component: ComponentRef; props?: Props};

/** track: follow the face; fixed: one still crop around `center`; off: the whole frame, no crop. */
export type CameraMode = 'track' | 'fixed' | 'off';

export type Shot = {
  id: string;
  from: Anchor;
  kind: 'speaker' | 'broll' | 'motion';
  level?: string;
  zoom?: [number, number];
  face?: [number, number];
  camera?: CameraMode; // overrides the plan's camera mode for this shot
  intro?: {zoom: number; dur: Duration};
  hook?: boolean;
  clip?: AssetRef;
  clipIn?: number;
  crop?: {zoom: number; origin: [number, number]};
  grade?: string;
  captionZone?: number;
  captions?: Instance;
  scene?: Instance; // motion shots: the full-screen motion scene drawn instead of the footage
  why?: string;
};

export type CaptionLine = {
  id: string;
  words: number[];
  role: string;
  style?: Partial<TextStyleToken>; // overrides the role's text style for this line only
  component?: ComponentRef; // this line's caption component, most specific first (line > shot > video)
  props?: Props; // props for this line's own component
  hidden?: boolean;
};

export type Overlay = {
  id: string;
  component: ComponentRef;
  from: Anchor;
  to: Anchor;
  attach?: 'screen' | 'scene';
  depth?: 'front' | 'behind-subject';
  props?: Props;
  why?: string;
};

/** A note on the edit: the user's (Studio, at a moment of the video) or anyone's. Claude closes it with a reply. */
export type Note = {id: string; text: string; status: 'open' | 'done'; at?: Anchor; to?: Anchor; by?: string; reply?: string};

export type Transition = {id: string; shot: string; component: ComponentRef; props?: Props; why?: string};
export type Sfx = {id: string; sound: AssetRef; at: Anchor; gain?: number; why?: string};

export type EditPlan = {
  schema: 'motionable.edit-plan/1';
  job: string;
  version: number;
  style: string;
  reference: null | {asset: AssetRef; study: AssetRef};
  canvas: Canvas;
  language: string;
  inputs: {source: AssetRef; proxy?: AssetRef; track?: AssetRef; matte?: AssetRef; broll?: AssetRef[]};
  transcript: {asset: AssetRef; edits: Record<string, string>};
  timeline: {segments: Segment[]; removed: Range[]; suggested: Range[]; why?: string};
  tokens: Tokens;
  shots: Shot[];
  captions: {component: ComponentRef; props?: Props; lines: CaptionLine[]; why?: string};
  overlays: Overlay[];
  transitions: Transition[];
  sfx: Sfx[];
  audio: {
    loudness?: number;
    /** a music bed under the voice: gain in dB (default −18), from an anchor (default the start), its own fades in s */
    music?: {asset: AssetRef; gain?: number; from?: Anchor; fadeIn?: number; fadeOut?: number};
    fadeOut?: number; // s: the whole video's sound fades out over its last seconds
    why?: string;
  };
  notes: (Note | string)[]; // plain strings are notes from before they had ids (read as done)
  /** Default: track when the plan has a face track, else fixed. center: source point (0–1) a fixed crop is centred on. */
  camera?: {mode: CameraMode; center?: [number, number]; why?: string};
};

// ---------- styles ----------
export type Trigger = {
  id: string;
  when: string;
  do: Record<string, string>;
  max?: {per?: number; unit?: 's'; perVideo?: number};
  minGapS?: number;
  countsAs?: string;
};

export type StyleRules = {
  timeline: {
    trimPausesOver: number;
    trimTo: number;
    naturalPause?: {afterSentence: number; afterComma: number};
    tail?: number;
    crossfade?: number;
    retakes: 'auto-when-sure' | 'suggest' | 'off';
    filler: 'suggest' | 'off';
  };
  framing: {
    levels: string[];
    changeOn?: 'sentence';
    hideTrimsWithLevelChange?: boolean;
    maxPerVideo?: Record<string, number>;
    maxSourceUpscale?: number;
    noJumpCutInSentence?: boolean;
  };
  shots: {targetS: [number, number]; maxS: number};
  hook?: {spanS: [number, number]; opening?: {level: string; intro?: {zoom: number; dur: Duration}}; structure?: string};
  captions: {wordsPerLine: [number, number]; maxLines: number; lowConfidence: number};
  broll?: {
    shareOfRuntime?: [number, number];
    clipS?: [number, number];
    source?: string;
    gradeToFootage?: boolean;
    captionShade?: boolean;
    cropLogos?: boolean;
  };
  motion?: {shareOfRuntime?: [number, number]; sceneS?: [number, number]; maxPerVideo?: number};
  sound?: {music: string; loudness: number};
  ending?: {ctaLastS?: number; level?: string};
};

export type Style = {
  schema: 'motionable.style/1';
  name: string;
  version: number;
  title: Record<string, string>;
  description: string;
  tags: string[];
  fits: {footage: string[]; framing: string[]; lengthS: [number, number]; speakers: number};
  canvas: Canvas;
  madeFrom: {kind: 'manual' | 'reference' | 'job'; [k: string]: unknown};
  author: {kind: 'us' | 'coder'; [k: string]: unknown};
  owner: string | null;
  status: Status;
  tokens: Tokens;
  rules: StyleRules;
  triggers: Trigger[];
  components: Record<string, Instance | ComponentRef[]>;
  never: {id: string; text: string; check?: string}[];
  refs?: string[]; // reference ids this version was learned from
  sources?: Record<string, string>; // dotted path → ref:<id>@<s> | lesson:<id> | guess
};

// ---------- components ----------
export type Status = 'draft' | 'private' | 'public' | 'deprecated' | 'blocked';
export type Kind = 'caption' | 'overlay' | 'transition' | 'scene';

export type PropSpec = {
  type:
    | 'number' | 'integer' | 'boolean' | 'enum' | 'text' | 'color' | 'gradient' | 'textStyle'
    | 'font' | 'anchor' | 'duration' | 'asset' | 'array' | 'object';
  default?: unknown;
  label?: Record<string, string>;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: {value: string; label?: Record<string, string>}[];
  maxLength?: number;
  multiline?: boolean;
  items?: PropSpec;
  maxItems?: number;
  fields?: Record<string, PropSpec>;
  accept?: string[];
  editor?: boolean;
};

export type ComponentManifest = {
  name: string;
  version: number;
  kind: Kind;
  title: Record<string, string>;
  description: string;
  tags: string[];
  props: Record<string, PropSpec>;
  needs: ('face' | 'matte')[];
  fullFrame?: boolean;
  frames?: {before: number; after: number};
  madeFrom: {kind: 'reference' | 'request' | 'manual'; [k: string]: unknown};
  author: {kind: 'us' | 'coder'; [k: string]: unknown};
  owner: string | null;
  status: Status;
  compatibleWith: number | null;
  gate?: unknown;
  bundle?: string;
  ae: {mode: 'layers' | 'native'};
};

// ---------- analysis inputs ----------
export type Word = {i: number; text: string; start: number; end: number; conf?: number};
export type Transcript = {provider?: string; language?: string; words: Word[]};
export type TrackSample = {t: number; cx: number; cy: number; w: number; h: number; found: boolean};
export type Track = {fps: number; w: number; h: number; samples: TrackSample[]};

/** A job's stored files (phase 0: jobs/<id>/job.json). */
export type AssetEntry = {path: string; kind: string; version?: number; meta?: Record<string, unknown>};
export type JobManifest = {
  id: string;
  kind?: 'job' | 'reference';
  title?: string;
  createdAt?: string;
  note?: string; // a sidecar note, e.g. which effect a reference shows
  brief?: Brief;
  assets: Record<string, AssetEntry>;
};
/** What the user said the video is, from the Studio's new-video wizard: Claude's proposal is built on it. */
export type Brief = {
  about: string;
  script?: string;
  mode: 'edit' | 'voiceover'; // edit = talking-head footage; voiceover = a voice track, the picture is all motion/b-roll
  style?: string; // name@version, or a style name still being built from references
};

// ---------- operations ----------
export type Op = {op: string; [k: string]: unknown};
export type Batch = {
  base: number;
  by: {kind: 'director' | 'editor' | 'qa' | 'mcp' | 'system'; [k: string]: unknown};
  why?: string;
  ops: Op[];
};
