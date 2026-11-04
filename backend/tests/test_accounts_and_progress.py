import asyncio
import json

from fastapi.testclient import TestClient

from app.main import app
from app.rag.retriever import retriever
from app.tutor import course, lesson
from app.tutor.memory import memory
from helpers import ADMIN, make_tutor, sign_up, upload_text

LONG = " ".join(f"Sentence {i} about plate tectonics and how continents drift over geological time." for i in range(60))


def test_chat_requires_an_account():
    with TestClient(app) as client:
        assert client.get("/api/chat/tutors").status_code == 401
        assert client.post("/api/chat/session/new", json={"tutor_id": "x"}).status_code == 401
        assert client.post("/api/chat/stream", json={"session_id": "s", "message": "hi"}).status_code == 401
        assert client.post("/api/chat/open", json={"session_id": "s"}).status_code == 401
        with client.websocket_connect("/api/chat/voice/s") as ws:
            assert "sign in" in ws.receive_json()["message"].lower()


def test_signup_login_logout():
    with TestClient(app) as client:
        token, user = sign_up(client, "Ada Lovelace")
        assert client.get("/api/auth/me").json()["user"]["name"] == "Ada Lovelace"
        assert client.post("/api/auth/signup", json={"name": "x", "email": user["email"], "password": "longenough1"}).status_code == 409
        assert client.post("/api/auth/signup", json={"name": "x", "email": "nope", "password": "longenough1"}).status_code == 422
        assert client.post("/api/auth/signup", json={"name": "x", "email": "a@b.co", "password": "short"}).status_code == 422
        assert client.post("/api/auth/login", json={"email": user["email"], "password": "wrong password"}).status_code == 401
        again = client.post("/api/auth/login", json={"email": user["email"], "password": "correct horse battery"})
        assert again.status_code == 200
        client.post("/api/auth/logout")
        assert client.get("/api/auth/me").status_code == 401
        client.headers["Authorization"] = f"Bearer {again.json()['token']}"
        assert client.get("/api/auth/me").status_code == 200


def test_a_student_cannot_touch_someone_elses_session():
    with TestClient(app) as client:
        tutor = make_tutor(client, "Private Tutor")
        try:
            upload_text(client, tutor, "a.txt", "Volcanoes erupt when magma rises through the crust.")
            sign_up(client, "Owner")
            sid = client.post("/api/chat/session/new", json={"tutor_id": tutor}).json()["session_id"]
            sign_up(client, "Intruder")
            assert client.get(f"/api/chat/history/{sid}").status_code == 404
            assert client.get(f"/api/chat/session/{sid}/state").status_code == 404
            assert client.post(f"/api/chat/session/{sid}/clear").status_code == 404
            assert client.post("/api/chat/open", json={"session_id": sid}).status_code == 404
            assert client.post("/api/chat/feedback", json={"session_id": sid, "message_id": "m", "rating": 1}).status_code == 404
        finally:
            client.delete(f"/api/admin/tutors/{tutor}", headers=ADMIN)


def test_outline_is_built_from_documents_and_long_documents_are_split():
    with TestClient(app) as client:
        tutor = make_tutor(client, "Outline Tutor")
        try:
            upload_text(client, tutor, "intro_to_rocks.txt", "Igneous rocks form when magma cools and hardens underground.")
            upload_text(client, tutor, "tectonics.txt", LONG)
            lessons = course.outline(tutor)
            titles = [l["title"] for l in lessons]
            assert titles[0] == "intro to rocks"
            assert len(lessons) > 2 and titles[1].startswith("tectonics (part 1 of ")
            assert [l["position"] for l in lessons] == list(range(1, len(lessons) + 1))

            # Instructor can rename and reorder; the new order sticks across re-syncs.
            reordered = [{"id": l["id"], "title": l["title"]} for l in reversed(lessons)]
            reordered[-1]["title"] = "Rocks 101"
            assert client.put(f"/api/admin/tutors/{tutor}/lessons", headers=ADMIN, json={"lessons": reordered}).status_code == 200
            after = course.outline(tutor)
            assert after[-1]["title"] == "Rocks 101" and after[0]["id"] == lessons[-1]["id"]
            assert client.put(f"/api/admin/tutors/{tutor}/lessons", headers=ADMIN, json={"lessons": reordered[:1]}).status_code == 422
        finally:
            client.delete(f"/api/admin/tutors/{tutor}", headers=ADMIN)


def test_batch_upload_keeps_the_order_the_instructor_chose():
    import io
    names = ["c_third.txt", "a_first.txt", "b_second.txt"]  # deliberately not alphabetical
    with TestClient(app) as client:
        tutor = make_tutor(client, "Batch Order Tutor")
        try:
            res = client.post(
                "/api/admin/documents/batch-upload", headers=ADMIN, data={"tutor_id": tutor},
                files=[("files", (n, io.BytesIO(f"Notes from {n} about volcanoes and magma.".encode()), "text/plain")) for n in names],
            )
            assert res.status_code == 200 and len(res.json()["successful"]) == 3, res.text
            assert [l["title"] for l in course.outline(tutor)] == ["c third", "a first", "b second"]
        finally:
            client.delete(f"/api/admin/tutors/{tutor}", headers=ADMIN)


