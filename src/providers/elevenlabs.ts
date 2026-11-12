import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WordsSchema, type Words } from '../core/types.js';
import type { GenReq, GenerationProvider } from './types.js';
import { httpError, num, prices, strParam, usd } from './util.js';

// Docs used (fetched 2026-11-12), all VERIFIED:
//  - https://elevenlabs.io/docs/api-reference/speech-to-text/convert  POST /v1/speech-to-text, multipart
//    (file, model_id, timestamps_granularity=word), header xi-api-key, words[{text,start,end,type}]
//  - https://elevenlabs.io/docs/api-reference/text-to-speech/convert  POST /v1/text-to-speech/{voice_id}
//    ?output_format=mp3_44100_128, JSON {text, model_id}, returns audio bytes
const API = 'https://api.elevenlabs.io';
const STT_URL = `${API}/v1/speech-to-text`;
const TTS_URL = (voice: string) => `${API}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`;
const STT_MODEL = 'scribe_v2';
const TTS_MODEL = 'eleven_multilingual_v2';

type Keys = { tts?: string; stt?: string };
export type ElevenLabs = GenerationProvider & { transcribe(file: string): Promise<Words> };

/** Own-key adapter for ElevenLabs: Scribe speech-to-text and text-to-speech. */
export function createElevenLabs(keys: Keys): ElevenLabs {
  const kinds: GenerationProvider['kinds'] = [];
  if (keys.tts) kinds.push('tts');
  if (keys.stt) kinds.push('stt');

  return {
    kinds,
    async quote(r: GenReq) {
      if (r.kind === 'tts') return { usd: usd((strParam(r.params.text, '').length / 1000) * prices.tts.per1kChars) };
      return { usd: usd((num(r.params.seconds, 60) / 60) * prices.stt.perMinute) };
    },
    async run(r) {
      if (r.kind !== 'tts' || !keys.tts) throw new Error('elevenlabs run supports tts only');
      const text = strParam(r.params.text, '');
      const voice = strParam(r.params.voiceId, '');
      if (!text || !voice) throw new Error('text and voiceId are required');
      const res = await fetch(TTS_URL(voice), {
        method: 'POST',
        headers: { 'xi-api-key': keys.tts, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: strParam(r.params.model, TTS_MODEL) }),
      });
      if (!res.ok) throw httpError('elevenlabs', res.status);
      await mkdir(r.outDir, { recursive: true });
      const file = join(r.outDir, `${r.taskId ?? randomBytes(6).toString('hex')}.mp3`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      return { file, usd: (await this.quote(r)).usd };
    },
    async transcribe(file) {
      if (!keys.stt) throw new Error('no elevenlabs stt key');
      const form = new FormData();
      form.append('model_id', STT_MODEL);
      form.append('timestamps_granularity', 'word');
      form.append('file', new Blob([await readFile(file)]), basename(file));
      const res = await fetch(STT_URL, { method: 'POST', headers: { 'xi-api-key': keys.stt }, body: form });
      if (!res.ok) throw httpError('elevenlabs', res.status);
      const j = (await res.json()) as { words?: { text: string; start: number | null; end: number | null; type: string }[] };
      const words = (j.words ?? [])
        .filter((w) => w.type === 'word' && typeof w.start === 'number' && typeof w.end === 'number')
        .map((w) => ({ w: w.text, start: w.start as number, end: w.end as number }));
      return WordsSchema.parse(words);
    },
  };
}
