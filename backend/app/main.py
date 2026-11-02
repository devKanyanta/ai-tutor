import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.database import get_db, init_db
from app.rag.vector_store import vector_store
from app.api.admin import router as admin_router
from app.api.chat import router as chat_router
from app.api.auth import router as auth_router
from app.api.health import router as health_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize database schema
    logger.info("Initializing SQLite database...")
    init_db()
    logger.info("Database initialized successfully.")
    # Chunks indexed before multi-tutor support need their owner so per-tutor retrieval can find them.
    with get_db() as db:
        owners = {r["id"]: r["tutor_id"] for r in db.execute("SELECT id, tutor_id FROM documents WHERE tutor_id IS NOT NULL")}
    if owners and vector_store.backfill_tutor_ids(owners):
        logger.info("Assigned existing indexed chunks to their tutors.")
    if settings.ADMIN_PASSWORD == "admin123" or settings.ADMIN_TOKEN == "tutor-admin-secret-token":
        logger.warning("SECURITY: default ADMIN_PASSWORD/ADMIN_TOKEN in use. Set your own before exposing this server.")
    if not settings.GEMINI_API_KEY:
        logger.warning("GEMINI_API_KEY is not set: running in offline mode (no AI responses, no voice lessons).")
    yield
    # Shutdown
    logger.info("Shutting down AI Tutor backend.")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Interactive Data-Driven AI Tutor API utilizing Google Gemini and local RAG.",
    lifespan=lifespan
)

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()] or ["*"],
    allow_credentials=False,  # bearer-token auth; wildcard origins are invalid with credentials
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes
app.include_router(health_router, prefix=settings.API_V1_STR)
app.include_router(admin_router, prefix=settings.API_V1_STR)
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(chat_router, prefix=settings.API_V1_STR)

# Serve the built React app from the same process when available (single-service hosting).
_dist = settings.FRONTEND_DIST
if (_dist / "index.html").exists():
    if (_dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (_dist / full_path).resolve()
        if full_path and candidate.is_file() and _dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
else:
    @app.get("/")
    def root():
        return {
            "message": f"Welcome to {settings.PROJECT_NAME} API. Visit /docs for Swagger specifications.",
            "version": settings.VERSION
        }
