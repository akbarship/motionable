// The lessons for this style (and the global ones): what the user rejected, in their words. A rule means apply_ops
// enforces it; the count shows how often it stopped a batch.
import {api, type Lesson} from './api';
import {useT} from './i18n';

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
              {l.rule && <span className="tag rule">{l.rule.kind}{'component' in l.rule ? ` ${l.rule.component}` : ''}</span>}
              {!!l.seen && <span className="tag">{t('stopped')} {l.seen}×</span>}
              <button className="link" onClick={() => api.removeLesson(l.id).catch((e) => onError(e.message))}>{t('remove')}</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
