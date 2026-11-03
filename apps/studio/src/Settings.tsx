// Settings: the user's own keys (stored whole on this computer, shown masked, each with where to get one), language,
// data folder (with a restart button when it changed), whether Claude in chat is connected, and the app's version.
import {useContext, useEffect, useState} from 'react';
import {api, type SettingsInfo} from './api';
import {ClaudePill, CopyCommand, PresenceContext} from './Requests';
import {useT, type Key, type Lang} from './i18n';

// each key: its label and the page where the user gets one (all three have free sign-ups)
const KEYS: {k: 'elevenlabs' | 'pexels' | 'pixabay'; label: Key; url: string}[] = [
  {k: 'elevenlabs', label: 'keyEleven', url: 'https://elevenlabs.io/app/settings/api-keys'},
  {k: 'pexels', label: 'keyPexels', url: 'https://www.pexels.com/api/new/'},
  {k: 'pixabay', label: 'keyPixabay', url: 'https://pixabay.com/api/docs/'},
];

export const Settings = ({lang, setLang, onError}: {lang: Lang; setLang(l: Lang): void; onError(m: string): void}) => {
  const t = useT();
  const [s, setS] = useState<SettingsInfo | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [home, setHome] = useState('');
  const presence = useContext(PresenceContext);
  const [saved, setSaved] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    api.settings().then((x) => { setS(x); setHome(x.home); }, (e) => onError(e.message));
  }, [onError]);

  const save = async (change: Parameters<typeof api.saveSettings>[0]) => {
    try {
      const x = await api.saveSettings(change);
      setS(x);
      setKeys({});
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  // the server restarts itself; the page reloads once it answers again
  const restart = async () => {
    setRestarting(true);
    try {
      await api.restart();
    } catch {}
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await fetch('/api/health').then((r) => r.ok, () => false)) return window.location.reload();
    }
    setRestarting(false);
  };
  if (!s) return <main className="setup" aria-busy="true"><p className="muted">…</p></main>;

  return (
    <main className="setup">
      <div className="sheet wide">
        <h2>{t('settings')}{saved && <span className="tag done" role="status">{t('saved')}</span>}</h2>

        <div className="sec">
          <h3>Claude</h3>
          <ClaudePill p={presence} />
          {presence.status === 'offline' && <><p className="hint">{t('stepClaudeHint')}</p><CopyCommand /></>}
        </div>

        <div className="sec">
          <h3>{t('apiKeys')}</h3>
          <p className="hint">{t('apiKeysHint')}</p>
          {KEYS.map(({k, label, url}) => (
            <div className="field key" key={k}>
              <label htmlFor={`key-${k}`}>{t(label)}</label>
              <span className="keyrow">
                <input id={`key-${k}`} className="inp" type="password" autoComplete="off" placeholder={s.keys[k] ?? t('notSet')}
                  value={keys[k] ?? ''} onChange={(e) => setKeys({...keys, [k]: e.target.value})} />
                <button className="btn primary" disabled={!keys[k]?.trim()} onClick={() => save({keys: {[k]: keys[k]}})}>{t('saveLesson')}</button>
                {s.keys[k] ? <button className="btn" onClick={() => save({keys: {[k]: null}})}>{t('remove')}</button>
                  : <a className="link" href={url} target="_blank" rel="noreferrer">{t('getKey')}</a>}
              </span>
            </div>
          ))}
        </div>

        <div className="sec">
          <h3>{t('language')}</h3>
          <div className="seg" role="group" aria-label={t('language')}>
            {(['uz', 'en'] as Lang[]).map((l) => (
              <button key={l} aria-pressed={lang === l} className={lang === l ? 'on' : ''} onClick={() => { setLang(l); save({lang: l}); }}>
                {l === 'uz' ? 'Oʻzbekcha' : 'English'}
              </button>
            ))}
          </div>
        </div>

        <div className="sec">
          <h3>{t('dataFolder')}</h3>
          <div className="keyrow">
            <input className="inp" value={home} onChange={(e) => setHome(e.target.value)} aria-label={t('dataFolder')} />
            <button className="btn" disabled={home === s.home} onClick={() => save({home})}>{t('saveLesson')}</button>
          </div>
          {s.restart && (
            <div className="keyrow">
              <p className="hint">{t('restartNeeded')}</p>
              <button className="btn primary" disabled={restarting} onClick={restart}>{restarting ? t('restarting') : t('restartServer')}</button>
            </div>
          )}
        </div>

        <div className="sec">
          <h3>{t('version_')}</h3>
          <div className="keyrow">
            <p className="hint">Motionable {s.version ?? ''}</p>
            <button className="btn" disabled={restarting} onClick={restart}>{restarting ? t('restarting') : t('restartServer')}</button>
          </div>
        </div>
      </div>
    </main>
  );
};
