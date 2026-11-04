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

/** What students see when choosing who to learn with. */
export interface Tutor {
  id: string;
  name: string;
  subject: string;
  description: string;
  document_count: number;
  ready_documents: number;
  /** Lessons in the course and how many of them this student has finished. */
  lesson_count: number;
  completed_lessons: number;
  /** Overall course progress 0-100, counting partly finished lessons. */
  progress_percent: number;
  created_at: string;
}

/** Instructor view: adds the private teaching guidance. */
export interface TutorAdmin extends Tutor {
  instructions: string;
}

export interface TutorInput {
  name: string;
  subject: string;
  description: string;
  instructions: string;
}

export interface DocumentItem {
  id: string;
  tutor_id?: string | null;
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

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface CourseLesson {
  id: string;
  position: number;
  title: string;
  status?: 'not_started' | 'in_progress' | 'completed';
  /** How far through this lesson the student is, 0-100. */
  percent?: number;
}

export interface CourseState {
  total: number;
  completed: number;
  /** Overall course progress 0-100, counting partly finished lessons. */
  percent: number;
  current_id: string | null;
  current_position: number | null;
  lessons: CourseLesson[];
}

export interface LessonState {
  /** Set while the student is on a break or has ended the lesson; the lesson picks up where it stopped. */
  paused?: '' | 'break' | 'ended';
  /** The student's position in the tutor's course; null when the tutor has no lessons. */
  course?: CourseState | null;
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
