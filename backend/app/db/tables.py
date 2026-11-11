"""Database schema (the "models"). Alembic reads this metadata; the app queries it with SQL via `get_db()`.

`seq` identity columns give a reliable insertion order (what SQLite's implicit rowid used to provide).
"""
from sqlalchemy import (
    BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Identity, Index, Integer, MetaData, PrimaryKeyConstraint,
    Table, Text, func,
)

metadata = MetaData(naming_convention={
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
})

_now = func.now()


def _created() -> Column:
    return Column("created_at", DateTime(timezone=True), nullable=False, server_default=_now)


def _updated() -> Column:
    return Column("updated_at", DateTime(timezone=True), nullable=False, server_default=_now)


users = Table(
    "users", metadata,
    Column("id", Text, primary_key=True),
    Column("email", Text, nullable=False, unique=True),
    Column("name", Text, nullable=False),
    Column("password_hash", Text, nullable=False),
    _created(),
)

auth_tokens = Table(
    "auth_tokens", metadata,
    Column("token_hash", Text, primary_key=True),
    Column("user_id", Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    _created(),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)

# A tutor belongs to the student who created it (owner_id). Tutors made in the instructor studio have no owner.
tutors = Table(
    "tutors", metadata,
    Column("id", Text, primary_key=True),
    Column("owner_id", Text, ForeignKey("users.id", ondelete="CASCADE")),
    Column("name", Text, nullable=False),
    Column("subject", Text, nullable=False, server_default=""),
    Column("description", Text, nullable=False, server_default=""),
    Column("instructions", Text, nullable=False, server_default=""),
    _created(),
    _updated(),
    Index("idx_tutors_owner", "owner_id"),
)

documents = Table(
    "documents", metadata,
    Column("id", Text, primary_key=True),
    Column("seq", BigInteger, Identity(), nullable=False),
    Column("tutor_id", Text, ForeignKey("tutors.id", ondelete="CASCADE")),
    Column("filename", Text, nullable=False),
    Column("file_path", Text, nullable=False),
    Column("file_type", Text, nullable=False),
    Column("file_size", Integer, nullable=False),
    Column("chunk_count", Integer, server_default="0"),
    Column("status", Text, nullable=False),  # PENDING, INDEXING, READY, FAILED
    Column("error_message", Text),
    _created(),
    _updated(),
    Index("idx_documents_tutor", "tutor_id"),
)

chunks = Table(
    "chunks", metadata,
    Column("id", Text, primary_key=True),
    Column("document_id", Text, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
    Column("chunk_index", Integer, nullable=False),
    Column("content", Text, nullable=False),
    Column("token_count", Integer, server_default="0"),
    _created(),
    Index("idx_chunks_document", "document_id", "chunk_index"),
)

# A tutor's ordered course outline (built from its documents).
course_lessons = Table(
    "course_lessons", metadata,
    Column("id", Text, primary_key=True),
    Column("seq", BigInteger, Identity(), nullable=False),
    Column("tutor_id", Text, ForeignKey("tutors.id", ondelete="CASCADE"), nullable=False),
    Column("document_id", Text, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
    Column("part", Integer, nullable=False, server_default="0"),
    Column("chunk_start", Integer, nullable=False, server_default="0"),
    Column("chunk_end", Integer, nullable=False, server_default="0"),  # exclusive
    Column("position", Integer, nullable=False),
    Column("title", Text, nullable=False),
    Column("title_custom", Integer, nullable=False, server_default="0"),
    Index("idx_course_lessons_tutor", "tutor_id", "position"),
)

lesson_progress = Table(
    "lesson_progress", metadata,
    Column("user_id", Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("lesson_id", Text, ForeignKey("course_lessons.id", ondelete="CASCADE"), nullable=False),
    Column("status", Text, nullable=False),  # in_progress, completed
    Column("percent", Integer, nullable=False, server_default="0"),
    _updated(),
    Column("completed_at", DateTime(timezone=True)),
    PrimaryKeyConstraint("user_id", "lesson_id", name="pk_lesson_progress"),
)

sessions = Table(
    "sessions", metadata,
    Column("id", Text, primary_key=True),
    Column("seq", BigInteger, Identity(), nullable=False),
    Column("title", Text),
    Column("tutor_id", Text, ForeignKey("tutors.id", ondelete="CASCADE")),
    Column("user_id", Text, ForeignKey("users.id", ondelete="CASCADE")),
    Column("course_lesson_id", Text),
    Column("current_topic", Text),
    Column("lesson_stage", Text, server_default="INIT"),
    Column("understanding_score", Integer, server_default="0"),
    Column("lesson_plan", Text),
    Column("lesson_beat", Integer, server_default="-1"),
    Column("lesson_holds", Integer, server_default="0"),
    Column("lesson_marker", Integer, server_default="-1"),
    Column("lesson_gate", Integer, server_default="0"),
    Column("lesson_paused", Integer, server_default="0"),  # 0 running, 1 on a break, 2 ended by the student
    _created(),
    Column("last_active", DateTime(timezone=True), nullable=False, server_default=_now),
    Index("idx_sessions_user", "user_id", "tutor_id"),
    Index("idx_sessions_tutor", "tutor_id"),
)

messages = Table(
    "messages", metadata,
    Column("id", Text, primary_key=True),
    Column("seq", BigInteger, Identity(), nullable=False),
    Column("session_id", Text, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
    Column("role", Text, nullable=False),  # user, assistant
    Column("content", Text, nullable=False),
    Column("sources", Text),  # JSON array of source references
    _created(),
    Index("idx_messages_session", "session_id", "seq"),
)

feedback = Table(
    "feedback", metadata,
    Column("id", Text, primary_key=True),
    Column("session_id", Text, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
    Column("message_id", Text, nullable=False),
    Column("rating", Integer, nullable=False),  # 1 thumbs up, -1 thumbs down
    Column("comment", Text),
    _created(),
)

deflections = Table(
    "deflections", metadata,
    Column("id", Text, primary_key=True),
    Column("session_id", Text, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
    Column("query", Text, nullable=False),
    _created(),
)

# Trial usage per student per UTC day (see app/core/trial.py).
usage_daily = Table(
    "usage_daily", metadata,
    Column("user_id", Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("day", Date, nullable=False),
    Column("turns", Integer, nullable=False, server_default="0"),
    Column("voice_seconds", Integer, nullable=False, server_default="0"),
    PrimaryKeyConstraint("user_id", "day", name="pk_usage_daily"),
)
