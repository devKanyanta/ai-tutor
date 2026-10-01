from fastapi import APIRouter
from app.core.config import settings
from app.rag.vector_store import vector_store

router = APIRouter(tags=["health"])

@router.get("/health")
async def health_check():
    """Health check endpoint confirming API status and indexed vector count."""
    return {
        "status": "healthy",
        "project": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "indexed_chunks": vector_store.count(),
        "gemini_configured": bool(settings.GEMINI_API_KEY)
    }
