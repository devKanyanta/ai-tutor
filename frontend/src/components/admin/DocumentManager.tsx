import { useState, useRef } from 'react';
import { UploadCloud, CheckCircle2, Clock, AlertCircle, FileText, Trash2, RefreshCw, Upload, Check, Loader2, FileSpreadsheet, FileType2, Library } from 'lucide-react';
import type { DocumentItem } from '../../types';
import { api } from '../../services/api';

interface DocumentManagerProps {
  token: string;
  documents: DocumentItem[];
  onRefresh: () => void;
  loading?: boolean;
}

export const DocumentManager: React.FC<DocumentManagerProps> = ({ token, documents, onRefresh, loading }) => {
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

  const pill = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold';
  const renderStatusBadge = (status: DocumentItem['status']) => {
    switch (status) {
      case 'READY':
        return <span className={`${pill} bg-board-50 text-board-700`}><CheckCircle2 className="h-3.5 w-3.5" /> Ready</span>;
      case 'INDEXING':
        return <span className={`${pill} bg-ink-100 text-ink-600`}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Indexing</span>;
      case 'PENDING':
        return <span className={`${pill} bg-ink-100 text-ink-600`}><Clock className="h-3.5 w-3.5" /> Queued</span>;
      case 'FAILED':
        return <span className={`${pill} bg-clay-50 text-clay-700`}><AlertCircle className="h-3.5 w-3.5" /> Failed</span>;
    }
  };

  const typeStyle = (type: string) => {
    if (type === 'pdf') return { icon: FileType2, cls: 'bg-clay-50 text-clay-700' };
    if (type === 'csv') return { icon: FileSpreadsheet, cls: 'bg-board-50 text-board-700' };
    if (type === 'docx' || type === 'doc') return { icon: FileText, cls: 'bg-board-50 text-board-600' };
    return { icon: FileText, cls: 'bg-ink-100 text-ink-600' };
  };

  return (
    <div className="space-y-8">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`anim-fade-up relative rounded-lg border-2 border-dashed p-8 text-center transition-colors duration-200 sm:p-10 ${
          isDragging ? 'border-board-500 bg-board-50' : 'border-ink-300 bg-surface hover:border-board-400'
        }`}
        style={{ animationDelay: '400ms' }}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md,.csv" multiple onChange={handleFileChange} className="hidden" id="curriculum-upload" disabled={isUploading} />
        <label htmlFor="curriculum-upload" className="flex cursor-pointer flex-col items-center">
          <span className={`mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-board-800 text-[#f6f2e9]`}>
            {isUploading ? <Loader2 className="h-7 w-7 animate-spin" /> : <UploadCloud className="h-7 w-7" />}
          </span>
          <span className="font-serif text-xl font-semibold text-ink-900">
            {isUploading
              ? batchProgress ? `Reading ${batchProgress.total} documents…` : 'Reading and indexing your document…'
              : isDragging ? 'Drop to add to your course' : 'Drop course materials here'}
          </span>
          <span className="mt-1 text-sm text-ink-500">or <span className="font-semibold text-board-600 underline underline-offset-2">browse files</span> · PDF, Word, text, Markdown or CSV</span>
        </label>

        {uploadSuccess && (
          <div role="status" className="anim-rise mx-auto mt-5 flex max-w-lg items-center justify-center gap-2 rounded-lg bg-board-50 px-4 py-2.5 text-sm text-board-700">
            <Check className="h-4 w-4 shrink-0" /> <span>{uploadSuccess}</span>
          </div>
        )}
        {uploadError && (
          <div role="alert" className="anim-rise mx-auto mt-3 flex max-w-lg items-center justify-center gap-2 rounded-lg bg-clay-50 px-4 py-2.5 text-sm text-clay-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> <span>{uploadError}</span>
          </div>
        )}
      </div>

      <section aria-label="Uploaded materials">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold text-ink-900">
            Uploaded materials <span className="ml-1 rounded-full bg-ink-100 px-2 py-0.5 font-sans text-xs font-semibold text-ink-600">{documents.length}</span>
          </h2>
          <button onClick={onRefresh} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-board-600 transition-colors hover:bg-board-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="space-y-3" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>
        ) : documents.length === 0 ? (
          <div className="card flex flex-col items-center px-6 py-12 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-50 text-ink-400"><Library className="h-7 w-7" /></span>
            <p className="font-serif text-lg font-semibold text-ink-900">Your library is empty</p>
            <p className="mt-1 max-w-sm text-sm text-ink-500">Add your first syllabus, textbook chapter or set of notes above and your students can start learning from it.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {documents.map((doc, i) => {
              const { icon: Icon, cls } = typeStyle(doc.file_type);
              return (
                <li key={doc.id} className="card anim-fade-up flex flex-wrap items-center gap-x-4 gap-y-3 p-4" style={{ animationDelay: `${i * 50}ms` }}>
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${cls}`}><Icon className="h-6 w-6" /></span>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate font-semibold text-ink-900">{doc.filename}</p>
                    <p className="text-xs text-ink-500">
                      {doc.file_type.toUpperCase()} · {formatFileSize(doc.file_size)} · {doc.chunk_count} sections
                    </p>
                    {doc.status === 'FAILED' && doc.error_message && (
                      <p className="mt-1 text-xs text-clay-700">{doc.error_message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {renderStatusBadge(doc.status)}
                    <button
                      onClick={() => triggerUpdate(doc.id)}
                      className="rounded-lg p-2.5 text-ink-400 transition-colors hover:bg-board-50 hover:text-board-600"
                      title="Replace with a new version"
                      aria-label={`Replace ${doc.filename} with a new version`}
                    >
                      <Upload className="h-[18px] w-[18px]" />
                    </button>
                    <button
                      onClick={() => handleDelete(doc.id, doc.filename)}
                      className="rounded-lg p-2.5 text-ink-400 transition-colors hover:bg-clay-50 hover:text-clay-700"
                      title="Delete"
                      aria-label={`Delete ${doc.filename}`}
                    >
                      <Trash2 className="h-[18px] w-[18px]" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <input ref={updateFileInputRef} type="file" accept=".pdf,.docx,.txt,.md,.csv" onChange={handleUpdateFileChange} className="hidden" />
    </div>
  );
};
