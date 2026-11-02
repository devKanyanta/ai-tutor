"""
Lesson flow: the tutor plans a short lesson from the curriculum, then moves through
Warm-up -> Learn -> Practice -> Recap automatically, one step per student turn.

The plan is a list of "beats" (one tutor turn each). On every student turn we decide whether to
advance to the next beat, hold on the current one (student is stuck), or answer a side question.
The chosen beat becomes a directive that is injected into the tutor's prompt, in both text
(engine.py) and voice (api/chat.py) lessons, so the two stay in sync.
"""
import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from google.genai import types
from pydantic import BaseModel, Field

from app.core.config import settings
from app.db.database import get_db
from app.tutor import course
from app.tutor.memory import memory

logger = logging.getLogger(__name__)

STAGES = ["WARMUP", "LEARN", "PRACTICE", "RECAP"]
STAGE_LABELS = {"WARMUP": "Warm-up", "LEARN": "Learn", "PRACTICE": "Practice", "RECAP": "Recap"}
MAX_HOLDS = 2  # re-explain at most this many times before moving on


# --------------------------------------------------------------------------- plan model
class LearnItem(BaseModel):
    point: str = Field(description="The single idea to teach, at most 25 words")
    check: str = Field(default="", description="A quick question to ask after teaching it")


class PracticeItem(BaseModel):
    task: str = Field(description="A small scenario or problem for the student to work through")
    hint: str = Field(default="")


class LessonPlan(BaseModel):
    topic: str = Field(description="Short lesson title, at most 8 words")
    objective: str = Field(description="One sentence: what the student will be able to do")
    hook: str = Field(description="A real-world scenario or intriguing question to open with")
    roadmap: List[str] = Field(description="2-3 short phrases: what the lesson will cover")
    learn: List[LearnItem]
    practice: List[PracticeItem]
    takeaways: List[str] = Field(description="2-3 key points for the recap")
    next_up: str = Field(default="", description="A related topic to study next, if any")


def _clean(text: Any, limit: int = 300) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()[:limit]


def normalize_plan(plan: LessonPlan) -> Dict[str, Any]:
    """Clamp sizes and fill gaps so the rest of the code can rely on the shape."""
    learn = [
        {"point": _clean(i.point, 200), "check": _clean(i.check, 200) or "In your own words, what does that mean?"}
        for i in plan.learn if _clean(i.point)
    ][:4]
    practice = [{"task": _clean(i.task, 300), "hint": _clean(i.hint, 200)} for i in plan.practice if _clean(i.task)][:2]
    topic = _clean(plan.topic, 80) or "Your lesson"
    if not learn:
        learn = [{"point": topic, "check": "In your own words, what does that mean?"}]
    if not practice:
        practice = [{"task": f"Explain {topic} in your own words and give one example.", "hint": ""}]
    takeaways = [_clean(t, 200) for t in plan.takeaways if _clean(t)][:3] or [l["point"] for l in learn[:3]]
    roadmap = [_clean(r, 80) for r in plan.roadmap if _clean(r)][:3] or [l["point"] for l in learn[:3]]
    return {
        "topic": topic,
        "objective": _clean(plan.objective, 240) or f"Understand {topic}.",
        "hook": _clean(plan.hook, 300) or f"Let's think about where {topic} shows up in real life.",
        "roadmap": roadmap,
        "learn": learn,
        "practice": practice,
        "takeaways": takeaways,
        "next_up": _clean(plan.next_up, 120),
    }


