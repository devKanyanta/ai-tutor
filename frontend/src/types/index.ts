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
