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
using ONLY the curriculum excerpts below. Do not invent facts that are not in the excerpts. Be CONCISE: every string is one short sentence or phrase.

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
            "SELECT lesson_plan, lesson_beat, lesson_holds, lesson_marker FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
    if not row or not row["lesson_plan"]:
        return LessonState()
    try:
        plan = json.loads(row["lesson_plan"])
    except ValueError:
        return LessonState()
    return LessonState(
        plan=plan,
        beat=row["lesson_beat"] if row["lesson_beat"] is not None else 0,
        holds=row["lesson_holds"] or 0,
        marker=row["lesson_marker"] if row["lesson_marker"] is not None else -1,
    )


def save_state(session_id: str, state: LessonState) -> None:
    with get_db() as db:
        db.execute(
            """UPDATE sessions SET lesson_plan = ?, lesson_beat = ?, lesson_holds = ?, lesson_marker = ?,
               lesson_stage = ?, current_topic = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?""",
            (
                json.dumps(state.plan) if state.plan else None,
                state.beat,
                state.holds,
                state.marker,
                state.stage,
                state.plan["topic"] if state.plan else None,
                session_id,
            ),
        )
        db.commit()


def reset_lesson(session_id: str) -> None:
    """Forget the current plan so the next question starts a fresh lesson (conversation is kept)."""
    save_state(session_id, LessonState())


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


def classify_turn(state: LessonState, text: str) -> str:
    """new_lesson | continue | side_question | closing"""
    t = _norm(text)
    if not state.plan:
        return "new_lesson"
    if any(p in t for p in _SWITCH):
        return "new_lesson"
    if state.done:
        return "closing" if is_acknowledgement(text) or len(t.split()) <= 2 else "new_lesson"
    if "?" in t and len(t.split()) >= 4 and not any(p in t for p in _HOLD):
        return "side_question"
    return "continue"


def wants_hold(text: str) -> bool:
    t = _norm(text)
    return any(p in t for p in _HOLD)


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
    header = f"Lesson: {plan['topic']}. Objective: {plan['objective']}\n"

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
            "Do NOT teach any of the points yet. End by asking the student for a quick guess or reaction."
        )
    elif stage == "LEARN":
        item = plan["learn"][idx]
        body = (
            f"PHASE 2 of 4 - LEARN, point {idx + 1} of {n_learn}: \"{item['point']}\". "
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
            f"PHASE 3 of 4 - PRACTICE, task {idx + 1} of {n_practice}. {lead}"
            f"set this task: {item['task']} "
            + (f"If they ask for help, you may give this hint: {item['hint']} " if item["hint"] else "")
            + "Ask them to try it. Do NOT give the answer."
        )
    else:  # RECAP
        suggestion = f" Suggest what to study next: {plan['next_up']}." if plan["next_up"] else ""
        body = (
            "PHASE 4 of 4 - RECAP. "
            + ("Give no feedback (the student only acknowledged); " if ack else "Give specific feedback on the student's last attempt, then ")
            + "summarise the key "
            f"takeaways in clear spoken sentences: {' | '.join(plan['takeaways'])}. "
            f"Acknowledge their progress.{suggestion} Finish by asking what they would like to study next."
        )

    if mode == "side_question":
        body = (
            "SIDE QUESTION. Answer the student's question briefly (2 to 4 sentences) using only the curriculum "
            "context. Then gently bring them back to the lesson and continue where you were. "
            "Do NOT advance to a new phase or point this turn. Where you were: " + body
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
                "complete": False, "objective": "", "phases": [], "beat": 0, "total_beats": 0}

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
    }


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

    if mode == "continue":
        assistant_count = memory.count_assistant_messages(session_id)
        hold = False
        if state.marker != assistant_count:  # a duplicate tool call for the same turn must not advance twice
            hold = wants_hold(user_message) and state.holds < MAX_HOLDS
            if hold:
                state.holds += 1
            else:
                state.beat += 1
                state.holds = 0
            state.marker = assistant_count
            save_state(session_id, state)
        else:
            hold = state.holds > 0
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
    return TurnPrep(chunks=chunks, in_bounds=True, directive=build_directive(state), mode=mode, new_plan=True)
