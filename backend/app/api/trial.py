"""The student free trial: create a personal tutor from ONE course file, within the trial limits."""
import asyncio
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.core import auth, trial
from app.core.config import settings
from app.db.database import get_db
from app.ingestion.pipeline import pipeline
from app.tutor import course, manage

router = APIRouter(prefix="/trial", tags=["trial"])

TUTOR_NAME = "Socratic"
ONE_MATERIAL_RULE = (
    "Each tutor teaches one course from one file. To teach something else, create another tutor "
    "so different subjects never get mixed up."
)


def _safe_filename(name: str | None) -> str:
    cleaned = Path((name or "").replace("\\", "/")).name.strip()
    return cleaned or "course-material"


@router.get("/status")
async def trial_status(user: dict = Depends(auth.current_user)):
    """Trial limits, what this student has used, and the notice about the upcoming full release."""
    return {**trial.status_for(user["id"]), "rule": ONE_MATERIAL_RULE}


@router.post("/tutors", status_code=status.HTTP_201_CREATED)
async def create_trial_tutor(
    subject: str = Form(..., min_length=1, max_length=120),
    file: UploadFile = File(...),
    user: dict = Depends(auth.current_user),
):
    """Create the student's own tutor from a single course file. Rejected if it would break a trial limit."""
    # Every tutor is "Socratic"; the subject (required) is what tells your tutors apart.
    name, subject = TUTOR_NAME, re.sub(r"\s+", " ", subject).strip()
    if not subject:
        raise HTTPException(status_code=422, detail="Please enter the subject this tutor will teach.")

    filename = _safe_filename(file.filename)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in manage.ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="That file type isn't supported. Use PDF, Word, TXT, Markdown or CSV.")

    max_bytes = settings.TRIAL_MAX_UPLOAD_MB * 1024 * 1024
    content = await file.read(max_bytes + 1)
    if not content:
        raise HTTPException(status_code=400, detail="That file is empty.")
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"During the trial a course file can be up to {settings.TRIAL_MAX_UPLOAD_MB} MB. Try a smaller file or one chapter at a time.",
        )

    tutor_id, doc_id = str(uuid.uuid4()), str(uuid.uuid4())
    save_path = settings.UPLOAD_DIR / f"{doc_id}_{filename}"
    with get_db() as db:
        # Serialise per student so two quick requests can't both slip under the tutor limit.
        db.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", (user["id"],)).fetchone()
        owned = db.execute("SELECT COUNT(*) AS n FROM tutors WHERE owner_id = ?", (user["id"],)).fetchone()["n"]
        if owned >= settings.TRIAL_MAX_TUTORS:
            raise HTTPException(
                status_code=403,
                detail=f"The free trial allows {settings.TRIAL_MAX_TUTORS} tutors. Delete one to make another.",
            )
        db.execute(
            "INSERT INTO tutors (id, owner_id, name, subject, description) VALUES (?, ?, ?, ?, ?)",
            (tutor_id, user["id"], name, subject, ""),
        )
        db.execute(
            "INSERT INTO documents (id, tutor_id, filename, file_path, file_type, file_size, chunk_count, status) "
            "VALUES (?, ?, ?, ?, ?, ?, 0, 'PENDING')",
            (doc_id, tutor_id, filename, str(save_path), ext, len(content)),
        )
        db.commit()
    save_path.write_bytes(content)

    error = None
    try:
        await asyncio.to_thread(pipeline.process_file, doc_id=doc_id, file_path=save_path, filename=filename, file_type=ext)
    except Exception as exc:  # the pipeline records FAILED itself
        error = str(exc)
    with get_db() as db:
        doc = db.execute("SELECT status, error_message FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if error or not doc or doc["status"] != "READY":
        manage.delete_tutor_data(tutor_id)  # a failed upload must not use up one of the student's tutor slots
        detail = (doc["error_message"] if doc else None) or error or "unknown error"
        raise HTTPException(status_code=422, detail=f"We couldn't read that file: {detail}")

    lessons = course.outline(tutor_id)
    return {"id": tutor_id, "name": name, "subject": subject, "lesson_count": len(lessons), "filename": filename}


@router.delete("/tutors/{tutor_id}")
async def delete_trial_tutor(tutor_id: str, user: dict = Depends(auth.current_user)):
    """Remove one of your own tutors (and its material) to free a slot. Other people's tutors read as not found."""
    with get_db() as db:
        row = db.execute("SELECT 1 FROM tutors WHERE id = ? AND owner_id = ?", (tutor_id, user["id"])).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Tutor not found")
    manage.delete_tutor_data(tutor_id)
    return {"status": "success"}
