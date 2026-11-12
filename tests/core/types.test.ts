import { describe, expect, test } from 'vitest';
import { PlanSchema } from '../../src/core/types.js';

const base = {
  format: { w: 1080, h: 1920, fps: 30 },
  duration: 3,
  styleIds: [],
  captions: { on: false, style: '', source: 'none' },
  audio: { voice: 'none', music: null },
  genEstimate: { items: 0, usd: 0 },
};
function planWith(scene: Record<string, unknown>) {
  return {
    ...base,
    scenes: [{ id: 's1', start: 0, end: 3, purpose: 'hook', footage: null, components: [], gen: null, ...scene }],
  };
}

describe('PlanSchema', () => {
  test('rejects gen without fallback', () => {
    expect(PlanSchema.safeParse(planWith({ gen: { type: 'image', prompt: 'p' }, fallback: undefined })).success).toBe(false);
  });
  test('accepts gen with fallback', () => {
    expect(PlanSchema.safeParse(planWith({ gen: { type: 'image', prompt: 'p' }, fallback: 'typography' })).success).toBe(true);
  });
  test('accepts no gen and no fallback', () => {
    expect(PlanSchema.safeParse(planWith({})).success).toBe(true);
  });
});
