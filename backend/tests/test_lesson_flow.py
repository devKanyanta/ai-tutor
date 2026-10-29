import asyncio

from app.tutor import lesson
from app.tutor.memory import memory

CHUNKS = [
    {"filename": "notes.txt", "chunk_index": i, "snippet": s, "score": 0.9,
     "content": f"{s} This is an important idea in the course that students should understand well."}
    for i, s in enumerate([
        "Photosynthesis converts light energy into chemical energy stored in sugars",
        "Chlorophyll absorbs mostly red and blue light and reflects green light",
        "The light reactions happen in the thylakoid membranes of the chloroplast",
    ])
]


def fake_retrieve(query, top_k=None):
    return list(CHUNKS), True


def run(session_id, message, retrieve=fake_retrieve):
    return asyncio.run(lesson.prepare_turn(session_id, message, message, retrieve, None))


def tutor_replies(session_id, n=1):
    for _ in range(n):  # a saved tutor reply is what makes the next student turn count as new
        memory.add_message(session_id, "assistant", "ok")


def test_classify_turn():
    empty = lesson.LessonState()
    assert lesson.classify_turn(empty, "Teach me about photosynthesis") == "new_lesson"
    plan = lesson.fallback_plan("photosynthesis", CHUNKS)
    active = lesson.LessonState(plan=plan, beat=1)
    assert lesson.classify_turn(active, "I think it makes sugar") == "continue"
    assert lesson.classify_turn(active, "ok") == "continue"
    assert lesson.classify_turn(active, "Why is chlorophyll green exactly?") == "side_question"
    assert lesson.classify_turn(active, "let's talk about something else") == "new_lesson"
    done = lesson.LessonState(plan=plan, beat=len(plan_beats(plan)))
    assert lesson.classify_turn(done, "thanks") == "closing"
    assert lesson.classify_turn(done, "now explain the Calvin cycle in detail") == "new_lesson"


def plan_beats(plan):
    return lesson.build_beats(plan)


def test_full_lesson_advances_automatically_through_every_phase():
    sid = memory.get_or_create_session()
    first = run(sid, "Teach me about photosynthesis")
    assert first.new_plan and "WARM-UP" in first.directive
    state = lesson.load_state(sid)
    total = len(state.beats)
    seen = [state.stage]

    for _ in range(total):  # one student reply per remaining step, plus the closing turn
        tutor_replies(sid)
        run(sid, "I think it is about sunlight and plants")
        seen.append(lesson.load_state(sid).stage)

    assert seen[0] == "WARMUP"
    assert seen.index("LEARN") < seen.index("PRACTICE") < seen.index("RECAP") < seen.index("DONE")
    assert lesson.public_state(sid)["complete"] is True


def test_struggling_student_holds_then_moves_on():
    sid = memory.get_or_create_session()
    run(sid, "Teach me about photosynthesis")
    tutor_replies(sid)
    run(sid, "sounds interesting")                      # warm-up -> learn 1
    assert lesson.load_state(sid).beat == 1
    for expected_holds in (1, 2):
        tutor_replies(sid)
        prep = run(sid, "I'm confused, I don't understand")
        assert lesson.load_state(sid).beat == 1          # held on the same step
        assert lesson.load_state(sid).holds == expected_holds
        assert "NEEDS HELP" in prep.directive
    tutor_replies(sid)
    run(sid, "I'm still confused")                       # holds exhausted: move on rather than loop forever
    assert lesson.load_state(sid).beat == 2


def test_side_question_does_not_advance_and_duplicate_turn_is_ignored():
    sid = memory.get_or_create_session()
    run(sid, "Teach me about photosynthesis")
    tutor_replies(sid)
    prep = run(sid, "Why is chlorophyll green exactly?")
    assert prep.mode == "side_question" and "SIDE QUESTION" in prep.directive
    assert lesson.load_state(sid).beat == 0

    run(sid, "I guess because it reflects green light")  # advances to learn 1
    beat = lesson.load_state(sid).beat
    run(sid, "I guess because it reflects green light")  # same turn repeated (duplicate tool call)
    assert lesson.load_state(sid).beat == beat == 1


def test_acknowledgement_is_not_critiqued_and_new_topic_resets_plan():
    sid = memory.get_or_create_session()
    run(sid, "Teach me about photosynthesis")
    tutor_replies(sid)
    run(sid, "sure")
    tutor_replies(sid)
    prep = run(sid, "ok")
    assert "only acknowledged" in prep.directive
    lesson.reset_lesson(sid)
    assert lesson.load_state(sid).plan is None
    assert lesson.public_state(sid)["phases"] == []


def test_lesson_state_endpoint_and_reset():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as client:
        sid = client.post("/api/chat/session/new").json()["session_id"]
        state = client.get(f"/api/chat/session/{sid}/state").json()
        assert state["lesson_stage"] == "INIT" and state["phases"] == []
        run(sid, "Teach me about photosynthesis")
        state = client.get(f"/api/chat/session/{sid}/state").json()
        assert [p["label"] for p in state["phases"]] == ["Warm-up", "Learn", "Practice", "Recap"]
        assert state["phases"][0]["status"] == "current"
        reset = client.post(f"/api/chat/session/{sid}/lesson/reset").json()
        assert reset["phases"] == []
