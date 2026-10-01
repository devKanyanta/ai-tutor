import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import type { SourceReference } from '../../types';

interface SourceBadgeProps {
  sources: SourceReference[];
}

export const SourceBadge: React.FC<SourceBadgeProps> = ({ sources }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2 text-xs border border-indigo-100 bg-indigo-50/60 rounded-lg p-2 transition-all">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-indigo-700 font-medium hover:text-indigo-900 focus:outline-none"
      >
        <span className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5" />
          Grounded in {sources.length} curriculum {sources.length === 1 ? 'source' : 'sources'}
        </span>
        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2 pt-2 border-t border-indigo-100">
          {sources.map((src, index) => (
            <div key={index} className="bg-white p-2 rounded border border-indigo-50 shadow-2xs">
              <div className="flex justify-between items-center text-slate-700 font-semibold mb-1">
                <span className="truncate max-w-[200px]">{src.filename}</span>
                <span className="text-[10px] text-slate-400">Match score: {src.score}</span>
              </div>
              <p className="text-slate-600 text-[11px] line-clamp-3 italic">
                "{src.snippet}"
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
