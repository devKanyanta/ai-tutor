import os
import shutil
import uuid
from pathlib import Path
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status

from app.core.config import settings
from app.core.security import verify_admin_token
from app.db.database import get_db
from app.db.models import (
    AdminLoginRequest,
    AdminLoginResponse,
    DocumentResponse,
    DocumentListResponse,
    MetricsResponse
)
from app.ingestion.pipeline import pipeline
from app.rag.vector_store import vector_store

router = APIRouter(prefix="/admin", tags=["admin"])

@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(payload: AdminLoginRequest):
    """Authenticate administrator account (SEC-02)."""
    if payload.password == settings.ADMIN_PASSWORD:
        return AdminLoginResponse(token=settings.ADMIN_TOKEN)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect admin password"
    )

@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(authorized: bool = Depends(verify_admin_token)):
    """List all curriculum documents and their indexing status (REQ-IN-03, REQ-IN-04)."""
    with get_db() as db:
        rows = db.execute("SELECT * FROM documents ORDER BY created_at DESC").fetchall()
        docs = [
            DocumentResponse(
                id=r["id"],
                filename=r["filename"],
                file_type=r["file_type"],
                file_size=r["file_size"],
                chunk_count=r["chunk_count"],
                status=r["status"],
                error_message=r["error_message"],
                created_at=str(r["created_at"]),
                updated_at=str(r["updated_at"])
            )
            for r in rows
        ]
    return DocumentListResponse(documents=docs, total_count=len(docs))

@router.post("/documents/upload", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    authorized: bool = Depends(verify_admin_token)
):
    """
    Upload and index curriculum material: PDF, TXT, DOCX, MD, CSV (REQ-IN-01..04).
    """
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
            INSERT INTO documents (id, filename, file_path, file_type, file_size, chunk_count, status)
            VALUES (?, ?, ?, ?, ?, 0, 'PENDING')
            """,
            (doc_id, file.filename, str(save_path), ext, file_size)
        )
        db.commit()

    # Process and index document
    try:
        pipeline.process_file(
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
        return DocumentResponse(
            id=r["id"],
            filename=r["filename"],
            file_type=r["file_type"],
            file_size=r["file_size"],
            chunk_count=r["chunk_count"],
            status=r["status"],
            error_message=r["error_message"],
            created_at=str(r["created_at"]),
            updated_at=str(r["updated_at"])
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
        pipeline.process_file(
            doc_id=doc_id,
            file_path=save_path,
            filename=file.filename,
            file_type=ext
        )
    except Exception as e:
        pass

    with get_db() as db:
        r = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return DocumentResponse(
            id=r["id"],
            filename=r["filename"],
            file_type=r["file_type"],
            file_size=r["file_size"],
            chunk_count=r["chunk_count"],
            status=r["status"],
            error_message=r["error_message"],
            created_at=str(r["created_at"]),
            updated_at=str(r["updated_at"])
        )

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
async def get_metrics(authorized: bool = Depends(verify_admin_token)):
    """Summary metrics of knowledge base and student interactions (KPIs)."""
    with get_db() as db:
        total_docs = db.execute("SELECT COUNT(*) as c FROM documents").fetchone()["c"]
        ready_docs = db.execute("SELECT COUNT(*) as c FROM documents WHERE status = 'READY'").fetchone()["c"]
        total_chunks = db.execute("SELECT COUNT(*) as c FROM chunks").fetchone()["c"]
        total_sessions = db.execute("SELECT COUNT(*) as c FROM sessions").fetchone()["c"]
        total_messages = db.execute("SELECT COUNT(*) as c FROM messages").fetchone()["c"]
        
        # KPI-2: Session Engagement (Average turns / messages per session)
        avg_turns = round(float(total_messages) / float(total_sessions), 1) if total_sessions > 0 else 0.0

        # KPI-3: Out-of-Bounds Deflection Count
        deflection_row = db.execute("SELECT COUNT(*) as c FROM deflections").fetchone()
        deflection_count = deflection_row["c"] if deflection_row else 0

        pos_feedback = db.execute("SELECT COUNT(*) as c FROM feedback WHERE rating > 0").fetchone()["c"]
        neg_feedback = db.execute("SELECT COUNT(*) as c FROM feedback WHERE rating < 0").fetchone()["c"]
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
