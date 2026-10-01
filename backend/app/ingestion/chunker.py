from typing import List
from app.core.config import settings

class TextChunker:
    """Split extracted text into overlapping chunks for embedding and vector search (REQ-IN-02)."""

    def __init__(self, chunk_size: int = settings.CHUNK_SIZE, chunk_overlap: int = settings.CHUNK_OVERLAP):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk_text(self, text: str) -> List[str]:
        text = text.strip()
        if not text:
            return []

        # If text is smaller than chunk size, return single chunk
        if len(text) <= self.chunk_size:
            return [text]

        chunks = []
        start = 0
        text_len = len(text)

        while start < text_len:
            end = start + self.chunk_size
            if end >= text_len:
                chunk = text[start:].strip()
                if chunk:
                    chunks.append(chunk)
                break

            # Find convenient break point (paragraph or sentence)
            break_point = text.rfind("\n\n", start, end)
            if break_point == -1 or break_point <= start:
                break_point = text.rfind("\n", start, end)
            if break_point == -1 or break_point <= start:
                break_point = text.rfind(". ", start, end)
                if break_point != -1:
                    break_point += 1
            if break_point == -1 or break_point <= start:
                break_point = text.rfind(" ", start, end)

            if break_point == -1 or break_point <= start:
                break_point = end

            chunk = text[start:break_point].strip()
            if chunk:
                chunks.append(chunk)

            # Advance start with overlap
            start = max(start + 1, break_point - self.chunk_overlap)

        return chunks
