"""
Course outline and student progress.

A tutor's outline is an ordered list of lessons built from its documents: one lesson per document,
or several parts for a long document (PART_CHUNKS chunks each). Instructors can rename and reorder them.
Progress is stored per student and lesson, so it follows the student across sessions and devices.
"""
import math
import re
import uuid
from typing import Any, Dict, List, Optional

from app.db.database import get_db

PART_CHUNKS = 6


def _title_from_filename(name: str) -> str:
    base = re.sub(r"\.[A-Za-z0-9]+$", "", name or "")
    base = re.sub(r"[_\-]+", " ", base).strip()
    return (base[:80] or "Lesson")


def sync_outline(tutor_id: str) -> None:
    """Bring the outline in line with the tutor's documents, keeping order, custom titles and progress."""
    with get_db() as db:
        docs = db.execute(
            "SELECT id, filename, chunk_count FROM documents WHERE tutor_id = ? AND status = 'READY' AND chunk_count > 0 "
            "ORDER BY created_at, rowid",
            (tutor_id,),
        ).fetchall()
        existing = db.execute("SELECT * FROM course_lessons WHERE tutor_id = ? ORDER BY position", (tutor_id,)).fetchall()
        live_docs = {r["id"] for r in db.execute("SELECT id FROM documents WHERE tutor_id = ?", (tutor_id,))}
        by_key = {(r["document_id"], r["part"]): r for r in existing}
        wanted = set()
        next_position = max((r["position"] for r in existing), default=0)

        for doc in docs:
            parts = max(1, math.ceil(doc["chunk_count"] / PART_CHUNKS))
            for part in range(parts):
                start, end = part * PART_CHUNKS, min((part + 1) * PART_CHUNKS, doc["chunk_count"])
                title = _title_from_filename(doc["filename"]) + (f" (part {part + 1} of {parts})" if parts > 1 else "")
                wanted.add((doc["id"], part))
                row = by_key.get((doc["id"], part))
                if row:
                    db.execute(
                        "UPDATE course_lessons SET chunk_start = ?, chunk_end = ?, title = CASE WHEN title_custom = 1 THEN title ELSE ? END WHERE id = ?",
                        (start, end, title, row["id"]),
                    )
                else:
                    next_position += 1
                    db.execute(
                        "INSERT INTO course_lessons (id, tutor_id, document_id, part, chunk_start, chunk_end, position, title) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (str(uuid.uuid4()), tutor_id, doc["id"], part, start, end, next_position, title),
                    )

        ready_docs = {d["id"] for d in docs}
        for row in existing:
            gone = row["document_id"] not in live_docs
            # A document that is re-indexing right now is not READY; keep its lessons (and progress) meanwhile.
            shrunk = row["document_id"] in ready_docs and (row["document_id"], row["part"]) not in wanted
            if gone or shrunk:
                db.execute("DELETE FROM lesson_progress WHERE lesson_id = ?", (row["id"],))
                db.execute("DELETE FROM course_lessons WHERE id = ?", (row["id"],))

        for position, row in enumerate(db.execute("SELECT id FROM course_lessons WHERE tutor_id = ? ORDER BY position, rowid", (tutor_id,)).fetchall(), 1):
            db.execute("UPDATE course_lessons SET position = ? WHERE id = ?", (position, row["id"]))
        db.commit()


