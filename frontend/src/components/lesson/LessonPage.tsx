import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, RotateCcw, Send, WifiOff, AlertCircle, Loader2 } from 'lucide-react';
import { Logo } from '../Logo';
import { Link } from '../../router';
import { LessonProgress } from './LessonProgress';
import { SlideDeck } from './SlideDeck';
import { VoiceOrb } from './VoiceOrb';
import { useVoiceLesson, type VoiceLessonEvent, type Pace } from './useVoiceLesson';
import { api } from '../../services/api';
import type { LessonState, Message } from '../../types';

const STARTERS = [
  { title: 'Map the course', text: 'What topics do my course materials cover?' },
  { title: 'Start from the basics', text: 'Explain the key idea of the first chapter simply' },
  { title: 'Quick summary', text: 'Give me a short summary of the main concepts' },
  { title: 'I am stuck', text: 'Help me understand something I find confusing' },
];

/**
 * One board "explanation" = everything the tutor said between two student turns.
 * Interruptions and late transcript chunks create several tutor messages in a row; join them.
 */
const toTutorTurns = (list: Message[]): Message[] => {
  const turns: Message[] = [];
  let previousRole: Message['role'] | null = null;
  for (const m of list) {
    if (m.role === 'assistant' && m.content) {
      const prev = turns[turns.length - 1];
      if (previousRole === 'assistant' && prev) {
        const plain = !!prev.plain && !!m.plain;
        turns[turns.length - 1] = {
          ...prev,
          id: m.id,
          plain,
          content: `${prev.content}${plain ? ' ' : '\n\n'}${m.content}`,
          sources: m.sources?.length ? m.sources : prev.sources,
          feedback: m.feedback ?? prev.feedback,
        };
      } else {
        turns.push({ ...m });
      }
    }
    previousRole = m.role;
  }
  return turns;
};

/** Voice transcription and interrupted turns arrive in fragments; show them as one utterance. */
const mergeConsecutive = (list: Message[]): Message[] => {
  const out: Message[] = [];
  for (const m of list) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      out[out.length - 1] = { ...prev, id: m.id, content: `${prev.content} ${m.content}`.trim(), sources: m.sources?.length ? m.sources : prev.sources };
    } else {
      out.push({ ...m });
    }
  }
  return out;
};

