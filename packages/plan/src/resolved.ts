// The resolved plan: what every renderer reads (edit-plan.md §11). Frames, CSS and file paths only.
import type {CaptionLine, CaptionWord, Rect, ResolvedTokens} from './render-types';
import type {Kind, Props} from './types';

export type RShot = {
  id: string;
  kind: 'speaker' | 'broll' | 'motion';
  start: number;
  end: number;
  captionY: number;
  broll?: {src: string; trimBefore: number; zoom: number; origin: [number, number]; grade: string};
  /** motion shots: the scene component, its resolved props, and the words spoken in the shot (frames from its start) */
  scene?: {component: string; props: Props; words: CaptionWord[]};
};

export type RCaptionBlock = {
  id: string;
  shot: string;
  component: string;
  props: Props;
  start: number; // absolute: the block's Sequence starts here
  end: number; // absolute: the shot cut (hardEnd)
  until: number; // relative to start
  hardEnd: number; // relative to start
  y: number;
  lines: CaptionLine[]; // word times relative to start
  /** the zone's y when the face made the block move (y is then below or above the face); onFace: no room either side */
  moved?: {from: number; onFace?: boolean};
  needsFace: boolean;
};

export type ROverlay = {
  id: string;
  component: string;
  start: number;
  end: number;
  attach: 'screen' | 'scene';
  depth: 'front' | 'behind-subject';
  props: Props;
  needsFace: boolean;
};

export type RTransition = {id: string; component: string; cut: number; before: number; after: number; props: Props; needsFace: boolean};

export type ResolvedPlan = {
  job: string;
  version: number;
  canvas: {w: number; h: number; fps: number};
  totalFrames: number;
  source: {src: string; w: number; h: number};
  speakerGrade: string;
  /** Kept source spans as output Sequences. `trimBefore` is in composition frames, as Remotion's OffthreadVideo takes it. */
  segments: {id: number; start: number; len: number; trimBefore: number; srcIn: number}[];
  /** Per output frame: the camera as [scale, left, top] (source px), and the face box [cx, cy, w, h] (0–1 of source). */
  camera: [number, number, number][];
  face: [number, number, number, number][];
  /** Per output frame: 1 when the speaker's face is on screen, 0 in spans of the footage without a face. */
  faceSeen: number[];
  shots: RShot[];
  captionBlocks: RCaptionBlock[];
  overlays: ROverlay[];
  transitions: RTransition[];
  matte: null | {src: string; startS: number};
  sfx: {id: string; src: string; frame: number; gain: number; frames: number}[]; // gain in dB; frames: how long it plays
  /** the music bed (from frame `start` to the end, or its own length) and the video's closing fade, in seconds */
  audio: {music: null | {src: string; start: number; frames: number; gain: number; fadeIn: number; fadeOut: number}; fadeOut: number};
  brollCaptionShade: boolean;
  tokens: ResolvedTokens;
  kinds: Record<string, Kind>;
};
