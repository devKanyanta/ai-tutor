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


def tutor_reply(session_id):
    memory.add_message(session_id, "assistant", "ok")  # a saved tutor reply makes the next student turn count


def say(session_id, message):
    """One full exchange: the student speaks, the lesson reacts, the tutor replies."""
    prep = run(session_id, message)
    tutor_reply(session_id)
    return prep


def new_lesson():
    sid = memory.get_or_create_session()
    say(sid, "Teach me about photosynthesis")
    return sid


def go_to_checkpoint(sid, stage):
    """Drive the lesson (confirming every checkpoint) until the checkpoint at the end of `stage` is open."""
    for _ in range(40):
        state = lesson.load_state(sid)
        if state.gate and state.stage == stage:
            return
        say(sid, "yes, let's move on" if lesson.awaiting_confirmation(state) else "I think it is about sunlight and plants")
    raise AssertionError(f"never reached the {stage} checkpoint")


def test_classify_turn():
    assert lesson.classify_turn(lesson.LessonState(), "Teach me about photosynthesis") == "new_lesson"
    plan = lesson.fallback_plan("photosynthesis", CHUNKS)
    learning = lesson.LessonState(plan=plan, beat=1)
    assert lesson.classify_turn(learning, "I think it makes sugar") == "continue"
    assert lesson.classify_turn(learning, "ok") == "continue"
    assert lesson.classify_turn(learning, "Why is chlorophyll green exactly?") == "side_question"
    # Voice transcripts often have no question mark.
    assert lesson.classify_turn(learning, "what does chlorophyll actually absorb") == "side_question"
    assert lesson.classify_turn(learning, "let's talk about something else") == "new_lesson"
    done = lesson.LessonState(plan=plan, beat=len(lesson.build_beats(plan)))
    assert lesson.classify_turn(done, "thanks") == "closing"
    assert lesson.classify_turn(done, "now explain the Calvin cycle in detail") == "new_lesson"


def test_ready_confirmation_is_strict():
    for yes in ("yes", "yeah I'm ready", "ok let's go", "sure, move on", "yes please continue"):
        assert lesson.is_ready_confirmation(yes), yes
    for no in ("not yet", "no wait", "I have a question first", "can you explain that again", "hmm", "I think it is sunlight"):
        assert not lesson.is_ready_confirmation(no), no


def test_every_phase_change_needs_a_yes_and_the_lesson_completes():
    sid = new_lesson()
    seen = [lesson.load_state(sid).stage]
    for _ in range(40):
        state = lesson.load_state(sid)
        if state.done:
            break
        say(sid, "yes, let's move on" if lesson.awaiting_confirmation(state) else "I think it is about sunlight and plants")
        seen.append(lesson.load_state(sid).stage)
    order = [s for i, s in enumerate(seen) if i == 0 or s != seen[i - 1]]
    assert order == ["WARMUP", "LEARN", "PRACTICE", "RECAP", "DONE"]
    assert lesson.public_state(sid)["complete"] is True


def test_warmup_waits_for_the_student_to_be_ready():
    sid = new_lesson()
    prep = say(sid, "sounds interesting to me")   # a comment is not a yes
    assert lesson.load_state(sid).stage == "WARMUP" and "PHASE CHECKPOINT" in prep.directive
    assert lesson.public_state(sid)["awaiting_confirmation"] == "Learn"
    say(sid, "yes ready")
    assert lesson.load_state(sid).stage == "LEARN"


def test_a_question_never_moves_the_lesson_to_the_next_phase():
    sid = new_lesson()
    go_to_checkpoint(sid, "LEARN")                 # last learn point answered, checkpoint asks about Practice
    state = lesson.load_state(sid)
    beat = state.beat
    assert lesson.public_state(sid)["awaiting_confirmation"] == "Practice"

    prep = say(sid, "Why is chlorophyll green exactly?")      # a question at the checkpoint
    assert prep.mode == "side_question"
    assert lesson.load_state(sid).stage == "LEARN" and lesson.load_state(sid).beat == beat

    prep = say(sid, "not yet, I want to go over that again")  # not ready
    assert lesson.load_state(sid).stage == "LEARN" and "PHASE CHECKPOINT" in prep.directive

    say(sid, "ok yes let's go on")                            # clear yes
    assert lesson.load_state(sid).stage == "PRACTICE"


def test_question_in_the_middle_of_learn_keeps_the_step():
    sid = new_lesson()
    say(sid, "yes ready")
    beat = lesson.load_state(sid).beat
    prep = say(sid, "what does chlorophyll actually absorb")
    assert prep.mode == "side_question" and "SIDE QUESTION" in prep.directive
    assert lesson.load_state(sid).beat == beat


