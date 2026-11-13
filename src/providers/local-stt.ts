import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npxCommand } from '../core/hf-cmd.js';
import type { Words } from '../core/types.js';

/** Thrown when whisper.cpp is not installed; `hint` tells the person what to install. */
export class LocalSttUnavailable extends Error {
  constructor(readonly hint: string) {
    super('local_stt_unavailable');
  }
}

const INSTALL_HINT: Record<string, string> = {
  linux: 'sudo apt-get install -y git cmake build-essential',
  darwin: 'xcode-select --install && brew install cmake',
  win32: 'Visual Studio Build Tools + CMake',
};

/** Normalise the CLI's transcript (array or {words}) of {text|word|w, start, end} into Words. */
export function toWords(data: unknown): Words | null {
  const arr = Array.isArray(data) ? data : (data as { words?: unknown })?.words;
  if (!Array.isArray(arr)) return null;
  const out: Words = [];
  for (const x of arr as Record<string, unknown>[]) {
    const w = String(x.text ?? x.word ?? x.w ?? '').trim();
    const start = Number(x.start);
    const end = Number(x.end);
    if (w && Number.isFinite(start) && Number.isFinite(end)) out.push({ w, start, end });
  }
  return out;
}

/**
 * Free on-device speech to text: `hyperframes transcribe --engine whisper` (whisper.cpp, multilingual model).
 * The model downloads once (medium = 1.5 GB). Slow on CPU, but costs nothing and needs no key.
 */
export async function transcribeLocal(file: string, opts: { model?: string; language?: string } = {}): Promise<Words> {
  const dir = await mkdtemp(join(tmpdir(), 'motionable-stt-'));
  try {
    const args = ['transcribe', file, '--dir', dir, '--engine', 'whisper', '--model', opts.model ?? 'medium', '--json'];
    if (opts.language) args.push('--language', opts.language);
    const bin = process.env.MOTIONABLE_HF_BIN;
    const c = bin ? { cmd: bin, args, shell: false } : npxCommand(process.platform, ['--no-install', 'hyperframes', ...args]);
    const stdout = await new Promise<string>((ok, fail) => {
      const ch = spawn(c.cmd, c.args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], shell: c.shell, windowsHide: true });
      let out = '';
      ch.stdout.on('data', (d: Buffer) => (out += d.toString()));
      ch.once('error', fail);
      ch.once('close', () => ok(out));
    });
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '');
    } catch {
      // not JSON: fall back to the transcript file below
    }
    if (parsed && typeof parsed === 'object' && (parsed as { ok?: boolean }).ok === false) {
      const reason = String((parsed as { reason?: string }).reason ?? '');
      if (reason.includes('whisper')) throw new LocalSttUnavailable(INSTALL_HINT[process.platform] ?? INSTALL_HINT.linux);
      throw new Error(`local transcribe failed: ${reason || 'unknown'}`);
    }
    const direct = toWords(parsed);
    if (direct && direct.length > 0) return direct;
    for (const name of ['transcript.json', 'words.json']) {
      try {
        const w = toWords(JSON.parse(await readFile(join(dir, name), 'utf8')));
        if (w) return w;
      } catch {
        // try the next name
      }
    }
    throw new Error('local transcribe returned no words');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
