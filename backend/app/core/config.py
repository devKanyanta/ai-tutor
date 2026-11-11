import os

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

class Settings(BaseSettings):
    PROJECT_NAME: str = "Interactive Data-Driven AI Tutor"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    
    # Base directories
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    UPLOAD_DIR: Path = DATA_DIR / "uploads"
    VECTOR_STORE_DIR: Path = DATA_DIR / "vector_store"
    # PostgreSQL. The default connects over the local socket as the current OS user.
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql+psycopg:///ai_tutor")
    
    # Gemini LLM & Embeddings
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    GEMINI_LIVE_MODEL: str = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live")
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "gemini-embedding-001")
    
    # Admin security
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "admin123")
    ADMIN_TOKEN: str = os.getenv("ADMIN_TOKEN", "tutor-admin-secret-token")
    
    # Deployment
    # Comma-separated list of allowed browser origins. "*" is fine when the frontend is served
    # by this backend (same origin); set your real domain(s) if hosting the frontend elsewhere.
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "*")
    FRONTEND_DIST: Path = Path(os.getenv("FRONTEND_DIST", str(BASE_DIR.parent / "frontend" / "dist")))

    # Free trial limits (students try the tutor with their own course material)
    TRIAL_MAX_TUTORS: int = 2              # tutors one student can have at a time
    TRIAL_MAX_UPLOAD_MB: int = 5           # size of the single course file per tutor
    TRIAL_DAILY_TURNS: int = 40            # tutor replies per student per day (text and voice)
    TRIAL_DAILY_VOICE_MINUTES: int = 10    # live voice time per student per day

    # RAG Settings
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 100
    RETRIEVAL_TOP_K: int = 4
    SIMILARITY_THRESHOLD: float = 0.55  # Below this threshold, question is considered out-of-bounds

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()

# Ensure directories exist
settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.VECTOR_STORE_DIR.mkdir(parents=True, exist_ok=True)
