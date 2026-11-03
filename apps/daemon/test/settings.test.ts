// Settings: keys are stored whole but only ever shown masked; empty removes; the data folder must be absolute.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {mask, publicSettings, readConfig, saveSettings} from '../src/settings';

describe('settings', () => {
  it('masks keys, removes empty ones and checks the folder', () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-settings-'));
    expect(mask('sk_abcdef1234')).toBe('••••1234');
    expect(mask(undefined)).toBeNull();
    const s = saveSettings({keys: {elevenlabs: '  sk_secret9876 ', pexels: ''}, lang: 'en'}, state);
    expect(s.keys).toEqual({elevenlabs: '••••9876', pexels: null, pixabay: null});
    expect(s.lang).toBe('en');
    expect(readConfig(state).keys?.elevenlabs).toBe('sk_secret9876');
    expect(JSON.stringify(publicSettings(state))).not.toContain('secret');
    saveSettings({keys: {elevenlabs: null}}, state);
    expect(readConfig(state).keys?.elevenlabs).toBeUndefined();
    expect(() => saveSettings({home: 'relative/dir'}, state)).toThrow('absolute');
  });
});
