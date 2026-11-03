// Uzbek transcript with word timings: ElevenLabs Scribe (scribe_v2), on the user's own key. Paid: callers ask first.
// Ported from an earlier Motionable version (transcribe.py). Node only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://api.elevenlabs.io/v1/speech-to-text';
export const SCRIBE_MODEL = 'scribe_v2';

// Uzbek Latin has two apostrophe letters: ʻ (U+02BB) in oʻ and gʻ, and ʼ (U+02BC). Scribe and keyboards write them
// as ' ’ ‘ ` ´; captions need the real letters.
const APOS = "'’‘`´ʻʼ";
const OG = new RegExp(`([oOgG])[${APOS}]`, 'g');
const TUTUQ = /(?<=[A-Za-zʻ])['’‘`´ʼ](?=[A-Za-z])/g; // every other apostrophe inside a word; never touches ʻ
export const uzbekApostrophes = (text: string) => text.replace(OG, '$1ʻ').replace(TUTUQ, 'ʼ');

/** The key from ELEVENLABS_API_KEY or ~/.motionable/config.json {"keys": {"elevenlabs": "..."}}. */
export const elevenLabsKey = () => {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.motionable', 'config.json'), 'utf8'));
    if (c.keys?.elevenlabs) return String(c.keys.elevenlabs);
  } catch {}
  throw new Error('no ElevenLabs key: set it in the app settings (or ELEVENLABS_API_KEY)');
};

type ScribeWord = {type: string; text: string; start: number; end: number; logprob?: number};

export const scribe = async (audio: string, key: string, language = 'uzb') => {
  const form = new FormData();
  form.set('model_id', SCRIBE_MODEL);
  form.set('file', await fs.openAsBlob(audio), path.basename(audio));
  form.set('language_code', language);
  form.set('timestamps_granularity', 'word');
  form.set('tag_audio_events', 'true');
  form.set('diarize', 'false');
  const r = await fetch(API, {method: 'POST', headers: {'xi-api-key': key}, body: form, signal: AbortSignal.timeout(900_000)});
  const text = await r.text();
  if (!r.ok) throw new Error(`Scribe failed (${r.status}): ${text.slice(-500)}`);
  return JSON.parse(text) as {words?: ScribeWord[]; language_code?: string; language_probability?: number};
};

export const toTranscript = (raw: Awaited<ReturnType<typeof scribe>>) => {
  const words: {i: number; text: string; start: number; end: number; conf: number | null}[] = [];
  const events: {text: string; start: number; end: number}[] = [];
  let fixed = 0;
  for (const w of raw.words ?? []) {
    if (w.type === 'word') {
      const text = uzbekApostrophes(w.text);
      if (text !== w.text) fixed++;
      words.push({i: words.length, text, start: +w.start.toFixed(3), end: +w.end.toFixed(3),
        conf: w.logprob === undefined ? null : +Math.exp(w.logprob).toFixed(3)});
    } else if (w.type === 'audio_event') events.push({text: w.text, start: +w.start.toFixed(3), end: +w.end.toFixed(3)});
  }
  return {
    transcript: {provider: `elevenlabs/${SCRIBE_MODEL}`, language: 'uz-Latn', languageDetected: raw.language_code ?? null,
      languageProbability: raw.language_probability ?? null, words, events},
    fixed,
  };
};
