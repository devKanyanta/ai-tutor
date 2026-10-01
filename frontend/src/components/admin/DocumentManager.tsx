import { useState, useRef } from 'react';
import { UploadCloud, CheckCircle2, Clock, AlertCircle, FileText, Trash2, RefreshCw, Upload, Check, Loader2 } from 'lucide-react';
import type { DocumentItem } from '../../types';
import { api } from '../../services/api';

interface DocumentManagerProps {
  token: string;
  documents: DocumentItem[];
  onRefresh: () => void;
}

export const DocumentManager: React.FC<DocumentManagerProps> = ({ token, documents, onRefresh }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [updatingDocId, setUpdatingDocId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateFileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    setBatchProgress({ current: 0, total: files.length });

    try {
      if (files.length === 1) {
        const newDoc = await api.uploadDocument(token, files[0]);
        setUploadSuccess(`Successfully uploaded and indexed "${newDoc.filename}" (${newDoc.chunk_count} chunks)`);
      } else {
        const batchResult = await api.batchUploadDocuments(token, files);
        const successCount = batchResult.successful.length;
        const failCount = batchResult.failed.length;
        if (failCount === 0) {
          setUploadSuccess(`Successfully batch-indexed all ${successCount} curriculum files!`);
        } else {
          setUploadSuccess(`Batch completed: ${successCount} indexed, ${failCount} failed.`);
          setUploadError(batchResult.failed.map((f) => `${f.filename}: ${f.error}`).join('; '));
        }
      }
      onRefresh();
    } catch (err: any) {
      setUploadError(err.message || 'File upload failed');
    } finally {
      setIsUploading(false);
      setBatchProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
  };

  const handleUpdateFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !updatingDocId) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const updated = await api.updateDocument(token, updatingDocId, file);
      setUploadSuccess(`Successfully updated curriculum document with "${updated.filename}" (${updated.chunk_count} chunks)`);
      onRefresh();
    } catch (err: any) {
      setUploadError(err.message || 'Update failed');
    } finally {
      setIsUploading(false);
      setUpdatingDocId(null);
      if (updateFileInputRef.current) updateFileInputRef.current.value = '';
    }
  };

  const triggerUpdate = (docId: string) => {
    setUpdatingDocId(docId);
    updateFileInputRef.current?.click();
  };

  const handleDelete = async (docId: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}" from curriculum materials?`)) return;
    try {
      await api.deleteDocument(token, docId);
      onRefresh();
    } catch (err: any) {
      alert(`Delete error: ${err.message}`);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const renderStatusBadge = (status: DocumentItem['status']) => {
    switch (status) {
      case 'READY':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5" /> Ready
          </span>
        );
      case 'INDEXING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 animate-pulse">
            <Clock className="w-3.5 h-3.5" /> Indexing
          </span>
        );
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
            <Clock className="w-3.5 h-3.5" /> Pending
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800">
            <AlertCircle className="w-3.5 h-3.5" /> Failed
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Zone (REQ-IN-01) with Multi-file & Folder Drag-and-Drop */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
          isDragging
            ? 'border-indigo-500 bg-indigo-50/70 scale-[1.01]'
            : 'border-slate-300 hover:border-indigo-400 bg-white/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.csv"
          multiple
          onChange={handleFileChange}
          className="hidden"
          id="curriculum-upload"
          disabled={isUploading}
        />
        <label
          htmlFor="curriculum-upload"
          className="flex flex-col items-center justify-center cursor-pointer"
        >
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mb-3">
            {isUploading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <UploadCloud className="w-6 h-6" />
            )}
          </div>
          <span className="text-sm font-semibold text-slate-700 mb-1">
            {isUploading
              ? batchProgress
                ? `Batch processing ${batchProgress.total} documents...`
                : 'Indexing and embedding document...'
              : 'Click or drop curriculum documents (or select multiple)'}
          </span>
          <span className="text-xs text-slate-500">
            Supports multi-file selection: PDF, DOCX, TXT, Markdown, CSV
          </span>
        </label>

        {uploadSuccess && (
          <div className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 p-2 rounded-lg flex items-center justify-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            <span>{uploadSuccess}</span>
          </div>
        )}
        {uploadError && (
          <div className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 p-2 rounded-lg flex items-center justify-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* Documents List (REQ-IN-03, REQ-IN-04) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">
            Uploaded Materials ({documents.length})
          </h3>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh List
          </button>
        </div>

        {documents.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
            No curriculum documents uploaded yet. Upload documents above to ground the AI Tutor.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-2xs">
            {documents.map((doc) => (
              <div key={doc.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50/80 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate max-w-xs sm:max-w-md">
                      {doc.filename}
                    </p>
                    <p className="text-[11px] text-slate-400 flex items-center gap-2">
                      <span>{doc.file_type.toUpperCase()}</span>
                      <span>•</span>
                      <span>{formatFileSize(doc.file_size)}</span>
                      <span>•</span>
                      <span>{doc.chunk_count} semantic chunks</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {renderStatusBadge(doc.status)}
                  <button
                    onClick={() => triggerUpdate(doc.id)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Update/Replace document file (REQ-IN-03)"
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(doc.id, doc.filename)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    title="Delete document"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hidden file input for update action */}
      <input
        ref={updateFileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.csv"
        onChange={handleUpdateFileChange}
        className="hidden"
      />
    </div>
  );
};
