// The starting global lessons: v1's rejections (v1/skill/brain/lessons) and the user's standing rules from memory,
// moved over by hand (docs/v2/plan.md). A mistakes list, not a design. Existing lessons are left as they are.
// Usage: npx tsx apps/daemon/scripts/seed-lessons.ts   (MOTIONABLE_STATE picks the state folder)
import type {Lesson} from '@motionable/plan';
import {loadLessons, saveLesson} from '@motionable/plan/store';

const SEED: (Omit<Lesson, 'at' | 'scope'> & {scope?: string})[] = [
  {id: 'key-min-hold', text: 'Katta (key) soʻz ekranda kamida 0.7 s tursin, darrov almashib ketmasin.',
    rule: {kind: 'min_hold', role: 'key', s: 0.7}, source: 'v1 2026-10-06-hero-min-hold'},
  {id: 'hero-min-hold', text: 'Hero soʻz ekranda kamida 0.7 s tursin, darrov almashib ketmasin.',
    rule: {kind: 'min_hold', role: 'hero', s: 0.7}, source: 'v1 2026-10-06-hero-min-hold'},
  {id: 'text-in-front', text: 'Matn speaker ortida emas, oldida tursin.', rule: {kind: 'no_behind_subject'}, source: 'memory'},
  {id: 'no-generic-overlays', text: 'Referenssiz, kalit soʻzga qarab qoʻyilgan generic karta va overlaylar kerak emas.',
    source: 'v1 2026-10-06-generic-overlays-rejected'},
  {id: 'broll-caption-contrast', text: 'B-roll ustidagi subtitr oʻqilsin: rang klipga yaqin yoki fon yorugʻ boʻlsa, joyini oʻzgartir yoki soya qoʻy.',
    source: 'v1 2026-10-06-captions-over-broll'},
  {id: 'captions-replace', text: 'Subtitr soʻzlari sakrab chiqsin, eski qator yangisi kelganda ketsin, ustma-ust yigʻilmasin.',
    source: 'v1 2026-10-06-caption-style-bounce'},
  {id: 'big-text-leaves', text: 'Katta matn oʻz gapi tugaganda ketsin, keyingi gapga osilib qolmasin.', source: 'memory'},
  {id: 'smooth-joins', text: 'Kesishlar silliq boʻlsin: jimlikda kes, tabiiy pauzalarni qoldir, uzuq-yuluq chiqmasin.',
    source: 'memory voiceover-cut-quality'},
  {id: 'not-every-scene-same', text: 'Har bir sahna bir xil grammatikada boʻlmasin; generic kit va soxta UI yoʻq.',
    source: 'memory ai-slop-editing-feedback'},
];

const have = new Set(loadLessons().map((l) => l.id));
for (const l of SEED) {
  if (have.has(l.id!)) continue;
  saveLesson({scope: 'global', ...l, seen: 0});
  console.log(`+ ${l.id}${l.rule ? ` (${l.rule.kind})` : ''}`);
}
console.log(`${loadLessons().length} lessons`);
