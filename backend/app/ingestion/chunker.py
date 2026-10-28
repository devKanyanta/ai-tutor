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

            # Search backward from end for a good delimiter in the latter portion of the window
            min_break = start + max(1, self.chunk_size // 3)
            break_point = -1
            for delim in ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "]:
                pos = text.rfind(delim, min_break, end)
                if pos != -1:
                    break_point = pos + len(delim.rstrip())
                    break

            if break_point <= start:
                break_point = end

            chunk = text[start:break_point].strip()
            if chunk:
                chunks.append(chunk)

            # Advance start ensuring progress beyond break_point - chunk_overlap
            next_start = max(start + (self.chunk_size - self.chunk_overlap), break_point - self.chunk_overlap)
            if next_start <= start:
                next_start = break_point
            start = next_start

        return chunks
