import uuid
import logging
from pathlib import Path
from typing import Dict, Any
from app.core.config import settings
from app.db.database import get_db
from app.ingestion.parsers import DocumentParser
from app.ingestion.chunker import TextChunker
from app.rag.vector_store import vector_store, embedding_client

logger = logging.getLogger(__name__)

class IngestionPipeline:
    """End-to-end ingestion pipeline: Upload -> Parse -> Chunk -> Embed -> Store (REQ-IN-01..04)."""

    def __init__(self):
        self.chunker = TextChunker()

    def process_file(self, doc_id: str, file_path: Path, filename: str, file_type: str) -> Dict[str, Any]:
        """Process an uploaded educational document and index it into vector store."""
        try:
            # Mark document as INDEXING (REQ-IN-04)
            with get_db() as db:
                db.execute(
                    "UPDATE documents SET status = 'INDEXING', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (doc_id,)
                )
                db.commit()

            # 1. Parse document
            raw_text = DocumentParser.parse(file_path, file_type)
            if not raw_text.strip():
                raise ValueError("Extracted text is empty or document cannot be parsed.")

            # 2. Chunk text
            chunks = self.chunker.chunk_text(raw_text)
            if not chunks:
                raise ValueError("No text chunks generated.")

            # 3. Generate embeddings
            vectors = embedding_client.embed_texts(chunks)

            # 4. Save chunks to SQLite
            with get_db() as db:
                for idx, chunk in enumerate(chunks):
                    chunk_id = str(uuid.uuid4())
                    db.execute(
                        "INSERT INTO chunks (id, document_id, chunk_index, content, token_count) VALUES (?, ?, ?, ?, ?)",
                        (chunk_id, doc_id, idx, chunk, len(chunk.split()))
                    )
                db.commit()

            # 5. Add to vector store
            vector_store.add_chunks(
                document_id=doc_id,
                filename=filename,
                chunks=chunks,
                vectors=vectors
            )

            # 6. Mark document as READY (REQ-IN-04)
            with get_db() as db:
                db.execute(
                    "UPDATE documents SET status = 'READY', chunk_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (len(chunks), doc_id)
                )
                db.commit()

            logger.info(f"Successfully processed document {filename} ({len(chunks)} chunks).")
            return {"status": "READY", "chunk_count": len(chunks)}

        except Exception as e:
            logger.error(f"Error processing document {filename}: {e}", exc_info=True)
            with get_db() as db:
                db.execute(
                    "UPDATE documents SET status = 'FAILED', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (str(e), doc_id)
                )
                db.commit()
            raise e

pipeline = IngestionPipeline()
