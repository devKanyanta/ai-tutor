export interface SourceReference {
  document_id: string;
  filename: string;
  chunk_index: number;
  snippet: string;
  score: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceReference[];
  created_at?: string;
  feedback?: 1 | -1 | null;
  /** Spoken transcript: render as plain text, not markdown/math. */
  plain?: boolean;
}

export interface DocumentItem {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  status: 'PENDING' | 'INDEXING' | 'READY' | 'FAILED';
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface BatchUploadResult {
  successful: DocumentItem[];
  failed: Array<{ filename: string; error: string }>;
  total_processed: number;
}

export interface Metrics {
  total_documents: number;
  total_chunks: number;
  ready_documents: number;
  total_sessions: number;
  total_messages: number;
  avg_turns_per_session: number;
  deflection_count: number;
  feedback_positive: number;
  feedback_negative: number;
  positive_ratio: number;
}

export interface LessonPhase {
  id: 'WARMUP' | 'LEARN' | 'PRACTICE' | 'RECAP';
  label: string;
  status: 'done' | 'current' | 'upcoming';
  step: number;   // 1-based step inside this phase (0 when not started)
  steps: number;  // number of tutor steps in this phase
  items: string[];
}

export interface LessonState {
  lesson_stage: string;   // INIT | WARMUP | LEARN | PRACTICE | RECAP | DONE
  current_topic: string;
  student_turns: number;
  complete?: boolean;
  objective?: string;
  phases?: LessonPhase[];
  beat?: number;
  total_beats?: number;
  /** Label of the phase the tutor is waiting for a go-ahead to start (e.g. "Practice"), or empty. */
  awaiting_confirmation?: string;
}
