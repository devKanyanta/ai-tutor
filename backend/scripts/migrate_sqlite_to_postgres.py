"""Copy an existing SQLite database (the old backend/data/tutor.db) into PostgreSQL.

    cd backend
    DATABASE_URL=postgresql+psycopg://user:pass@host/ai_tutor python scripts/migrate_sqlite_to_postgres.py data/tutor.db

Safe to re-run: rows already in PostgreSQL are skipped. Rows that point at something that no longer exists are
dropped, and documents/sessions from before multi-tutor support are adopted by one "General Tutor" like before.
The vector index (data/vector_store) is not in the database and needs no migration.
"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.database import get_db, init_db  # noqa: E402

LEGACY_TUTOR_ID = "general-tutor"
# (table, primary-key columns); order respects foreign keys. SQLite rowid keeps insertion order for `seq`.
TABLES = [
    ("users", "id"), ("auth_tokens", "token_hash"), ("tutors", "id"), ("documents", "id"), ("chunks", "id"),
    ("course_lessons", "id"), ("lesson_progress", "user_id, lesson_id"), ("sessions", "id"), ("messages", "id"),
    ("feedback", "id"), ("deflections", "id"),
]


def main(path: str) -> None:
    init_db()
    src = sqlite3.connect(path)
    src.row_factory = sqlite3.Row
    existing = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    ids: dict[str, set] = {}

    with get_db() as db:
        db.execute("SET TIME ZONE 'UTC'")
        adopted = False
        for table, pk in TABLES:
            if table not in existing:
                continue
            with get_db() as probe:
                target_columns = {r["column_name"] for r in probe.execute(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = ?", (table,))}
            rows = src.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
            columns = [c for c in rows[0].keys() if c in target_columns] if rows else []
            kept = skipped = 0

            if table == "tutors" and not adopted:
                orphan_docs = src.execute("SELECT COUNT(*) FROM documents WHERE tutor_id IS NULL").fetchone()[0] if "documents" in existing else 0
                orphan_sessions = src.execute(
                    "SELECT COUNT(*) FROM sessions WHERE tutor_id IS NULL AND EXISTS (SELECT 1 FROM messages WHERE session_id = sessions.id)"
                ).fetchone()[0] if {"sessions", "messages"} <= existing else 0
                if orphan_docs or orphan_sessions:
                    adopted = True
                    db.execute(
                        "INSERT INTO tutors (id, name, subject, description) VALUES (?, 'General Tutor', 'All course materials', "
                        "'Your original course library, from before tutors were split by subject.') ON CONFLICT DO NOTHING",
                        (LEGACY_TUTOR_ID,),
                    )
                    ids.setdefault("tutors", set()).add(LEGACY_TUTOR_ID)

            for row in rows:
                data = {c: row[c] for c in columns}
                if table == "documents" and not data.get("tutor_id"):
                    data["tutor_id"] = LEGACY_TUTOR_ID
                if table == "sessions" and not data.get("tutor_id") and src.execute(
                        "SELECT 1 FROM messages WHERE session_id = ?", (data["id"],)).fetchone():
                    data["tutor_id"] = LEGACY_TUTOR_ID
                if not _references_exist(table, data, ids):
                    skipped += 1
                    continue
                marks = ", ".join("?" for _ in columns)
                db.execute(
                    f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({marks}) ON CONFLICT ({pk}) DO NOTHING",
                    tuple(data[c] for c in columns),
                )
                key = data.get("id")
                if key is not None:
                    ids.setdefault(table, set()).add(key)
                kept += 1
            print(f"{table:16} copied {kept:6}  dropped {skipped}")
        db.commit()
    print("Done.")


def _references_exist(table: str, data: dict, ids: dict[str, set]) -> bool:
    def known(parent: str, value) -> bool:
        return value is None or value in ids.get(parent, set())

    checks = {
        "auth_tokens": [("users", "user_id")],
        "tutors": [("users", "owner_id")],
        "documents": [("tutors", "tutor_id")],
        "chunks": [("documents", "document_id")],
        "course_lessons": [("tutors", "tutor_id"), ("documents", "document_id")],
        "lesson_progress": [("users", "user_id"), ("course_lessons", "lesson_id")],
        "sessions": [("tutors", "tutor_id"), ("users", "user_id")],
        "messages": [("sessions", "session_id")],
        "feedback": [("sessions", "session_id")],
        "deflections": [("sessions", "session_id")],
    }
    return all(known(parent, data.get(column)) for parent, column in checks.get(table, []))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
