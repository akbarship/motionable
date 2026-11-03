// Settings: the user's own keys (stored whole on this computer, shown masked), language, data folder, and whether
// Claude in chat is connected (it connects itself with /motionable).
import {useContext, useEffect, useState} from 'react';
import {api, type SettingsInfo} from './api';
import {ClaudePill, PresenceContext} from './Requests';
import {useT, type Lang} from './i18n';

export const Settings = ({setLang, onError}: {setLang(l: Lang): void; onError(m: string): void}) => {
  const t = useT();
  const [s, setS] = useState<SettingsInfo | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [home, setHome] = useState('');
  const presence = useContext(PresenceContext);
  const [saved, setSaved] = useState(false);

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
  if (!s) return <main className="setup" />;

  return (
    <main className="setup">
      <div className="sheet wide">
        <h2>{t('settings')}{saved && <span className="tag done">{t('saved')}</span>}</h2>

        <div className="sec">
          <h3>{t('apiKeys')}</h3>
          <p className="hint">{t('apiKeysHint')}</p>
          {(['elevenlabs', 'gemini'] as const).map((k) => (
            <div className="field" key={k}>
              <label htmlFor={`key-${k}`}>{k === 'elevenlabs' ? 'ElevenLabs' : 'Gemini'}</label>
              <span className="keyrow">
                <input id={`key-${k}`} className="inp" type="password" autoComplete="off" placeholder={s.keys[k] ?? t('notSet')}
                  value={keys[k] ?? ''} onChange={(e) => setKeys({...keys, [k]: e.target.value})} />
                <button className="btn primary" disabled={!keys[k]?.trim()} onClick={() => save({keys: {[k]: keys[k]}})}>{t('saveLesson')}</button>
                {s.keys[k] && <button className="btn" onClick={() => save({keys: {[k]: null}})}>{t('remove')}</button>}
              </span>
            </div>
          ))}
        </div>

        <div className="sec">
          <h3>{t('language')}</h3>
          <div className="seg" role="group" aria-label={t('language')}>
            {(['uz', 'en'] as Lang[]).map((l) => (
              <button key={l} className={s.lang === l ? 'on' : ''} onClick={() => { setLang(l); save({lang: l}); }}>{l === 'uz' ? 'Oʻzbekcha' : 'English'}</button>
            ))}
          </div>
        </div>

        <div className="sec">
          <h3>{t('dataFolder')}</h3>
          <div className="keyrow">
            <input className="inp" value={home} onChange={(e) => setHome(e.target.value)} aria-label={t('dataFolder')} />
            <button className="btn" disabled={home === s.home} onClick={() => save({home})}>{t('saveLesson')}</button>
          </div>
          {s.restart && <p className="hint">⚠ {t('restartNeeded')}</p>}
        </div>

        <div className="sec">
          <h3>Claude</h3>
          <ClaudePill p={presence} />
          {presence.status === 'offline' && <p className="hint">{t('claudeOfflineHint')}</p>}
        </div>
      </div>
    </main>
  );
};
