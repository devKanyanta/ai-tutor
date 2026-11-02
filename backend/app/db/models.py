from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime

class TutorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    subject: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=600)
    instructions: str = Field(default="", max_length=2000)

class TutorUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    subject: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = Field(default=None, max_length=600)
    instructions: Optional[str] = Field(default=None, max_length=2000)

class TutorResponse(BaseModel):
    id: str
    name: str
    subject: str
    description: str
    instructions: str = ""
    document_count: int = 0
    ready_documents: int = 0
    lesson_count: int = 0
    completed_lessons: int = 0
    created_at: str

class NewSessionRequest(BaseModel):
    tutor_id: str = Field(min_length=1, max_length=100)
    fresh: bool = False

class OpenRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=100)

class DocumentResponse(BaseModel):
    id: str
    tutor_id: Optional[str] = None
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

class BatchUploadResponse(BaseModel):
    successful: List[DocumentResponse]
    failed: List[dict]
    total_processed: int

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
    session_id: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=4000)

class FeedbackRequest(BaseModel):
    session_id: str
    message_id: str
    rating: Literal[1, -1]  # thumbs up / thumbs down
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
    avg_turns_per_session: float  # KPI-2: Session Engagement
    deflection_count: int         # KPI-3: Out-of-Bounds Deflection
    feedback_positive: int
    feedback_negative: int
    positive_ratio: float
