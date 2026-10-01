import asyncio
import json
import logging
from typing import AsyncGenerator, Dict, Any, List
from google import genai
from google.genai import types

from app.core.config import settings
from app.rag.retriever import retriever
from app.rag.vector_store import vector_store
from app.tutor.prompts import (
    SOCRATIC_TUTOR_SYSTEM_PROMPT,
    OUT_OF_BOUNDS_RESPONSE,
    JAILBREAK_REFUSAL_RESPONSE,
    check_jailbreak_attempt
)
from app.tutor.memory import memory

logger = logging.getLogger(__name__)

class TutorEngine:
    """
    Pedagogical AI Tutor Engine orchestrating Socratic guidance, RAG grounding,
    guardrails, and real-time streaming (<1.5s TTFT per PERF-01).
    """

    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        self.client = None
        if self.api_key:
            try:
                self.client = genai.Client(api_key=self.api_key)
            except Exception as e:
                logger.warning(f"Failed to initialize Gemini Client in TutorEngine: {e}")

    async def stream_response(self, session_id: str, user_message: str) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream tutor response via Server-Sent Events (SSE).
        Yields dictionaries with event types: 'sources', 'token', 'done', 'error'.
        """
        # Ensure session exists
        session_id = memory.get_or_create_session(session_id)

        # Record user message in memory
        memory.add_message(session_id=session_id, role="user", content=user_message)

        # 1. Guardrail Check: Jailbreak / Prompt Injection (REQ-AI-04)
        if check_jailbreak_attempt(user_message):
            for token in JAILBREAK_REFUSAL_RESPONSE.split(" "):
                yield {"type": "token", "content": token + " "}
                await asyncio.sleep(0.02)
            msg_id = memory.add_message(
                session_id=session_id,
                role="assistant",
                content=JAILBREAK_REFUSAL_RESPONSE
            )
            yield {"type": "done", "message_id": msg_id, "session_id": session_id}
            return

        # 2. Check if knowledge base has documents
        if vector_store.count() == 0:
            msg = (
                "Welcome to the AI Tutor! Your instructor has not yet uploaded curriculum materials. "
                "Once course documents are uploaded in the Admin panel, I will be ready to guide your learning!"
            )
            for token in msg.split(" "):
                yield {"type": "token", "content": token + " "}
                await asyncio.sleep(0.02)
            msg_id = memory.add_message(session_id=session_id, role="assistant", content=msg)
            yield {"type": "done", "message_id": msg_id, "session_id": session_id}
            return

        # Prepare conversation history for context (REQ-UI-03)
        history = memory.get_recent_messages(session_id)
        # Exclude the message we just saved
        past_turns = history[:-1] if len(history) > 1 else []

        # 3. Retrieve relevant chunks with conversational context awareness
        # Short conversational student turns (e.g. "yes", "it doubles", "give me a hint")
        # should inherit the topic context from recent tutor turns rather than deflecting falsely.
        words = user_message.strip().split()
        is_short_conversational = len(words) <= 6

        # Formulate query for retrieval
        retrieval_query = user_message
        if is_short_conversational and past_turns:
            # Combine previous tutor prompt or student prompt with current reply
            recent_context_snippets = [
                t["content"] for t in past_turns[-2:] if t.get("content")
            ]
            if recent_context_snippets:
                # Append last context to anchor conversational follow-ups
                retrieval_query = f"{' '.join(recent_context_snippets)} {user_message}"

        chunks, is_in_bounds = retriever.retrieve(retrieval_query)

        # If still not in bounds but there are past turns in this session that were grounded,
        # try retrieving using the prior conversational turn to keep Socratic flow alive
        if not is_in_bounds and past_turns and is_short_conversational:
            prior_turn = past_turns[-1]["content"]
            fallback_chunks, fallback_in_bounds = retriever.retrieve(prior_turn)
            if fallback_in_bounds:
                chunks = fallback_chunks
                is_in_bounds = True

        # 4. Out-of-Bounds Handling (REQ-AI-03)
        if not is_in_bounds:
            # Log deflection for KPI tracking (KPI-3)
            try:
                import uuid
                from app.db.database import get_db
                with get_db() as db:
                    db.execute(
                        "INSERT INTO deflections (id, session_id, query) VALUES (?, ?, ?)",
                        (str(uuid.uuid4()), session_id, user_message[:500])
                    )
                    db.commit()
            except Exception as e:
                logger.warning(f"Failed to log deflection: {e}")

            for token in OUT_OF_BOUNDS_RESPONSE.split(" "):
                yield {"type": "token", "content": token + " "}
                await asyncio.sleep(0.02)
            msg_id = memory.add_message(
                session_id=session_id,
                role="assistant",
                content=OUT_OF_BOUNDS_RESPONSE
            )
            yield {"type": "done", "message_id": msg_id, "session_id": session_id}
            return

        # Prepare source citations to yield first to UI
        sources = [
            {
                "document_id": c.get("document_id", ""),
                "filename": c.get("filename", ""),
                "chunk_index": c.get("chunk_index", 0),
                "snippet": c.get("snippet", ""),
                "score": round(float(c.get("score", 0.0)), 3)
            }
            for c in chunks
        ]
        yield {"type": "sources", "sources": sources}

        # Format context from retrieved curriculum chunks
        context_text = "\n\n---\n".join([
            f"[Source: {c.get('filename')} (Section {c.get('chunk_index') + 1})]\n{c.get('content')}"
            for c in chunks
        ])

        # Prepare conversation history (REQ-UI-03)
        history = memory.get_recent_messages(session_id)
        # Exclude the very last message since it's the current user message
        past_turns = history[:-1] if len(history) > 1 else []

        full_prompt = (
            f"{SOCRATIC_TUTOR_SYSTEM_PROMPT}\n\n"
            f"[CURRICULUM CONTEXT START]\n{context_text}\n[CURRICULUM CONTEXT END]\n\n"
        )
        if past_turns:
            full_prompt += "[CONVERSATION HISTORY]\n"
            for t in past_turns:
                full_prompt += f"{t['role'].capitalize()}: {t['content']}\n"
            full_prompt += "\n"

        full_prompt += f"Student: {user_message}\nAI Tutor (remember: Socratic method, guiding questions, strictly grounded):"

        full_response_text = ""

        # Call Gemini if available, otherwise simulate pedagogically grounded Socratic response
        if self.client:
            try:
                response = self.client.models.generate_content_stream(
                    model=settings.GEMINI_MODEL,
                    contents=full_prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.3,
                        max_output_tokens=1000,
                    )
                )
                for chunk in response:
                    token_text = chunk.text or ""
                    if token_text:
                        full_response_text += token_text
                        yield {"type": "token", "content": token_text}
                        # Small yield tick for smooth SSE
                        await asyncio.sleep(0.005)
            except Exception as e:
                logger.error(f"Error streaming from Gemini: {e}")
                fallback = self._generate_socratic_fallback(user_message, chunks)
                for token in fallback.split(" "):
                    full_response_text += token + " "
                    yield {"type": "token", "content": token + " "}
                    await asyncio.sleep(0.02)
        else:
            # Fallback simulator for offline/test environments
            fallback = self._generate_socratic_fallback(user_message, chunks)
            for token in fallback.split(" "):
                full_response_text += token + " "
                yield {"type": "token", "content": token + " "}
                await asyncio.sleep(0.02)

        # Save assistant message to memory
        msg_id = memory.add_message(
            session_id=session_id,
            role="assistant",
            content=full_response_text.strip(),
            sources=sources
        )

        yield {"type": "done", "message_id": msg_id, "session_id": session_id}

    def _generate_socratic_fallback(self, query: str, chunks: List[Dict[str, Any]]) -> str:
        """Generate a simulated Socratic guiding response grounded in the context."""
        snippet = chunks[0].get("snippet", "") if chunks else ""
        return (
            f"That's a thoughtful question regarding our curriculum! "
            f"Based on **{chunks[0].get('filename', 'our course material')}**, let's examine this carefully.\n\n"
            f"Consider this key principle from our reading:\n"
            f"> *\"{snippet[:140]}...\"*\n\n"
            f"To help you connect the dots: What do you think happens when we apply this concept to your scenario? "
            f"What would be the very first step you'd take?"
        )

tutor_engine = TutorEngine()
