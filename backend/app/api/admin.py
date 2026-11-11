import asyncio
import os
import shutil
import uuid
from pathlib import Path
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status

from app.core.config import settings
from app.core.security import verify_admin_token
from app.db.database import get_db
from app.db.models import (
    AdminLoginRequest,
    AdminLoginResponse,
    DocumentResponse,
    DocumentListResponse,
    BatchUploadResponse,
    MetricsResponse,
    TutorCreate,
    TutorUpdate,
    TutorResponse,
)
from app.ingestion.pipeline import pipeline
from app.tutor import course, manage
from pydantic import BaseModel, Field
from app.rag.vector_store import vector_store

router = APIRouter(prefix="/admin", tags=["admin"])

def _safe_filename(name: str | None) -> str:
    """Strip any directory components so uploads can't escape UPLOAD_DIR."""
    cleaned = Path((name or "").replace("\\", "/")).name.strip()
    return cleaned or "unknown"

@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(payload: AdminLoginRequest):
    """Authenticate administrator account (SEC-02)."""
    if payload.password == settings.ADMIN_PASSWORD:
        return AdminLoginResponse(token=settings.ADMIN_TOKEN)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect admin password"
    )


def _doc_response(r) -> DocumentResponse:
    return DocumentResponse(
        id=r["id"],
        tutor_id=r["tutor_id"],
        filename=r["filename"],
        file_type=r["file_type"],
        file_size=r["file_size"],
        chunk_count=r["chunk_count"],
        status=r["status"],
        error_message=r["error_message"],
        created_at=str(r["created_at"]),
        updated_at=str(r["updated_at"]),
    )

def _require_tutor(tutor_id: str):
    with get_db() as db:
        row = db.execute("SELECT * FROM tutors WHERE id = ?", (tutor_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tutor not found")
    return row

def _tutor_response(r, db) -> TutorResponse:
    counts = db.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END), 0) AS ready FROM documents WHERE tutor_id = ?",
        (r["id"],),
    ).fetchone()
    return TutorResponse(
        id=r["id"], name=r["name"], subject=r["subject"], description=r["description"],
        instructions=r["instructions"], document_count=counts["n"], ready_documents=counts["ready"],
        created_at=str(r["created_at"]),
    )

@router.get("/tutors", response_model=List[TutorResponse])
async def list_admin_tutors(authorized: bool = Depends(verify_admin_token)):
    """All tutors with their private instructions."""
    with get_db() as db:
        rows = db.execute("SELECT * FROM tutors ORDER BY created_at DESC, name").fetchall()
        return [_tutor_response(r, db) for r in rows]

@router.post("/tutors", response_model=TutorResponse, status_code=status.HTTP_201_CREATED)
async def create_tutor(payload: TutorCreate, authorized: bool = Depends(verify_admin_token)):
    """Create a specialised tutor with its own, separate curriculum."""
    tutor_id = str(uuid.uuid4())
    with get_db() as db:
        db.execute(
            "INSERT INTO tutors (id, name, subject, description, instructions) VALUES (?, ?, ?, ?, ?)",
            (tutor_id, payload.name.strip(), payload.subject.strip(), payload.description.strip(), payload.instructions.strip()),
        )
        db.commit()
        return _tutor_response(db.execute("SELECT * FROM tutors WHERE id = ?", (tutor_id,)).fetchone(), db)

@router.put("/tutors/{tutor_id}", response_model=TutorResponse)
async def update_tutor(tutor_id: str, payload: TutorUpdate, authorized: bool = Depends(verify_admin_token)):
    _require_tutor(tutor_id)
    changes = {k: v.strip() for k, v in payload.model_dump(exclude_none=True).items()}
    if "name" in changes and not changes["name"]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name cannot be empty")
    with get_db() as db:
        if changes:
            assignments = ", ".join(f"{column} = ?" for column in changes)  # column names come from the model, not the client
            db.execute(
                f"UPDATE tutors SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (*changes.values(), tutor_id),
            )
            db.commit()
        return _tutor_response(db.execute("SELECT * FROM tutors WHERE id = ?", (tutor_id,)).fetchone(), db)

