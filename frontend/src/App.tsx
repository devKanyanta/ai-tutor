import { useState, useEffect } from 'react';
import { GraduationCap, ShieldCheck, MessageSquare, LogOut } from 'lucide-react';
import { ChatInterface } from './components/chat/ChatInterface';
import { DocumentManager } from './components/admin/DocumentManager';
import { MetricsOverview } from './components/admin/MetricsOverview';
import { AdminModal } from './components/admin/AdminModal';
import type { DocumentItem, Metrics } from './types';
import { api } from './services/api';

export function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'admin'>('chat');
  const [adminToken, setAdminToken] = useState<string | null>(
    localStorage.getItem('ai_tutor_admin_token')
  );
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const fetchAdminData = async (token: string) => {
    try {
      const [docsRes, metricsRes] = await Promise.all([
        api.getDocuments(token),
        api.getMetrics(token),
      ]);
      setDocuments(docsRes.documents);
      setMetrics(metricsRes);
    } catch (err) {
      console.error('Error fetching admin data:', err);
    }
  };

  useEffect(() => {
    if (adminToken && activeTab === 'admin') {
      fetchAdminData(adminToken);
    }
  }, [adminToken, activeTab]);

  const handleAdminClick = () => {
    if (adminToken) {
      setActiveTab('admin');
    } else {
      setIsLoginModalOpen(true);
    }
  };

  const handleLoginSuccess = (token: string) => {
    setAdminToken(token);
    localStorage.setItem('ai_tutor_admin_token', token);
    setActiveTab('admin');
    fetchAdminData(token);
  };

  const handleAdminLogout = () => {
    setAdminToken(null);
    localStorage.removeItem('ai_tutor_admin_token');
    setActiveTab('chat');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo & Project Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center shadow-xs">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">
                AI Socratic Tutor
              </h1>
              <p className="text-[11px] text-slate-500">
                Interactive Grounded Learning Platform
              </p>
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'chat'
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Student Chat</span>
            </button>

            <button
              onClick={handleAdminClick}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'admin'
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Instructor Portal</span>
            </button>

            {adminToken && activeTab === 'admin' && (
              <button
                onClick={handleAdminLogout}
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors ml-1"
                title="Log out of Instructor Portal"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4">
        {activeTab === 'chat' ? (
          <ChatInterface />
        ) : (
          <div className="max-w-4xl mx-auto py-2">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-900">Curriculum & Document Ingestion</h2>
              <p className="text-xs text-slate-500 mt-1">
                Upload course syllabi, textbooks, and notes. The AI tutor will strictly ground its responses and guiding questions in this material.
              </p>
            </div>

            <MetricsOverview metrics={metrics} />

            <DocumentManager
              token={adminToken || ''}
              documents={documents}
              onRefresh={() => adminToken && fetchAdminData(adminToken)}
            />
          </div>
        )}
      </main>

      {/* Admin Login Dialog */}
      <AdminModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  );
}

export default App;