def test_lessons_start_automatically_and_progress_is_saved_per_student():
    """The tutor never asks what to study: it opens lesson 1, finishes it, then moves on, and progress outlives the session."""
    with TestClient(app) as client:
        tutor = make_tutor(client, "Course Tutor")
        try:
            upload_text(client, tutor, "one.txt", "Photosynthesis lets plants turn sunlight, water and carbon dioxide into sugar and oxygen.")
            upload_text(client, tutor, "two.txt", "Cellular respiration releases the energy stored in sugar so that cells can do work.")
            retrieve = retriever.for_tutor(tutor)

            _, ada = sign_up(client, "Ada Lovelace")
            sid = client.post("/api/chat/session/new", json={"tutor_id": tutor}).json()["session_id"]

            prep = asyncio.run(lesson.open_session(sid, retrieve, None))
            assert prep.new_plan and "SESSION OPENING" in prep.directive
            assert "Ada" in prep.directive and "Lesson 1 of 2" in prep.directive
            assert "Do NOT ask which topic" in prep.directive
            state = client.get(f"/api/chat/session/{sid}/state").json()
            assert state["course"]["current_position"] == 1 and state["course"]["completed"] == 0

            # Opening again mid-lesson resumes instead of restarting.
            resumed = asyncio.run(lesson.open_session(sid, retrieve, None))
            assert resumed.mode == "resume" and "WELCOME BACK" in resumed.directive

            # Ending the lesson keeps the place; reconnecting later resumes it instead of restarting.
            tutor_reply_msg = memory.add_message(sid, "assistant", "ok")
            ended = asyncio.run(lesson.prepare_turn(sid, "I want to end the lesson", "end", retrieve, None))
            assert ended.mode == "end" and lesson.load_state(sid).paused == 2
            progress_now = client.get(f"/api/chat/tutors/{tutor}/course").json()
            assert progress_now["completed"] == 0
            back = asyncio.run(lesson.open_session(sid, retrieve, None))
            assert back.mode == "resume" and lesson.load_state(sid).paused == 0

            # Finish the lesson (confirming every checkpoint). Progress is recorded step by step, not just at the end.
            seen = []
            for _ in range(40):
                if lesson.load_state(sid).done:
                    break
                memory.add_message(sid, "assistant", "ok")
                asyncio.run(lesson.prepare_turn(sid, "yes I am ready", "yes", retrieve, None))
                lessons_now = client.get(f"/api/chat/tutors/{tutor}/course").json()["lessons"]
                seen.append(lessons_now[0]["percent"])
            assert seen[0] > 0 and seen == sorted(seen) and 0 < seen[-2] < 100, seen
            assert lesson.public_state(sid)["course"]["lessons"][0]["percent"] == 100
            assert lesson.load_state(sid).done
            progress = client.get(f"/api/chat/tutors/{tutor}/course").json()
            assert progress["completed"] == 1 and progress["lessons"][0]["status"] == "completed"
            assert progress["lessons"][0]["percent"] == 100 and progress["percent"] == 50  # 1 of 2 lessons done

            # "ready" after the wrap-up starts lesson 2 directly.
            memory.add_message(sid, "assistant", "ok")
            nxt = asyncio.run(lesson.prepare_turn(sid, "yes", "yes", retrieve, None))
            assert nxt.new_plan and "Lesson 2 of 2" in nxt.directive
            assert client.get(f"/api/chat/session/{sid}/state").json()["course"]["current_position"] == 2

            # A brand-new session (or device) still knows lesson 1 is done and goes to lesson 2.
            fresh = client.post("/api/chat/session/new", json={"tutor_id": tutor, "fresh": True}).json()["session_id"]
            assert fresh != sid
            again = asyncio.run(lesson.open_session(fresh, retrieve, None))
            assert "Lesson 2 of 2" in again.directive and "continuing the course" in again.directive
            tutors = {t["id"]: t for t in client.get("/api/chat/tutors").json()["tutors"]}
            assert tutors[tutor]["lesson_count"] == 2 and tutors[tutor]["completed_lessons"] == 1

            # Another student starts from the beginning.
            sign_up(client, "Grace Hopper")
            other = client.post("/api/chat/session/new", json={"tutor_id": tutor}).json()["session_id"]
            assert other not in (sid, fresh)
            first = asyncio.run(lesson.open_session(other, retrieve, None))
            assert "Lesson 1 of 2" in first.directive and "first session" in first.directive

            # Text flow: the tutor speaks first via /open, then it refuses to open twice.
            events = [json.loads(l[6:]) for l in client.post("/api/chat/open", json={"session_id": other}).text.splitlines() if l.startswith("data: ")]
            assert any(e["type"] == "token" for e in events) and events[-1]["type"] == "done"
            assert not any("what topic" in e.get("content", "").lower() for e in events)
            second = [json.loads(l[6:]) for l in client.post("/api/chat/open", json={"session_id": other}).text.splitlines() if l.startswith("data: ")]
            assert [e["type"] for e in second] == ["done"]
        finally:
            client.delete(f"/api/admin/tutors/{tutor}", headers=ADMIN)
