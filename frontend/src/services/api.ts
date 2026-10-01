import type { DocumentItem, Metrics } from '../types';

const BASE_URL = '/api';

export const api = {
  // Chat APIs
  createNewSession: async (): Promise<{ session_id: string }> => {
    const res = await fetch(`${BASE_URL}/chat/session/new`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to create new session');
    return res.json();
  },

  getSessionHistory: async (sessionId: string) => {
    const res = await fetch(`${BASE_URL}/chat/history/${sessionId}`);
    if (!res.ok) throw new Error('Failed to fetch session history');
    return res.json();
  },

  clearSession: async (sessionId: string) => {
    const res = await fetch(`${BASE_URL}/chat/session/${sessionId}/clear`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to clear session');
    return res.json();
  },

  submitFeedback: async (sessionId: string, messageId: string, rating: 1 | -1, comment?: string) => {
    const res = await fetch(`${BASE_URL}/chat/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, message_id: messageId, rating, comment }),
    });
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

  getDocuments: async (token: string): Promise<{ documents: DocumentItem[]; total_count: number }> => {
    const res = await fetch(`${BASE_URL}/admin/documents`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch documents');
    return res.json();
  },

  uploadDocument: async (token: string, file: File): Promise<DocumentItem> => {
    const formData = new FormData();
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

  getMetrics: async (token: string): Promise<Metrics> => {
    const res = await fetch(`${BASE_URL}/admin/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch metrics');
    return res.json();
  },
};
