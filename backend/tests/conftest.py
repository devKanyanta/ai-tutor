import os
import sys
from pathlib import Path

# Tests always run against their own database, never the development one.
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", "postgresql+psycopg:///ai_tutor_test")
sys.path.insert(0, str(Path(__file__).parent))


import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _database_schema():
    """Create the tables once per run. Some tests use the database without starting the app, so they can't rely on its startup migration."""
    from app.db.database import init_db

    init_db()