class LessonOrderItem(BaseModel):
    id: str
    title: str = Field(min_length=1, max_length=120)

class LessonOrder(BaseModel):
    lessons: List[LessonOrderItem]

@router.get("/tutors/{tutor_id}/lessons")
async def get_tutor_lessons(tutor_id: str, authorized: bool = Depends(verify_admin_token)):
    """The course outline students will work through, in order."""
    _require_tutor(tutor_id)
    return {"lessons": course.outline(tutor_id)}

@router.put("/tutors/{tutor_id}/lessons")
async def set_tutor_lessons(tutor_id: str, payload: LessonOrder, authorized: bool = Depends(verify_admin_token)):
    """Reorder and/or rename lessons. The list must contain every lesson of this tutor exactly once."""
    _require_tutor(tutor_id)
    current = {l["id"]: l for l in course.outline(tutor_id)}
    ids = [item.id for item in payload.lessons]
    if sorted(ids) != sorted(current):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Send every lesson exactly once.")
    with get_db() as db:
        for position, item in enumerate(payload.lessons, 1):
            title = item.title.strip()
            custom = int(title != current[item.id]["title"]) 
            db.execute(
                "UPDATE course_lessons SET position = ?, title = ?, title_custom = CASE WHEN ? = 1 THEN 1 ELSE title_custom END WHERE id = ?",
                (position, title, custom, item.id),
            )
        db.commit()
    return {"lessons": course.outline(tutor_id)}

@router.delete("/tutors/{tutor_id}")
async def delete_tutor(tutor_id: str, authorized: bool = Depends(verify_admin_token)):
    """Delete a tutor together with its documents, vectors and student sessions."""
    tutor = _require_tutor(tutor_id)
    manage.delete_tutor_data(tutor_id)
    return {"status": "success", "message": f"Tutor '{tutor['name']}' and its materials were deleted."}

@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(
    tutor_id: str | None = Query(default=None),
    authorized: bool = Depends(verify_admin_token),
):
    """List curriculum documents (optionally just one tutor's) and their indexing status (REQ-IN-03, REQ-IN-04)."""
    with get_db() as db:
        if tutor_id:
            rows = db.execute("SELECT * FROM documents WHERE tutor_id = ? ORDER BY created_at DESC", (tutor_id,)).fetchall()
        else:
            rows = db.execute("SELECT * FROM documents ORDER BY created_at DESC").fetchall()
        docs = [_doc_response(r) for r in rows]
    return DocumentListResponse(documents=docs, total_count=len(docs))

@router.post("/documents/upload", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    tutor_id: str = Form(...),
    authorized: bool = Depends(verify_admin_token)
):
    """
    Upload and index curriculum material: PDF, TXT, DOCX, MD, CSV (REQ-IN-01..04).
    """
    _require_tutor(tutor_id)
    file.filename = _safe_filename(file.filename)
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else ""
    allowed_exts = {"pdf", "txt", "docx", "doc", "md", "markdown", "csv"}
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File extension '.{ext}' is not supported. Allowed formats: PDF, TXT, DOCX, MD, CSV."
        )

    doc_id = str(uuid.uuid4())
    save_filename = f"{doc_id}_{file.filename}"
    save_path = settings.UPLOAD_DIR / save_filename

    # Save uploaded file
    try:
        content = await file.read()
        file_size = len(content)
        with open(save_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save file: {str(e)}"
        )

    # Insert pending record in SQLite
    with get_db() as db:
        db.execute(
            """
            INSERT INTO documents (id, tutor_id, filename, file_path, file_type, file_size, chunk_count, status)
            VALUES (?, ?, ?, ?, ?, ?, 0, 'PENDING')
            """,
            (doc_id, tutor_id, file.filename, str(save_path), ext, file_size)
        )
        db.commit()

    # Process and index document
    try:
        await asyncio.to_thread(
            pipeline.process_file,
            doc_id=doc_id,
            file_path=save_path,
            filename=file.filename,
            file_type=ext
        )
    except Exception as e:
        # Document status is set to FAILED by pipeline
        pass

    with get_db() as db:
        r = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return _doc_response(r)

