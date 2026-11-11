import os
import sys
from pathlib import Path

# Tests always run against their own database, never the development one.
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", "postgresql+psycopg:///ai_tutor_test")
sys.path.insert(0, str(Path(__file__).parent))