def test_struggling_student_holds_then_moves_on():
    sid = new_lesson()
    say(sid, "yes ready")                                     # warm-up -> learn 1
    beat = lesson.load_state(sid).beat
    for expected_holds in (1, 2):
        prep = say(sid, "I'm confused, I don't understand")
        assert lesson.load_state(sid).beat == beat and lesson.load_state(sid).holds == expected_holds
        assert "NEEDS HELP" in prep.directive
    say(sid, "I'm still confused")                            # holds exhausted: move on rather than loop forever
    assert lesson.load_state(sid).beat > beat or lesson.load_state(sid).gate


def test_duplicate_turn_is_ignored():
    sid = new_lesson()
    run(sid, "yes ready")                                     # tutor has not replied yet
    beat = lesson.load_state(sid).beat
    run(sid, "yes ready")                                     # same turn repeated (duplicate tool call)
    assert lesson.load_state(sid).beat == beat == 1


def test_acknowledgement_is_not_critiqued_and_new_topic_resets_plan():
    sid = new_lesson()
    say(sid, "sure")
    prep = say(sid, "ok")
    assert "only acknowledged" in prep.directive
    lesson.reset_lesson(sid)
    assert lesson.load_state(sid).plan is None
    assert lesson.public_state(sid)["phases"] == []


def test_practice_needs_a_real_attempt_before_the_checkpoint():
    sid = new_lesson()
    go_to_checkpoint(sid, "LEARN")
    say(sid, "yes")                                           # confirm -> Practice task 1
    state = lesson.load_state(sid)
    assert state.stage == "PRACTICE"
    beat = state.beat

    prep = say(sid, "ok")                                     # no attempt: hold, encourage a go
    assert lesson.load_state(sid).beat == beat and "NOT ATTEMPTED" in prep.directive

    say(sid, "Plants take in carbon dioxide and make sugar using light")  # a real attempt moves on
    after = lesson.load_state(sid)
    assert after.beat == beat + 1 or after.gate


def test_voice_commit_follows_the_same_checkpoint_rules():
    sid = new_lesson()
    go_to_checkpoint(sid, "LEARN")
    tutor_reply(sid)
    lesson.commit_turn(sid, "why is chlorophyll green exactly")   # a question: no change
    assert lesson.load_state(sid).stage == "LEARN"
    lesson.commit_turn(sid, "not yet")                            # not ready: stays at the checkpoint
    assert lesson.load_state(sid).stage == "LEARN" and lesson.load_state(sid).gate
    tutor_reply(sid)
    lesson.commit_turn(sid, "yes")                                # clear yes: now it crosses
    assert lesson.load_state(sid).stage == "PRACTICE"


def test_lesson_state_endpoint_and_reset():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.config import settings
    with TestClient(app) as client:
        from helpers import sign_up
        sign_up(client)
        tid = client.post(
            "/api/admin/tutors",
            headers={"Authorization": f"Bearer {settings.ADMIN_TOKEN}"},
            json={"name": "Lesson Flow Tutor"},
        ).json()["id"]
        sid = client.post("/api/chat/session/new", json={"tutor_id": tid}).json()["session_id"]
        state = client.get(f"/api/chat/session/{sid}/state").json()
        assert state["lesson_stage"] == "INIT" and state["phases"] == []
        run(sid, "Teach me about photosynthesis")
        state = client.get(f"/api/chat/session/{sid}/state").json()
        assert [p["label"] for p in state["phases"]] == ["Warm-up", "Learn", "Practice", "Recap"]
        assert state["phases"][0]["status"] == "current"
        reset = client.post(f"/api/chat/session/{sid}/lesson/reset").json()
        assert reset["phases"] == []
        client.delete(f"/api/admin/tutors/{tid}", headers={"Authorization": f"Bearer {settings.ADMIN_TOKEN}"})


# --------------------------------------------------------------------------- ending and breaks
def test_end_and_break_phrases_are_recognised_but_not_over_matched():
    for text in ("I want to end the lesson", "let's stop for now", "I'm done", "that's all for today", "stop the lesson please"):
        assert lesson.wants_end(text), text
    for text in ("let's take a break", "I need a quick break", "give me a minute", "can we pause", "brb"):
        assert lesson.wants_break(text), text
    for text in (
        "I'm done with this question, is it 42?",
        "what happens at the end of the lesson plan in chapter two",
        "the thread will pause until the lock is released and then it continues to run",
    ):
        assert not lesson.wants_end(text) and not lesson.wants_break(text), text
    assert lesson.wants_back("ok I'm back") and lesson.wants_back("ready to continue")
    assert not lesson.wants_back("let's take a break")


