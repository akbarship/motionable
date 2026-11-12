import { z } from 'zod';

export const KindSchema = z.enum(['image', 'video', 'tts', 'stt']);
export type Kind = z.infer<typeof KindSchema>;

export const TaskTypeSchema = z.enum(['study_ref', 'direct', 'execute', 'edit', 'render', 'generate']);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskStatusSchema = z.enum(['queued', 'awaiting_approval', 'running', 'done', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  brief: z.string(),
  status: z.string(),
  styleIds: z.array(z.string()),
  createdAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const StyleSchema = z.object({
  id: z.string().optional(),
  pace: z.object({ avgShotSeconds: z.number(), cutsPerMin: z.number() }),
  framing: z.string(),
  captions: z.object({
    fontFamily: z.string(),
    weight: z.union([z.string(), z.number()]),
    case: z.string(),
    position: z.string(),
    highlight: z.string(),
    wordsPerLine: z.number(),
  }),
  textCards: z.object({ when: z.string(), look: z.string() }),
  transitions: z.array(z.string()),
  colour: z.object({ palette: z.array(z.string()), grade: z.string() }),
  motion: z.array(z.object({ name: z.string(), timing: z.string() })),
  audio: z.object({ musicEnergy: z.string(), sfx: z.string() }),
  doNot: z.array(z.string()),
  sheets: z.array(z.string()),
  keyFrames: z.array(z.object({ file: z.string(), shows: z.string() })).max(6).optional(),
});
export type Style = z.infer<typeof StyleSchema>;

export const AssetSourceSchema = z.enum(['footage', 'broll', 'registry', 'gen', 'type']);

/** Project-relative path: no leading slash, no drive letter, no `..` segment. */
const relPath = z
  .string()
  .min(1)
  .refine((p) => !/^([/\\]|[A-Za-z]:)/.test(p) && !p.split(/[/\\]/).includes('..'), {
    message: 'must be a project-relative path (no leading slash, no "..")',
  });

/** One concrete thing the executor puts on screen. `gen` assets are paid and need a prompt and a free fallback. */
export const AssetSchema = z
  .object({
    id: z.string().min(1),
    source: AssetSourceSchema,
    what: z.string().min(1),
    kind: z.enum(['image', 'video']).optional(),
    seconds: z.number().positive().optional(),
    prompt: z.string().optional(),
    refFrames: z.array(relPath).optional(),
    fallback: z.string().optional(),
  })
  .superRefine((a, ctx) => {
    if (a.source !== 'gen') return;
    if (!a.prompt?.trim()) ctx.addIssue({ code: 'custom', path: ['prompt'], message: "source 'gen' needs a prompt" });
    if (!a.fallback?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['fallback'], message: "source 'gen' needs a fallback that works without paid calls" });
    }
  });
export type Asset = z.infer<typeof AssetSchema>;

const SceneSchema = z.object({
  id: z.string().min(1),
  start: z.number().min(0),
  end: z.number(),
  purpose: z.string(),
  script: z.string(),
  layout: z.string().min(1),
  motion: z.string().min(1),
  assets: z.array(AssetSchema).min(1, 'every scene needs at least one asset'),
  footage: z.object({ src: z.string(), in: z.number(), out: z.number() }).nullable(),
  components: z.array(
    z.object({
      kind: z.enum(['title', 'lower-third', 'caption', 'card', 'chart', 'overlay', 'transition']),
      description: z.string(),
      props: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
  fallback: z.string().optional(),
});

export const MIN_SCENE_S = 0.8;
export const MAX_WORDS_PER_S = 3;
const EPS = 0.01;

export const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const sameLayout = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

export const PlanSchema = z
  .object({
    format: z.object({ w: z.number(), h: z.number(), fps: z.number() }),
    duration: z.number().positive(),
    styleIds: z.array(z.string()),
    story: z.object({
      hook: z.string().min(1),
      idea: z.string().min(1),
      payoff: z.string().min(1),
      cta: z.string().min(1),
    }),
    beats: z.number().int().min(0),
    captions: z.object({ on: z.boolean(), style: z.string(), source: z.enum(['stt', 'script', 'none']) }),
    scenes: z.array(SceneSchema).min(1),
    audio: z.object({ voice: z.enum(['footage', 'none']), music: z.string().nullable() }),
    genEstimate: z.object({ items: z.number(), usd: z.number() }),
  })
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const ids = new Set<string>();
    p.scenes.forEach((s, i) => {
      const want = i === 0 ? 0 : p.scenes[i - 1].end;
      if (Math.abs(s.start - want) > EPS) {
        issue(['scenes', i, 'start'], `must be ${want} (scenes are contiguous from 0, no gaps or overlaps)`);
      }
      const len = s.end - s.start;
      if (len < MIN_SCENE_S - 1e-9) issue(['scenes', i, 'end'], `scene is ${+len.toFixed(2)} s; every scene needs >= ${MIN_SCENE_S} s`);
      const words = wordCount(s.script);
      if (len > 0 && words / len > MAX_WORDS_PER_S + 1e-9) {
        issue(['scenes', i, 'script'], `${words} words in ${+len.toFixed(2)} s is over ${MAX_WORDS_PER_S} words/s; cut words or lengthen the scene`);
      }
      if (i > 0 && sameLayout(s.layout, p.scenes[i - 1].layout)) {
        issue(['scenes', i, 'layout'], `same layout as scene ${p.scenes[i - 1].id}; vary the grammar between neighbours`);
      }
      s.assets.forEach((a, j) => {
        if (ids.has(a.id)) issue(['scenes', i, 'assets', j, 'id'], `asset id "${a.id}" is used twice; ids are unique in the plan`);
        ids.add(a.id);
      });
    });
    const last = p.scenes[p.scenes.length - 1];
    if (last && Math.abs(last.end - p.duration) > EPS) {
      issue(['duration'], `must equal the last scene end (${last.end})`);
    }
    if (p.beats > 0 && Math.abs(p.scenes.length - p.beats) > 1) {
      issue(['scenes'], `${p.scenes.length} scenes but beats is ${p.beats}; keep the count within +-1 of beats`);
    }
  });
export type Plan = z.infer<typeof PlanSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  type: TaskTypeSchema,
  status: TaskStatusSchema,
  input: z.record(z.string(), z.unknown()),
  progress: z.array(z.string()),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const ProviderUseSchema = z.enum(['off', 'kie', 'elevenlabs', 'bot']);
export const ProviderConfigSchema = z.object({ use: ProviderUseSchema, key: z.string().optional() });

export const ConfigSchema = z.object({
  providers: z.object({
    image: ProviderConfigSchema,
    video: ProviderConfigSchema,
    tts: ProviderConfigSchema,
    stt: ProviderConfigSchema,
  }),
  botKey: z.string().optional(),
  botUrl: z.string().optional(),
  port: z.number().int().default(4377),
});
export type Config = z.infer<typeof ConfigSchema>;

export const WordsSchema = z.array(z.object({ w: z.string(), start: z.number(), end: z.number() }));
export type Words = z.infer<typeof WordsSchema>;

export const ChatMsgSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  files: z.array(z.string()).optional(),
  at: z.string(),
});
export type ChatMsg = z.infer<typeof ChatMsgSchema>;
