// A moment on the timeline (output seconds) as a plan anchor: the last kept word whose anchor is at or before it,
// plus the rest in frames (word:N+7f). Anchors on words follow the words through later cuts.
export type AnchorWord = {i: number; at: number | null};

export const timeToAnchor = (words: AnchorWord[], t: number, fps: number) => {
  const f = Math.round(t * fps);
  const kept = words.filter((w) => w.at !== null);
  if (!kept.length) return `out:${(f / fps).toFixed(3)}`;
  const before = kept.filter((w) => Math.round(w.at! * fps) <= f).at(-1) ?? kept[0];
  const off = f - Math.round(before.at! * fps);
  return off === 0 ? `word:${before.i}` : `word:${before.i}${off > 0 ? '+' : ''}${off}f`;
};

/** Output seconds snapped to a frame and clamped to the video. */
export const snap = (t: number, fps: number, duration: number) => Math.min(duration, Math.max(0, Math.round(t * fps) / fps));
