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
    check_jailbreak_attempt,
    is_simple_greeting,
    tutor_persona_block,
)
from app.tutor import course, lesson
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

    async def stream_response(self, session_id: str, user_message: str, opening: bool = False) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream tutor response via Server-Sent Events (SSE).
        Yields dictionaries with event types: 'sources', 'token', 'done', 'error'.

        With opening=True there is no student message: the tutor speaks first and starts (or resumes)
        the student's course lesson instead of asking what to study.
        """
        # Ensure session exists
        session_id = memory.get_or_create_session(session_id)

        # A bare "hi" before any lesson has started is just the student arriving: open the course lesson.
        if not opening and is_simple_greeting(user_message) and not lesson.load_state(session_id).plan \
                and course.session_course(session_id):
            opening = True

        # Record user message in memory
        if not opening:
            memory.add_message(session_id=session_id, role="user", content=user_message)

        # 1. Guardrail Check: Jailbreak / Prompt Injection (REQ-AI-04)
        if not opening and check_jailbreak_attempt(user_message):
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

        # 2. Check that the session has a tutor and that tutor has material
        tutor = memory.get_session_tutor(session_id)
        tutor_id = tutor["id"] if tutor else None
        if not tutor or vector_store.count(tutor_id) == 0:
            msg = (
                "Please pick an AI tutor to learn with before we start."
                if not tutor else
                f"Welcome to {tutor['name']}! Your instructor has not yet uploaded course materials for this tutor. "
                "Once they are added, I will be ready to guide your learning!"
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
        earlier = history if opening else history[:-1]
        past_turns = [m for m in earlier if m.get("content")]

        # 2.5 Special Handling for Simple Conversational Greetings
        # If the student simply says "hey", "hello", "hi", etc., greet them warmly without dumping irrelevant chunks!
        if not opening and is_simple_greeting(user_message):
            greeting_prompt = (
                f"{SOCRATIC_TUTOR_SYSTEM_PROMPT}\n\n"
                f"The student just initiated or greeted the session with: \"{user_message}\".\n"
                f"Give a friendly, welcoming spoken greeting (2-3 sentences max) introducing yourself as their Socratic AI Tutor. "
                f"Speak naturally for text-to-speech. Invite them to mention any topic or concept from their course materials that they'd like to learn today."
            )
            full_response_text = ""
            if self.client:
                try:
                    response = await self.client.aio.models.generate_content_stream(
                        model=settings.GEMINI_MODEL,
                        contents=greeting_prompt,
                        config=types.GenerateContentConfig(temperature=0.7, max_output_tokens=250)
                    )
                    async for chunk in response:
                        token_text = chunk.text or ""
                        if token_text:
                            full_response_text += token_text
                            yield {"type": "token", "content": token_text}
                except Exception as e:
                    logger.warning(f"Gemini greeting error: {e}")
                    if full_response_text:
                        # Already streamed part of the greeting; keep what the student saw.
                        msg_id = memory.add_message(session_id=session_id, role="assistant", content=full_response_text.strip())
                        yield {"type": "done", "message_id": msg_id, "session_id": session_id}
                        return
                    full_response_text = (
                        "Hello there! I'm your Socratic AI Tutor, and I'm really glad you're here. "
                        "What concept from your course materials would you like to explore together today?"
                    )
                    for token in full_response_text.split(" "):
                        yield {"type": "token", "content": token + " "}
                        await asyncio.sleep(0.02)
            else:
                full_response_text = (
                    "Hello there! I'm your Socratic AI Tutor, and I'm really glad you're here. "
                    "What concept from your course materials would you like to explore together today?"
                )
                for token in full_response_text.split(" "):
                    yield {"type": "token", "content": token + " "}
                    await asyncio.sleep(0.02)

            msg_id = memory.add_message(
                session_id=session_id,
                role="assistant",
                content=full_response_text.strip(),
                sources=[]
            )
            yield {"type": "done", "message_id": msg_id, "session_id": session_id}
            return

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
                t["content"][:300] for t in past_turns[-2:] if t.get("content")
            ]
            if recent_context_snippets:
                # Append last context to anchor conversational follow-ups
                retrieval_query = f"{' '.join(recent_context_snippets)} {user_message}"

        # Lesson orchestration: plan a new lesson, advance/hold/answer a side question, and retrieve
        # context for the current step (see app/tutor/lesson.py). Status messages stream while planning.
        status_queue: asyncio.Queue = asyncio.Queue()

        async def on_status(message: str):
            await status_queue.put(message)

        if opening:
            user_message = "(The student has just opened the lesson.)"
            prep_task = asyncio.create_task(lesson.open_session(
                session_id, retriever.for_tutor(tutor_id), self.client, on_status
            ))
        else:
            prep_task = asyncio.create_task(lesson.prepare_turn(
                session_id, user_message, retrieval_query, retriever.for_tutor(tutor_id), self.client, on_status
            ))
        while not prep_task.done():
            try:
                yield {"type": "status", "message": await asyncio.wait_for(status_queue.get(), timeout=0.1)}
            except asyncio.TimeoutError:
                pass
        while not status_queue.empty():
            yield {"type": "status", "message": status_queue.get_nowait()}
        prep = prep_task.result()
        if prep is None:  # opening a tutor whose course has no lessons yet
            msg = f"Welcome to {tutor['name']}! There are no lessons ready yet. Please check back soon."
            msg_id = memory.add_message(session_id=session_id, role="assistant", content=msg)
            yield {"type": "token", "content": msg}
            yield {"type": "done", "message_id": msg_id, "session_id": session_id}
            return
        chunks, is_in_bounds = prep.chunks, prep.in_bounds

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

        # Tell the UI where the lesson is (phase, step, plan) as soon as it is known.
        yield {"type": "lesson", "lesson": lesson.public_state(session_id)}

        full_prompt = (
            f"{SOCRATIC_TUTOR_SYSTEM_PROMPT}\n\n"
            f"{tutor_persona_block(tutor)}\n"
            f"[LESSON DIRECTIVE - follow this exactly for this turn]\n{prep.directive}\n[END LESSON DIRECTIVE]\n\n"
            f"[CURRICULUM CONTEXT START]\n{context_text}\n[CURRICULUM CONTEXT END]\n\n"
        )
        if past_turns:
            full_prompt += "[CONVERSATION HISTORY]\n"
            for t in past_turns:
                full_prompt += f"{t['role'].capitalize()}: {t['content']}\n"
            full_prompt += "\n"

        full_prompt += (
            f"Student: {user_message}\n"
            f"AI Tutor (follow the lesson directive; spoken cadence; max 1 question):"
        )

        full_response_text = ""

        # Call Gemini if available, otherwise simulate pedagogically grounded Socratic response
        if self.client:
            gemini_error = None
            # Retry up to 3 attempts on transient errors (503, timeouts)
            for attempt in range(3):
                try:
                    response = await self.client.aio.models.generate_content_stream(
                        model=settings.GEMINI_MODEL,
                        contents=full_prompt,
                        config=types.GenerateContentConfig(
                            temperature=0.3,
                            max_output_tokens=2500,
                        )
                    )
                    async for chunk in response:
                        token_text = chunk.text or ""
                        if token_text:
                            full_response_text += token_text
                            yield {"type": "token", "content": token_text}
                    gemini_error = None
                    break  # Success - exit retry loop
                except Exception as e:
                    gemini_error = e
                    logger.warning(f"Gemini attempt {attempt+1} failed: {e}")
                    if full_response_text:
                        # Text was already shown to the student; retrying would duplicate it.
                        break
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)  # Exponential backoff: 1s, 2s

            if gemini_error and not full_response_text:
                logger.error(f"Gemini streaming failed after retries: {gemini_error}")
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
        """Generate a simulated voice-optimized Socratic guiding response grounded in context."""
        if not chunks:
            return (
                "That's an interesting question, but it doesn't seem to be in our study materials. "
                "What topic from your course would you like to explore together?"
            )

        filename = chunks[0].get('filename', 'our course notes')
        first_snippet = chunks[0].get('snippet', '').strip().replace('\n', ' ')
        clean_snippet = first_snippet[:120]

        return (
            f"That's a great question! In {filename}, we look closely at this concept. "
            f"Think about this idea from the reading: {clean_snippet}. "
            f"If you were tackling this in a real project, what do you think would be your first move?"
        )

tutor_engine = TutorEngine()
