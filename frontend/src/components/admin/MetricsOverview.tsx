import { BookMarked, Layers, Users, ThumbsUp } from 'lucide-react';
import type { Metrics } from '../../types';

interface MetricsOverviewProps {
  metrics: Metrics | null;
}

export const MetricsOverview: React.FC<MetricsOverviewProps> = ({ metrics }) => {
  if (!metrics) return null;

  const cards = [
    {
      label: 'Curriculum Documents',
      value: metrics.total_documents,
      subtext: `${metrics.ready_documents} active and indexed`,
      icon: BookMarked,
      color: 'text-indigo-600 bg-indigo-50 border-indigo-100',
    },
    {
      label: 'Semantic Chunks',
      value: metrics.total_chunks,
      subtext: 'Vector embeddings ready',
      icon: Layers,
      color: 'text-violet-600 bg-violet-50 border-violet-100',
    },
    {
      label: 'Active Sessions',
      value: metrics.total_sessions,
      subtext: `${metrics.total_messages} messages exchanged`,
      icon: Users,
      color: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    },
    {
      label: 'Satisfaction Ratio',
      value: `${Math.round(metrics.positive_ratio * 100)}%`,
      subtext: `+${metrics.feedback_positive} / -${metrics.feedback_negative} feedback`,
      icon: ThumbsUp,
      color: 'text-amber-600 bg-amber-50 border-amber-100',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      {cards.map((c, i) => {
        const Icon = c.icon;
        return (
          <div key={i} className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">{c.label}</span>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${c.color}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-xl font-bold text-slate-800">{c.value}</div>
            <p className="text-[11px] text-slate-400 mt-0.5">{c.subtext}</p>
          </div>
        );
      })}
    </div>
  );
};
