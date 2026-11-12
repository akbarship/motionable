import { useEffect, useState, type FormEvent } from 'react';
import { api, type Config, type ConfigPatch, type Kind, type ProviderUse } from '../api';

type Choice = 'off' | 'own' | 'bot';

const KINDS: { kind: Kind; label: string; own: ProviderUse; ownName: string }[] = [
  { kind: 'image', label: 'Rasm', own: 'kie', ownName: 'kie.ai' },
  { kind: 'video', label: 'Video', own: 'kie', ownName: 'kie.ai' },
  { kind: 'tts', label: 'Ovoz (TTS)', own: 'elevenlabs', ownName: 'ElevenLabs' },
  { kind: 'stt', label: 'Subtitr (STT)', own: 'elevenlabs', ownName: 'ElevenLabs' },
];

const BOT_ERRORS: Record<string, string> = {
  no_bot_key: "Bot kaliti kiritilmagan.",
  bad_bot_url: "Bot manzili noto'g'ri.",
  insufficient_balance: "Balans yetarli emas.",
};

const toChoice = (u: ProviderUse): Choice => (u === 'off' ? 'off' : u === 'bot' ? 'bot' : 'own');

interface Row {
  choice: Choice;
  key: string; // masked value from the server, or what the user typed
}

/** Provider per kind (off / own key / bot), bot key and URL, and bot balance. */
export function Settings() {
  const [rows, setRows] = useState<Record<Kind, Row> | null>(null);
  const [botKey, setBotKey] = useState('');
  const [botUrl, setBotUrl] = useState('');
  const [sttRate, setSttRate] = useState<number | null>(null); // USD per minute, read from the server's prices.json
  const [server, setServer] = useState<Config | null>(null); // last saved config (masked)
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [balance, setBalance] = useState<{ usd?: number; error?: string; busy?: boolean }>({});

  function fill(c: Config) {
    const next = {} as Record<Kind, Row>;
    for (const { kind } of KINDS) next[kind] = { choice: toChoice(c.providers[kind].use), key: c.providers[kind].key ?? '' };
    setRows(next);
    setBotKey(c.botKey ?? '');
    setBotUrl(c.botUrl ?? '');
    setServer(c);
  }

  /** Removes a stored key right away; '' tells the server to clear it. Other unsaved edits stay. */
  async function clearKey(kind: Kind | 'bot') {
    if (!server) return;
    setSaved(null);
    setSaveError(null);
    try {
      const patch: ConfigPatch =
        kind === 'bot' ? { botKey: '' } : { providers: { [kind]: { use: server.providers[kind].use, key: '' } } };
      const c = await api.putConfig(patch);
      setServer(c);
      if (kind === 'bot') {
        setBotKey('');
        setBalance({});
      } else set(kind, { key: '' });
      setSaved("Kalit o'chirildi.");
    } catch (err) {
      setSaveError((err as Error).message);
    }
  }

  async function checkBalance() {
    setBalance({ busy: true });
    try {
      const b = await api.balance();
      setBalance({ usd: typeof b.usd === 'number' ? b.usd : undefined });
    } catch (e) {
      const m = (e as Error).message;
      setBalance({ error: BOT_ERRORS[m] ?? m });
    }
  }

  useEffect(() => {
    api.prices().then((p) => setSttRate(p.stt.perMinute), () => {});
    api.getConfig().then(
      (c) => {
        fill(c);
        if (c.botKey) void checkBalance();
      },
      (e) => setLoadError((e as Error).message),
    );
  }, []);

  const set = (kind: Kind, p: Partial<Row>) => {
    setSaved(null);
    setRows((cur) => (cur ? { ...cur, [kind]: { ...cur[kind], ...p } } : cur));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!rows) return;
    setSaving(true);
    setSaved(null);
    setSaveError(null);
    const providers: NonNullable<ConfigPatch['providers']> = {};
    for (const { kind, own } of KINDS) {
      const r = rows[kind];
      const use: ProviderUse = r.choice === 'off' ? 'off' : r.choice === 'bot' ? 'bot' : own;
      providers[kind] = r.key ? { use, key: r.key } : { use };
    }
    const patch: ConfigPatch = { providers };
    // Only send what changed: an untouched or emptied URL never overwrites the stored one.
    const url = botUrl.trim();
    if (url && url !== (server?.botUrl ?? '')) patch.botUrl = url;
    if (botKey) patch.botKey = botKey;
    try {
      fill(await api.putConfig(patch));
      setSaved('Saqlandi.');
      if (botKey) void checkBalance();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="settings">
        <p className="form-error" role="alert">{loadError}</p>
      </div>
    );
  }
  if (!rows) return <div className="loading" aria-busy="true">Yuklanmoqda…</div>;

  const usesBot = Object.values(rows).some((r) => r.choice === 'bot');

  return (
    <form className="settings" onSubmit={save}>
      <h1 className="h-screen">Sozlamalar</h1>
      <p className="muted lead">
        Rasm, video, ovoz va subtitr qayerdan olinsin. Pullik so'rovlar har doim sizning tasdig'ingizdan keyin ketadi.
      </p>

      <section className="group" aria-labelledby="gen-h">
        <h2 id="gen-h" className="h-group">Generatsiya</h2>
        {KINDS.map(({ kind, label, ownName }) => {
          const r = rows[kind];
          const sid = `use-${kind}`;
          const kid = `key-${kind}`;
          return (
            <div className="setting" key={kind}>
              <div className="setting-row">
                <label htmlFor={sid} className="setting-label">{label}</label>
                <div className="select-wrap">
                  <select id={sid} value={r.choice} onChange={(e) => set(kind, { choice: e.target.value as Choice })}>
                    <option value="off">O'chiq</option>
                    <option value="own">O'z kalitim ({ownName})</option>
                    <option value="bot">Bot</option>
                  </select>
                </div>
              </div>
              {r.choice === 'own' && (
                <div className="setting-sub">
                  <label htmlFor={kid}>{ownName} kaliti</label>
                  <div className="inline">
                    <input
                      id={kid}
                      type="password"
                      className="mono"
                      value={r.key}
                      onChange={(e) => set(kind, { key: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      placeholder="Kalitni joylang"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {server?.providers[kind].key && (
                      <button type="button" className="btn btn--ghost" onClick={() => void clearKey(kind)}
                        aria-label={`${ownName} kalitini o'chirish (${label})`}>
                        O'chirish
                      </button>
                    )}
                  </div>
                </div>
              )}
              {kind === 'stt' && (
                <p className="note">
                  Subtitr yoqilganda har bir transkripsiya alohida tasdiqsiz ishlaydi (taxminan {sttRate === null ? '…' : '$' + sttRate}/daqiqa).
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section className="group" aria-labelledby="bot-h">
        <h2 id="bot-h" className="h-group">Bot</h2>
        {!usesBot && <p className="muted small">Bot hech bir tur uchun tanlanmagan.</p>}
        <div className="field">
          <label htmlFor="bot-key">Bot kaliti</label>
          <div className="inline">
            <input
              id="bot-key"
              type="password"
              className="mono"
              value={botKey}
              onChange={(e) => {
                setSaved(null);
                setBotKey(e.target.value);
              }}
              onFocus={(e) => e.target.select()}
              placeholder="Telegram botdan olingan kalit"
              autoComplete="off"
              spellCheck={false}
            />
            {server?.botKey && (
              <button type="button" className="btn btn--ghost" onClick={() => void clearKey('bot')}
                aria-label="Bot kalitini o'chirish">
                O'chirish
              </button>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="bot-url">Bot manzili</label>
          <input
            id="bot-url"
            type="url"
            className="mono"
            value={botUrl}
            onChange={(e) => {
              setSaved(null);
              setBotUrl(e.target.value);
            }}
            placeholder="https://"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="balance" aria-live="polite">
          <span className="balance-label">Balans</span>
          <span className="balance-value">
            {balance.busy
              ? 'Tekshirilmoqda…'
              : balance.usd !== undefined
                ? `$${balance.usd.toFixed(2)}`
                : balance.error ?? '—'}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={checkBalance} disabled={balance.busy}>
            Yangilash
          </button>
        </div>
      </section>

      <div className="actions actions--sticky">
        <button type="submit" className="btn btn--dark btn--lg" disabled={saving}>
          {saving ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
        <p className="small" role="status">
          {saveError ? <span className="form-error">{saveError}</span> : saved}
        </p>
      </div>
    </form>
  );
}
