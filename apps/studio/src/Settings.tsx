// Settings: the user's own keys (stored whole on this computer, shown masked), language, data folder, and the link
// to their Claude Code: is the CLI there, is the Motionable MCP added, add it with one click.
import {useEffect, useState} from 'react';
import {api, type ClaudeCode, type SettingsInfo} from './api';
import {useT, type Lang} from './i18n';

export const Settings = ({setLang, lastClaudeError, onError}: {setLang(l: Lang): void; lastClaudeError: string | null; onError(m: string): void}) => {
  const t = useT();
  const [s, setS] = useState<SettingsInfo | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [home, setHome] = useState('');
  const [cc, setCc] = useState<ClaudeCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings().then((x) => { setS(x); setHome(x.home); }, (e) => onError(e.message));
    api.claudeCode().then(setCc, () => setCc(null));
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
  const connect = async () => {
    setBusy(true);
    try {
      setCc(await api.connectClaudeCode());
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!s) return <main className="setup" />;
  const oauth = lastClaudeError && /oauth|authenticat|login/i.test(lastClaudeError);

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
          <h3>Claude Code</h3>
          {!cc && <p className="hint">{t('running')}</p>}
          {cc && (
            <>
              <ul className="checks">
                <li className={cc.cli ? 'ok' : 'bad'}>{cc.cli ? `✓ ${t('ccFound')} (${cc.version})` : `✕ ${t('ccMissing')}`}</li>
                <li className={/connected|added/i.test(cc.mcp) ? 'ok' : 'bad'}>
                  {/connected|added/i.test(cc.mcp) ? `✓ ${t('ccConnected')} (${cc.mcp})` : `✕ ${t('ccNotConnected')}`}
                </li>
                {oauth && <li className="bad">✕ {t('ccLogin')}</li>}
              </ul>
              {cc.cli && !/connected|added/i.test(cc.mcp) && (
                <div className="btnrow"><button className="btn primary" onClick={connect} disabled={busy}>{busy ? t('running') : t('ccConnect')}</button></div>
              )}
              <p className="hint">{t('ccCommand')}</p>
              <code className="cmd">{cc.command}</code>
            </>
          )}
        </div>
      </div>
    </main>
  );
};
