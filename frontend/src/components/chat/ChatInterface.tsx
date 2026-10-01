import { useState, useRef, useEffect } from 'react';
import { Send, RotateCcw, Sparkles, Loader2 } from 'lucide-react';
import type { Message } from '../../types';
import { MessageItem } from './MessageItem';
import { api } from '../../services/api';

export const ChatInterface: React.FC = () => {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initialize session
  useEffect(() => {
    const initSession = async () => {
      try {
        const stored = localStorage.getItem('ai_tutor_session_id');
        if (stored) {
          setSessionId(stored);
          const history = await api.getSessionHistory(stored);
          if (history.messages && history.messages.length > 0) {
            setMessages(history.messages);
            return;
          }
        }
        const newSession = await api.createNewSession();
        setSessionId(newSession.session_id);
        localStorage.setItem('ai_tutor_session_id', newSession.session_id);
      } catch (err) {
        console.error('Session init error:', err);
      }
    };
    initSession();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleClearSession = async () => {
    if (!sessionId) return;
    try {
      await api.clearSession(sessionId);
      setMessages([]);
      const newSession = await api.createNewSession();
      setSessionId(newSession.session_id);
      localStorage.setItem('ai_tutor_session_id', newSession.session_id);
    } catch (err) {
      console.error('Clear session error:', err);
    }
  };

  const handleFeedback = async (messageId: string, rating: 1 | -1) => {
    try {
      await api.submitFeedback(sessionId, messageId, rating);
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, feedback: rating } : msg))
      );
    } catch (err) {
      console.error('Feedback error:', err);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading || !sessionId) return;

    const userText = input.trim();
    setInput('');

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userText,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    const assistantPlaceholderId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantPlaceholderId,
      role: 'assistant',
      content: '',
      sources: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: userText }),
      });

      if (!response.ok) throw new Error('Stream request failed');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No readable stream available');

      let accumulatedText = '';
      let currentSources: any[] = [];
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const event = JSON.parse(dataStr);
              if (event.type === 'sources') {
                currentSources = event.sources;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantPlaceholderId
                      ? { ...msg, sources: currentSources }
                      : msg
                  )
                );
              } else if (event.type === 'token') {
                accumulatedText += event.content;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantPlaceholderId
                      ? { ...msg, content: accumulatedText }
                      : msg
                  )
                );
              } else if (event.type === 'done') {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantPlaceholderId
                      ? { ...msg, id: event.message_id || msg.id }
                      : msg
                  )
                );
              }
            } catch (err) {
              console.error('SSE parse error:', err);
            }
          }
        }
      }
    } catch (err) {
      console.error('Chat error:', err);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantPlaceholderId
            ? { ...msg, content: 'An error occurred while connecting to your tutor. Please try again.' }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-w-4xl mx-auto px-2 sm:px-4 py-2">
      {/* Session Controls Header */}
      <div className="flex items-center justify-between py-2 border-b border-slate-200/80 mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-700">Socratic Guided Learning</h2>
          <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 font-medium">
            Strictly Grounded
          </span>
        </div>
        <button
          onClick={handleClearSession}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg transition-colors shadow-2xs"
          title="Reset conversation and start fresh (REQ-UI-04)"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>New Session</span>
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-1 py-2 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-3 shadow-2xs">
              <Sparkles className="w-7 h-7" />
            </div>
            <h3 className="text-base font-semibold text-slate-800 mb-1">
              Welcome to your interactive AI Tutor!
            </h3>
            <p className="text-sm text-slate-600 max-w-md mb-4">
              I am here to guide your understanding step-by-step using questions and curriculum materials.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg text-left text-xs">
              <button
                onClick={() => setInput("Can you help me understand how vectors and dot products work?")}
                className="p-2.5 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 bg-white transition-all text-slate-700 text-left"
              >
                👉 "Can you help me understand how vectors work?"
              </button>
              <button
                onClick={() => setInput("What is the main topic covered in our uploaded curriculum?")}
                className="p-2.5 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 bg-white transition-all text-slate-700 text-left"
              >
                👉 "What is the main topic covered in our curriculum?"
              </button>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              onFeedback={handleFeedback}
            />
          ))
        )}
        {isLoading && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
          <div className="flex items-center gap-2 p-3 text-slate-400 text-xs italic">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
            <span>Consulting course curriculum and formulating guidance...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input Bar */}
      <div className="pt-2">
        <form
          onSubmit={handleSendMessage}
          className="relative flex items-end gap-2 bg-white p-2 rounded-2xl border border-slate-300 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition-all"
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or share your current thinking..."
            className="flex-1 max-h-32 resize-none border-0 bg-transparent py-1.5 px-2 text-sm text-slate-800 focus:outline-none placeholder-slate-400"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 shadow-2xs"
            aria-label="Send message"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
        <p className="text-[11px] text-center text-slate-400 mt-1.5">
          Press <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px]">Enter</kbd> to submit, <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px]">Shift + Enter</kbd> for newline
        </p>
      </div>
    </div>
  );
};