export const LessonPage: React.FC = () => {
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [initError, setInitError] = useState(false);
  const [booting, setBooting] = useState(true);
  const [lesson, setLesson] = useState<LessonState>({ lesson_stage: 'INIT', current_topic: '', student_turns: 0 });
  const [progress, setProgress] = useState(1);
  const [pace, setPaceState] = useState<Pace>(() => {
    try { const v = localStorage.getItem('ai_tutor_pace'); return v === 'normal' || v === 'slow' ? v : 'relaxed'; } catch { return 'relaxed'; }
  });
  const [speaker, setSpeaker] = useState<'none' | 'you' | 'tutor'>('none');
  const voiceSourcesRef = useRef<Message['sources']>([]);
  const lastVoiceRole = useRef<'user' | 'assistant' | null>(null);

  const refreshLesson = useCallback(async (id: string) => {
    if (!id) return;
    try { setLesson(await api.getSessionState(id)); } catch { /* progress is optional */ }
  }, []);

  const initSession = useCallback(async () => {
    setInitError(false);
    setBooting(true);
    try {
      const stored = localStorage.getItem('ai_tutor_session_id');
      if (stored) {
        setSessionId(stored);
        const history = await api.getSessionHistory(stored);
        if (history.messages?.length > 0) {
          setMessages(mergeConsecutive(history.messages));
          void refreshLesson(stored);
          return;
        }
      }
      const created = await api.createNewSession();
      setSessionId(created.session_id);
      localStorage.setItem('ai_tutor_session_id', created.session_id);
    } catch (err) {
      console.error('Session init error:', err);
      setInitError(true);
    } finally {
      setBooting(false);
    }
  }, [refreshLesson]);

  useEffect(() => { void initSession(); }, [initSession]);

  const handleVoiceEvent = (event: VoiceLessonEvent) => {
    if (event.type === 'transcript' && event.content?.trim()) {
      const text = event.content.trim();
      const continuing = lastVoiceRole.current === 'user';
      lastVoiceRole.current = 'user';
      voiceSourcesRef.current = [];
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (continuing && last?.role === 'user') {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, id: event.message_id || m.id, content: `${m.content} ${text}` } : m));
        }
        return [...prev, { id: event.message_id || `voice-user-${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() }];
      });
      return;
    }
    if (event.type === 'assistant_text' && event.content) {
      lastVoiceRole.current = 'assistant';
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.id.startsWith('voice-assistant-')) {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: m.content + event.content } : m));
        }
        return [...prev, { id: `voice-assistant-${Date.now()}`, role: 'assistant', content: event.content || '', sources: voiceSourcesRef.current || [], created_at: new Date().toISOString(), plain: true }];
      });
      return;
    }
    if (event.type === 'sources' && event.sources) {
      voiceSourcesRef.current = event.sources;
      setMessages((prev) => {
        const i = prev.findLastIndex((m) => m.role === 'assistant');
        if (i < 0 || !prev[i].id.startsWith('voice-assistant-')) return prev;
        return prev.map((m, idx) => (idx === i ? { ...m, sources: event.sources } : m));
      });
      return;
    }
    if (event.type === 'turn_complete' && event.message_id) {
      voiceSourcesRef.current = [];
      setMessages((prev) => {
        const i = prev.findLastIndex((m) => m.role === 'assistant');
        return i < 0 ? prev : prev.map((m, idx) => (idx === i ? { ...m, id: event.message_id || m.id } : m));
      });
      void refreshLesson(sessionId);
    }
  };

  const voice = useVoiceLesson({ sessionId, onEvent: handleVoiceEvent, onActiveChange: setIsVoiceActive });

  useEffect(() => {
    voice.setPace(pace);
    try { localStorage.setItem('ai_tutor_pace', pace); } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pace]);

  // Which side is talking right now, for the status line. Polls the audio levels a few times a second.
  useEffect(() => {
    if (voice.status !== 'listening') { setSpeaker('none'); return; }
    const timer = window.setInterval(() => {
      const { mic, tutor } = voice.levelsRef.current;
      const next = tutor > 0.05 && tutor >= mic ? 'tutor' : mic > 0.08 ? 'you' : 'none';
      setSpeaker((prev) => (prev === next ? prev : next));
    }, 150);
    return () => window.clearInterval(timer);
  }, [voice.status, voice.levelsRef]);

  // Reveal the tutor's spoken text in step with playback (see getSpeechProgress).
  useEffect(() => {
    if (!isVoiceActive) { setProgress(1); return; }
    const timer = window.setInterval(() => {
      const next = voice.getSpeechProgress();
      setProgress((prev) => (Math.abs(prev - next) < 0.004 ? prev : next));
    }, 80);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVoiceActive]);

  const handleFeedback = async (messageId: string, rating: 1 | -1) => {
    try {
      await api.submitFeedback(sessionId, messageId, rating);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: rating } : m)));
    } catch (err) {
      console.error('Feedback error:', err);
    }
  };

  const ask = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || !sessionId || isLoading) return;
    setInput('');

    // During a voice lesson, typed questions go through the same live session.
    if (isVoiceActive && voice.sendText(text)) return;
    if (isVoiceActive) return;

    const stamp = Date.now();
    const userId = `u-${stamp}`;
    const assistantId = `a-${stamp}`;
    lastVoiceRole.current = null;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: text, created_at: new Date().toISOString() },
      { id: assistantId, role: 'assistant', content: '', sources: [], created_at: new Date().toISOString() },
    ]);
    setIsLoading(true);

    const patch = (fn: (m: Message) => Message) => setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));
    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });
      if (!response.ok || !response.body) throw new Error('Stream request failed');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          try {
            const event = JSON.parse(payload);
            if (event.type === 'sources') patch((m) => ({ ...m, sources: event.sources }));
            else if (event.type === 'token') { accumulated += event.content; patch((m) => ({ ...m, content: accumulated })); }
            else if (event.type === 'error') patch((m) => ({ ...m, content: accumulated || 'Sorry, something went wrong while answering. Please try again.' }));
            else if (event.type === 'done') patch((m) => ({ ...m, id: event.message_id || m.id }));
          } catch (err) {
            console.error('SSE parse error:', err);
          }
        }
      }
    } catch (err) {
      console.error('Chat error:', err);
      patch((m) => ({ ...m, content: 'We could not reach your tutor. Please check your connection and try again.' }));
    } finally {
      setIsLoading(false);
      void refreshLesson(sessionId);
    }
  };

  const newSession = async () => {
    if (!sessionId || isVoiceActive || isLoading) return;
    if (messages.length > 0 && !window.confirm('Start a new session? This clears the current lesson.')) return;
    try {
      await api.clearSession(sessionId);
      setMessages([]);
      setLesson({ lesson_stage: 'INIT', current_topic: '', student_turns: 0 });
      const created = await api.createNewSession();
      setSessionId(created.session_id);
      localStorage.setItem('ai_tutor_session_id', created.session_id);
    } catch (err) {
      console.error('Clear session error:', err);
    }
  };

  const revealed = useMemo(() => {
    const m = messages[messages.length - 1];
    if (!isVoiceActive || !m || m.role !== 'assistant' || !m.plain || progress >= 1) return messages;
    const end = m.content.indexOf(' ', Math.floor(m.content.length * progress));
    const visible = end < 0 ? m.content : m.content.slice(0, end);
    return [...messages.slice(0, -1), { ...m, content: visible }];
  }, [messages, isVoiceActive, progress]);
  const tutorTurns = useMemo(() => toTutorTurns(revealed), [revealed]);
  const studentTurns = messages.filter((m) => m.role === 'user');
  const last = messages[messages.length - 1];
  const voiceStreaming = last?.role === "assistant" && (last.id.startsWith("voice-assistant-") || (isVoiceActive && !!last.plain && progress < 1));
  const streaming = isLoading || !!voiceStreaming;
  const thinking = isLoading && last?.role === 'assistant' && !last.content;

  const orbMode = voice.status === 'listening' ? 'live' : voice.status === 'connecting' ? 'connecting' : 'idle';
  const statusLine =
    voice.status === 'connecting' ? 'Connecting…'
      : voice.status === 'listening' ? (speaker === 'tutor' ? 'Tutor is speaking' : speaker === 'you' ? 'Listening to you' : 'Listening — go ahead')
        : 'Voice lesson is off';

  const latestStudent = studentTurns[studentTurns.length - 1];
  const earlier = studentTurns.slice(0, -1).reverse();

  return (
    <div className="flex h-dvh flex-col bg-paper">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-ink-200 bg-surface px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Logo />
          <div className="hidden md:block">
            <LessonProgress stage={lesson.lesson_stage} active={lesson.student_turns > 0} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={newSession} disabled={isVoiceActive || isLoading} className="btn btn-ghost !px-3 !py-2 text-xs" title="Clear this lesson and start fresh">
            <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New session</span>
          </button>
          <Link to="/studio" className="hidden px-2 py-2 text-xs font-medium text-ink-600 hover:text-ink-900 sm:block">Instructors</Link>
        </div>
      </header>
      <div className="border-b border-ink-200 bg-surface px-4 py-1.5 md:hidden"><LessonProgress stage={lesson.lesson_stage} active={lesson.student_turns > 0} /></div>

      {initError && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-mark-400/50 bg-mark-300/30 px-4 py-2 text-sm text-ink-800">
          <span className="flex items-center gap-2"><WifiOff className="h-4 w-4" /> We can’t reach your tutor right now.</span>
          <button onClick={() => void initSession()} className="btn btn-ghost !py-1.5 text-xs">Try again</button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-1">
        {/* Board (tutor) */}
        <div className="min-h-0">
          {booting ? <div className="skeleton h-full" aria-hidden="true" /> : (
            <SlideDeck
              turns={tutorTurns}
              streaming={streaming}
              thinking={thinking}
              followLive={isVoiceActive}
              starters={STARTERS}
              disabled={!sessionId || (isVoiceActive && voice.status !== 'listening')}
              onAsk={(t) => void ask(t)}
              onFeedback={handleFeedback}
            />
          )}
        </div>

        {/* Student panel */}
        <aside className="flex min-h-0 flex-col border-t border-ink-200 bg-surface lg:border-l lg:border-t-0" aria-label="Your voice">
          <div className="grid grid-cols-[6rem_1fr] items-center gap-4 p-4 lg:flex lg:flex-col lg:gap-0 lg:px-6 lg:pb-2 lg:pt-8">
            <VoiceOrb levelsRef={voice.levelsRef} mode={orbMode} className="aspect-square w-24 lg:w-64" />
            <div className="min-w-0 lg:mt-4 lg:w-full lg:text-center">
              <p className="text-sm font-semibold text-ink-900" role="status" aria-live="polite">{statusLine}</p>
              <div className="mt-2 lg:mt-3">
                {voice.status === 'listening' || voice.status === 'connecting' ? (
                  <button onClick={voice.stop} disabled={voice.status === 'connecting'} className="btn btn-danger !px-4 !py-2 text-sm lg:w-full">
                    {voice.status === 'connecting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MicOff className="h-4 w-4" />} End voice lesson
                  </button>
                ) : (
                  <button onClick={voice.start} disabled={!sessionId} className="btn btn-primary !px-4 !py-2 text-sm lg:w-full">
                    <Mic className="h-4 w-4" /> Start voice lesson
                  </button>
                )}
              </div>
              <div className="mt-3 lg:mt-4" role="radiogroup" aria-label="Tutor speaking pace">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400 lg:text-center">Voice pace</p>
                <div className="inline-flex overflow-hidden rounded-lg border border-ink-300 lg:flex">
                  {([['normal', 'Normal'], ['relaxed', 'Relaxed'], ['slow', 'Slow']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      role="radio"
                      aria-checked={pace === id}
                      onClick={() => setPaceState(id)}
                      className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${pace === id ? 'bg-board-800 text-[#f6f2e9]' : 'bg-white text-ink-600 hover:bg-ink-100'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {voice.status === 'error' && voice.error && (
                <p role="alert" className="mt-2 flex items-start gap-1.5 text-left text-xs text-clay-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {voice.error}</p>
              )}
            </div>
          </div>

          {/* What the student said */}
          <div className="scroll-soft hidden min-h-0 flex-1 overflow-y-auto border-t border-ink-100 px-6 py-4 lg:block">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">You said</p>
            {latestStudent ? (
              <p key={latestStudent.id} className="anim-fade-in border-l-2 border-clay-500 pl-3 font-serif text-lg leading-snug text-ink-900">{latestStudent.content}</p>
            ) : (
              <p className="text-sm text-ink-400">Your words appear here as you speak or type.</p>
            )}
            {earlier.length > 0 && (
              <ul className="mt-5 space-y-2 border-t border-ink-100 pt-3">
                {earlier.slice(0, 8).map((m) => (
                  <li key={m.id} className="line-clamp-2 text-xs text-ink-500">{m.content}</li>
                ))}
              </ul>
            )}
          </div>
          {/* Compact transcript for phones */}
          <p className="line-clamp-2 border-t border-ink-100 px-4 py-2 text-sm text-ink-700 lg:hidden">
            {latestStudent ? <><span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-clay-500">You</span>{latestStudent.content}</> : <span className="text-ink-400">Your words appear here as you speak or type.</span>}
          </p>

          {/* Type instead */}
          <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="flex items-center gap-2 border-t border-ink-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:p-4">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={4000}
              aria-label="Type a question"
              placeholder={isVoiceActive ? 'Or type to your tutor…' : 'Or type a question…'}
              className="min-w-0 flex-1 rounded-lg border border-ink-300 bg-white px-3 py-2.5 text-sm placeholder-ink-400 focus:border-board-500 focus:outline-none focus:ring-2 focus:ring-board-500/20"
            />
            <button type="submit" disabled={!input.trim() || isLoading} className="btn btn-primary !px-3 !py-2.5" aria-label="Send">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
};
