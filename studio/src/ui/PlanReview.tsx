import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { fmtUsd, genUnavailable, quoteItemsFor, type PlanView } from '../pipeline';

const num = (n: number) => String(Math.round(n * 100) / 100);

/** Director's plan: hook, scenes (script, layout, motion, assets), optional paid generation with a quote, and Approve. */
export function PlanReview({ projectId, plan, onStarted }: { projectId: string; plan: PlanView; onStarted: () => void }) {
  const items = useMemo(() => quoteItemsFor(plan), [plan]);
  const [useGen, setUseGen] = useState(false);
  const [quote, setQuote] = useState<{ usd: number; missing: string[] } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (items.length === 0) return;
    let live = true;
    api.quote(projectId, items).then(
      (q) => {
        if (!live) return;
        setQuote(q);
        setQuoteError(null);
        if (genUnavailable(q.missing)) setUseGen(false);
      },
      (e: Error) => live && setQuoteError(e.message),
    );
    return () => {
      live = false;
    };
  }, [projectId, items]);

  const unavailable = quote ? genUnavailable(quote.missing) : false;

  async function approve() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      await api.addTask(projectId, 'execute', { useGen: useGen && !unavailable });
      onStarted();
    } catch (e) {
      setError((e as Error).message);
      setSending(false);
    }
  }

  return (
    <section className="block" aria-labelledby="plan-h">
      <h2 id="plan-h" className="block-h">Reja</h2>
      {plan.story && (
        <div className="plan-story">
          <p className="plan-hook">
            <span className="muted small">Hook</span> {plan.story.hook}
          </p>
          {plan.story.cta && <p className="muted small">CTA: {plan.story.cta}</p>}
        </div>
      )}
      <p className="muted small">
        Davomiyligi: {num(plan.duration)} s · {plan.scenes.length} ta sahna
        {items.length > 0 ? ` · ${items.length} ta AI generatsiya` : ''}
      </p>
      <ol className="scenes">
        {plan.scenes.map((s) => (
          <li key={s.id} className="scene">
            <div className="scene-head">
              <span className="scene-time">
                {num(s.start)}–{num(s.end)} s
              </span>
              <span className="scene-purpose">{s.purpose}</span>
            </div>
            {s.script && <p className="scene-script">{s.script}</p>}
            {s.layout && (
              <p className="scene-line small">
                <b>Joylashuv</b> {s.layout}
              </p>
            )}
            {s.motion && (
              <p className="scene-line small">
                <b>Harakat</b> {s.motion}
              </p>
            )}
            <ul className="scene-assets">
              {s.assets.map((a) => (
                <li key={a.id}>
                  <span className={`chip chip--src${a.source === 'gen' ? ' chip--gen' : ''}`}>{a.source}</span> {a.what}
                  {a.source === 'gen' && a.fallback && <span className="muted"> · zaxira: {a.fallback}</span>}
                </li>
              ))}
            </ul>
            {s.fallback && <p className="scene-fallback muted small">Zaxira: {s.fallback}</p>}
          </li>
        ))}
      </ol>

      {items.length > 0 && (
        <div className="gen-toggle">
          <label className="switch">
            <input type="checkbox" checked={useGen} disabled={unavailable || quote === null} onChange={(e) => setUseGen(e.target.checked)} />
            <span>Generatsiyadan foydalanish</span>
          </label>
          {quote && !unavailable && <p className="small">Taxminiy narx: {fmtUsd(quote.usd)}</p>}
          {unavailable && <p className="muted small">Rasm/video generatsiyasi uchun Sozlamalarda provayder tanlang</p>}
          {quoteError && <p className="form-error" role="alert">{quoteError}</p>}
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--dark btn--lg" disabled={sending} onClick={() => void approve()}>
          {sending ? 'Yuborilmoqda…' : 'Rejani tasdiqlash'}
        </button>
      </div>
    </section>
  );
}
