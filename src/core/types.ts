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
});
export type Style = z.infer<typeof StyleSchema>;

const SceneSchema = z
  .object({
    id: z.string(),
    start: z.number(),
    end: z.number(),
    purpose: z.string(),
    footage: z.object({ src: z.string(), in: z.number(), out: z.number() }).nullable(),
    components: z.array(
      z.object({
        kind: z.enum(['title', 'lower-third', 'caption', 'card', 'chart', 'overlay', 'transition']),
        description: z.string(),
        props: z.record(z.string(), z.unknown()).default({}),
      }),
    ),
    gen: z
      .object({ type: z.enum(['image', 'video']), prompt: z.string(), seconds: z.number().optional() })
      .nullable(),
    fallback: z.string().optional(),
  })
  .refine((s) => s.gen == null || (typeof s.fallback === 'string' && s.fallback.length > 0), {
    message: 'fallback is required when gen is set',
    path: ['fallback'],
  });

export const PlanSchema = z.object({
  format: z.object({ w: z.number(), h: z.number(), fps: z.number() }),
  duration: z.number(),
  styleIds: z.array(z.string()),
  captions: z.object({ on: z.boolean(), style: z.string(), source: z.enum(['stt', 'script', 'none']) }),
  scenes: z.array(SceneSchema),
  audio: z.object({ voice: z.enum(['footage', 'tts', 'none']), music: z.string().nullable() }),
  genEstimate: z.object({ items: z.number(), usd: z.number() }),
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