def outline(tutor_id: str, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Ordered lessons; with a user, each carries that student's status."""
    sync_outline(tutor_id)
    with get_db() as db:
        rows = db.execute("SELECT id, position, title FROM course_lessons WHERE tutor_id = ? ORDER BY position", (tutor_id,)).fetchall()
        status = {}
        if user_id:
            status = {
                r["lesson_id"]: r["status"]
                for r in db.execute(
                    "SELECT lesson_id, status FROM lesson_progress WHERE user_id = ? AND lesson_id IN "
                    "(SELECT id FROM course_lessons WHERE tutor_id = ?)",
                    (user_id, tutor_id),
                )
            }
    return [
        {"id": r["id"], "position": r["position"], "title": r["title"], "status": status.get(r["id"], "not_started")}
        for r in rows
    ]


def summary(tutor_id: str, user_id: str) -> Dict[str, int]:
    lessons = outline(tutor_id, user_id)
    return {"total": len(lessons), "completed": sum(1 for l in lessons if l["status"] == "completed")}


def next_lesson(tutor_id: str, user_id: str, after_position: int = 0) -> Optional[Dict[str, Any]]:
    """The first lesson the student has not completed (after the given position, if any)."""
    for lesson in outline(tutor_id, user_id):
        if lesson["position"] > after_position and lesson["status"] != "completed":
            return lesson
    return None


def lesson_chunks(lesson_id: str) -> List[Dict[str, Any]]:
    with get_db() as db:
        lesson = db.execute("SELECT * FROM course_lessons WHERE id = ?", (lesson_id,)).fetchone()
        if not lesson:
            return []
        rows = db.execute(
            "SELECT c.chunk_index, c.content, c.document_id, d.filename FROM chunks c JOIN documents d ON d.id = c.document_id "
            "WHERE c.document_id = ? AND c.chunk_index >= ? AND c.chunk_index < ? ORDER BY c.chunk_index",
            (lesson["document_id"], lesson["chunk_start"], lesson["chunk_end"]),
        ).fetchall()
    return [
        {**dict(r), "snippet": r["content"][:200], "score": 1.0}
        for r in rows
    ]


# --------------------------------------------------------------------------- progress
def _set_status(user_id: str, lesson_id: str, status: str) -> None:
    with get_db() as db:
        if status == "completed":
            db.execute(
                "INSERT INTO lesson_progress (user_id, lesson_id, status, completed_at) VALUES (?, ?, 'completed', CURRENT_TIMESTAMP) "
                "ON CONFLICT (user_id, lesson_id) DO UPDATE SET status = 'completed', "
                "completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP",
                (user_id, lesson_id),
            )
        else:  # never downgrade a finished lesson
            db.execute(
                "INSERT INTO lesson_progress (user_id, lesson_id, status) VALUES (?, ?, 'in_progress') "
                "ON CONFLICT (user_id, lesson_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP",
                (user_id, lesson_id),
            )
        db.commit()


def session_info(session_id: str) -> Optional[Dict[str, Any]]:
    """Who and what a session belongs to: user, tutor and the course lesson in progress."""
    with get_db() as db:
        row = db.execute(
            """SELECT s.user_id, s.tutor_id, s.course_lesson_id, u.name AS user_name, t.name AS tutor_name
               FROM sessions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN tutors t ON t.id = s.tutor_id
               WHERE s.id = ?""",
            (session_id,),
        ).fetchone()
    return dict(row) if row else None


def set_session_lesson(session_id: str, lesson_id: Optional[str]) -> None:
    with get_db() as db:
        db.execute("UPDATE sessions SET course_lesson_id = ? WHERE id = ?", (lesson_id, session_id))
        db.commit()
    info = session_info(session_id)
    if lesson_id and info and info["user_id"]:
        _set_status(info["user_id"], lesson_id, "in_progress")


def mark_session_lesson_complete(session_id: str) -> None:
    info = session_info(session_id)
    if info and info["user_id"] and info["course_lesson_id"]:
        _set_status(info["user_id"], info["course_lesson_id"], "completed")


def session_course(session_id: str) -> Optional[Dict[str, Any]]:
    """Where this session's student is in the course, for the UI and for directives."""
    info = session_info(session_id)
    if not info or not info["tutor_id"] or not info["user_id"]:
        return None
    lessons = outline(info["tutor_id"], info["user_id"])
    if not lessons:
        return None
    current = next((l for l in lessons if l["id"] == info["course_lesson_id"]), None)
    following = None
    if current:
        following = next((l for l in lessons if l["position"] > current["position"]), None)
    return {
        "total": len(lessons),
        "completed": sum(1 for l in lessons if l["status"] == "completed"),
        "current": current,
        "next": following,
        "lessons": lessons,
    }
