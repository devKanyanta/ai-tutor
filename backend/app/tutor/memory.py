import json
import uuid
from typing import List, Dict, Any, Optional
from app.db.database import get_db
from app.core.security import anonymize_text

class ConversationMemory:
    """Session conversation memory buffer with SQLite persistence (REQ-UI-03, REQ-UI-04, SEC-01)."""

    def __init__(self, max_history_turns: int = 10):
        self.max_history_turns = max_history_turns

    def get_or_create_session(self, session_id: Optional[str] = None) -> str:
        """Ensure session exists or create a new session ID."""
        with get_db() as db:
            if session_id:
                row = db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
                if row:
                    return session_id

            new_id = str(uuid.uuid4())
            db.execute("INSERT INTO sessions (id, title) VALUES (?, ?)", (new_id, "New Learning Session"))
            db.commit()
            return new_id

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
            db.commit()
        return msg_id

    def get_recent_messages(self, session_id: str) -> List[Dict[str, Any]]:
        """Retrieve recent conversation history for prompt context injection."""
        with get_db() as db:
            rows = db.execute(
                """
                SELECT rowid, id, role, content, sources, created_at 
                FROM messages 
                WHERE session_id = ? 
                ORDER BY rowid DESC 
                LIMIT ?
                """,
                (session_id, self.max_history_turns * 2)
            ).fetchall()

        messages = []
        for r in reversed(rows):
            sources_val = json.loads(r["sources"]) if r["sources"] else []
            messages.append({
                "rowid": r["rowid"],
                "id": r["id"],
                "role": r["role"],
                "content": r["content"],
                "sources": sources_val,
                "created_at": r["created_at"]
            })
        return messages

    def clear_session(self, session_id: str):
        """Reset conversation history for the session (REQ-UI-04)."""
        with get_db() as db:
            db.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            db.execute("UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?", (session_id,))
            db.commit()

memory = ConversationMemory()
