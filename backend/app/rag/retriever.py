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

    def retrieve(self, query: str) -> Tuple[List[Dict[str, Any]], bool]:
        """
        Retrieve relevant curriculum chunks.
        Returns:
            (retrieved_chunks, is_in_bounds)
        """
        # If vector store is empty, curriculum has not been indexed yet
        if vector_store.count() == 0:
            return [], False

        query_vec = embedding_client.embed_query(query)
        results = vector_store.search(query_vec, top_k=self.top_k)

        if not results:
            return [], False

        # Check top score against similarity threshold for out-of-bounds detection (REQ-AI-03)
        top_score = results[0].get("score", 0.0)
        is_in_bounds = top_score >= self.threshold

        return results, is_in_bounds

retriever = DocumentRetriever()
