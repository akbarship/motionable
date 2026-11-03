// What the Studio has to tell the user and must not vanish on its own: errors (in plain words, with the one action
// that fixes them), a paid step's confirmation, and the finished export. Dialogs use the native <dialog> element:
// focus moves in, Esc closes, and the page behind can't be clicked.
import {useEffect, useRef, type ReactNode} from 'react';
import {useT} from './i18n';
import {Alert, Close, Download} from './Icons';

export type Notice = {kind: 'error' | 'info'; text: string; action?: 'settings'};

/** Raw messages (often the server's English) turned into what the user can do about them. */
export const friendly = (raw: string): Notice => {
  if (/elevenlabs|no .*key|api key/i.test(raw)) return {kind: 'error', text: 'errNoKey', action: 'settings'};
  if (/failed to fetch|networkerror|daemon|ECONNREFUSED/i.test(raw)) return {kind: 'error', text: 'errServer'};
  return {kind: 'error', text: raw};
};

/** The notice bar: errors stay until dismissed; info goes after a few seconds. */
export const NoticeBar = ({n, onClose, onSettings}: {n: Notice; onClose(): void; onSettings(): void}) => {
  const t = useT();
  const text = n.text in KEYS ? t(n.text as never) : n.text;
  useEffect(() => {
    if (n.kind !== 'info') return;
    const h = window.setTimeout(onClose, 4000);
    return () => window.clearTimeout(h);
  }, [n, onClose]);
  return (
    <div className={`notice ${n.kind}`} role={n.kind === 'error' ? 'alert' : 'status'}>
      {n.kind === 'error' && <Alert size={18} />}
      <p>{n.kind === 'error' && <b>{t('errTitle')}: </b>}{text}</p>
      {n.action === 'settings' && <button className="btn slim" onClick={() => { onSettings(); onClose(); }}>{t('openSettings')}</button>}
      <button className="iconbtn" onClick={onClose} aria-label={t('close')}><Close size={16} /></button>
    </div>
  );
};
const KEYS = {errNoKey: 1, errServer: 1};

/** A modal dialog on the native element (focus trap, Esc, inert background). */
export const Dialog = ({open, onClose, title, children}: {open: boolean; onClose(): void; title: string; children: ReactNode}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="dlg-title">
      <h2 id="dlg-title">{title}</h2>
      {children}
    </dialog>
  );
};

/** Before money is spent: how much, in minutes of audio, then the user's yes or no. */
export const PaidDialog = ({open, minutes, onYes, onNo}: {open: boolean; minutes: number | null; onYes(): void; onNo(): void}) => {
  const t = useT();
  return (
    <Dialog open={open} onClose={onNo} title={t('paidTitle')}>
      <p>{t('paidBody')} <b>{minutes === null ? '?' : minutes.toFixed(1)} {t('minutesAudio')}</b>.</p>
      <p className="muted">{t('transcribeHint')}</p>
      <div className="btnrow">
        <span className="spacer" />
        <button className="btn" onClick={onNo}>{t('cancel')}</button>
        <button className="btn primary" onClick={onYes} autoFocus>{t('goAhead')}</button>
      </div>
    </Dialog>
  );
};

/** The finished export: the file itself, one click away. */
export const ExportDialog = ({file, project, onClose, onVideos}: {file: string | null; project: string | null; onClose(): void; onVideos(): void}) => {
  const t = useT();
  const url = file && project ? `/api/projects/${encodeURIComponent(project)}/out/${encodeURIComponent(file)}` : '';
  return (
    <Dialog open={!!file} onClose={onClose} title={t('exportDone')}>
      <p className="muted">{t('exportDoneHint')}</p>
      {url && <video className="donevideo" src={url} controls playsInline />}
      <div className="btnrow">
        <button className="link" onClick={() => { onVideos(); onClose(); }}>{t('myVideos')}</button>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>{t('close')}</button>
        {url && <a className="btn primary" href={url} download={file ?? undefined}><Download size={14} /> {t('download')}</a>}
      </div>
    </Dialog>
  );
};
