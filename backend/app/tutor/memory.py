import json
import uuid
from typing import List, Dict, Any, Optional
from app.db.database import get_db
from app.core.security import anonymize_text

class ConversationMemory:
    """Session conversation memory buffer with SQLite persistence (REQ-UI-03, REQ-UI-04, SEC-01)."""

    def __init__(self, max_history_turns: int = 10):
        self.max_history_turns = max_history_turns

    def get_or_create_session(self, session_id: Optional[str] = None, tutor_id: Optional[str] = None, user_id: Optional[str] = None) -> str:
        """Ensure session exists or create a new session ID. A session belongs to one tutor for life."""
        with get_db() as db:
            if session_id:
                row = db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
                if row:
                    return session_id
                # Insert with the requested session_id if provided
                db.execute("INSERT INTO sessions (id, title, tutor_id, user_id) VALUES (?, ?, ?, ?)", (session_id, "New Learning Session", tutor_id, user_id))
                db.commit()
                return session_id

            new_id = str(uuid.uuid4())
            db.execute("INSERT INTO sessions (id, title, tutor_id, user_id) VALUES (?, ?, ?, ?)", (new_id, "New Learning Session", tutor_id, user_id))
            db.commit()
            return new_id

    def find_active_session(self, user_id: str, tutor_id: str) -> Optional[str]:
        """The student's most recent session with this tutor, so their lesson is always picked back up."""
        with get_db() as db:
            row = db.execute(
                "SELECT id FROM sessions WHERE user_id = ? AND tutor_id = ? ORDER BY last_active DESC, seq DESC LIMIT 1",
                (user_id, tutor_id),
            ).fetchone()
        return row["id"] if row else None

    def get_session_tutor(self, session_id: str) -> Optional[Dict[str, Any]]:
        """The tutor this session belongs to (name, subject, instructions), or None if it has none."""
        with get_db() as db:
            row = db.execute(
                """SELECT t.id, t.name, t.subject, t.description, t.instructions
                   FROM sessions s JOIN tutors t ON t.id = s.tutor_id WHERE s.id = ?""",
                (session_id,),
            ).fetchone()
        return dict(row) if row else None

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        sources: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        """Save a message to the database, anonymizing PII before persisting (SEC-01)."""
        clean_content = anonymize_text(content)
        msg_id = str(uuid.uuid4())
        sources_json = json.dumps(sources) if sources else None

        with get_db() as db:
            db.execute(
                "INSERT INTO messages (id, session_id, role, content, sources) VALUES (?, ?, ?, ?, ?)",
                (msg_id, session_id, role, clean_content, sources_json)
            )
            db.execute(
                "UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?",
                (session_id,)
            )
            if role == "assistant":  # each tutor reply counts against the student's daily trial allowance
                db.execute(
                    "INSERT INTO usage_daily (user_id, day, turns) "
                    "SELECT user_id, CAST((now() AT TIME ZONE 'UTC') AS date), 1 FROM sessions WHERE id = ? AND user_id IS NOT NULL "
                    "ON CONFLICT (user_id, day) DO UPDATE SET turns = usage_daily.turns + 1",
                    (session_id,)
                )
            db.commit()
        return msg_id

    def get_recent_messages(self, session_id: str) -> List[Dict[str, Any]]:
        """Retrieve recent conversation history for prompt context injection."""
        with get_db() as db:
            rows = db.execute(
                """
                SELECT seq, id, role, content, sources, created_at 
                FROM messages 
                WHERE session_id = ? 
                ORDER BY seq DESC 
                LIMIT ?
                """,
                (session_id, self.max_history_turns * 2)
            ).fetchall()

        messages = []
        for r in reversed(rows):
            sources_val = json.loads(r["sources"]) if r["sources"] else []
            messages.append({
                "seq": r["seq"],
                "id": r["id"],
                "role": r["role"],
                "content": r["content"],
                "sources": sources_val,
                "created_at": str(r["created_at"])
            })
        return messages

    def count_user_messages(self, session_id: str) -> int:
        """Total student turns in the session (not capped by the prompt history window)."""
        with get_db() as db:
            row = db.execute(
                "SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND role = 'user'",
                (session_id,)
            ).fetchone()
        return int(row["n"]) if row else 0

    def count_assistant_messages(self, session_id: str) -> int:
        """Total tutor turns saved in the session."""
        with get_db() as db:
            row = db.execute(
                "SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND role = 'assistant'",
                (session_id,)
            ).fetchone()
        return int(row["n"]) if row else 0

    def trailing_user_text(self, session_id: str) -> str:
        """The student's words since the tutor last spoke (voice transcripts arrive in fragments)."""
        parts: List[str] = []
        for message in reversed(self.get_recent_messages(session_id)):
            if message["role"] != "user":
                break
            parts.append(message["content"])
        return " ".join(reversed(parts)).strip()

    def get_session_state(self, session_id: str) -> Dict[str, Any]:
        """Fetch current pedagogical tracking state for this learning session."""
        with get_db() as db:
            row = db.execute(
                "SELECT title, current_topic, lesson_stage, understanding_score FROM sessions WHERE id = ?",
                (session_id,)
            ).fetchone()
            if row:
                return {
                    "title": row["title"],
                    "current_topic": row["current_topic"] or "",
                    "lesson_stage": row["lesson_stage"] or "HOOK",
                    "understanding_score": row["understanding_score"] or 0
                }
            return {
                "title": "New Learning Session",
                "current_topic": "",
                "lesson_stage": "HOOK",
                "understanding_score": 0
            }

    def update_session_state(
        self,
        session_id: str,
        current_topic: Optional[str] = None,
        lesson_stage: Optional[str] = None,
        understanding_score: Optional[int] = None
    ):
        """Update current lesson stage and topic progression."""
        with get_db() as db:
            updates = []
            params = []
            if current_topic is not None:
                updates.append("current_topic = ?")
                params.append(current_topic)
            if lesson_stage is not None:
                updates.append("lesson_stage = ?")
                params.append(lesson_stage)
            if understanding_score is not None:
                updates.append("understanding_score = ?")
                params.append(understanding_score)
            
            if updates:
                params.append(session_id)
                db.execute(
                    f"UPDATE sessions SET {', '.join(updates)}, last_active = CURRENT_TIMESTAMP WHERE id = ?",
                    tuple(params)
                )
                db.commit()

    def clear_session(self, session_id: str):
        """Reset conversation history for the session (REQ-UI-04)."""
        with get_db() as db:
            db.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            db.execute(
                "UPDATE sessions SET current_topic = NULL, lesson_stage = 'INIT', understanding_score = 0, lesson_plan = NULL, lesson_beat = -1, lesson_holds = 0, lesson_marker = -1, lesson_gate = 0, lesson_paused = 0, course_lesson_id = NULL, last_active = CURRENT_TIMESTAMP WHERE id = ?",
                (session_id,)
            )
            db.commit()

memory = ConversationMemory()
