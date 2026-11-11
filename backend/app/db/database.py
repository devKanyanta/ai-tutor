"""PostgreSQL access through SQLAlchemy.

`get_db()` hands out a small connection wrapper that keeps the original `db.execute(sql, params)` call style
(`?` placeholders, rows readable by column name) on top of a pooled SQLAlchemy engine, so queries stay plain,
parameterised SQL. The schema itself lives in `app/db/tables.py` and is created and changed by Alembic.
"""
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional, Sequence

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine, Result

from app.core.config import settings

_engine: Optional[Engine] = None
_PLACEHOLDER = re.compile(r"\?")


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=10, future=True)
    return _engine


def _bind(sql: str, params: Sequence[Any] | None) -> tuple[Any, dict[str, Any]]:
    """Turn `?` placeholders and a parameter tuple into SQLAlchemy named binds."""
    values = tuple(params or ())
    counter = iter(range(len(values) + 1))
    named = _PLACEHOLDER.sub(lambda _: f":p{next(counter)}", sql)
    return text(named), {f"p{i}": v for i, v in enumerate(values)}


class Rows:
    """Result of `execute`: iterate, or `fetchone()` / `fetchall()`. Rows support `row["column"]` and `dict(row)`."""

    def __init__(self, result: Result):
        self._result = result

    @property
    def rowcount(self) -> int:
        return self._result.rowcount

    def fetchone(self):
        row = self._result.mappings().first()
        return row

    def fetchall(self):
        return self._result.mappings().all()

    def __iter__(self) -> Iterator:
        return iter(self._result.mappings())


class Database:
    """One transaction. Call `commit()` to keep writes; anything uncommitted is rolled back on exit."""

    def __init__(self, conn: Connection):
        self._conn = conn

    def execute(self, sql: str, params: Sequence[Any] | None = None) -> Rows:
        statement, binds = _bind(sql, params)
        return Rows(self._conn.execute(statement, binds))

    def commit(self) -> None:
        self._conn.commit()


@contextmanager
def get_db() -> Iterator[Database]:
    conn = get_engine().connect()
    try:
        yield Database(conn)
    finally:
        conn.rollback()  # no-op after commit(); discards partial work if the block raised
        conn.close()


def init_db() -> None:
    """Bring the database schema up to date (runs Alembic migrations)."""
    from alembic import command
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parents[2]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "head")
