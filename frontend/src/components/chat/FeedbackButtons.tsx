import React from 'react';
import { ThumbsUp, ThumbsDown, Check } from 'lucide-react';

interface FeedbackButtonsProps {
  currentFeedback?: 1 | -1 | null;
  onFeedback: (rating: 1 | -1) => void;
}

export const FeedbackButtons: React.FC<FeedbackButtonsProps> = ({ currentFeedback, onFeedback }) => {
  return (
    <div className="flex items-center gap-1 mt-1 text-slate-400">
      <button
        onClick={() => onFeedback(1)}
        className={`p-1 rounded hover:bg-slate-100 transition-colors ${
          currentFeedback === 1 ? 'text-emerald-600 bg-emerald-50' : 'hover:text-slate-600'
        }`}
        title="Helpful explanation"
        aria-label="Thumbs up feedback"
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>

      <button
        onClick={() => onFeedback(-1)}
        className={`p-1 rounded hover:bg-slate-100 transition-colors ${
          currentFeedback === -1 ? 'text-rose-600 bg-rose-50' : 'hover:text-slate-600'
        }`}
        title="Unhelpful or unclear"
        aria-label="Thumbs down feedback"
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>

      {currentFeedback && (
        <span className="text-[11px] text-slate-500 flex items-center gap-0.5 ml-1">
          <Check className="w-3 h-3 text-emerald-500" /> Feedback recorded
        </span>
      )}
    </div>
  );
};
