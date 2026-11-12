import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, maskedConfig, saveConfig } from '../../src/core/config.js';

let prev: string | undefined;
let tmp: string;

beforeEach(async () => {
  prev = process.env.MOTIONABLE_HOME;
  tmp = await mkdtemp(join(tmpdir(), 'motionable-'));
  process.env.MOTIONABLE_HOME = tmp;
});

afterEach(async () => {
  if (prev === undefined) delete process.env.MOTIONABLE_HOME;
  else process.env.MOTIONABLE_HOME = prev;
  await rm(tmp, { recursive: true, force: true });
});

describe('config', () => {
  it('defaults every kind to off and port 4377 without writing', async () => {
    const c = await loadConfig();
    for (const k of ['image', 'video', 'tts', 'stt'] as const) expect(c.providers[k]).toEqual({ use: 'off' });
    expect(c.port).toBe(4377);
    await expect(stat(join(tmp, 'config.json'))).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32')('saves with mode 0o600', async () => {
    await saveConfig({ botKey: 'secret-1234' });
    expect((await stat(join(tmp, 'config.json'))).mode & 0o777).toBe(0o600);
  });

  it('merges per provider kind', async () => {
    await saveConfig({ providers: { image: { use: 'kie', key: 'img-key-aaaa' } } as never });
    const c = await saveConfig({ providers: { stt: { use: 'bot' } } as never });
    expect(c.providers.image).toEqual({ use: 'kie', key: 'img-key-aaaa' });
    expect(c.providers.stt).toEqual({ use: 'bot' });
    expect((await loadConfig()).providers.image.use).toBe('kie');
  });

  it('keeps the stored key when a patch changes only use', async () => {
    await saveConfig({ providers: { image: { use: 'kie', key: 'k-1234' } } });
    const c = await saveConfig({ providers: { image: { use: 'elevenlabs' } } });
    expect(c.providers.image).toEqual({ use: 'elevenlabs', key: 'k-1234' });
    const d = await saveConfig({ providers: { image: { use: 'kie', key: undefined } } });
    expect(d.providers.image.key).toBe('k-1234');
  });

  it('masks keys and never leaks the full key', async () => {
    const c = await saveConfig({
      providers: { tts: { use: 'elevenlabs', key: 'sk-supersecret-abcd' } } as never,
      botKey: 'botsecret-wxyz',
    });
    const m = maskedConfig(c);
    expect(m.providers.tts.key).toBe('••••abcd');
    expect(m.botKey).toBe('••••wxyz');
    expect(JSON.stringify(m)).not.toContain('supersecret');
    expect(JSON.stringify(m)).not.toContain('botsecret');
    expect(maskedConfig({ ...c, botKey: 'ab' }).botKey).toBe('••••');
  });

  it('keeps old key when a masked value is saved', async () => {
    await saveConfig({ providers: { tts: { use: 'elevenlabs', key: 'sk-supersecret-abcd' } } as never, botKey: 'botsecret-wxyz' });
    const c = await saveConfig({ providers: { tts: { use: 'kie', key: '••••abcd' } } as never, botKey: '••••wxyz' });
    expect(c.providers.tts).toEqual({ use: 'kie', key: 'sk-supersecret-abcd' });
    expect(c.botKey).toBe('botsecret-wxyz');
    expect((await loadConfig()).providers.tts.key).toBe('sk-supersecret-abcd');
  });
});
