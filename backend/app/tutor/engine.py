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
    is_simple_greeting
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
        past_turns = [m for m in history[:-1] if m.get("content")] if len(history) > 1 else []

        # 2.5 Special Handling for Simple Conversational Greetings
        # If the student simply says "hey", "hello", "hi", etc., greet them warmly without dumping irrelevant chunks!
        if is_simple_greeting(user_message):
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

        chunks, is_in_bounds = await asyncio.to_thread(retriever.retrieve, retrieval_query)

        # If still not in bounds but there are past turns in this session that were grounded,
        # try retrieving using the prior conversational turn to keep Socratic flow alive
        if not is_in_bounds and past_turns and is_short_conversational:
            prior_turn = past_turns[-1]["content"][:600]
            fallback_chunks, fallback_in_bounds = await asyncio.to_thread(retriever.retrieve, prior_turn)
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

        # Retrieve session lesson tracking state
        session_state = memory.get_session_state(session_id)
        current_stage = session_state.get("lesson_stage", "HOOK")
        current_topic = session_state.get("current_topic", "")

        # Format context from retrieved curriculum chunks
        context_text = "\n\n---\n".join([
            f"[Source: {c.get('filename')} (Section {c.get('chunk_index') + 1})]\n{c.get('content')}"
            for c in chunks
        ])

        # Determine pedagogical stage from the student's turn number in this session.
        # Stages cycle so long sessions keep teaching new sub-topics instead of
        # being stuck in "synthesis" forever.
        student_turn = memory.count_user_messages(session_id)
        stage_guidance = ""
        next_stage = current_stage

        # Check if student is unsure or giving a blank response
        lowered = user_message.lower()
        is_struggling = any(p in lowered for p in [
            "don't know", "dont know", "do not know", "not sure", "no idea", "confused",
            "i'm lost", "im lost", "help me understand", "don't understand", "dont understand"
        ])

        # 1 = hook; then repeating 5-turn cycle: concept, concept, application, application, synthesis
        cycle_position = 0 if student_turn <= 1 else (student_turn - 2) % 5
        if is_struggling:
            stage_guidance = (
                "STUDENT NEEDS PROACTIVE TEACHING:\n"
                "- Do NOT ask another quiz question.\n"
                "- 70% of response must be direct explanation, clear intuition, and a vivid real-world example.\n"
                "- Walk them step-by-step through how it works, then ask a gentle Guided Prediction or check."
            )
        elif student_turn <= 1:
            next_stage = "HOOK"
            stage_guidance = (
                "LESSON STAGE 1: Hook & Roadmap (Start).\n"
                "- Open with a compelling real-world scenario, intriguing dilemma, or vivid analogy.\n"
                "- DO NOT ask a test question (e.g., do not ask what they already know).\n"
                "- Briefly outline the 2–3 core ideas you will explore together.\n"
                "- Conclude with a warm opening invitation or a Guided Prediction."
            )
        elif cycle_position in (0, 1):
            next_stage = "CONCEPT"
            stage_guidance = (
                "LESSON STAGE 2: Explain & Anchor (Instruction Phase).\n"
                "- 70% of response MUST be high-yield teaching: explain the core mechanism clearly in bite-sized chunks.\n"
                "- Anchor with a concrete metaphor, case study, or walkthrough.\n"
                "- Conclude with an Interactive Mechanic (Guided Prediction OR Fork in the Road choice OR Concept Translation).\n"
                "- Strictly obey The 'One Question' Rule."
            )
        elif cycle_position in (2, 3):
            next_stage = "REAL_WORLD_EXAMPLE"
            stage_guidance = (
                "LESSON STAGE 3 & 4: Practical Application (Hands-On Phase).\n"
                "- Give the student ONE meaningful real-world challenge or scenario from the curriculum to solve.\n"
                "- If responding to their previous answer, validate what they got right, clarify misconceptions with fresh instruction, and expand on their solution.\n"
                "- No interrogation loops—deliver teaching value first."
            )
        else:
            next_stage = "SYNTHESIS"
            stage_guidance = (
                "LESSON STAGE 5: Synthesis & Transition (Finish).\n"
                "- Summarize the 2–3 key takeaways of the lesson clearly.\n"
                "- Acknowledge the student's progress enthusiastically.\n"
                "- Introduce the next logical topic or ask if they are ready to explore the next chapter."
            )

        # Update session tracking
        memory.update_session_state(
            session_id=session_id,
            current_topic=current_topic or user_message[:50],
            lesson_stage=next_stage
        )

        full_prompt = (
            f"{SOCRATIC_TUTOR_SYSTEM_PROMPT}\n\n"
            f"[CURRENT LESSON LIFECYCLE GUIDANCE]\n{stage_guidance}\n[END LESSON GUIDANCE]\n\n"
            f"[CURRICULUM CONTEXT START]\n{context_text}\n[CURRICULUM CONTEXT END]\n\n"
        )
        if past_turns:
            full_prompt += "[CONVERSATION HISTORY]\n"
            for t in past_turns:
                full_prompt += f"{t['role'].capitalize()}: {t['content']}\n"
            full_prompt += "\n"

        full_prompt += (
            f"Student: {user_message}\n"
            f"AI Tutor (teach first with 70% explanation, spoken cadence, max 1 question, no interrogation):"
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
                            max_output_tokens=1000,
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
