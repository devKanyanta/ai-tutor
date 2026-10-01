import os
import json
import logging
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional
from google import genai
from google.genai import types
from app.core.config import settings

logger = logging.getLogger(__name__)

class GeminiEmbeddingClient:
    """Client for generating text embeddings using Google Gemini API."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.GEMINI_API_KEY
        self.client = None
        if self.api_key:
            try:
                self.client = genai.Client(api_key=self.api_key)
            except Exception as e:
                logger.warning(f"Failed to initialize Google GenAI Client: {e}")

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of texts using text-embedding-004."""
        if not texts:
            return []
        
        # If API key is present and client initialized, use real Gemini Embeddings
        if self.client:
            try:
                embeddings = []
                for text in texts:
                    response = self.client.models.embed_content(
                        model=settings.EMBEDDING_MODEL,
                        contents=text,
                    )
                    # response.embedding.values is the vector
                    if hasattr(response, "embedding") and hasattr(response.embedding, "values"):
                        embeddings.append(response.embedding.values)
                    elif hasattr(response, "embeddings") and len(response.embeddings) > 0:
                        embeddings.append(response.embeddings[0].values)
                    else:
                        raise ValueError("Unexpected response format from Gemini embed_content")
                return embeddings
            except Exception as e:
                logger.error(f"Error calling Gemini Embedding API: {e}")
                # Fall back to deterministic fallback if API fails
                return [self._fallback_embedding(t) for t in texts]

        # Deterministic semantic-like fallback embedding for offline/testing when no key is set
        return [self._fallback_embedding(t) for t in texts]

    def embed_query(self, query: str) -> List[float]:
        return self.embed_texts([query])[0]

    def _fallback_embedding(self, text: str, dim: int = 768) -> List[float]:
        """Deterministic term-frequency hash embedding vector for testing/offline mode."""
        vec = np.zeros(dim, dtype=np.float32)
        words = text.lower().split()
        for word in words:
            idx = abs(hash(word)) % dim
            vec[idx] += 1.0
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec.tolist()


class EmbeddedVectorStore:
    """
    Embedded local vector database using normalized numpy vectors and persistent JSON metadata.
    Provides fast (<500ms per PERF-02) cosine similarity search without external services.
    """

    def __init__(self, storage_dir: Optional[Path] = None):
        self.storage_dir = storage_dir or settings.VECTOR_STORE_DIR
        self.vectors_file = self.storage_dir / "vectors.npy"
        self.metadata_file = self.storage_dir / "metadata.json"
        
        self.embeddings: np.ndarray = np.empty((0, 768), dtype=np.float32)
        self.metadata: List[Dict[str, Any]] = []
        self._load()

    def _load(self):
        """Load persisted vectors and metadata from disk."""
        if self.vectors_file.exists() and self.metadata_file.exists():
            try:
                self.embeddings = np.load(str(self.vectors_file))
                with open(self.metadata_file, "r", encoding="utf-8") as f:
                    self.metadata = json.load(f)
                logger.info(f"Loaded {len(self.metadata)} vectors from local store.")
            except Exception as e:
                logger.error(f"Failed to load vector store: {e}")
                self.embeddings = np.empty((0, 768), dtype=np.float32)
                self.metadata = []
        else:
            self.embeddings = np.empty((0, 768), dtype=np.float32)
            self.metadata = []

    def _save(self):
        """Persist current vectors and metadata to disk."""
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        np.save(str(self.vectors_file), self.embeddings)
        with open(self.metadata_file, "w", encoding="utf-8") as f:
            json.dump(self.metadata, f, indent=2)

    def add_chunks(self, document_id: str, filename: str, chunks: List[str], vectors: List[List[float]]):
        """Add document chunks and corresponding embedding vectors to index."""
        if not chunks or not vectors:
            return

        new_vecs = np.array(vectors, dtype=np.float32)
        # Normalize vectors for fast cosine similarity dot product
        norms = np.linalg.norm(new_vecs, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        new_vecs = new_vecs / norms

        if self.embeddings.shape[0] == 0:
            self.embeddings = new_vecs
        else:
            # Match dimensions if differing
            if self.embeddings.shape[1] != new_vecs.shape[1]:
                # Re-initialize if dimension changed
                self.embeddings = new_vecs
                self.metadata = []
            else:
                self.embeddings = np.vstack([self.embeddings, new_vecs])

        for idx, chunk in enumerate(chunks):
            self.metadata.append({
                "document_id": document_id,
                "filename": filename,
                "chunk_index": idx,
                "snippet": chunk[:200] + ("..." if len(chunk) > 200 else ""),
                "content": chunk
            })

        self._save()

    def delete_document(self, document_id: str):
        """Remove all chunks associated with a document_id (REQ-IN-03)."""
        keep_indices = [i for i, meta in enumerate(self.metadata) if meta.get("document_id") != document_id]
        if len(keep_indices) == len(self.metadata):
            return

        if keep_indices:
            self.embeddings = self.embeddings[keep_indices]
            self.metadata = [self.metadata[i] for i in keep_indices]
        else:
            self.embeddings = np.empty((0, 768), dtype=np.float32)
            self.metadata = []

        self._save()

    def search(self, query_vector: List[float], top_k: int = settings.RETRIEVAL_TOP_K) -> List[Dict[str, Any]]:
        """
        Cosine similarity retrieval in sub-millisecond execution (PERF-02).
        Returns top_k items with relevance scores.
        """
        if self.embeddings.shape[0] == 0 or not self.metadata:
            return []

        q_vec = np.array(query_vector, dtype=np.float32)
        q_norm = np.linalg.norm(q_vec)
        if q_norm > 0:
            q_vec = q_vec / q_norm

        # Cosine similarity via dot product against normalized vectors
        scores = np.dot(self.embeddings, q_vec)
        
        # Sort descending
        top_indices = np.argsort(scores)[::-1][:top_k]
        
        results = []
        for idx in top_indices:
            score = float(scores[idx])
            meta = self.metadata[idx].copy()
            meta["score"] = score
            results.append(meta)

        return results

    def count(self) -> int:
        return len(self.metadata)


# Global instances
embedding_client = GeminiEmbeddingClient()
vector_store = EmbeddedVectorStore()
