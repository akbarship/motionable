import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Task } from '../api';
import { awaitingGenerate, hasUnknownState, lastProgress, readPlan, showPlanReview, stageState } from '../pipeline';
import { ApproveCost } from '../ui/ApproveCost';
import { PlanReview } from '../ui/PlanReview';
import { StageCard } from '../ui/StageCard';

/** Pipeline screen: Study -> Direct -> Execute, plan review and paid-generation approvals. */
export function Pipeline({ id, tick }: { id: string; tick: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plan, setPlan] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  // Only the newest request may write state; older replies that land late are dropped.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const v = await api.getProject(id);
      if (seq !== loadSeq.current) return;
      setTasks(v.tasks);
      setPlan(v.plan);
      setError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const stages = [
    { id: 'study', title: "Namunani o'rganish" },
    { id: 'direct', title: 'Rejalashtirish' },
    { id: 'execute', title: 'Yaratish' },
  ] as const;

  const view = plan == null ? null : readPlan(plan);
  const pending = awaitingGenerate(tasks);
  const executeDone = tasks.some((t) => t.type === 'execute' && t.status === 'done');
  const unknown = tasks.filter(hasUnknownState);

  return (
    <div className="pipe">
      <h1 className="h-screen">Jarayon</h1>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ol className="stagecards">
        {stages.map((s, i) => (
          <StageCard key={s.id} index={i + 1} title={s.title} state={stageState(tasks, s.id)} lines={lastProgress(tasks, s.id)} />
        ))}
      </ol>

      {plan != null && view === null && (
        <p className="form-error" role="alert">
          Reja o'qilmadi
        </p>
      )}
      {view && showPlanReview(tasks) && <PlanReview key={JSON.stringify(plan)} projectId={id} plan={view} onStarted={() => void load()} />}
      {executeDone && (
        <a className="btn btn--dark" href={`#/p/${id}/edit`}>
          Muharrirga o'tish
        </a>
      )}
      <ApproveCost projectId={id} pending={pending} unknown={unknown} onChanged={() => void load()} />
    </div>
  );
}
