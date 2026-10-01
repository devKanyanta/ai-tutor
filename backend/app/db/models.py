from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class DocumentResponse(BaseModel):
    id: str
    filename: str
    file_type: str
    file_size: int
    chunk_count: int
    status: str
    error_message: Optional[str] = None
    created_at: str
    updated_at: str

class DocumentListResponse(BaseModel):
    documents: List[DocumentResponse]
    total_count: int

class AdminLoginRequest(BaseModel):
    password: str

class AdminLoginResponse(BaseModel):
    token: str
    expires_in: int = 86400

class SourceReference(BaseModel):
    document_id: str
    filename: str
    chunk_index: int
    snippet: str
    score: float

class ChatMessage(BaseModel):
    id: Optional[str] = None
    role: str # 'user' | 'assistant'
    content: str
    sources: Optional[List[SourceReference]] = None
    created_at: Optional[str] = None

class ChatRequest(BaseModel):
    session_id: str
    message: str

class FeedbackRequest(BaseModel):
    session_id: str
    message_id: str
    rating: int # 1 or -1
    comment: Optional[str] = None

class FeedbackResponse(BaseModel):
    status: str
    message: str

class MetricsResponse(BaseModel):
    total_documents: int
    total_chunks: int
    ready_documents: int
    total_sessions: int
    total_messages: int
    feedback_positive: int
    feedback_negative: int
    positive_ratio: float
