import json
import uuid
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from sse_starlette.sse import EventSourceResponse

from app.db.database import get_db
from app.db.models import (
    ChatRequest,
    ChatMessage,
    FeedbackRequest,
    FeedbackResponse,
    SourceReference
)
from app.tutor.engine import tutor_engine
from app.tutor.memory import memory
from app.core.security import anonymize_text

router = APIRouter(prefix="/chat", tags=["chat"])

@router.post("/session/new")
async def create_new_session():
    """Create a new chat session (REQ-UI-04)."""
    session_id = memory.get_or_create_session()
    return {"session_id": session_id}

@router.get("/history/{session_id}")
async def get_session_history(session_id: str):
    """Retrieve chat history for a session (REQ-UI-03)."""
    messages = memory.get_recent_messages(session_id)
    return {"session_id": session_id, "messages": messages}

@router.post("/session/{session_id}/clear")
async def clear_session(session_id: str):
    """Clear chat conversation for active session (REQ-UI-04)."""
    memory.clear_session(session_id)
    return {"status": "success", "message": "Session cleared"}

@router.post("/stream")
async def stream_chat(payload: ChatRequest):
    """
    Stream Socratic AI Tutor response via Server-Sent Events (SSE).
    Guarantees TTFT under 1.5 seconds (PERF-01).
    """
    async def event_generator():
        try:
            async for event in tutor_engine.stream_response(payload.session_id, payload.message):
                yield {
                    "event": "message",
                    "data": json.dumps(event)
                }
        except Exception as e:
            yield {
                "event": "message",
                "data": json.dumps({"type": "error", "message": str(e)})
            }

    return EventSourceResponse(event_generator())

@router.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(payload: FeedbackRequest):
    """Record student feedback (thumbs up / thumbs down) on responses (KPI-4)."""
    fb_id = str(uuid.uuid4())
    anonymized_comment = anonymize_text(payload.comment) if payload.comment else None

    with get_db() as db:
        db.execute(
            """
            INSERT INTO feedback (id, session_id, message_id, rating, comment)
            VALUES (?, ?, ?, ?, ?)
            """,
            (fb_id, payload.session_id, payload.message_id, payload.rating, anonymized_comment)
        )
        db.commit()

    return FeedbackResponse(status="success", message="Thank you for your feedback!")