@router.post("/documents/batch-upload", response_model=BatchUploadResponse)
async def batch_upload_documents(
    files: List[UploadFile] = File(...),
    tutor_id: str = Form(...),
    authorized: bool = Depends(verify_admin_token)
):
    """
    Batch upload multiple curriculum documents simultaneously.
    Parses and indexes each document, reporting successful and failed items.
    """
    _require_tutor(tutor_id)
    allowed_exts = {"pdf", "txt", "docx", "doc", "md", "markdown", "csv"}
    successful: List[DocumentResponse] = []
    failed: List[dict] = []

    for file in files:
        filename = _safe_filename(file.filename)
        ext = filename.split(".")[-1].lower() if "." in filename else ""
        if ext not in allowed_exts:
            failed.append({
                "filename": filename,
                "error": f"Unsupported extension '.{ext}'. Allowed: PDF, TXT, DOCX, MD, CSV."
            })
            continue

        doc_id = str(uuid.uuid4())
        save_filename = f"{doc_id}_{filename}"
        save_path = settings.UPLOAD_DIR / save_filename

        try:
            content = await file.read()
            file_size = len(content)
            with open(save_path, "wb") as f:
                f.write(content)

            with get_db() as db:
                db.execute(
                    """
                    INSERT INTO documents (id, tutor_id, filename, file_path, file_type, file_size, chunk_count, status)
                    VALUES (?, ?, ?, ?, ?, ?, 0, 'PENDING')
                    """,
                    (doc_id, tutor_id, filename, str(save_path), ext, file_size)
                )
                db.commit()

            await asyncio.to_thread(
                pipeline.process_file,
                doc_id=doc_id,
                file_path=save_path,
                filename=filename,
                file_type=ext
            )

            with get_db() as db:
                r = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
                successful.append(_doc_response(r))
        except Exception as e:
            failed.append({
                "filename": filename,
                "error": str(e)
            })

    return BatchUploadResponse(
        successful=successful,
        failed=failed,
        total_processed=len(files)
    )

