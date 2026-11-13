import { z } from 'zod';

export const KindSchema = z.enum(['image', 'video', 'tts', 'stt']);
export type Kind = z.infer<typeof KindSchema>;

export const TaskTypeSchema = z.enum(['study_ref', 'direct', 'storyboard', 'storyboard_edit', 'execute', 'edit', 'render', 'generate']);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskStatusSchema = z.enum(['queued', 'awaiting_approval', 'running', 'done', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #rrggbb');

/** The user's answers to the post-study questions. The director and executor treat them as hard rules. */
export const StyleAnswersSchema = z.object({
  /** 'reference' = the style palette as studied; else the user's own colours. */
  palette: z.union([z.literal('reference'), z.array(hex).min(1).max(6)]),
  font: z.string().min(1).max(80),
  /** 'exact' = rebuild the reference background as measured; 'simple' = a calmer version in the same colours. */
  background: z.enum(['exact', 'simple']),
  accent: hex,
});
export type StyleAnswers = z.infer<typeof StyleAnswersSchema>;

/** One Claude Code chat: a random id made by its MCP server at start. */
export const SessionIdSchema = z.string().regex(/^[a-f0-9]{16}$/);

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  brief: z.string(),
  status: z.string(),
  styleIds: z.array(z.string()),
  createdAt: z.string(),
  styleAnswers: StyleAnswersSchema.optional(),
  /** Claude Code chat (MCP process) that works this project's queue; the last chat to open it wins. */
  session: SessionIdSchema.optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** One measured animation: what moves, when, how long, which ease, from/to values and the exact CSS. */
export const RecipeSchema = z.object({
  name: z.string().min(1),
  element: z.string().min(1),
  trigger: z.string().min(1),
  duration: z.number().positive(),
  ease: z.string().min(1),
  from: z.record(z.string(), z.union([z.string(), z.number()])),
  to: z.record(z.string(), z.union([z.string(), z.number()])),
  stagger: z.number().min(0).optional(),
  blur: z.string().optional(),
  css: z.string().optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const BackgroundSchema = z.object({
  kind: z.string().min(1),
  css: z.string().optional(),
  stops: z.array(z.string()).max(8).optional(),
  blobs: z
    .array(
      z.object({
        colour: z.string(),
        x: z.number(),
        y: z.number(),
        r: z.number().positive(),
        blur: z.number().min(0),
        drift: z.string().optional(),
      }),
    )
    .max(8)
    .optional(),
  notes: z.string().optional(),
});

export const MaterialSchema = z.object({
  name: z.string().min(1),
  blur: z.number().min(0).optional(),
  border: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  radius: z.number().min(0).optional(),
  css: z.string().optional(),
});

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
  /** Measured animations, implemented verbatim by the executor. */
  recipes: z.array(RecipeSchema).max(16).optional(),
  background: BackgroundSchema.optional(),
  materials: z.array(MaterialSchema).max(6).optional(),
  type: z
    .object({
      families: z.array(z.string().min(1)).min(1).max(4),
      sizes: z.array(z.object({ role: z.string().min(1), px: z.number().positive() })).max(8),
    })
    .optional(),
  /** Scene grammars seen in the reference (icon carousel, stat card, chat bubbles...). */
  grammars: z.array(z.string().min(1)).max(16).optional(),
  assetsNeeded: z
    .array(z.object({ what: z.string().min(1), how: z.enum(['logo', 'gen', 'ui', 'footage', 'type']), note: z.string().optional() }))
    .max(16)
    .optional(),
});
export type Style = z.infer<typeof StyleSchema>;

/** `logo` = a real brand mark (media-use resolve), `ui` = a faithful HTML rebuild of a real product screen. */
export const AssetSourceSchema = z.enum(['footage', 'broll', 'registry', 'gen', 'logo', 'ui', 'type']);

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
  /** Scene grammar from the style's `grammars` (icon carousel, stat card, chat bubbles...). */
  grammar: z.string().min(1).optional(),
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
/** Distinct grammars a video needs (fewer scenes: one per scene). */
export const MIN_GRAMMARS = 4;
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
    const withGrammar = p.scenes.filter((s) => s.grammar);
    if (withGrammar.length > 0) {
      p.scenes.forEach((s, i) => {
        if (!s.grammar) issue(['scenes', i, 'grammar'], 'every scene needs a grammar when one has it');
        else if (i > 0 && p.scenes[i - 1].grammar && sameLayout(s.grammar, p.scenes[i - 1].grammar!)) {
          issue(['scenes', i, 'grammar'], `same grammar as scene ${p.scenes[i - 1].id}; neighbours never share a grammar`);
        }
      });
      const distinct = new Set(withGrammar.map((s) => s.grammar!.trim().toLowerCase())).size;
      const need = Math.min(MIN_GRAMMARS, p.scenes.length);
      if (distinct < need) issue(['scenes'], `${distinct} distinct grammars; use at least ${need}`);
    }
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

/** `storyboard/board.json`: one still per plan scene, written by the executor's storyboard task. */
export const StoryboardSchema = z.object({
  scenes: z
    .array(
      z.object({
        sceneId: z.string().min(1),
        file: z.string().regex(/^[A-Za-z0-9._-]+\.(png|jpg|jpeg)$/, 'a plain .png/.jpg name inside storyboard/'),
        script: z.string(),
        at: z.number().min(0),
      }),
    )
    .min(1),
  updatedAt: z.string(),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

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
