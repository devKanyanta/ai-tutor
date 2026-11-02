import type { AuthUser, CourseLesson, DocumentItem, Metrics, BatchUploadResult, LessonState, Tutor, TutorAdmin, TutorInput } from '../types';

// Relative by default: Vite proxies /api in dev, and the backend (or reverse proxy) serves it in production.
export const BASE_URL: string = import.meta.env.VITE_API_BASE || '/api';

export const UNAUTHORIZED = 'UNAUTHORIZED';

const TOKEN_KEY = 'ai_tutor_user_token';
export const AUTH_EXPIRED_EVENT = 'ai_tutor:auth-expired';

export const getUserToken = (): string => {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
};
export const setUserToken = (token: string | null) => {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
};
export const userAuthHeaders = (): Record<string, string> => {
  const token = getUserToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** fetch() for student endpoints: sends the student's token and signs them out if it was rejected. */
export async function studentFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...userAuthHeaders() } });
  if (res.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  return res;
}

const jsonBody = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function errorText(res: Response, fallback: string): Promise<string> {
  const err = await res.json().catch(() => null);
  const detail = err?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '');
  return fallback;
}

export const api = {
  // Student accounts
  signup: async (name: string, email: string, password: string): Promise<{ token: string; user: AuthUser }> => {
    const res = await fetch(`${BASE_URL}/auth/signup`, jsonBody({ name, email, password }));
    if (!res.ok) throw new Error(await errorText(res, 'Could not create your account'));
    return res.json();
  },

  login: async (email: string, password: string): Promise<{ token: string; user: AuthUser }> => {
    const res = await fetch(`${BASE_URL}/auth/login`, jsonBody({ email, password }));
    if (!res.ok) throw new Error(await errorText(res, 'Could not sign in'));
    return res.json();
  },

  me: async (): Promise<AuthUser | null> => {
    if (!getUserToken()) return null;
    const res = await fetch(`${BASE_URL}/auth/me`, { headers: userAuthHeaders() });
    if (!res.ok) return null;
    return (await res.json()).user;
  },

  logout: async () => {
    await fetch(`${BASE_URL}/auth/logout`, { method: 'POST', headers: userAuthHeaders() }).catch(() => undefined);
  },

  // Chat APIs
  getTutors: async (): Promise<Tutor[]> => {
    const res = await studentFetch('/chat/tutors');
    if (!res.ok) throw new Error('Failed to load tutors');
    return (await res.json()).tutors;
  },

  getTutor: async (tutorId: string): Promise<Tutor | null> => {
    const res = await studentFetch(`/chat/tutors/${encodeURIComponent(tutorId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Failed to load tutor');
    return res.json();
  },

  /** The student's session with this tutor (their existing one, so the course continues where they left off). */
  createNewSession: async (tutorId: string): Promise<{ session_id: string; resumed: boolean }> => {
    const res = await studentFetch('/chat/session/new', jsonBody({ tutor_id: tutorId }));
    if (!res.ok) throw new Error('Failed to create new session');
    return res.json();
  },

  getSessionHistory: async (sessionId: string) => {
    const res = await studentFetch(`/chat/history/${encodeURIComponent(sessionId)}`);
    if (!res.ok) throw new Error('Failed to fetch session history');
    return res.json();
  },

  getSessionState: async (sessionId: string): Promise<LessonState> => {
    const res = await studentFetch(`/chat/session/${encodeURIComponent(sessionId)}/state`);
    if (!res.ok) throw new Error('Failed to fetch lesson state');
    return res.json();
  },

  resetLesson: async (sessionId: string): Promise<LessonState> => {
    const res = await studentFetch(`/chat/session/${encodeURIComponent(sessionId)}/lesson/reset`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to reset lesson');
    return res.json();
  },

  clearSession: async (sessionId: string) => {
    const res = await studentFetch(`/chat/session/${encodeURIComponent(sessionId)}/clear`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to clear session');
    return res.json();
  },

  submitFeedback: async (sessionId: string, messageId: string, rating: 1 | -1, comment?: string) => {
    const res = await studentFetch('/chat/feedback', jsonBody({ session_id: sessionId, message_id: messageId, rating, comment }));
    if (!res.ok) throw new Error('Failed to submit feedback');
    return res.json();
  },

  // Admin APIs
  adminLogin: async (password: string): Promise<{ token: string }> => {
    const res = await fetch(`${BASE_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(err.detail || 'Login failed');
    }
    return res.json();
  },

  // Instructor tutor management
  getAdminTutors: async (token: string): Promise<TutorAdmin[]> => {
    const res = await fetch(`${BASE_URL}/admin/tutors`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new Error(UNAUTHORIZED);
    if (!res.ok) throw new Error('Failed to load tutors');
    return res.json();
  },

  saveTutor: async (token: string, input: TutorInput, tutorId?: string): Promise<TutorAdmin> => {
    const res = await fetch(`${BASE_URL}/admin/tutors${tutorId ? `/${tutorId}` : ''}`, {
      method: tutorId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (res.status === 401) throw new Error(UNAUTHORIZED);
    if (!res.ok) throw new Error('Could not save the tutor');
    return res.json();
  },

  deleteTutor: async (token: string, tutorId: string) => {
    const res = await fetch(`${BASE_URL}/admin/tutors/${tutorId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to delete tutor');
    return res.json();
  },

  getTutorLessons: async (token: string, tutorId: string): Promise<CourseLesson[]> => {
    const res = await fetch(`${BASE_URL}/admin/tutors/${tutorId}/lessons`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) throw new Error(UNAUTHORIZED);
    if (!res.ok) throw new Error('Failed to load lessons');
    return (await res.json()).lessons;
  },

  saveTutorLessons: async (token: string, tutorId: string, lessons: { id: string; title: string }[]): Promise<CourseLesson[]> => {
    const res = await fetch(`${BASE_URL}/admin/tutors/${tutorId}/lessons`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lessons }),
    });
    if (res.status === 401) throw new Error(UNAUTHORIZED);
    if (!res.ok) throw new Error('Could not save the lesson order');
    return (await res.json()).lessons;
  },

  getDocuments: async (token: string, tutorId: string): Promise<{ documents: DocumentItem[]; total_count: number }> => {
    const res = await fetch(`${BASE_URL}/admin/documents?tutor_id=${encodeURIComponent(tutorId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error(UNAUTHORIZED);
    if (!res.ok) throw new Error('Failed to fetch documents');
    return res.json();
  },

  uploadDocument: async (token: string, tutorId: string, file: File): Promise<DocumentItem> => {
    const formData = new FormData();
    formData.append('tutor_id', tutorId);
    formData.append('file', file);
    const res = await fetch(`${BASE_URL}/admin/documents/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(err.detail || 'Upload failed');
    }
    return res.json();
  },

  batchUploadDocuments: async (token: string, tutorId: string, files: File[]): Promise<BatchUploadResult> => {
    const formData = new FormData();
    formData.append('tutor_id', tutorId);
    files.forEach((file) => formData.append('files', file));
    const res = await fetch(`${BASE_URL}/admin/documents/batch-upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Batch upload failed' }));
      throw new Error(err.detail || 'Batch upload failed');
    }
    return res.json();
  },

  updateDocument: async (token: string, docId: string, file: File): Promise<DocumentItem> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE_URL}/admin/documents/${docId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Update failed' }));
      throw new Error(err.detail || 'Update failed');
    }
    return res.json();
  },

  deleteDocument: async (token: string, docId: string) => {
    const res = await fetch(`${BASE_URL}/admin/documents/${docId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to delete document');
    return res.json();
  },

  getMetrics: async (token: string, tutorId: string): Promise<Metrics> => {
    const res = await fetch(`${BASE_URL}/admin/metrics?tutor_id=${encodeURIComponent(tutorId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error(UNAUTHORIZED);
    if (!res.ok) throw new Error('Failed to fetch metrics');
    return res.json();
  },
};
