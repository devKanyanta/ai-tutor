import sqlite3
from pathlib import Path
from contextlib import contextmanager
from app.core.config import settings

def init_db():
    """Initialize SQLite database schema."""
    conn = sqlite3.connect(settings.DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    cursor = conn.cursor()
    
    # Tutors: each instructor-created tutor owns its own curriculum, so subjects never mix.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tutors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '', -- optional teaching-style guidance from the instructor
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Student accounts. Passwords are salted scrypt hashes; tokens are stored only as SHA-256 digests.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS auth_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
    """)

    # A tutor's ordered course outline (built from its documents) and each student's progress through it.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS course_lessons (
        id TEXT PRIMARY KEY,
        tutor_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        part INTEGER NOT NULL DEFAULT 0,
        chunk_start INTEGER NOT NULL DEFAULT 0,
        chunk_end INTEGER NOT NULL DEFAULT 0, -- exclusive
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        title_custom INTEGER NOT NULL DEFAULT 0
    );
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_course_lessons_tutor ON course_lessons (tutor_id, position)")
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS lesson_progress (
        user_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        status TEXT NOT NULL, -- in_progress, completed
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        PRIMARY KEY (user_id, lesson_id)
    );
    """)

    # Documents table (REQ-IN-03, REQ-IN-04)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        chunk_count INTEGER DEFAULT 0,
        status TEXT NOT NULL, -- PENDING, INDEXING, READY, FAILED
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # Document Chunks table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
    );
    """)

    # Chat Sessions & Messages (REQ-UI-03, SEC-01)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        current_topic TEXT,
        lesson_stage TEXT DEFAULT 'INIT', -- INIT, HOOK, CONCEPT, REAL_WORLD_EXAMPLE, CHECK_UNDERSTANDING, SYNTHESIS
        understanding_score INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Multi-tutor ownership (added after the first release)
    for table, column in (
        ("documents", "tutor_id TEXT"),
        ("sessions", "tutor_id TEXT"),
        ("sessions", "user_id TEXT"),
        ("sessions", "course_lesson_id TEXT"),
    ):
        try:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column}")
        except Exception:
            pass
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, tutor_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_documents_tutor ON documents (tutor_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_tutor ON sessions (tutor_id)")

    # Ensure columns exist if table was already created
    try:
        cursor.execute("ALTER TABLE sessions ADD COLUMN current_topic TEXT")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE sessions ADD COLUMN lesson_stage TEXT DEFAULT 'INIT'")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE sessions ADD COLUMN understanding_score INTEGER DEFAULT 0")
    except Exception:
        pass

    # Lesson flow state (see app/tutor/lesson.py)
    for column in (
        "lesson_plan TEXT",
        "lesson_beat INTEGER DEFAULT -1",
        "lesson_holds INTEGER DEFAULT 0",
        "lesson_marker INTEGER DEFAULT -1",
        "lesson_gate INTEGER DEFAULT 0",
    ):
        try:
            cursor.execute(f"ALTER TABLE sessions ADD COLUMN {column}")
        except Exception:
            pass

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL, -- user, assistant
        content TEXT NOT NULL,
        sources TEXT, -- JSON array of source references
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
    );
    """)

    # Student Feedback table (KPI-4)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        rating INTEGER NOT NULL, -- 1 for thumbs up, -1 for thumbs down
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Deflection logs table (KPI-3: Out-of-Bounds Deflection tracking)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS deflections (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        query TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    conn.commit()
    _adopt_legacy_content(conn)
    conn.close()


DEFAULT_TUTOR_ID = "general-tutor"


def _adopt_legacy_content(conn: sqlite3.Connection) -> None:
    """Content from before multi-tutor support goes to one default tutor so nothing is lost."""
    orphans = conn.execute(
        "SELECT (SELECT COUNT(*) FROM documents WHERE tutor_id IS NULL) + "
        "(SELECT COUNT(*) FROM sessions WHERE tutor_id IS NULL AND EXISTS (SELECT 1 FROM messages WHERE session_id = sessions.id))"
    ).fetchone()[0]
    if not orphans:
        return
    conn.execute(
        "INSERT OR IGNORE INTO tutors (id, name, subject, description) VALUES (?, ?, ?, ?)",
        (DEFAULT_TUTOR_ID, "General Tutor", "All course materials",
         "Your original course library, from before tutors were split by subject."),
    )
    conn.execute("UPDATE documents SET tutor_id = ? WHERE tutor_id IS NULL", (DEFAULT_TUTOR_ID,))
    conn.execute(
        "UPDATE sessions SET tutor_id = ? WHERE tutor_id IS NULL AND EXISTS (SELECT 1 FROM messages WHERE session_id = sessions.id)",
        (DEFAULT_TUTOR_ID,),
    )
    conn.commit()

@contextmanager
def get_db():
    conn = sqlite3.connect(settings.DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()
