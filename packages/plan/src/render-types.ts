// What a renderer gets from the resolver. Plain types: no React, no HyperFrames.
export type Rect = {x: number; y: number; w: number; h: number};
/** A face box: center and size. */
export type Box = {cx: number; cy: number; w: number; h: number};
export type Fill = {kind: 'color'; color: string} | {kind: 'gradient'; css: string};

/** A resolved text style: tokens.type[role] merged with the line's own props. */
export type TextStyle = {
  font: string;
  weight: number;
  size: number;
  tracking: number;
  caps: boolean;
  italic: boolean;
  keep: boolean; // emphasis: this text never recedes
  fill: Fill;
  shadow?: string; // CSS shadow
};

export type ResolvedTokens = {
  color: Record<string, string>;
  gradient: Record<string, string>; // CSS linear-gradient(...)
  type: Record<string, TextStyle>;
  shadow: Record<string, string>;
  timing: {anchorLead: number; captionLead: number; minHold: number}; // anchorLead in seconds; the others in frames
};

export type CaptionWord = {id: number; text: string; start: number; end: number}; // frames from the block start
export type CaptionLine = {id: string; role: string; style: TextStyle; words: CaptionWord[]};
