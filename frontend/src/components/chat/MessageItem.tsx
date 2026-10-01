import { Bot, User } from 'lucide-react';
import type { Message } from '../../types';
import { MarkdownContent } from './MarkdownContent';
import { SourceBadge } from './SourceBadge';
import { FeedbackButtons } from './FeedbackButtons';

interface MessageItemProps {
  message: Message;
  onFeedback: (messageId: string, rating: 1 | -1) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, onFeedback }) => {
  const isAssistant = message.role === 'assistant';

  return (
    <div
      className={`flex gap-3 my-3 p-3 rounded-xl transition-all ${
        isAssistant
          ? 'bg-white border border-slate-200/80 shadow-xs'
          : 'bg-indigo-50/70 border border-indigo-100 ml-auto max-w-[85%]'
      }`}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isAssistant
            ? 'bg-indigo-600 text-white shadow-xs'
            : 'bg-slate-700 text-white'
        }`}
      >
        {isAssistant ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-xs text-slate-800">
            {isAssistant ? 'Socratic Tutor' : 'You'}
          </span>
          {message.created_at && (
            <span className="text-[10px] text-slate-400">
              {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        <MarkdownContent content={message.content} />

        {isAssistant && message.sources && message.sources.length > 0 && (
          <SourceBadge sources={message.sources} />
        )}

        {isAssistant && (
          <FeedbackButtons
            currentFeedback={message.feedback}
            onFeedback={(rating) => onFeedback(message.id, rating)}
          />
        )}
      </div>
    </div>
  );
};
