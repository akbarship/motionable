// The lessons for this style (and the global ones): what the user rejected, in their words. A rule means apply_ops
// enforces it; the count shows how often it stopped a batch.
import {api, type Lesson} from './api';
import {useT, type Key} from './i18n';

// an enforced rule, in the user's words
const RULE: Record<string, Key> = {forbid: 'ruleForbid', max_per_minute: 'ruleMax', min_hold: 'ruleHold', no_behind_subject: 'ruleBehind'};

export const Lessons = ({lessons, onError}: {lessons: Lesson[]; onError(m: string): void}) => {
  const t = useT();
  return (
    <div className="sec lessons">
      <h3>{t('lessons')} <span>{lessons.length}</span></h3>
      {!lessons.length && <p className="hint">{t('noLessons')}</p>}
      <ul>
        {[...lessons].reverse().map((l) => (
          <li key={l.id}>
            <p>{l.text}</p>
            <div className="lmeta">
              <span className="tag">{l.scope === 'global' ? t('global') : l.scope.replace('style:', '')}</span>
              {l.rule && <span className="tag rule">{RULE[l.rule.kind] ? t(RULE[l.rule.kind]) : l.rule.kind}</span>}
              {!!l.seen && <span className="tag">{l.seen} {t('stopped')}</span>}
              <button className="link" aria-label={`${t('remove')}: ${l.text}`}
                onClick={() => window.confirm(`${t('remove')}?\n\n${l.text}`) && api.removeLesson(l.id).catch((e) => onError(e.message))}>{t('remove')}</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