def fallback_plan(request: str, chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """A usable plan built straight from the retrieved text, for when the planner is unavailable."""
    topic = _clean(re.sub(r"[?!.]", "", request), 60) or "Your lesson"
    snippets: List[str] = []
    for chunk in chunks:
        sentence = re.split(r"(?<=[.!?])\s+", _clean(chunk.get("content", ""), 400))[0]
        if len(sentence) > 25 and sentence not in snippets:
            snippets.append(sentence[:200])
    points = snippets[:3] or [topic]
    return normalize_plan(LessonPlan(
        topic=topic,
        objective=f"Understand the key ideas of {topic}.",
        hook=f"Let's start with why {topic} matters.",
        roadmap=[f"Idea {i + 1}" for i in range(len(points))],
        learn=[LearnItem(point=p, check="What stands out to you about that?") for p in points],
        practice=[PracticeItem(task=f"Explain {topic} in your own words and give an example.")],
        takeaways=points,
    ))


PLANNER_PROMPT = """You are an instructional designer. Plan a short, focused tutoring lesson for the student's request, \
using ONLY the curriculum excerpts below. Do not invent facts that are not in the excerpts. Be CONCISE: every string is one short sentence or phrase. Everything in the plan must be directly about the student's request; \
do not wander into neighbouring topics that happen to appear in the excerpts.

Student's request: {request}

Plan these parts:
- topic: a short lesson title.
- objective: one sentence on what the student will be able to do afterwards.
- hook: one sentence: a real-world scenario or intriguing question to open the lesson (do not ask what they already know).
- roadmap: 2-3 short phrases previewing what will be covered.
- learn: 2-4 items, in a sensible teaching order. Each has the single idea to teach ("point") and a quick check question.
- practice: 1-2 small tasks that make the student apply the ideas (scenarios or problems, no answers).
- takeaways: 2-3 key points for the final recap.
- next_up: a related topic from the excerpts to study next (or empty).

[CURRICULUM EXCERPTS]
{context}
[END EXCERPTS]"""


def _plan_sync(client: Any, request: str, chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
    context = "\n\n---\n".join(
        f"[{c.get('filename', 'material')}] {c.get('content', '')[:900]}" for c in chunks[:6]
    )
    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=PLANNER_PROMPT.format(request=request[:500], context=context),
        config=types.GenerateContentConfig(
            temperature=0.3,
            max_output_tokens=1000,
            response_mime_type="application/json",
            response_schema=LessonPlan,
        ),
    )
    return normalize_plan(LessonPlan.model_validate_json(response.text))


async def create_plan(client: Any, request: str, chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
    if client is None:
        return fallback_plan(request, chunks)
    try:
        return await asyncio.wait_for(asyncio.to_thread(_plan_sync, client, request, chunks), timeout=15)
    except Exception as exc:  # network, quota, bad JSON, timeout
        logger.warning(f"Lesson planner failed, using fallback plan: {exc}")
        return fallback_plan(request, chunks)


# --------------------------------------------------------------------------- beats & state
def build_beats(plan: Dict[str, Any]) -> List[Tuple[str, int]]:
    return (
        [("WARMUP", 0)]
        + [("LEARN", i) for i in range(len(plan["learn"]))]
        + [("PRACTICE", i) for i in range(len(plan["practice"]))]
        + [("RECAP", 0)]
    )


@dataclass
class LessonState:
    plan: Optional[Dict[str, Any]] = None
    beat: int = -1
    holds: int = 0
    marker: int = -1  # assistant-message count when we last advanced (guards against double-advance)
    gate: bool = False  # phase checkpoint: waiting for the student to agree to move to the next phase
    in_course: bool = False       # this lesson is part of the tutor's course outline (so progress is tracked)
    next_title: str = ""          # title of the following course lesson, if any

    @property
    def beats(self) -> List[Tuple[str, int]]:
        return build_beats(self.plan) if self.plan else []

    @property
    def done(self) -> bool:
        return bool(self.plan) and self.beat >= len(self.beats)

    @property
    def stage(self) -> str:
        if not self.plan:
            return "INIT"
        if self.done:
            return "DONE"
        return self.beats[max(self.beat, 0)][0]


def load_state(session_id: str) -> LessonState:
    with get_db() as db:
        row = db.execute(
            "SELECT lesson_plan, lesson_beat, lesson_holds, lesson_marker, lesson_gate FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
    if not row or not row["lesson_plan"]:
        return LessonState()
    try:
        plan = json.loads(row["lesson_plan"])
    except ValueError:
        return LessonState()
    info = course.session_course(session_id)
    current = info["current"] if info else None
    return LessonState(
        plan=plan,
        beat=row["lesson_beat"] if row["lesson_beat"] is not None else 0,
        holds=row["lesson_holds"] or 0,
        marker=row["lesson_marker"] if row["lesson_marker"] is not None else -1,
        gate=bool(row["lesson_gate"]),
        in_course=bool(current),
        next_title=(info["next"]["title"] if info and info["next"] else "") if current else "",
    )


def save_state(session_id: str, state: LessonState) -> None:
    with get_db() as db:
        db.execute(
            """UPDATE sessions SET lesson_plan = ?, lesson_beat = ?, lesson_holds = ?, lesson_marker = ?, lesson_gate = ?,
               lesson_stage = ?, current_topic = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?""",
            (
                json.dumps(state.plan) if state.plan else None,
                state.beat,
                state.holds,
                state.marker,
                int(state.gate),
                state.stage,
                state.plan["topic"] if state.plan else None,
                session_id,
            ),
        )
        db.commit()
    if state.done:
        course.mark_session_lesson_complete(session_id)


def reset_lesson(session_id: str) -> None:
    """Forget the current plan so the next question starts a fresh (off-course) lesson; the conversation is kept."""
    save_state(session_id, LessonState())
    course.set_session_lesson(session_id, None)


# --------------------------------------------------------------------------- turn classification
_ACK = re.compile(
    r"^(yes|yeah|yep|yup|ok|okay|sure|got it|i see|makes sense|right|ready|next|continue|go on|go ahead|"
    r"thanks|thank you|alright|cool|nice|great|mhm|uh huh|sounds good|lets go|let's go|move on|keep going|"
    r"i understand|understood)\b"
)
_SWITCH = (
    "new topic", "different topic", "another topic", "change topic", "something else", "start over",
    "let's talk about", "lets talk about", "teach me about", "can we learn about", "i want to learn about",
    "switch to", "move to a different",
)
_HOLD = (
    "don't know", "dont know", "do not know", "not sure", "no idea", "confused", "i'm lost", "im lost",
    "don't understand", "dont understand", "didn't get", "didnt get", "what do you mean", "repeat",
    "say that again", "explain again", "go back", "slower", "i don't get", "i dont get", "huh",
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s'?]", " ", text.lower())).strip()


def is_acknowledgement(text: str) -> bool:
    t = _norm(text)
    return len(t.split()) <= 4 and bool(_ACK.match(t))


_QUESTION_WORDS = {
    "what", "why", "how", "when", "where", "who", "which", "can", "could", "does", "do", "did", "is", "are",
    "was", "were", "should", "would", "will", "isnt", "doesnt", "whats", "hows",
}
_READY_YES = (
    "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "ready", "go ahead", "lets go", "let's go", "continue",
    "next", "move on", "sounds good", "proceed", "go on", "alright", "absolutely", "of course", "keep going",
)
_READY_NO = (
    "not yet", "no", "nope", "wait", "hold on", "one more", "before", "first", "explain", "again", "review",
    "go over", "question", "not ready", "confused", "don't", "dont", "what", "why", "how", "can you",
)


def looks_like_question(text: str) -> bool:
    """Voice transcripts often lack a question mark, so also recognise a leading question word."""
    t = _norm(text)
    words = t.replace("?", "").split()
    if len(words) < 4:
        return False
    return "?" in t or words[0].replace("'", "") in _QUESTION_WORDS


def is_ready_confirmation(text: str) -> bool:
    """A clear 'yes, move on' (not 'not yet', not a question)."""
    t = _norm(text).replace("?", "")
    if not t or len(t.split()) > 8:
        return False
    padded = f" {t} "
    if any(f" {w} " in padded for w in _READY_NO):
        return False
    return any(f" {w} " in padded for w in _READY_YES)


def crosses_phase(state: LessonState) -> bool:
    """Would the next step start a different phase?"""
    if not state.plan or state.done:
        return False
    beats = state.beats
    nxt = state.beat + 1
    return nxt < len(beats) and beats[nxt][0] != beats[state.beat][0]


def next_phase_label(state: LessonState) -> str:
    beats = state.beats
    nxt = state.beat + 1
    return STAGE_LABELS[beats[nxt][0]] if state.plan and nxt < len(beats) else ""


def awaiting_confirmation(state: LessonState) -> bool:
    """True while the tutor is asking whether the student is ready to start the next phase."""
    if not state.plan or state.done:
        return False
    return state.gate or (state.stage == "WARMUP" and crosses_phase(state))


def classify_turn(state: LessonState, text: str) -> str:
    """new_lesson | continue | side_question | closing"""
    t = _norm(text)
    if not state.plan:
        return "new_lesson"
    if any(p in t for p in _SWITCH):
        return "new_lesson"
    if state.done:
        return "closing" if is_acknowledgement(text) or len(t.split()) <= 2 else "new_lesson"
    if awaiting_confirmation(state) and is_ready_confirmation(text):
        return "continue"
    # In practice a question is usually an attempt ("is that code reuse?"), so it is never a side question.
    if state.stage != "PRACTICE" and looks_like_question(text) and not any(p in t for p in _HOLD):
        return "side_question"
    return "continue"


def wants_hold(text: str) -> bool:
    t = _norm(text)
    return any(p in t for p in _HOLD)


def needs_hold(state: LessonState, text: str) -> bool:
    """Stay on this step? Yes if the student is stuck, or if a practice task got no real attempt ('ok')."""
    if wants_hold(text):
        return True
    return state.stage == "PRACTICE" and is_acknowledgement(text)


# --------------------------------------------------------------------------- directives
def focus_text(state: LessonState) -> str:
    """What this beat is about, used to retrieve the most relevant curriculum text."""
    if not state.plan or state.done:
        return ""
    stage, idx = state.beats[state.beat]
    plan = state.plan
    if stage == "WARMUP":
        return f"{plan['topic']} {plan['hook']}"
    if stage == "LEARN":
        return f"{plan['learn'][idx]['point']} {plan['learn'][idx]['check']}"
    if stage == "PRACTICE":
        return plan["practice"][idx]["task"]
    return " ".join(plan["takeaways"])


def build_directive(state: LessonState, mode: str = "continue", hold: bool = False, ack: bool = False) -> str:
    plan = state.plan
    if not plan:
        return ""
    header = (
        f"Lesson: {plan['topic']}. Objective: {plan['objective']}\n"
        "Stay strictly on this step: use only the curriculum context, do not bring in other topics or outside "
        "knowledge, and do not teach anything this directive does not ask for.\n"
    )

    if state.done and state.in_course:
        if state.next_title:
            return header + (
                "LESSON COMPLETE. Warmly wrap up in one sentence, then tell the student the next lesson in the course is "
                f"\"{state.next_title}\" and ask if they are ready to start it. Do not ask what topic they want, and do "
                "not start teaching the next lesson until they say yes."
            )
        return header + (
            "LESSON COMPLETE, and it was the last lesson: the student has finished the whole course. Congratulate them "
            "warmly in two sentences and tell them they can ask you to review anything in the course."
        )
    if state.done:
        suggestion = f" You could suggest studying next: {plan['next_up']}." if plan["next_up"] else ""
        return header + (
            "LESSON COMPLETE. The student has finished all phases. Warmly wrap up in one or two sentences, "
            f"and ask which topic from the course materials they would like to study next.{suggestion} "
            "Do not start teaching a new topic until they choose one."
        )

    stage, idx = state.beats[state.beat]
    n_learn, n_practice = len(plan["learn"]), len(plan["practice"])

    if stage == "WARMUP":
        body = (
            "PHASE 1 of 4 - WARM-UP (this turn only). Open with this hook, in your own words: "
            f"{plan['hook']} Then say in one sentence what you will cover together: {'; '.join(plan['roadmap'])}. "
            "Do NOT teach any of the points yet. End by asking, as your one question, whether they are ready to start learning."
        )
    elif stage == "LEARN":
        item = plan["learn"][idx]
        body = (
            f"PHASE 2 of 4 - LEARN, point {idx + 1} of {n_learn}: \"{item['point']}\". "
            + ("Begin with a short spoken bridge from the warm-up into the lesson (for example 'Great, let's dig in'). " if idx == 0 else "")
            + (
                "The student only acknowledged (something like 'yes' or 'ok') and did not answer anything, so do NOT "
                "praise, critique or comment on their reply; just carry on. "
                if ack else
                "If the student just replied to your previous question, react to it in one short phrase "
                "(confirm what is right, gently fix what is not) before teaching. "
            ) +
            "Teach ONLY this point, in 3 to 5 spoken sentences, with one concrete example from the curriculum context. "
            f"End with a quick check question like: {item['check']} "
            "Do not move on to later points."
        )
    elif stage == "PRACTICE":
        item = plan["practice"][idx]
        if ack:
            lead = "The student only acknowledged and did not answer anything, so give no feedback; just "
        elif idx == 0:
            lead = "Give brief, specific feedback on the student's last answer (what is right, what to fix and why), then "
        else:
            lead = "Give specific feedback on the student's attempt at the previous task (what is right, what to fix and why), then "
        body = (
            f"PHASE 3 of 4 - PRACTICE, task {idx + 1} of {n_practice}. "
            + ("Begin with a short spoken bridge from learning into practice (for example 'Now let's try it yourself'). " if idx == 0 else "")
            + f"{lead}"
            f"set this task: {item['task']} "
            + (f"If they ask for help, you may give this hint: {item['hint']} " if item["hint"] else "")
            + "Ask them to try it. Do NOT give the answer."
        )
    else:  # RECAP
        suggestion = f" Suggest what to study next: {plan['next_up']}." if plan["next_up"] else ""
        body = (
            "PHASE 4 of 4 - RECAP. Begin with a short spoken bridge (for example 'Let's pull it together'). "
            + ("Give no feedback (the student only acknowledged); " if ack else "Give specific feedback on the student's last attempt, then ")
            + "summarise the key "
            f"takeaways in clear spoken sentences: {' | '.join(plan['takeaways'])}. "
            + (
                (
                    f"Acknowledge their progress. Finish by telling them the next lesson is \"{state.next_title}\" and "
                    "asking if they are ready for it."
                    if state.next_title else
                    "Acknowledge their progress and congratulate them: this was the last lesson of the course."
                ) if state.in_course else
                f"Acknowledge their progress.{suggestion} Finish by asking what they would like to study next."
            )
        )

    if state.gate:
        nxt = next_phase_label(state)
        body = (
            f"PHASE CHECKPOINT. The {STAGE_LABELS[stage]} phase is finished and the student has not yet agreed to "
            f"move on. Respond to what the student just said (if it was a question, answer it briefly from the "
            f"curriculum context; otherwise give brief, specific feedback), say in one sentence what this phase "
            f"covered, then ask clearly whether they are ready to move on to {nxt} or would like to go over "
            f"anything first. Do NOT start {nxt} yet. Ask only that one question."
        )
    if mode == "side_question":
        body = (
            "SIDE QUESTION. Answer the student's question briefly (2 to 4 sentences) using only the curriculum "
            "context. Then gently bring them back to the lesson and continue where you were. "
            "Do NOT advance to a new phase or point this turn. Where you were: " + body
        )
    elif hold and stage == "PRACTICE" and ack:
        body = (
            "THE STUDENT HAS NOT ATTEMPTED THE TASK YET (they only said something like 'ok'). Do not move on and do "
            "not give the answer. Encourage them to have a go, and offer the hint. Current task: " + body
        )
    elif hold:
        body = (
            "THE STUDENT NEEDS HELP WITH THE CURRENT STEP. Do not move on. Re-teach it a different way (a new "
            "analogy, simpler words, smaller steps), then ask an easier check question. Current step: " + body
        )
    return header + body


def public_state(session_id: str) -> Dict[str, Any]:
    """Lesson progress for the UI."""
    state = load_state(session_id)
    student_turns = memory.count_user_messages(session_id)
    if not state.plan:
        return {"lesson_stage": "INIT", "current_topic": "", "student_turns": student_turns,
                "complete": False, "objective": "", "phases": [], "beat": 0, "total_beats": 0,
                "awaiting_confirmation": "", "course": course_state(session_id)}

    beats, plan = state.beats, state.plan
    items = {
        "WARMUP": plan["roadmap"],
        "LEARN": [i["point"] for i in plan["learn"]],
        "PRACTICE": [i["task"] for i in plan["practice"]],
        "RECAP": plan["takeaways"],
    }
    phases = []
    for stage in STAGES:
        indexes = [i for i, (s, _) in enumerate(beats) if s == stage]
        if state.done or state.beat > indexes[-1]:
            status, step = "done", len(indexes)
        elif state.beat < indexes[0]:
            status, step = "upcoming", 0
        else:
            status, step = "current", state.beat - indexes[0] + 1
        phases.append({
            "id": stage, "label": STAGE_LABELS[stage], "status": status,
            "step": step, "steps": len(indexes), "items": items[stage],
        })
    return {
        "lesson_stage": state.stage,
        "current_topic": plan["topic"],
        "student_turns": student_turns,
        "complete": state.done,
        "objective": plan["objective"],
        "phases": phases,
        "beat": min(state.beat, len(beats)),
        "total_beats": len(beats),
        "awaiting_confirmation": next_phase_label(state) if awaiting_confirmation(state) else "",
        "course": course_state(session_id),
    }


def course_state(session_id: str) -> Optional[Dict[str, Any]]:
    """Course progress for the UI: the outline with statuses and which lesson is current."""
    info = course.session_course(session_id)
    if not info:
        return None
    return {
        "total": info["total"],
        "completed": info["completed"],
        "current_id": info["current"]["id"] if info["current"] else None,
        "current_position": info["current"]["position"] if info["current"] else None,
        "lessons": info["lessons"],
    }


def advance_state(session_id: str, state: LessonState, student_text: str) -> Tuple[LessonState, bool]:
    """
    Move the lesson on by one student turn. Idempotent per tutor turn: several triggers (tool call, voice
    commit) may fire for one student reply and must act only once. Returns (state, held).

    Phases never change without agreement: when the next step would start a new phase the tutor first holds a
    checkpoint ("ready to move on to Practice?") and only a clear yes crosses the boundary.
    """
    count = memory.count_assistant_messages(session_id)
    if state.marker == count:
        return state, state.holds > 0
    hold = False
    if state.gate:
        if is_ready_confirmation(student_text):
            state.gate = False
            state.beat += 1
            state.holds = 0
        # otherwise stay at the checkpoint: answer / review, then ask again
    elif needs_hold(state, student_text) and state.holds < MAX_HOLDS:
        state.holds += 1
        hold = True
    elif crosses_phase(state):
        if state.stage == "WARMUP" and is_ready_confirmation(student_text):
            state.beat += 1   # the warm-up already asked "ready to start?" and they said yes
        else:
            state.gate = True
        state.holds = 0
    else:
        state.beat += 1
        state.holds = 0
    state.marker = count
    save_state(session_id, state)
    return state, hold


def commit_turn(session_id: str, student_text: str) -> LessonState:
    """
    Voice: called when the tutor starts replying, to advance the lesson even if the model never asked.
    Only plain continuations advance; new topics and side questions are handled by the lookup tool.
    """
    state = load_state(session_id)
    if not state.plan or state.done:
        return state
    if classify_turn(state, student_text) != "continue":
        return state
    state, _ = advance_state(session_id, state, student_text)
    return state


def _format_context(chunks: List[Dict[str, Any]]) -> str:
    return "\n\n---\n".join(
        f"[Source: {c.get('filename', 'course material')} (Section {c.get('chunk_index', 0) + 1})]\n{c.get('content', '')}"
        for c in chunks
    )


async def next_step_briefing(session_id: str, retrieve: Retrieve) -> Optional[str]:
    """
    Voice: a private briefing injected after each tutor turn so the model already holds the script for
    its next reply. This is what keeps the lesson on plan even when the model skips the lookup tool.
    """
    state = load_state(session_id)
    if not state.plan:
        return None
    head = (
        "[LESSON BRIEFING - private instructions from the system, not from the student. Never read it aloud or "
        "mention it. It is your script for your NEXT reply only.]\n"
    )
    if state.done:
        return head + (
            "The lesson is complete. If the student acknowledges, warmly wrap up in a sentence or two and ask which "
            "topic from the course materials they would like next. If they name a new topic or ask a new question, "
            "call search_curriculum."
        )

    upcoming = LessonState(plan=state.plan, beat=state.beat + 1, holds=0, marker=state.marker)
    gated = LessonState(plan=state.plan, beat=state.beat, holds=0, marker=state.marker, gate=True)
    checkpoint_next = awaiting_confirmation(state)          # the student was just asked "ready to move on?"
    checkpoint_soon = (not checkpoint_next) and crosses_phase(state)  # their next reply ends this phase
    focus = focus_text(upcoming) or focus_text(state)
    chunks, _ = await asyncio.to_thread(retrieve, focus[:600])
    context = _format_context(chunks)
    total = len(state.beats)
    notes = []
    if state.holds > 0:
        notes.append(
            "You have JUST re-taught the current step in a simpler way. Do not re-teach it again unless the student "
            "is clearly confused again; if they reply normally, do A."
        )
    if state.stage == "PRACTICE":
        notes.append(
            "The current step is a practice task. If the student only says 'ok' or 'yes' without attempting it, do "
            "NOT move on: encourage them to try and offer the hint."
        )
    current_focus = focus_text(state)
    if checkpoint_next:
        nxt = next_phase_label(state)
        decision = (
            f"The student has just been asked whether they are ready to move on to {nxt}.\n"
            f"A) They clearly agree ('yes', 'ready', 'ok', 'let's go'): start {nxt}: {build_directive(upcoming)}\n"
            "   Use only this curriculum context for facts:\n"
            f"{context}\n"
            f"B) ANYTHING else (not yet, a question, hesitation, a comment): stay in the current phase and do NOT start "
            f"{nxt}. If it is a question, call search_curriculum and answer it. Then {build_directive(gated)}\n"
        )
    elif checkpoint_soon:
        decision = (
            "A phase is about to finish, so your next reply is a CHECKPOINT, not the next phase.\n"
            f"A) A normal reply (an answer, an attempt, 'yes', 'ok'): {build_directive(gated)}\n"
            "   Use only this curriculum context for facts:\n"
            f"{context}\n"
            "B) The student is confused or asks you to repeat: stay on the current step. Re-teach it in a different, "
            f"simpler way and ask an easier check question. The current step is about: {current_focus[:300]}\n"
        )
    else:
        decision = (
            f"A) A normal reply (an answer, an attempt, 'yes', 'ok', 'go on'): move to step {state.beat + 2}: "
            f"{build_directive(upcoming)}\n"
            "   If the reply is only 'yes' or 'ok', do not praise or critique it; just continue. "
            "Use only this curriculum context for facts:\n"
            f"{context}\n"
            "B) The student is confused or asks you to repeat: stay on the current step. Re-teach it in a different, "
            f"simpler way and ask an easier check question. The current step is about: {current_focus[:300]}\n"
        )
    return head + (
        f"You are at step {state.beat + 1} of {total}. " + " ".join(notes) + "\n"
        "Decide by what the student says next:\n"
        + decision
        + "Any question from the student, even a short one: call search_curriculum, answer it in a few sentences, "
        "and stay where you are; a question never moves the lesson on.\n"
        "If the student wants a different topic: call search_curriculum.\n"
        "Never add other topics, never use knowledge outside the curriculum context, never skip ahead, and never "
        "start a new phase unless the student has clearly agreed to move on."
    )


# --------------------------------------------------------------------------- per-turn orchestration
@dataclass
class TurnPrep:
    chunks: List[Dict[str, Any]] = field(default_factory=list)
    in_bounds: bool = False
    directive: str = ""
    mode: str = "continue"
    new_plan: bool = False


Retrieve = Callable[..., Tuple[List[Dict[str, Any]], bool]]


async def prepare_turn(
    session_id: str,
    user_message: str,
    retrieval_query: str,
    retrieve: Retrieve,
    client: Any,
    on_status: Optional[Callable[[str], Awaitable[None]]] = None,
) -> TurnPrep:
    """
    Decide what the tutor does this turn: plan a new lesson, advance to the next beat, hold, answer a
    side question or close the lesson. Returns the curriculum context and the directive to follow.
    """
    state = load_state(session_id)
    mode = classify_turn(state, user_message)

    # Finished a course lesson and the student is ready: go straight to the next one.
    if mode == "closing" and state.done and state.in_course:
        info = course.session_info(session_id)
        upcoming = course.next_lesson(info["tutor_id"], info["user_id"]) if info else None
        if upcoming:
            return await start_course_lesson(session_id, upcoming, client, on_status, intro="next")

    if mode == "continue":
        state, hold = advance_state(session_id, state, user_message)
        focus = focus_text(state)
        chunks: List[Dict[str, Any]] = []
        if focus:
            chunks, ok = await asyncio.to_thread(retrieve, f"{focus} {user_message}"[:600])
            if not ok:
                chunks, ok = await asyncio.to_thread(retrieve, focus[:600])
        # Inside an active lesson a reply like "yes" must never be treated as off-topic.
        return TurnPrep(chunks=chunks, in_bounds=True, directive=build_directive(state, "continue", hold, ack=is_acknowledgement(user_message)), mode=mode)

    # New lessons retrieve extra context once, for both the answer and the plan.
    chunks, ok = await asyncio.to_thread(retrieve, retrieval_query, 8) if mode == "new_lesson" \
        else await asyncio.to_thread(retrieve, retrieval_query)
    plan_chunks = chunks
    chunks = chunks[:4] if mode == "new_lesson" else chunks

    if mode == "side_question":
        return TurnPrep(chunks=chunks, in_bounds=ok, directive=build_directive(state, "side_question"), mode=mode)

    if mode == "closing":
        return TurnPrep(chunks=[], in_bounds=True, directive=build_directive(state), mode=mode)

    # new_lesson
    if not ok:
        return TurnPrep(chunks=chunks, in_bounds=False, mode=mode)
    if on_status:
        await on_status("Planning your lesson…")
    plan = await create_plan(client, user_message, plan_chunks)
    state = LessonState(plan=plan, beat=0, holds=0, marker=memory.count_assistant_messages(session_id))
    save_state(session_id, state)
    course.set_session_lesson(session_id, None)  # a topic the student chose is outside the course, so no progress
    return TurnPrep(chunks=chunks, in_bounds=True, directive=build_directive(state), mode=mode, new_plan=True)


# --------------------------------------------------------------------------- course lessons
def _first_name(name: Optional[str]) -> str:
    return (name or "").strip().split(" ")[0]


def resume_question(state: LessonState) -> str:
    """The question the student was last asked, so a returning student can simply answer it."""
    plan = state.plan
    if state.gate or (state.stage == "WARMUP"):
        nxt = next_phase_label(state)
        return f"ask whether they are ready to move on to {nxt}" if nxt else "ask if they are ready to continue"
    stage, idx = state.beats[state.beat]
    if stage == "LEARN":
        return f"re-ask this check question: {plan['learn'][idx]['check']}"
    if stage == "PRACTICE":
        return f"set this task again: {plan['practice'][idx]['task']}"
    return "ask what they would like to do next"


def resume_directive(state: LessonState, student_name: str) -> str:
    plan = state.plan
    stage = STAGE_LABELS.get(state.stage, state.stage.title())
    return (
        f"Lesson: {plan['topic']}. Objective: {plan['objective']}\n"
        "WELCOME BACK. The student has returned to a lesson already in progress. "
        f"Greet {student_name or 'them'} warmly in one short sentence, then in one sentence remind them where you "
        f"stopped (the lesson \"{plan['topic']}\", {stage} phase). Then {resume_question(state)}. "
        "Do NOT ask what topic they want, do not restart the lesson and do not teach anything new this turn."
    )


async def start_course_lesson(
    session_id: str,
    lesson: Dict[str, Any],
    client: Any,
    on_status: Optional[Callable[[str], Awaitable[None]]] = None,
    intro: str = "first",
) -> TurnPrep:
    """Plan a course lesson from its own material and open it. intro: first | back | next."""
    chunks = course.lesson_chunks(lesson["id"])
    if on_status:
        await on_status("Preparing your lesson…")
    plan = await create_plan(client, lesson["title"], chunks)
    state = LessonState(plan=plan, beat=0, holds=0, marker=memory.count_assistant_messages(session_id))
    save_state(session_id, state)
    course.set_session_lesson(session_id, lesson["id"])
    state = load_state(session_id)

    info = course.session_info(session_id) or {}
    total = len(course.outline(info.get("tutor_id"))) if info.get("tutor_id") else 0
    name = _first_name(info.get("user_name"))
    where = f"Lesson {lesson['position']} of {total}: \"{lesson['title']}\""
    if intro == "next":
        opening = f"The previous lesson is finished. Say a brief, upbeat transition and that you are now starting {where}."
    elif intro == "back":
        opening = f"Greet {name or 'the student'} by name, welcome them back in one short sentence and say you are continuing the course with {where}."
    else:
        opening = (
            f"This is the student's first session. Greet {name or 'the student'} by name in one short sentence, say you are "
            f"{info.get('tutor_name') or 'their tutor'} and that you will begin the course with {where}."
        )
    directive = (
        f"SESSION OPENING. {opening} Do NOT ask which topic they want to learn: the course plan decides. "
        "Keep this greeting to one or two sentences, then continue with the warm-up below.\n"
        + build_directive(state)
    )
    return TurnPrep(chunks=chunks[:4], in_bounds=True, directive=directive, mode="new_lesson", new_plan=True)


async def open_session(
    session_id: str,
    retrieve: Retrieve,
    client: Any,
    on_status: Optional[Callable[[str], Awaitable[None]]] = None,
) -> Optional[TurnPrep]:
    """
    The tutor's first words in a session. No topic question: resume the lesson in progress, otherwise start
    the student's next unfinished course lesson. None when the tutor has no lessons yet.
    """
    info = course.session_info(session_id)
    if not info or not info["tutor_id"] or not info["user_id"]:
        return None
    state = load_state(session_id)

    if state.plan and not state.done:
        focus = focus_text(state)
        chunks, _ = await asyncio.to_thread(retrieve, focus[:600]) if focus else ([], False)
        return TurnPrep(chunks=chunks, in_bounds=True, directive=resume_directive(state, _first_name(info["user_name"])), mode="resume")

    lessons = course.outline(info["tutor_id"], info["user_id"])
    if not lessons:
        return None
    upcoming = course.next_lesson(info["tutor_id"], info["user_id"])
    if upcoming:
        started_before = any(l["status"] != "not_started" for l in lessons)
        return await start_course_lesson(session_id, upcoming, client, on_status, intro="back" if started_before else "first")
    return TurnPrep(
        chunks=[], in_bounds=True, mode="complete",
        directive=(
            f"SESSION OPENING. The student ({_first_name(info['user_name']) or 'a returning student'}) has already completed every "
            "lesson in the course. Welcome them back, congratulate them in one sentence, and offer to review any part of the "
            "course or answer questions about it. Ask what they would like to go over."
        ),
    )
