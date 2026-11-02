import logging
from typing import List, Dict, Any, Tuple
from app.rag.vector_store import vector_store, embedding_client
from app.core.config import settings

logger = logging.getLogger(__name__)

class DocumentRetriever:
    """Retrieves grounded curriculum context for student queries (REQ-AI-01)."""

    def __init__(self, top_k: int = settings.RETRIEVAL_TOP_K, threshold: float = settings.SIMILARITY_THRESHOLD):
        self.top_k = top_k
        self.threshold = threshold

    def retrieve(self, query: str, top_k: int | None = None, tutor_id: str | None = None) -> Tuple[List[Dict[str, Any]], bool]:
        """
        Retrieve relevant chunks from ONE tutor's curriculum; other tutors' material is never searched.
        Returns:
            (retrieved_chunks, is_in_bounds)
        """
        # No tutor, or that tutor has no indexed material yet
        if not tutor_id or vector_store.count(tutor_id) == 0:
            return [], False

        query_vec = embedding_client.embed_query(query)
        results = vector_store.search(query_vec, top_k=top_k or self.top_k, tutor_id=tutor_id)

        if not results:
            return [], False

        # Check top score against similarity threshold for out-of-bounds detection (REQ-AI-03)
        top_score = results[0].get("score", 0.0)
        is_in_bounds = top_score >= self.threshold

        return results, is_in_bounds

    def for_tutor(self, tutor_id: str | None):
        """A retrieve(query, top_k=None) callable locked to one tutor, for the lesson engine."""
        return lambda query, top_k=None: self.retrieve(query, top_k, tutor_id)

retriever = DocumentRetriever()
