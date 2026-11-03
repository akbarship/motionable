// "Bu yoqmadi" on a caption line, an overlay or a transition: the user's reason becomes a timed note (Claude fixes
// this spot) and a lesson (the mistake isn't made again). "Never use this component" makes the lesson a rule.
import {useState} from 'react';
import {api, type Op} from './api';
import {useT} from './i18n';

type Props = {
  style: string; // name@version
  what: string; // e.g. "caption line w14", "overlay hook"
  component: string | null;
  at?: string; // anchor of the moment, for the note
  apply(why: string, ops: Op[]): Promise<void> | void;
  onError(m: string): void;
};

export const Dislike = ({style, what, component, at, apply, onError}: Props) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [never, setNever] = useState(false);
  if (!open) return <button className="btn dislike" onClick={() => setOpen(true)}>👎 {t('dislike')}</button>;
  const send = async () => {
    const text = reason.trim();
    try {
      await api.addLesson({text, scope: `style:${style.split('@')[0]}`, source: `studio: ${what}`,
        ...(never && component ? {rule: {kind: 'forbid', component}} : {})});
      await apply('studio: the user disliked this', [{op: 'note.add', text: `${t('dislike')} (${what}): ${text}`, ...(at ? {at} : {})}]);
      setOpen(false);
      setReason('');
      setNever(false);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <div className="dislikebox">
      <label htmlFor="dislike-reason">{t('dislikeWhy')}</label>
      <textarea id="dislike-reason" className="inp" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      {component && (
        <label className="toggle">
          <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} />
          {t('neverUse')} <code>{component}</code>
        </label>
      )}
      <div className="btnrow">
        <button className="btn primary" disabled={!reason.trim()} onClick={send}>{t('saveLesson')}</button>
        <button className="btn" onClick={() => setOpen(false)}>{t('cancel')}</button>
      </div>
    </div>
  );
};