def test_a_break_freezes_the_lesson_until_the_student_is_back():
    sid = new_lesson()
    before = lesson.load_state(sid)
    tutor_reply(sid)
    prep = run(sid, "I need a break")
    assert prep.mode == "break" and "BREAK" in prep.directive and "Do NOT teach" in prep.directive
    paused = lesson.load_state(sid)
    assert paused.paused == 1 and paused.beat == before.beat   # nothing advanced
    assert lesson.public_state(sid)["paused"] == "break"
    assert lesson.commit_turn(sid, "mm") .beat == before.beat    # voice commit does not advance a paused lesson

    # Small talk while away does not restart anything.
    tutor_reply(sid)
    assert "STILL ON A BREAK" in run(sid, "ok thanks").directive
    assert lesson.load_state(sid).paused == 1

    tutor_reply(sid)
    back = run(sid, "I'm back, let's continue")
    assert back.mode == "resume" and "WELCOME BACK" in back.directive
    state = lesson.load_state(sid)
    assert state.paused == 0 and state.beat == before.beat
    assert lesson.public_state(sid)["paused"] == ""


def test_ending_a_lesson_keeps_the_place_and_does_not_complete_it():
    sid = new_lesson()
    tutor_reply(sid)
    say(sid, "yes ready")
    place = lesson.load_state(sid).beat
    tutor_reply(sid)
    prep = run(sid, "I want to end the lesson")
    assert prep.mode == "end" and "END OF LESSON" in prep.directive and "progress is saved" in prep.directive
    state = lesson.load_state(sid)
    assert state.paused == 2 and state.beat == place and not state.done
    assert lesson.public_state(sid)["paused"] == "ended" and not lesson.public_state(sid)["complete"]

    # Saying they are back picks up exactly where they stopped.
    tutor_reply(sid)
    back = run(sid, "I'm ready to continue")
    assert back.mode == "resume" and "WELCOME BACK" in back.directive
    assert lesson.load_state(sid).paused == 0 and lesson.load_state(sid).beat == place


def test_asking_a_real_question_while_on_a_break_resumes_normally():
    sid = new_lesson()
    tutor_reply(sid)
    run(sid, "give me a minute")
    tutor_reply(sid)
    prep = run(sid, "wait, why does the light matter for this?")
    assert prep.mode == "side_question"
    assert lesson.load_state(sid).paused == 0


def test_every_excerpt_is_taught_by_some_point():
    chunks = [{"filename": "n.txt", "chunk_index": i, "content": f"Fact number {i} about rivers."} for i in range(6)]
    plan = lesson.normalize_plan(lesson.LessonPlan(
        topic="Rivers", objective="o", hook="h", roadmap=["a"], takeaways=["t"], practice=[],
        learn=[lesson.LearnItem(point="Source", sections=[1]), lesson.LearnItem(point="Flow", sections=[2, 5])],  # 3, 4, 6 unassigned
    ), chunks)
    taught = sorted(s["chunk_index"] for item in plan["learn"] for s in item["sources"])
    assert taught == [0, 1, 2, 3, 4, 5]

    state = lesson.LessonState(plan=plan, beat=1)  # first learn point
    context = lesson.beat_context(state, [{"filename": "x", "chunk_index": 99, "content": "other"}])
    assert [c["chunk_index"] for c in context[:len(plan["learn"][0]["sources"])]] == [s["chunk_index"] for s in plan["learn"][0]["sources"]]
    assert "slowly and in detail" in lesson.build_directive(state)


def test_fallback_plan_covers_each_excerpt_and_lessons_can_have_many_points():
    chunks = [{"filename": "n.txt", "chunk_index": i, "content": f"This is a reasonably long sentence number {i} about volcanoes."} for i in range(9)]
    plan = lesson.fallback_plan("Volcanoes", chunks)
    assert len(plan["learn"]) == 9
    assert sorted(s["chunk_index"] for it in plan["learn"] for s in it["sources"]) == list(range(9))


def test_document_metadata_is_not_taught():
    chunks = [
        {"filename": "n.txt", "chunk_index": 0, "content": "University of Lusaka\nDepartment of Biology\nCourse: BIO 101 Introduction to Biology\nLecturer: Dr A. Phiri\nPage 1 of 40"},
        {"filename": "n.txt", "chunk_index": 1, "content": "Cells are the basic units of life.\nPage 2 of 40\nAll cells have a membrane."},
    ]
    plan = lesson.normalize_plan(lesson.LessonPlan(
        topic="Cells", objective="o", hook="h", roadmap=["a"], takeaways=["t"], practice=[],
        learn=[lesson.LearnItem(point="Cells", sections=[2])], skipped_sections=[1],
    ), chunks)
    text = " ".join(s["content"] for it in plan["learn"] for s in it["sources"])
    assert "University" not in text and "Lecturer" not in text and "Page 2" not in text
    assert "basic units of life" in text and "membrane" in text
    # Even if the planner forgot to skip the title page, it is not forced onto a point.
    plan = lesson.normalize_plan(lesson.LessonPlan(
        topic="Cells", objective="o", hook="h", roadmap=["a"], takeaways=["t"], practice=[],
        learn=[lesson.LearnItem(point="Cells", sections=[2])],
    ), chunks)
    assert [s["chunk_index"] for it in plan["learn"] for s in it["sources"]] == [1]
    assert "never mention or ask about the document itself" in lesson.build_directive(lesson.LessonState(plan=plan, beat=1))