@router.put("/documents/{doc_id}", response_model=DocumentResponse)
async def update_document(
    doc_id: str,
    file: UploadFile = File(...),
    authorized: bool = Depends(verify_admin_token)
):
    """
    Update/refresh an existing curriculum document with a new revision (REQ-IN-03).
    Re-parses, re-chunks, and updates the vector store without changing document ID.
    """
    file.filename = _safe_filename(file.filename)
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else ""
    allowed_exts = {"pdf", "txt", "docx", "doc", "md", "markdown", "csv"}
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File extension '.{ext}' is not supported. Allowed formats: PDF, TXT, DOCX, MD, CSV."
        )

    with get_db() as db:
        existing = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    save_filename = f"{doc_id}_{file.filename}"
    save_path = settings.UPLOAD_DIR / save_filename

    # Save new file content
    try:
        content = await file.read()
        file_size = len(content)
        with open(save_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save replacement file: {str(e)}"
        )

    # Clean old chunks from database and purge from vector store
    vector_store.delete_document(doc_id)
    with get_db() as db:
        db.execute("DELETE FROM chunks WHERE document_id = ?", (doc_id,))
        db.execute(
            """
            UPDATE documents 
            SET filename = ?, file_path = ?, file_type = ?, file_size = ?, status = 'PENDING', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (file.filename, str(save_path), ext, file_size, doc_id)
        )
        db.commit()

    # Re-index through pipeline
    try:
        await asyncio.to_thread(
            pipeline.process_file,
            doc_id=doc_id,
            file_path=save_path,
            filename=file.filename,
            file_type=ext
        )
    except Exception as e:
        pass

    with get_db() as db:
        r = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return _doc_response(r)

@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, authorized: bool = Depends(verify_admin_token)):
    """Delete a document and purge its vectors from index (REQ-IN-03)."""
    with get_db() as db:
        doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if not doc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

        # Remove physical file if exists
        try:
            p = Path(doc["file_path"])
            if p.exists():
                p.unlink()
        except Exception:
            pass

        # Remove from vector store
        vector_store.delete_document(doc_id)

        # Delete database records (chunks cascade deleted via foreign key)
        db.execute("DELETE FROM chunks WHERE document_id = ?", (doc_id,))
        db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        db.commit()

    return {"status": "success", "message": f"Document '{doc['filename']}' deleted successfully."}

@router.get("/metrics", response_model=MetricsResponse)
async def get_metrics(tutor_id: str | None = Query(default=None), authorized: bool = Depends(verify_admin_token)):
    """Summary metrics of knowledge base and student interactions (KPIs)."""
    # Optional per-tutor scope: every figure is restricted to that tutor's documents and sessions.
    doc_where, ses_where = ("", "")
    args: tuple = ()
    if tutor_id:
        doc_where, ses_where, args = " WHERE tutor_id = ?", " WHERE tutor_id = ?", (tutor_id,)
    ses_ids = f"(SELECT id FROM sessions{ses_where})"
    ready_clause = " AND status = 'READY'" if doc_where else " WHERE status = 'READY'"
    with get_db() as db:
        def count(sql: str, params: tuple = ()) -> int:
            return db.execute(sql, params).fetchone()["c"]

        total_docs = count(f"SELECT COUNT(*) AS c FROM documents{doc_where}", args)
        ready_docs = count(f"SELECT COUNT(*) AS c FROM documents{doc_where}{ready_clause}", args)
        total_chunks = count(f"SELECT COUNT(*) AS c FROM chunks WHERE document_id IN (SELECT id FROM documents{doc_where})", args)
        total_sessions = count(f"SELECT COUNT(*) AS c FROM sessions{ses_where}", args)
        total_messages = count(f"SELECT COUNT(*) AS c FROM messages WHERE session_id IN {ses_ids}", args)

        # KPI-2: Session Engagement (Average turns / messages per session)
        # Only sessions with at least one message count (every page load creates a session).
        active_sessions = count(f"SELECT COUNT(DISTINCT session_id) AS c FROM messages WHERE session_id IN {ses_ids}", args)
        avg_turns = round(float(total_messages) / float(active_sessions), 1) if active_sessions > 0 else 0.0

        # KPI-3: Out-of-Bounds Deflection Count
        deflection_count = count(f"SELECT COUNT(*) AS c FROM deflections WHERE session_id IN {ses_ids}", args)

        pos_feedback = count(f"SELECT COUNT(*) AS c FROM feedback WHERE rating > 0 AND session_id IN {ses_ids}", args)
        neg_feedback = count(f"SELECT COUNT(*) AS c FROM feedback WHERE rating < 0 AND session_id IN {ses_ids}", args)
        total_fb = pos_feedback + neg_feedback
        pos_ratio = (pos_feedback / total_fb) if total_fb > 0 else 1.0

    return MetricsResponse(
        total_documents=total_docs,
        total_chunks=total_chunks,
        ready_documents=ready_docs,
        total_sessions=total_sessions,
        total_messages=total_messages,
        avg_turns_per_session=avg_turns,
        deflection_count=deflection_count,
        feedback_positive=pos_feedback,
        feedback_negative=neg_feedback,
        positive_ratio=round(pos_ratio, 2)
    )
