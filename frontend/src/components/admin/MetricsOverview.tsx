import { useEffect, useState } from 'react';
import { BookMarked, Layers, MessagesSquare, Activity, ShieldAlert, ThumbsUp } from 'lucide-react';
import type { Metrics } from '../../types';

/** Animates a number from 0 to `value` with an ease-out curve. */
function useCountUp(value: number, duration = 900) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

const Stat: React.FC<{
  label: string; value: number; decimals?: number; suffix?: string; hint: string;
  icon: typeof BookMarked; tint: string; delay: number;
}> = ({ label, value, decimals = 0, suffix = '', hint, icon: Icon, tint, delay }) => {
  const shown = useCountUp(value);
  return (
    <div className="card anim-fade-up p-4 sm:p-5" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-ink-500 sm:text-sm">{label}</p>
        <span className={`hidden h-10 w-10 items-center justify-center rounded-xl sm:flex ${tint}`}><Icon className="h-5 w-5" /></span>
      </div>
      <p className="font-serif mt-2 text-3xl font-semibold sm:mt-3 sm:text-4xl text-ink-900">
        {shown.toFixed(decimals)}<span className="ml-0.5 text-xl text-ink-400">{suffix}</span>
      </p>
      <p className="mt-1 text-xs text-ink-500">{hint}</p>
    </div>
  );
};

export const MetricsOverview: React.FC<{ metrics: Metrics | null; loading?: boolean }> = ({ metrics, loading }) => {
  if (loading || !metrics) {
    return (
      <div className="mb-8 grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-36 rounded-xl" />)}
      </div>
    );
  }
  const satisfaction = Math.round(metrics.positive_ratio * 100);

  return (
    <section aria-label="Course and student metrics" className="mb-8 grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
      <Stat label="Course documents" value={metrics.total_documents} hint={`${metrics.ready_documents} ready for students`} icon={BookMarked} tint="bg-ink-100 text-ink-600" delay={0} />
      <Stat label="Knowledge sections" value={metrics.total_chunks} hint="Searchable passages the tutor teaches from" icon={Layers} tint="bg-ink-100 text-ink-600" delay={70} />
      <Stat label="Student sessions" value={metrics.total_sessions} hint={`${metrics.total_messages} messages exchanged`} icon={MessagesSquare} tint="bg-ink-100 text-ink-600" delay={140} />
      <Stat label="Engagement" value={metrics.avg_turns_per_session} decimals={1} suffix=" msgs" hint="Average per active session (goal: 10+)" icon={Activity} tint="bg-ink-100 text-ink-600" delay={210} />
      <Stat label="Off-topic redirects" value={metrics.deflection_count} hint="Questions steered back to the course" icon={ShieldAlert} tint="bg-ink-100 text-ink-600" delay={280} />
      <div className="card anim-fade-up p-4 sm:p-5" style={{ animationDelay: '350ms' }}>
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium text-ink-500">Student satisfaction</p>
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-ink-100 text-ink-600"><ThumbsUp className="h-5 w-5" /></span>
        </div>
        <p className="font-serif mt-2 text-3xl font-semibold sm:mt-3 sm:text-4xl text-ink-900">{satisfaction}<span className="ml-0.5 text-xl text-ink-400">%</span></p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100" role="img" aria-label={`${satisfaction}% positive feedback`}>
          <div className="h-full rounded-full bg-board-600 transition-all duration-1000 ease-out" style={{ width: `${satisfaction}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-ink-500">{metrics.feedback_positive} helpful · {metrics.feedback_negative} unclear</p>
      </div>
    </section>
  );
};
