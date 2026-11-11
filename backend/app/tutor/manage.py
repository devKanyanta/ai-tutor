"""Shared tutor/document housekeeping used by both the instructor studio and the student trial."""
from pathlib import Path

from app.db.database import get_db
from app.rag.vector_store import vector_store

ALLOWED_EXTENSIONS = {"pdf", "txt", "docx", "doc", "md", "markdown", "csv"}


def delete_tutor_data(tutor_id: str) -> None:
    """Remove a tutor with its files, vectors, outline, student sessions and progress."""
    with get_db() as db:
        docs = db.execute("SELECT id, file_path FROM documents WHERE tutor_id = ?", (tutor_id,)).fetchall()
        for doc in docs:
            try:
                Path(doc["file_path"]).unlink(missing_ok=True)
            except OSError:
                pass
            vector_store.delete_document(doc["id"])
        # Chunks, lessons, progress, documents, sessions, messages, feedback and deflections all cascade from the tutor.
        db.execute("DELETE FROM tutors WHERE id = ?", (tutor_id,))
        db.commit()
